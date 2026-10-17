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

/** One-compartment linear lung with direction-dependent resistance (ADR-0003). */
export class LinearLung implements LungModel {
  constructor(public mechanics: Mechanics) {}

  alveolarPressure(volume: number, pmus: number): number {
    return volume / this.mechanics.compliance - pmus;
  }

  flow(paw: number, volume: number, pmus: number): number {
    const drive = paw - this.alveolarPressure(volume, pmus);
    return drive / (drive >= 0 ? this.mechanics.rInsp : this.mechanics.rExp);
  }

  pressureForFlow(flow: number, volume: number, pmus: number): number {
    const r = flow >= 0 ? this.mechanics.rInsp : this.mechanics.rExp;
    return this.alveolarPressure(volume, pmus) + r * flow;
  }

  volumeAtPressure(pressure: number): number {
    return pressure * this.mechanics.compliance;
  }
}
