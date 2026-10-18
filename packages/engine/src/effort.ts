import { mulberry32, normalFrom } from "./random";
import type { Drive } from "./types";

/** Breath-to-breath variation of the patient's own effort (R6-Q4). Coefficients of variation. */
export interface EffortVariability {
  seed: number;
  /** Neural cycle length. */
  cvRate: number;
  /** Peak Muscle Pressure. */
  cvAmplitude: number;
  /** Neural inspiratory time. */
  cvTi: number;
  /** Mean number of neural cycles between sighs (0 = no sighs). */
  sighEvery: number;
}

/** Natural breathing at rest. Agitation scales the CVs up (see session.ts). */
export const NATURAL_VARIABILITY: Omit<EffortVariability, "seed"> = {
  cvRate: 0.1,
  cvAmplitude: 0.15,
  cvTi: 0.1,
  sighEvery: 60,
};

/** A sigh: a deeper, longer effort followed by a longer pause. */
const SIGH = { amplitude: 2, ti: 1.4, period: 1.5 };

/** Reverse triggering (R6-Q2): an effort entrained by a passive ventilator inflation. */
export const ENTRAINED_EFFORT = {
  /** From the start of the inflation to the start of the effort (s). */
  delay: 0.35,
  /** Neural inspiratory time (s). */
  ti: 0.7,
  /** Peak Muscle Pressure (cmH2O). */
  pmus: 8,
};

interface Cycle {
  /** Unique per effort, so breaths can be matched to the effort that caused them. */
  id: number;
  /** Set off by a ventilator breath (reverse triggering) rather than the patient's own clock. */
  entrained: boolean;
  start: number;
  period: number;
  ti: number;
  /** Multiplier on the drive's peak Muscle Pressure, or an absolute peak for entrained efforts. */
  amplitude: number;
  sigh: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** (1 − cos) rise over Ti, (1 + cos) relaxation over half of Ti (capped by the cycle), then rest. */
function shape(c: Cycle, t: number): number {
  const tc = t - c.start;
  if (tc < 0) return 0;
  const tRelax = Math.min(0.5 * c.ti, c.period - c.ti);
  if (tc < c.ti) return (1 - Math.cos((Math.PI * tc) / c.ti)) / 2;
  if (tc < c.ti + tRelax) return (1 + Math.cos((Math.PI * (tc - c.ti)) / tRelax)) / 2;
  return 0;
}

/** End of active neural inspiration: Ti plus the first half of the relaxation. */
function inspiratoryEnd(c: Cycle): number {
  return c.start + c.ti + 0.5 * Math.min(0.5 * c.ti, c.period - c.ti);
}

/**
 * Generates Muscle Pressure on the patient's own neural clock, independent of the ventilator,
 * so mismatches between the two produce asynchrony on their own. Each cycle's length, depth and
 * inspiratory time are drawn when it starts; with no variability every cycle is identical.
 */
/** The effort under way at some moment (see PatientEffort.activeEffort). */
export interface ActiveEffort {
  id: number;
  entrained: boolean;
  start: number;
  /** When active inspiration ends (Ti plus half the relaxation). */
  inspirationEnd: number;
}

export class PatientEffort {
  private cycle: Cycle | null = null;
  private nextId = 1;
  private nextStart: number;
  private entrained: Cycle[] = [];
  private random: (() => number) | null = null;
  private variability: EffortVariability | null = null;

  constructor(
    public drive: Drive,
    /** Time of the first effort (s). */
    firstEffortAt = 1,
    variability: EffortVariability | null = null,
  ) {
    this.nextStart = firstEffortAt;
    this.setVariability(variability);
  }

  /** Switch variability on or off. A new seed restarts the random sequence. */
  setVariability(v: EffortVariability | null): void {
    if (v && v.seed !== this.variability?.seed) this.random = mulberry32(v.seed);
    this.variability = v;
  }

