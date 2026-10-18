import type { Drive } from "./types";

/** Sedation level set on the Instructor Panel (R4-Q1). Patients start deeply sedated. */
export type SedationLevel = "deep" | "light" | "awake";

/** Agitation or pain (Instructor Panel): more drive and a more irregular pattern. */
export type Agitation = "none" | "moderate" | "severe";

/** How the patient breathes, set on the Instructor Panel (M9). */
export interface PatientFeatures {
  /** Natural = breath-to-breath variability and sighs (R6-Q4); regular = identical cycles. */
  breathing: "natural" | "regular";
  agitation: Agitation;
  /** Passive ventilator breaths entrain a patient effort (R6-Q2). */
  reverseTriggering: boolean;
  /** Heartbeat ripple in the airway signals: off, small (the usual) or strong (can autotrigger). */
  cardiacOscillation: "off" | "small" | "strong";
}

/**
 * Cardiogenic oscillation amplitude (cmH2O). Strong gives about 4–6 L/min of flow ripple at the
 * airway in normal lungs, enough to autotrigger a 2 L/min flow trigger (Hess & Kacmarek fig. 15-2).
 */
export const CARDIAC_OSCILLATION: Record<PatientFeatures["cardiacOscillation"], number> = {
  off: 0,
  small: 0.12,
  strong: 0.7,
};

export const DEFAULT_FEATURES: PatientFeatures = {
  breathing: "natural",
  agitation: "none",
  reverseTriggering: false,
  cardiacOscillation: "small",
};

/** Agitation multiplies Muscle Pressure, neural rate and the variability coefficients. */
export const AGITATION_EFFECT: Record<Agitation, { pmus: number; rate: number; variability: number }> =
  {
    none: { pmus: 1, rate: 1, variability: 1 },
    moderate: { pmus: 1.5, rate: 1.3, variability: 1.5 },
    severe: { pmus: 2, rate: 1.6, variability: 2 },
  };

/** Fraction of the profile's Muscle Pressure available at each sedation level. */
export const SEDATION_FACTOR: Record<SedationLevel, number> = { deep: 0, light: 0.5, awake: 1 };

/**
 * Wakefulness drive (V1.2, Hess & Kacmarek ch. 7/15): an awake patient keeps breathing even when
 * alkalemic; only the chemical part of drive falls to zero. The multiplier never drops below this.
 */
export const WAKEFULNESS_FLOOR: Record<SedationLevel, number> = { deep: 0, light: 0.15, awake: 0.4 };

/** Arterial pH at or above which chemical drive stops (apneic threshold). */
export const APNEIC_PH = 7.5;
const MAX_MULTIPLIER = 2;
const MAX_NEURAL_RATE = 45;

/**
 * Chemoreflex (R4-Q2). Drive is 1× at the profile's reference pH, scales linearly toward
 * zero at the apneic threshold, and goes up to 2× when more acidemic.
 */
export function chemoreflexMultiplier(ph: number | null, referencePh: number): number {
  if (ph === null) return 1;
  const m = (APNEIC_PH - ph) / (APNEIC_PH - referencePh);
  return Math.min(MAX_MULTIPLIER, Math.max(0, m));
}

/** The drive actually applied to the patient, given sedation, chemoreflex and agitation. */
export function effectiveDrive(
  base: Drive,
  sedation: SedationLevel,
  chemo: number,
  agitation: Agitation = "none",
): Drive {
  const s = SEDATION_FACTOR[sedation];
  const multiplier = Math.max(chemo, WAKEFULNESS_FLOOR[sedation]);
  const a = AGITATION_EFFECT[agitation];
  if (s === 0 || multiplier === 0 || base.neuralRate === 0) {
    return { ...base, neuralRate: 0, pmusMax: 0 };
  }
  return {
    ...base,
    pmusMax: base.pmusMax * s * multiplier * a.pmus,
    neuralRate: Math.min(MAX_NEURAL_RATE, base.neuralRate * (0.5 + 0.5 * multiplier) * a.rate),
  };
}
