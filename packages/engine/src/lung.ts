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
 * One-compartment lung with direction-dependent resistance (ADR-0003). Linear by default; a
 * profile can add small-airway narrowing on expiration and stiffening at high volume.
 */
export class LinearLung implements LungModel {
  constructor(public mechanics: Mechanics) {}

  /** Elastic recoil pressure (cmH2O) at elastic volume `v`. */
  recoil(v: number): number {
    const { compliance, overdistensionVolume: vod, overdistensionStiffness: k } = this.mechanics;
    const over = vod !== undefined && k ? Math.max(0, v - vod) : 0;
    return v / compliance + (k ?? 0) * over * over;
  }

  /** Expiratory resistance at elastic volume `v`. */
  expiratoryResistance(v: number): number {
    const { rExp, rInsp, airwayCollapse: n, collapseVolume: vc } = this.mechanics;
    if (!n || !vc) return rExp;
    const factor = Math.min(Math.pow(vc / Math.max(v, 1e-6), n), MAX_COLLAPSE_FACTOR);
    return Math.max(rInsp, rExp * factor);
  }

  alveolarPressure(volume: number, pmus: number): number {
    return this.recoil(volume) - pmus;
  }

  flow(paw: number, volume: number, pmus: number): number {
    const drive = paw - this.alveolarPressure(volume, pmus);
    return drive / (drive >= 0 ? this.mechanics.rInsp : this.expiratoryResistance(volume));
  }

  pressureForFlow(flow: number, volume: number, pmus: number): number {
    const r = flow >= 0 ? this.mechanics.rInsp : this.expiratoryResistance(volume);
    return this.alveolarPressure(volume, pmus) + r * flow;
  }

  volumeAtPressure(pressure: number): number {
    const { compliance: c, overdistensionVolume: vod, overdistensionStiffness: k } = this.mechanics;
    const linear = pressure * c;
    if (vod === undefined || !k || linear <= vod) return linear;
    // Solve k·x² + x/C = P − vod/C for x = V − vod ≥ 0.
    const rhs = pressure - vod / c;
    const x = (-1 / c + Math.sqrt(1 / (c * c) + 4 * k * rhs)) / (2 * k);
    return vod + x;
  }
}
