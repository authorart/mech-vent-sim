import type { ProfileId } from "./profiles";
import { INITIAL_SETTINGS } from "./settings";
import type { VcvSettings } from "./types";

/**
 * Disease targets (M14, R6-Q11/12): starting settings and goals per Patient Profile, from Hess &
 * Kacmarek ch. 14 (initial settings), 17 (ARDS), 18 (COPD, asthma), 22 (neuromuscular), 23
 * (cardiac failure), 26 (overdose) and 31 (esophageal pressure). Values only; the wording
 * lives in the UI.
 */
export interface Range {
  min: number;
  max: number;
}

export interface DiseaseTargets {
  /** Tidal volume (mL/kg PBW) and the value "Apply recommended start" uses. */
  vtPerKg: Range & { start: number };
  rr: Range & { start: number };
  /** Inspiratory time (s). */
  ti: Range & { start: number };
  peep: Range & { start: number };
  pplatMax: number;
  /** End-inspiratory transpulmonary pressure limit (cmH2O, ch. 31): about 25. */
  plMax: number;
  ph: Range;
  spo2: Range;
  fio2Start: number;
  /** Raised high pressure limit for the start (asthma: peak 60–70 is acceptable). */
  highPressureLimit?: number;
}

const common = {
  pplatMax: 30,
  plMax: 25,
  ph: { min: 7.35, max: 7.45 },
  spo2: { min: 92, max: 98 },
};

export const TARGETS: Record<ProfileId, DiseaseTargets> = {
  normal: {
    ...common,
    vtPerKg: { min: 6, max: 8, start: 7 },
    rr: { min: 15, max: 20, start: 16 },
    ti: { min: 0.6, max: 1, start: 0.8 },
    peep: { min: 5, max: 8, start: 5 },
    fio2Start: 1,
  },
  ards: {
    ...common,
    vtPerKg: { min: 4, max: 8, start: 6 },
    rr: { min: 20, max: 35, start: 26 },
    ti: { min: 0.5, max: 0.8, start: 0.6 },
    peep: { min: 10, max: 20, start: 12 },
    ph: { min: 7.2, max: 7.4 },
    spo2: { min: 88, max: 95 },
    fio2Start: 1,
  },
  ardsStiffChestWall: {
    ...common,
    vtPerKg: { min: 4, max: 8, start: 6 },
    rr: { min: 20, max: 35, start: 26 },
    ti: { min: 0.5, max: 0.8, start: 0.6 },
    // PEEP set to about the esophageal pressure counters the chest wall (ch. 31, fig. 31-13).
    peep: { min: 12, max: 22, start: 16 },
    // A higher plateau can be safe while transpulmonary pressure stays below 25.
    pplatMax: 38,
    ph: { min: 7.2, max: 7.4 },
    spo2: { min: 88, max: 95 },
    fio2Start: 1,
    highPressureLimit: 50,
  },
  asthma: {
    ...common,
    vtPerKg: { min: 4, max: 6, start: 5 },
    rr: { min: 8, max: 20, start: 12 },
    ti: { min: 1, max: 1.5, start: 1 },
    peep: { min: 0, max: 5, start: 5 },
    ph: { min: 7.2, max: 7.45 },
    spo2: { min: 88, max: 95 },
    fio2Start: 1,
    highPressureLimit: 60,
  },
  copd: {
    ...common,
    vtPerKg: { min: 6, max: 8, start: 7 },
    rr: { min: 8, max: 15, start: 12 },
    ti: { min: 0.6, max: 1, start: 0.8 },
    peep: { min: 5, max: 8, start: 5 },
    ph: { min: 7.3, max: 7.45 },
    spo2: { min: 90, max: 95 },
    fio2Start: 0.4,
  },
  metabolicAcidosis: {
    ...common,
    vtPerKg: { min: 6, max: 8, start: 8 },
    rr: { min: 20, max: 35, start: 28 },
    ti: { min: 0.6, max: 1, start: 0.7 },
    peep: { min: 5, max: 8, start: 5 },
    ph: { min: 7.2, max: 7.45 },
    fio2Start: 1,
  },
  cardiogenicEdema: {
    ...common,
    vtPerKg: { min: 6, max: 8, start: 7 },
    rr: { min: 15, max: 25, start: 18 },
    ti: { min: 0.6, max: 1, start: 0.9 },
    peep: { min: 5, max: 10, start: 8 },
    fio2Start: 1,
  },
  massivePe: {
    ...common,
    vtPerKg: { min: 6, max: 8, start: 7 },
    rr: { min: 16, max: 25, start: 20 },
    ti: { min: 0.6, max: 1, start: 0.8 },
    peep: { min: 5, max: 8, start: 5 },
    fio2Start: 1,
  },
  centralApnea: {
    ...common,
    vtPerKg: { min: 6, max: 8, start: 7 },
    rr: { min: 15, max: 20, start: 16 },
    ti: { min: 0.8, max: 1, start: 0.9 },
    peep: { min: 5, max: 5, start: 5 },
    fio2Start: 0.4,
  },
  neuromuscular: {
    ...common,
    vtPerKg: { min: 8, max: 10, start: 8 },
    rr: { min: 15, max: 20, start: 16 },
    ti: { min: 1, max: 1.5, start: 1.1 },
    peep: { min: 5, max: 5, start: 5 },
    fio2Start: 0.4,
  },
};

