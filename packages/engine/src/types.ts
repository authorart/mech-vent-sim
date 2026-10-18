import type { ScenarioEventKind } from "./scenario";

/**
 * Core Engine types. All internal quantities use the Engine's unit system:
 * volume L · flow L/s (+ = inspiratory) · pressure cmH2O · time s · compliance L/cmH2O ·
 * resistance cmH2O/(L/s). The UI converts to display units (mL, L/min).
 */

/** Passive respiratory-system mechanics of a Patient Profile. */
export interface Mechanics {
  /** Respiratory-system compliance C_rs (L/cmH2O). */
  compliance: number;
  /** Inspiratory Resistance R_insp (cmH2O/(L/s)). */
  rInsp: number;
  /** Expiratory Resistance R_exp (cmH2O/(L/s)), at `collapseVolume` when that is set. */
  rExp: number;
  /**
   * Small-airway narrowing (ADR-0003, V1.2): R_exp × (collapseVolume / V)^airwayCollapse, never
   * below R_insp. Expiratory flow peaks early, then falls away: the "scooped" obstructive pattern.
   * 0 or unset = constant R_exp.
   */
  airwayCollapse?: number;
  /** Elastic volume (L) at which the expiratory resistance equals R_exp. */
  collapseVolume?: number;
  /** Elastic volume (L) above which the respiratory system stiffens (overdistension). */
  overdistensionVolume?: number;
  /** Extra recoil k × (V − overdistensionVolume)² above that volume (cmH2O/L²). 0 or unset = linear. */
  overdistensionStiffness?: number;
  /**
   * Expiratory flow limitation (M11, COPD): below this pressure the small airways collapse and
   * expiratory flow stops depending on airway pressure (waterfall). PEEP up to it is absorbed.
   */
  criticalPressure?: number;
  /** Recruitment (M11): compliance added when the whole recruitable lung is open (L/cmH2O). */
  recruitCompliance?: number;
  /** Mean closing pressure (cmH2O) of recruitable units: the deflation limb. */
  recruitClosing?: number;
  /** Mean opening pressure (cmH2O): the inflation limb (above closing = hysteresis). */
  recruitOpening?: number;
  /** Viscoelastic tissue (M11): resistance (cmH2O/(L/s)) and time constant (s) of the P1 → P2 decay. */
  viscoResistance?: number;
  viscoTime?: number;
  /** Chest wall compliance (L/cmH2O) and end-expiratory esophageal pressure (cmH2O), for Pes. */
  chestWallCompliance?: number;
  pesOffset?: number;
}

/** Respiratory drive: produces Muscle Pressure on its own neural clock. */
export interface Drive {
  /** Neural breathing rate (breaths/min). 0 = no effort (central apnea). */
  neuralRate: number;
  /** Peak Muscle Pressure per effort (cmH2O, ≥ 0). */
  pmusMax: number;
  /** Fraction of the neural cycle spent in active inspiration (0–1). */
  inspFraction: number;
}

export interface Patient {
  mechanics: Mechanics;
  drive: Drive;
}

/** How one breath is delivered: volume control, pressure control or pressure support. */
export type BreathKind = "VCV" | "PCV" | "PSV";

export type Mode = BreathKind | "V-SIMV" | "P-SIMV";

/** Mandatory Breath (size and length set by the ventilator) or Spontaneous Breath (by the patient). */
export type BreathType = "mandatory" | "spontaneous";

export type TriggerSetting =
  | { type: "flow"; /** L/s */ threshold: number }
  | { type: "pressure"; /** cmH2O below PEEP */ threshold: number };

interface CommonSettings {
  /** Extrinsic PEEP (cmH2O). */
  peep: number;
  /** Inspired O2 fraction (0.21–1). */
  fio2: number;
  trigger: TriggerSetting;
  /** Airway pressure at which inspiration is ended immediately (cmH2O). */
  highPressureLimit: number;
}

