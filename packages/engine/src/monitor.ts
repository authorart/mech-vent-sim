import type { AsynchronySummary } from "./asynchrony";
import type { AsynchronyKind, BreathRecord, BreathTrigger, BreathType, Mode } from "./types";

/** A value measured by a maneuver, and when it was measured. */
export interface Measured {
  value: number;
  t: number;
  /** False when patient effort during the maneuver contaminated it. */
  reliable: boolean;
}

/** Breath Metrics: what the ventilator monitor displays after each completed Breath. */
export interface BreathMetrics {
  /** End time of the breath (s). */
  t: number;
  trigger: BreathTrigger;
  mode: Mode;
  breathType: BreathType;
  ppeak: number;
  pmean: number;
  /** End-expiratory airway pressure (cmH2O). Equals PEEP_e unless a hold was in progress. */
  peep: number;
  /** Most recent P_plat from an Inspiratory Pause. */
  pplat: Measured | null;
  /** Most recent Total PEEP from an Expiratory Hold. */
  totalPeep: Measured | null;
  /** Most recent PEEP_i (Total PEEP − PEEP_e) from an Expiratory Hold. */
  peepI: Measured | null;
  /** P_plat − Total PEEP (falls back to PEEP_e when no hold has been done). */
  drivingPressure: number | null;
  /** Static compliance from this breath's plateau (L/cmH2O). */
  cstat: number | null;
  /** Airway resistance from this breath's plateau (cmH2O/(L/s)); needs constant flow at end of inspiration. */
  raw: number | null;
  /**
   * Esophageal-balloon values of this breath (M14): end-inspiratory and end-expiratory esophageal
   * pressure, and transpulmonary pressure (alveolar − esophageal) at those moments.
   */
  esophageal: { pesEndInsp: number; pesEndExp: number; plEndInsp: number; plEndExp: number };
  /** Dynamic compliance: Vte ÷ (P peak − PEEP) (L/cmH2O), for a decremental PEEP trial. */
  cdyn: number | null;
  /** Stress index of this breath (passive constant-flow VCV only), see BreathRecord. */
  stressIndex: number | null;
  /** Asynchronies of this breath (M12, engine truth). */
  asynchronies: AsynchronyKind[];
  /** Rolling two-minute asynchrony summary, filled in by the Session (null from a bare Monitor). */
  asynchrony: AsynchronySummary | null;
  vti: number;
  vte: number;
  /** Minute ventilation: exhaled volume over the last minute (L/min). */
  ve: number;
  rrTotal: number;
  /** Patient-triggered breaths per minute (Mandatory or Spontaneous). */
  rrSpont: number;
  /** Mandatory Breaths per minute; the rest of rrTotal are Spontaneous Breaths (SIMV, R7-Q7). */
  rrMandatory: number;
  /** Mean exhaled volume of each breath type over the last minute (L); null when there were none. */
  vteMandatory: number | null;
  vteSpontaneous: number | null;
  ti: number;
  te: number;
  /** Te / Ti, shown as 1 : x. */
  ieRatio: number;
  /**
   * Engine truth, used by teaching alarms that the spec defines without a maneuver
   * (Auto-PEEP, Driving Pressure). Not for display as measured values.
   */
  truth: { peepI: number; drivingPressure: number };
}

const WINDOW = 60;
const MIN_RESISTANCE_FLOW = 0.1;

/** Turns BreathRecords into Breath Metrics, keeping a one-minute rolling window. */
export class Monitor {
  private recent: { end: number; vte: number; spont: boolean; mandatory: boolean }[] = [];
  private firstStart: number | null = null;
  private pplat: Measured | null = null;
  private totalPeep: Measured | null = null;
  private peepI: Measured | null = null;

  update(b: BreathRecord): BreathMetrics {
    this.firstStart ??= b.startTime;
    this.recent.push({
      end: b.endTime,
      vte: b.vte,
      spont: b.trigger === "patient",
      mandatory: b.breathType === "mandatory",
    });
    this.recent = this.recent.filter((r) => r.end > b.endTime - WINDOW);

    if (b.plateauPaw !== null) {
      this.pplat = { value: b.plateauPaw, t: b.endTime, reliable: b.plateauReliable };
    }
    if (b.totalPeep !== null) {
      const reliable = b.totalPeepReliable;
      this.totalPeep = { value: b.totalPeep, t: b.endTime, reliable };
      this.peepI = { value: b.totalPeep - b.peep, t: b.endTime, reliable };
    }

    const span = Math.min(WINDOW, b.endTime - this.firstStart);
    const perMinute = span > 0 ? 60 / span : 0;
    const baseline = this.totalPeep?.value ?? b.peep;

    let cstat: number | null = null;
    let raw: number | null = null;
    if (b.plateauPaw !== null) {
      const dp = b.plateauPaw - baseline;
      cstat = dp > 0 ? b.vti / dp : null;
      if (b.mode === "VCV" && b.cycleFlow > MIN_RESISTANCE_FLOW) {
        raw = (b.endInspPaw - b.plateauPaw) / b.cycleFlow;
      }
    }

    const ti = b.inspTime;
    const te = b.endTime - b.startTime - ti;
    const mandatory = this.recent.filter((r) => r.mandatory);
    const spontaneous = this.recent.filter((r) => !r.mandatory);
    const meanVte = (rs: { vte: number }[]) =>
      rs.length > 0 ? rs.reduce((s, r) => s + r.vte, 0) / rs.length : null;

    return {
      t: b.endTime,
      trigger: b.trigger,
      mode: b.mode,
      breathType: b.breathType,
      ppeak: b.peakPaw,
      pmean: b.meanPaw,
      peep: b.totalPeep !== null ? b.peep : b.endExpPaw,
      pplat: this.pplat,
      totalPeep: this.totalPeep,
      peepI: this.peepI,
      drivingPressure: this.pplat ? this.pplat.value - baseline : null,
      cstat,
      raw,
      cdyn: b.peakPaw - b.peep >= 1 ? b.vte / (b.peakPaw - b.peep) : null,
      esophageal: {
        pesEndInsp: b.pesEndInsp,
        pesEndExp: b.pesEndExp,
        plEndInsp: b.endInspRecoil - b.pesEndInsp,
        plEndExp: b.endExpRecoil - b.pesEndExp,
      },
      stressIndex: b.stressIndex,
      asynchronies: b.asynchronies,
      asynchrony: null,
      vti: b.vti,
      vte: b.vte,
      ve: this.recent.reduce((s, r) => s + r.vte, 0) * perMinute,
      rrTotal: this.recent.length * perMinute,
      rrSpont: this.recent.filter((r) => r.spont).length * perMinute,
      rrMandatory: mandatory.length * perMinute,
      vteMandatory: meanVte(mandatory),
      vteSpontaneous: meanVte(spontaneous),
      ti,
      te,
      ieRatio: ti > 0 ? te / ti : 0,
      truth: {
        peepI: b.endExpRecoil - b.peep,
        // Steady state: end-expiratory recoil is the same at the start and the end of a breath.
        drivingPressure: b.endInspRecoil - b.endExpRecoil,
      },
    };
  }
}
