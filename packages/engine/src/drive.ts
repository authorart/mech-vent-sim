import type { Drive } from "./types";

/** Sedation level set on the Instructor Panel (R4-Q1). Patients start deeply sedated. */
export type SedationLevel = "deep" | "light" | "awake";

/** Fraction of the profile's Muscle Pressure available at each sedation level. */
export const SEDATION_FACTOR: Record<SedationLevel, number> = { deep: 0, light: 0.5, awake: 1 };

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

/** The drive actually applied to the patient, given sedation and chemoreflex. */
export function effectiveDrive(base: Drive, sedation: SedationLevel, multiplier: number): Drive {
  const s = SEDATION_FACTOR[sedation];
  if (s === 0 || multiplier === 0 || base.neuralRate === 0) {
    return { ...base, neuralRate: 0, pmusMax: 0 };
  }
  return {
    ...base,
    pmusMax: base.pmusMax * s * multiplier,
    neuralRate: Math.min(MAX_NEURAL_RATE, base.neuralRate * (0.5 + 0.5 * multiplier)),
  };
}
