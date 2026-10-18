import type { BreathRecord } from "./types";

/**
 * Gas-exchange characteristics of a Patient Profile.
 * Dead space has an anatomic part (a fixed volume) and an alveolar part (a fraction of
 * the remaining volume), so Vd/Vt rises as Vt falls.
 */
export interface GasParams {
  /** CO2 production (mL/min). */
  vco2: number;
  /** Anatomic + apparatus dead space (L). */
  anatomicDeadSpace: number;
  /** Fraction of the remaining (alveolar) tidal volume that reaches unperfused alveoli. */
  alveolarDeadSpaceFraction: number;
  /** True shunt with no PEEP (fraction of cardiac output). */
  shuntMax: number;
  /** Fraction of shunt that PEEP can recruit (0–1). */
  recruitableFraction: number;
  /** End-expiratory alveolar pressure at which half the recruitable shunt is recruited (cmH2O). */
  peepHalf: number;
  /** Low V/Q venous admixture at room air; it fades as FiO2 rises toward 1. */
  vqMismatch: number;
  /** Plasma bicarbonate (mmol/L), fixed for the profile. */
  hco3: number;
  /** Haemoglobin (g/dL). */
  hb: number;
}

export interface BloodGas {
  pao2: number;
  paco2: number;
  ph: number;
  etco2: number;
  spo2: number;
  /** PaO2 / FiO2. */
  pf: number;
  /** Alveolar ventilation over the last 30 s (L/min). */
  va: number;
  /** Current effective shunt fraction including V/Q admixture. */
  shunt: number;
}

const PATM = 760;
const PH2O = 47;
const RQ = 0.8;
/** Effective CO2 store (mL/mmHg): gives τ ≈ 2–3 min at normal alveolar ventilation. */
const CO2_CAPACITY = 13;
/** Arteriovenous O2 content difference (mL/dL). */
const AV_DIFF = 5;
const PAO2_TAU = 45;
const RECRUIT_WIDTH = 3;
const VA_WINDOW = 30;
/** No breath for this long and EtCO2 reads 0. */
const ETCO2_TIMEOUT = 15;

/** Severinghaus O2 dissociation curve: SaO2 (0–1) from PO2 (mmHg). */
export function o2Saturation(po2: number): number {
  const p = Math.max(po2, 0.1);
  return 1 / (23400 / (p ** 3 + 150 * p) + 1);
}

export function o2Content(po2: number, hb: number): number {
  return 1.34 * hb * o2Saturation(po2) + 0.003 * po2;
}