export interface VcvSettings extends CommonSettings {
  mode: "VCV";
  /** Set tidal volume (L). */
  tidalVolume: number;
  /** Mandatory rate (breaths/min). */
  rate: number;
  /** Peak inspiratory flow (L/s). */
  peakFlow: number;
  /** Square = constant flow; decelerating = linear ramp from peak flow to zero. */
  flowPattern: "square" | "decelerating";
  /** End-inspiratory pause (s); 0 = none. */
  pauseTime: number;
}

export interface PcvSettings extends CommonSettings {
  mode: "PCV";
  /** Set pressure above PEEP (cmH2O). */
  pInsp: number;
  rate: number;
  /** Inspiratory time (s). */
  inspTime: number;
  /** Time for airway pressure to reach target (s). */
  riseTime: number;
}

/** Mandatory pressure-controlled ventilation used by Apnea Backup. */
export interface BackupSettings {
  pInsp: number;
  rate: number;
  inspTime: number;
}

export interface PsvSettings extends CommonSettings {
  mode: "PSV";
  /** Pressure support above PEEP (cmH2O). */
  pSupport: number;
  riseTime: number;
  /** Expiratory Sensitivity: cycle when flow falls to this fraction of peak flow (0–1). */
  esens: number;
  /** Seconds without a breath before Apnea Backup starts. */
  apneaTime: number;
  backup: BackupSettings;
}

/** Pressure support for the Spontaneous Breaths between SIMV Mandatory Breaths (R7-Q2). */
interface SpontaneousSupport {
  /** Pressure support above PEEP (cmH2O); 0 = CPAP. */
  pSupport: number;
  /** Expiratory Sensitivity of the supported breaths (0–1). */
  esens: number;
}

/** V-SIMV: volume-controlled Mandatory Breaths at the SIMV rate, pressure support between. */
export interface VsimvSettings extends CommonSettings, SpontaneousSupport {
  mode: "V-SIMV";
  tidalVolume: number;
  /** SIMV rate: Mandatory Breaths per minute. */
  rate: number;
  peakFlow: number;
  flowPattern: "square" | "decelerating";
  pauseTime: number;
  /** Rise time of the pressure-supported breaths (s). */
  riseTime: number;
}

/** P-SIMV: pressure-controlled Mandatory Breaths at the SIMV rate, pressure support between. */
export interface PsimvSettings extends CommonSettings, SpontaneousSupport {
  mode: "P-SIMV";
  pInsp: number;
  rate: number;
  inspTime: number;
  /** Rise time of both the Mandatory and the supported breaths (s). */
  riseTime: number;
}

export type SimvSettings = VsimvSettings | PsimvSettings;

export type VentSettings = VcvSettings | PcvSettings | PsvSettings | SimvSettings;

export type BreathTrigger = "mandatory" | "patient" | "backup";