  get isVariable(): boolean {
    return this.variability !== null;
  }

  /** Muscle Pressure at time t. Must be called with non-decreasing t. */
  pmus(t: number): number {
    return this.own(t) + this.entrainedPmus(t);
  }

  /** True while the patient is actively breathing in (own or entrained effort). */
  inspiring(t: number): boolean {
    const own = this.cycle && t >= this.cycle.start && t < inspiratoryEnd(this.cycle);
    return !!own || this.entrained.some((c) => t >= c.start && t < inspiratoryEnd(c));
  }

  /** The effort breathing in at time t (the latest one if two overlap), or null. */
  activeEffort(t: number): ActiveEffort | null {
    const all = [...(this.cycle ? [this.cycle] : []), ...this.entrained];
    const active = all.filter((c) => t >= c.start && t < inspiratoryEnd(c));
    if (active.length === 0) return null;
    const c = active.reduce((a, b) => (b.start > a.start ? b : a));
    return { id: c.id, entrained: c.entrained, start: c.start, inspirationEnd: inspiratoryEnd(c) };
  }

  /** When the effort under way at time t stops breathing in, or null if none is. */
  inspirationEndsAt(t: number): number | null {
    const all = [...(this.cycle ? [this.cycle] : []), ...this.entrained];
    const active = all.filter((c) => t >= c.start && t < inspiratoryEnd(c));
    return active.length > 0 ? Math.max(...active.map(inspiratoryEnd)) : null;
  }

  /** Schedule an effort entrained by a ventilator inflation starting at t (reverse triggering). */
  entrain(t: number): void {
    const { delay, ti, pmus } = ENTRAINED_EFFORT;
    this.entrained.push({
      id: this.nextId++,
      entrained: true,
      start: t + delay,
      period: ti * 2,
      ti,
      amplitude: pmus,
      sigh: false,
    });
  }

  /** The cycle just started was a sigh (for tests and teaching notes). */
  get lastWasSigh(): boolean {
    return this.cycle?.sigh ?? false;
  }

  private own(t: number): number {
    const { neuralRate, pmusMax, inspFraction } = this.drive;
    if (neuralRate <= 0 || pmusMax <= 0) {
      this.cycle = null;
      this.nextStart = Math.max(this.nextStart, t);
      return 0;
    }
    while (t >= this.nextStart) {
      this.cycle = this.newCycle(this.nextStart, 60 / neuralRate, inspFraction);
      this.nextStart = this.cycle.start + this.cycle.period;
    }
    return this.cycle ? pmusMax * this.cycle.amplitude * shape(this.cycle, t) : 0;
  }

  private entrainedPmus(t: number): number {
    if (this.entrained.length === 0) return 0;
    this.entrained = this.entrained.filter((c) => t < c.start + c.period);
    return this.entrained.reduce((s, c) => s + c.amplitude * shape(c, t), 0);
  }

  private newCycle(start: number, period: number, inspFraction: number): Cycle {
    const v = this.variability;
    const rnd = this.random;
    const id = this.nextId++;
    if (!v || !rnd) {
      return { id, entrained: false, start, period, ti: inspFraction * period, amplitude: 1, sigh: false };
    }
    const normal = normalFrom(rnd);
    let p = period * clamp(1 + v.cvRate * normal(), 0.6, 1.6);
    let fraction = clamp(inspFraction * (1 + v.cvTi * normal()), 0.2, 0.55);
    let amplitude = clamp(1 + v.cvAmplitude * normal(), 0.4, 1.8);
    const sigh = v.sighEvery > 0 && rnd() < 1 / v.sighEvery;
    if (sigh) {
      amplitude *= SIGH.amplitude;
      fraction = Math.min(0.55, (fraction * SIGH.ti) / SIGH.period);
      p *= SIGH.period;
    }
    return { id, entrained: false, start, period: p, ti: fraction * p, amplitude, sigh };
  }
}
