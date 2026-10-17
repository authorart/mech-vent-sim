/** Baseline circulation of a Patient Profile. */
export interface CirculationParams {
  hr: number;
  sbp: number;
  dbp: number;
}

export interface Vitals {
  hr: number;
  sbp: number;
  dbp: number;
  map: number;
  spo2: number;
}

export interface VitalsInputs {
  /** Mean airway pressure (cmH2O). */
  pmean: number;
  /** True PEEP_i (cmH2O). */
  peepI: number;
  spo2: number;
}

/** P_mean above this starts to reduce venous return (cmH2O). */
const PMEAN_THRESHOLD = 12;
const SBP_PER_PMEAN = 1.5;
const SBP_PER_PEEPI = 2;
const HR_PER_SBP_DROP = 0.5;
const HR_PER_SPO2_POINT = 1;
const TAU = 10;

/**
 * V1 circulation (R3-Q5): fixed per profile plus one rule. High intrathoracic pressure
 * (P_mean, PEEP_i) lowers venous return and blood pressure, and HR compensates.
 */
export class Circulation {
  private current: Vitals | null = null;

  constructor(public params: CirculationParams) {}

  get state(): Vitals | null {
    return this.current;
  }

  targets(inputs: VitalsInputs): Vitals {
    const { hr, sbp, dbp } = this.params;
    const drop =
      SBP_PER_PMEAN * Math.max(0, inputs.pmean - PMEAN_THRESHOLD) +
      SBP_PER_PEEPI * Math.max(0, inputs.peepI);
    const s = Math.max(40, sbp - drop);
    // Pulse pressure narrows as SBP falls.
    const d = Math.max(25, dbp - drop * 0.6);
    const h = hr + HR_PER_SBP_DROP * drop + HR_PER_SPO2_POINT * Math.max(0, 90 - inputs.spo2);
    return { hr: Math.min(180, h), sbp: s, dbp: d, map: d + (s - d) / 3, spo2: inputs.spo2 };
  }

  prime(inputs: VitalsInputs): void {
    this.current = this.targets(inputs);
  }

  step(dt: number, inputs: VitalsInputs): Vitals | null {
    if (!this.current) return null;
    const tg = this.targets(inputs);
    const k = Math.exp(-dt / TAU);
    const mix = (a: number, b: number) => b + (a - b) * k;
    const sbp = mix(this.current.sbp, tg.sbp);
    const dbp = mix(this.current.dbp, tg.dbp);
    this.current = {
      hr: mix(this.current.hr, tg.hr),
      sbp,
      dbp,
      map: dbp + (sbp - dbp) / 3,
      spo2: inputs.spo2,
    };
    return this.current;
  }
}