function po2FromContent(content: number, hb: number): number {
  let lo = 0.1;
  let hi = PATM;
  if (o2Content(hi, hb) <= content) return hi;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (o2Content(mid, hb) < content) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface GasInputs {
  fio2: number;
  /** End-expiratory alveolar pressure (cmH2O): drives recruitment. */
  endExpAlveolarPressure: number;
  /**
   * Fraction of the recruitable lung open at end expiration, when the lung model tracks
   * recruitment (M11). Without it, recruitment follows end-expiratory pressure.
   */
  endExpRecruited?: number;
}

/** Steady-state targets and the dynamic arterial state. */
export class GasExchange {
  private alveolarVolumes: { start: number; t: number; v: number; vInspired: number }[] = [];
  private lastBreathEnd = -Infinity;
  private lastTidalVolume = 0;
  private paco2: number | null = null;
  private pao2: number | null = null;
  private latest: BloodGas | null = null;

  constructor(public params: GasParams) {}

  get state(): BloodGas | null {
    return this.latest;
  }

  get primed(): boolean {
    return this.paco2 !== null;
  }

  onBreath(b: BreathRecord): void {
    const p = this.params;
    const alveolar = (vt: number) =>
      Math.max(0, vt - p.anatomicDeadSpace) * (1 - p.alveolarDeadSpaceFraction);
    this.alveolarVolumes.push({
      start: b.startTime,
      t: b.endTime,
      v: alveolar(b.lungVte),
      vInspired: alveolar(b.lungVti),
    });
    this.lastBreathEnd = b.endTime;
    this.lastTidalVolume = b.lungVte;
  }

  /**
   * Alveolar ventilation (L/min) from whole breaths that ended in the last 30 s. The span runs
   * from the first counted breath's start to the last one's end. If breathing stops, the span
   * stretches to now so V_A falls toward zero.
   */
  alveolarVentilation(t: number, inspired = false): number {
    this.alveolarVolumes = this.alveolarVolumes.filter((x) => x.t > t - VA_WINDOW);
    const first = this.alveolarVolumes[0];
    const last = this.alveolarVolumes.at(-1);
    if (!first || !last) return 0;
    let span = last.t - first.start;
    const period = span / this.alveolarVolumes.length;
    if (t - last.t > 2 * period) span = t - first.start;
    if (span <= 0) return 0;
    const sum = this.alveolarVolumes.reduce((s, x) => s + (inspired ? x.vInspired : x.v), 0);
    return (sum * 60) / span;
  }

  shuntFraction(inputs: GasInputs): number {
    const p = this.params;
    const s =
      inputs.endExpRecruited ??
      1 / (1 + Math.exp(-(inputs.endExpAlveolarPressure - p.peepHalf) / RECRUIT_WIDTH));
    const trueShunt = p.shuntMax * (1 - p.recruitableFraction * s);
    const admixture = p.vqMismatch * Math.max(0, (1 - inputs.fio2) / (1 - 0.21));
    return Math.min(0.95, trueShunt + admixture);
  }

  targets(t: number, inputs: GasInputs, inspired = false): { paco2: number; pao2: number } {
    const va = this.alveolarVentilation(t, inspired);
    const paco2 = va > 0.05 ? Math.min(200, (0.863 * this.params.vco2) / va) : 200;
    return { paco2, pao2: this.pao2Target(paco2, inputs) };
  }

  private pao2Target(paco2: number, inputs: GasInputs): number {
    const hb = this.params.hb;
    const pAO2 = Math.max(0, inputs.fio2 * (PATM - PH2O) - paco2 / RQ);
    const cc = o2Content(pAO2, hb);
    const s = this.shuntFraction(inputs);
    // CaO2 = (1−s)·Cc + s·Cv and Cv = CaO2 − a-v difference.
    const ca = Math.max(0.5, cc - (s * AV_DIFF) / (1 - s));
    return po2FromContent(ca, hb);
  }

  /**
   * Snap to steady state (used once the initial breaths have filled the window). Uses inspired
   * volumes: at steady state Vte = Vti, but while air trapping builds up the first exhaled
   * volumes are smaller and would overstate PaCO2.
   */
  prime(t: number, inputs: GasInputs): void {
    const tg = this.targets(t, inputs, true);
    this.paco2 = tg.paco2;
    this.pao2 = tg.pao2;
    this.latest = this.snapshot(t, inputs);
  }

  /** Advance arterial values by `dt` seconds of physiological time. */
  step(t: number, dt: number, inputs: GasInputs): BloodGas | null {
    if (this.paco2 === null || this.pao2 === null) return null;
    const va = this.alveolarVentilation(t);

    // CO2 mass balance: C·dP/dt = VCO2 − VA·P/0.863 (exact solution over dt).
    const a = this.params.vco2 / CO2_CAPACITY / 60;
    const b = va / (0.863 * CO2_CAPACITY) / 60;
    this.paco2 = b > 0 ? a / b + (this.paco2 - a / b) * Math.exp(-b * dt) : this.paco2 + a * dt;
    this.paco2 = Math.min(this.paco2, 200);

    const target = this.pao2Target(this.paco2, inputs);
    this.pao2 = target + (this.pao2 - target) * Math.exp(-dt / PAO2_TAU);

    this.latest = this.snapshot(t, inputs);
    return this.latest;
  }

  private snapshot(t: number, inputs: GasInputs): BloodGas {
    const p = this.params;
    const paco2 = this.paco2 ?? 40;
    const pao2 = this.pao2 ?? 90;
    const breathing =
      t - this.lastBreathEnd < ETCO2_TIMEOUT && this.lastTidalVolume > p.anatomicDeadSpace;
    return {
      pao2,
      paco2,
      ph: 6.1 + Math.log10(p.hco3 / (0.03 * paco2)),
      etco2: breathing ? paco2 * (1 - p.alveolarDeadSpaceFraction) : 0,
      spo2: 100 * o2Saturation(pao2),
      pf: pao2 / inputs.fio2,
      va: this.alveolarVentilation(t),
      shunt: this.shuntFraction(inputs),
    };
  }
}
