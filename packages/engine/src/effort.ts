import type { Drive } from "./types";

/**
 * Generates Muscle Pressure on the patient's own neural clock, independent of the ventilator,
 * so mismatches between the two produce dyssynchrony on their own.
 *
 * Each neural cycle: a (1 − cos) rise over the inspiratory time, then a (1 + cos) relaxation
 * over half that time (capped by the cycle), then rest.
 */
export class PatientEffort {
  private cycleStart: number;

  constructor(
    public drive: Drive,
    /** Time of the first effort (s). */
    firstEffortAt = 1,
  ) {
    this.cycleStart = firstEffortAt;
  }

  /** Muscle Pressure at time t. Must be called with non-decreasing t. */
  pmus(t: number): number {
    const { neuralRate, pmusMax, inspFraction } = this.drive;
    if (neuralRate <= 0 || pmusMax <= 0) {
      this.cycleStart = Math.max(this.cycleStart, t);
      return 0;
    }
    const period = 60 / neuralRate;
    while (t - this.cycleStart >= period) this.cycleStart += period;
    const tc = t - this.cycleStart;
    if (tc < 0) return 0;

    const ti = inspFraction * period;
    const tRelax = Math.min(0.5 * ti, period - ti);
    if (tc < ti) return (pmusMax * (1 - Math.cos((Math.PI * tc) / ti))) / 2;
    if (tc < ti + tRelax) return (pmusMax * (1 + Math.cos((Math.PI * (tc - ti)) / tRelax))) / 2;
    return 0;
  }
}