const round = (v: number, step: number) => Math.round(v / step) * step;

/** "Apply recommended start" (R6-Q12): volume control with the profile's starting targets. */
export function recommendedStart(id: ProfileId, pbw: number): VcvSettings {
  const t = TARGETS[id];
  const vt = round((t.vtPerKg.start * pbw) / 1000, 0.01);
  // Square flow that gives the target Ti, in 5 L/min steps.
  const flowLpm = Math.min(120, Math.max(20, round((vt / t.ti.start) * 60, 5)));
  return {
    ...INITIAL_SETTINGS,
    tidalVolume: vt,
    rate: t.rr.start,
    peakFlow: flowLpm / 60,
    flowPattern: "square",
    pauseTime: 0,
    peep: t.peep.start,
    fio2: t.fio2Start,
    highPressureLimit: t.highPressureLimit ?? INITIAL_SETTINGS.highPressureLimit,
  };
}

export type TargetKey = "vtPerKg" | "rr" | "ti" | "peep" | "pplat" | "pl" | "ph" | "spo2";
export type TargetStatus = "ok" | "low" | "high" | "unknown";

export interface TargetRow {
  key: TargetKey;
  value: number | null;
  range: Range;
  status: TargetStatus;
}

export interface TargetInputs {
  vtPerKg: number | null;
  rr: number | null;
  ti: number | null;
  peep: number | null;
  pplat: number | null;
  /** End-inspiratory transpulmonary pressure (cmH2O). */
  pl: number | null;
  ph: number | null;
  spo2: number | null;
}

/** Compare the current values with the profile's targets. */
export function evaluateTargets(id: ProfileId, x: TargetInputs): TargetRow[] {
  const t = TARGETS[id];
  const ranges: Record<TargetKey, Range> = {
    vtPerKg: t.vtPerKg,
    rr: t.rr,
    ti: t.ti,
    peep: t.peep,
    pplat: { min: 0, max: t.pplatMax },
    pl: { min: 0, max: t.plMax },
    ph: t.ph,
    spo2: t.spo2,
  };
  return (Object.keys(ranges) as TargetKey[]).map((key) => {
    const value = x[key];
    const range = ranges[key];
    const status: TargetStatus =
      value === null
        ? "unknown"
        : value < range.min - 1e-9
          ? "low"
          : value > range.max + 1e-9
            ? "high"
            : "ok";
    return { key, value, range, status };
  });
}