/** Raw record of one completed Breath, measured at the Engine's internal rate. */
export interface BreathRecord {
  startTime: number;
  endTime: number;
  trigger: BreathTrigger;
  /** How this breath was delivered (an SIMV breath is VCV/PCV when mandatory, PSV when spontaneous). */
  mode: BreathKind;
  breathType: BreathType;
  /** Set PEEP during this breath (cmH2O). */
  peep: number;
  /** Time from breath start to start of expiration, including any pause (s). */
  inspTime: number;
  /** Inspired volume (L). */
  vti: number;
  /** Expired volume (L, positive). */
  vte: number;
  peakPaw: number;
  /** Airway pressure when inspiratory flow stopped (before any pause). */
  endInspPaw: number;
  meanPaw: number;
  /** Airway pressure at the end of the breath's expiration. */
  endExpPaw: number;
  /** Engine truth: elastic recoil pressure (V/C) at the end of inspiration. The UI measures P_plat with a pause. */
  endInspRecoil: number;
  /** Engine truth: elastic recoil pressure at the end of expiration. Minus PEEP, this is the true PEEP_i. */
  endExpRecoil: number;
  /** Airway pressure at the end of the inspiratory pause, when a pause occurred. */
  plateauPaw: number | null;
  /** False when the patient made an effort during the pause. */
  plateauReliable: boolean;
  /** Total PEEP measured by an Expiratory Hold at the end of this breath. */
  totalPeep: number | null;
  /** False when the patient made an effort during the hold. */
  totalPeepReliable: boolean;
  peakInspFlow: number;
  /** Flow at the moment inspiration ended (L/s). */
  cycleFlow: number;
  /** Inspiration was ended by the high pressure limit. */
  highPressureCycled: boolean;
  /** What ended inspiration: set time (VCV/PCV/backup), PSV flow (Esens), PSV pressure, or the high pressure limit. */
  cycle: CycleReason;
  /**
   * Stress index of a passive constant-flow VCV breath: the exponent b of Paw = a·t^b + c.
   * 1 = linear; < 1 tidal recruitment; > 1 overdistension. Null when not measurable.
   */
  stressIndex: number | null;
  /** Fraction of the recruitable lung open at the end of this breath's expiration (engine truth). */
  endExpRecruited: number;
  /** Asynchronies that belong to this breath (ineffective triggers arrive as events instead). */
  asynchronies: AsynchronyKind[];
  /**
   * Volumes that actually entered and left the alveoli (engine truth). They differ from
   * vti/vte, which the ventilator measures, when there is a leak (M13).
   */
  lungVti: number;
  lungVte: number;
  /**
   * Esophageal pressure at end inspiration and end expiration (cmH2O), as an esophageal balloon
   * would read them with no effort (M14). Alveolar minus esophageal = transpulmonary pressure.
   */
  pesEndInsp: number;
  pesEndExp: number;
}

export type EngineEvent =
  | { type: "breathStart"; t: number; trigger: BreathTrigger; breathType: BreathType }
  | { type: "settingsApplied"; t: number }
  | { type: "apneaBackupStarted"; t: number }
  | { type: "apneaBackupEnded"; t: number }
  | { type: "highPressureCycle"; t: number; paw: number }
  | { type: "asynchrony"; t: number; kind: AsynchronyKind }
  | {
      type: "scenario";
      t: number;
      id: number;
      kind: ScenarioEventKind;
      phase: "started" | "resolved";
    }
  | { type: "plateauMeasured"; t: number; plateau: number; reliable: boolean }
  | {
      type: "totalPeepMeasured";
      t: number;
      totalPeep: number;
      peepI: number;
      reliable: boolean;
    };

/** Interleaved Sample layout in the output Float32Array. */
export type CycleReason = "time" | "flow" | "pressure" | "highPressure";

/**
 * Patient–ventilator asynchrony, classified from the Engine's ground truth (M12; Hess & Kacmarek
 * ch. 15). Learners see only the waveforms unless the instructor turns labels on (R6-Q10).
 */
export type AsynchronyKind =
  | "ineffectiveTrigger"
  | "autoTrigger"
  | "reverseTrigger"
  | "doubleTrigger"
  | "flowStarvation"
  | "prematureCycling"
  | "delayedCycling";

export const ASYNCHRONY_KINDS: AsynchronyKind[] = [
  "ineffectiveTrigger",
  "autoTrigger",
  "reverseTrigger",
  "doubleTrigger",
  "flowStarvation",
  "prematureCycling",
  "delayedCycling",
];

export const SAMPLE = {
  T: 0,
  PAW: 1,
  FLOW: 2,
  /** Volume since the start of the current Breath (L), as a ventilator displays it. */
  VOLUME: 3,
  PALV: 4,
  PMUS: 5,
  /** Expiratory Muscle Pressure (cmH2O, ≥ 0): the patient pushing gas out (ADR-0002 amendment). */
  PEXP: 6,
  /** Esophageal (pleural) pressure (cmH2O, M11). */
  PES: 7,
  /** Airway CO2 (mmHg): the capnogram (M15). */
  CO2: 8,
  STRIDE: 9,
} as const;
