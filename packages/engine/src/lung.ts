import type { Mechanics } from "./types";

/**
 * A lung model maps elastic volume, muscle pressure and airway-opening pressure to flow.
 * `volume` is elastic volume above the relaxation volume (L); this keeps the model swappable
 * for curved-compliance or two-compartment versions later.
 */
export interface LungModel {
  /** Alveolar pressure (cmH2O): elastic recoil minus Muscle Pressure. */
  alveolarPressure(volume: number, pmus: number): number;
  /** Flow (L/s, + = inspiratory) when airway-opening pressure is `paw`. */
  flow(paw: number, volume: number, pmus: number): number;
  /** Airway-opening pressure needed to drive `flow`. */
  pressureForFlow(flow: number, volume: number, pmus: number): number;
  /** Elastic volume at which alveolar pressure equals `pressure` with no effort. */
  volumeAtPressure(pressure: number): number;
}

/** Expiratory resistance never rises above this multiple of R_exp (keeps exhalation finite). */
const MAX_COLLAPSE_FACTOR = 2;

/**
 * Recruitment (M11). Lung units close below a closing pressure and reopen only above a higher
 * opening pressure (hysteresis). Both are spread around their means as logistic curves; opening
 * pressures are spread wider. Units open and close with these time constants (s).
 */
export const CLOSE_WIDTH = 3;
export const OPEN_WIDTH = 6;
export const RECRUIT_TIME = 0.3;
export const DERECRUIT_TIME = 0.6;
/** Share of the recruited compliance gain that also moves the overdistension point up. */
export const RECRUIT_ROOM = 0.5;
/** Default chest wall compliance (L/cmH2O) and end-expiratory esophageal pressure (cmH2O). */
export const DEFAULT_CHEST_WALL = 0.2;
export const DEFAULT_PES_OFFSET = 3;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * One-compartment lung with direction-dependent resistance (ADR-0003). Linear by default; a
 * profile can add small-airway narrowing and a flow-limiting critical pressure on expiration,
 * recruitment with hysteresis, stiffening at high volume and a viscoelastic tissue element.
 */
export class LinearLung implements LungModel {
  /** Fraction of the recruitable lung that is open (0–1). */
  recruited = 0;
  /** Viscoelastic tissue pressure (cmH2O): charges with flow, relaxes during a pause (P1 → P2). */
  pve = 0;

  constructor(public mechanics: Mechanics) {}

  get hasRecruitment(): boolean {
    return (this.mechanics.recruitCompliance ?? 0) > 0;
  }

  /** Fraction open at steady state once alveolar pressure has fallen to `p` (deflation limb). */
  closingCurve(p: number): number {
    return logistic((p - (this.mechanics.recruitClosing ?? 0)) / CLOSE_WIDTH);
  }

  /** Fraction open once alveolar pressure has risen to `p` (inflation limb). */
  openingCurve(p: number): number {
    return logistic((p - (this.mechanics.recruitOpening ?? 0)) / OPEN_WIDTH);
  }

  /** Respiratory-system compliance now: the profile value at PEEP 5, plus or minus recruited lung. */
  get compliance(): number {
    const { compliance, recruitCompliance: cr } = this.mechanics;
    if (!cr) return compliance;
    return Math.max(0.002, compliance + cr * (this.recruited - this.closingCurve(5)));
  }

  /**
   * Start state: as freshly intubated on PEEP 5 (derecruited). A higher starting PEEP keeps only
   * what PEEP 5 kept open; more has to be opened by tidal or recruitment-maneuver pressures.
   */
  settle(peep: number): void {
    this.pve = 0;
    if (this.hasRecruitment) this.recruited = this.closingCurve(Math.min(peep, 5));
  }

  /**
   * Advance recruitment and the viscoelastic element by `dt` (s), given the elastic alveolar
   * pressure now and the flow into the lung.
   */
  step(dt: number, alveolarPressure: number, flow: number): void {
    const { viscoResistance: r2, viscoTime: tau2 } = this.mechanics;
    // Maxwell element: dPve/dt = (V̇·R2 − Pve)/τ2.
    if (r2 && tau2) this.pve += (flow * r2 - this.pve) * Math.min(1, dt / tau2);
    if (!this.hasRecruitment) return;
    const opening = this.openingCurve(alveolarPressure);
    const closing = this.closingCurve(alveolarPressure);
    if (opening > this.recruited) {
      this.recruited += (opening - this.recruited) * Math.min(1, dt / RECRUIT_TIME);
    } else if (closing < this.recruited) {
      this.recruited += (closing - this.recruited) * Math.min(1, dt / DERECRUIT_TIME);
    }
  }

  /** Volume where overdistension starts: recruited lung adds some room before units overstretch. */
  get overdistensionVolume(): number | undefined {
    const vod = this.mechanics.overdistensionVolume;
    if (vod === undefined || !this.hasRecruitment) return vod;
    return vod * (1 + RECRUIT_ROOM * (this.compliance / this.mechanics.compliance - 1));
  }

  /** Elastic recoil pressure (cmH2O) at elastic volume `v`. */
  recoil(v: number): number {
    const k = this.mechanics.overdistensionStiffness;
    const vod = this.overdistensionVolume;
    const over = vod !== undefined && k ? Math.max(0, v - vod) : 0;
    return v / this.compliance + (k ?? 0) * over * over;
  }

  /** Expiratory resistance at elastic volume `v`. */
  expiratoryResistance(v: number): number {
    const { rExp, rInsp, airwayCollapse: n, collapseVolume: vc } = this.mechanics;
    if (!n || !vc) return rExp;
    const factor = Math.min(Math.pow(vc / Math.max(v, 1e-6), n), MAX_COLLAPSE_FACTOR);
    return Math.max(rInsp, rExp * factor);
  }

  /** Pressure below which small airways collapse on expiration (0 = none). */
  get criticalPressure(): number {
    return this.mechanics.criticalPressure ?? 0;
  }

  alveolarPressure(volume: number, pmus: number): number {
    return this.recoil(volume) + this.pve - pmus;
  }

  flow(paw: number, volume: number, pmus: number): number {
    const palv = this.alveolarPressure(volume, pmus);
    if (paw >= palv) return (paw - palv) / this.mechanics.rInsp;
    // Waterfall: below the critical pressure, flow no longer depends on airway pressure.
    const downstream = Math.max(paw, this.criticalPressure);
    return -Math.max(0, palv - downstream) / this.expiratoryResistance(volume);
  }

  pressureForFlow(flow: number, volume: number, pmus: number): number {
    const r = flow >= 0 ? this.mechanics.rInsp : this.expiratoryResistance(volume);
    return this.alveolarPressure(volume, pmus) + r * flow;
  }

  volumeAtPressure(pressure: number): number {
    const k = this.mechanics.overdistensionStiffness;
    const vod = this.overdistensionVolume;
    const c = this.compliance;
    const linear = pressure * c;
    if (vod === undefined || !k || linear <= vod) return linear;
    // Solve k·x² + x/C = P − vod/C for x = V − vod ≥ 0.
    const rhs = pressure - vod / c;
    const x = (-1 / c + Math.sqrt(1 / (c * c) + 4 * k * rhs)) / (2 * k);
    return vod + x;
  }

  /** Esophageal (pleural) pressure: chest-wall recoil minus inspiratory effort. */
  pleuralPressure(volume: number, pmus: number, pexp = 0): number {
    const ccw = this.mechanics.chestWallCompliance ?? DEFAULT_CHEST_WALL;
    const offset = this.mechanics.pesOffset ?? DEFAULT_PES_OFFSET;
    return offset + volume / ccw - pmus + pexp;
  }
}
