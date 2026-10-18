import { SAMPLE } from "@mech-vent/engine";

/** Sweep length shown on the monitor (s). */
export const SWEEP_SECONDS = 10;
const RATE = 100;
/** Width of the moving erase bar (s). */
export const ERASE_SECONDS = 0.35;

/**
 * Fixed-position sweep buffer, like a monitor: each sample is written at x = t mod sweep, so
 * the trace redraws over itself with a moving gap. Lives outside React state.
 */
export class SweepBuffer {
  readonly size = SWEEP_SECONDS * RATE;
  readonly t = new Float64Array(this.size).fill(NaN);
  readonly paw = new Float32Array(this.size).fill(NaN);
  readonly flow = new Float32Array(this.size).fill(NaN);
  readonly volume = new Float32Array(this.size).fill(NaN);
  /** Optional 4th-trace channels (M15). */
  readonly pes = new Float32Array(this.size).fill(NaN);
  readonly co2 = new Float32Array(this.size).fill(NaN);
  /** Index of the newest sample. */
  head = -1;
  frozen = false;
  /** Increments on every write, so canvases know when to redraw. */
  version = 0;

  /** Samples since the current breath started (for loops). */
  loop: { paw: number[]; flow: number[]; volume: number[] } = { paw: [], flow: [], volume: [] };
  /** The last completed breath's loop, drawn as a ghost. */
  previousLoop: { paw: number[]; flow: number[]; volume: number[] } | null = null;
  private breathStarts: number[] = [];

  /** Called for each breathStart event; the loop splits when samples reach that time. */
  markBreathStart(t: number): void {
    this.breathStarts.push(t);
  }

  push(data: Float32Array): void {
    for (let i = 0; i < data.length; i += SAMPLE.STRIDE) {
      const t = data[i + SAMPLE.T]!;
      const paw = data[i + SAMPLE.PAW]!;
      const flow = data[i + SAMPLE.FLOW]! * 60; // L/s → L/min
      const volume = data[i + SAMPLE.VOLUME]! * 1000; // L → mL
      const pes = data[i + SAMPLE.PES]!;
      const co2 = data[i + SAMPLE.CO2]!;

      while (this.breathStarts.length > 0 && t >= this.breathStarts[0]! - 1e-6) {
        this.breathStarts.shift();
        if (this.loop.paw.length > 0) this.previousLoop = this.loop;
        this.loop = { paw: [], flow: [], volume: [] };
      }
      this.loop.paw.push(paw);
      this.loop.flow.push(flow);
      this.loop.volume.push(volume);
      if (this.loop.paw.length > 2000) this.loop = { paw: [], flow: [], volume: [] };

      if (this.frozen) continue;
      const idx = Math.round(t * RATE) % this.size;
      this.t[idx] = t;
      this.paw[idx] = paw;
      this.flow[idx] = flow;
      this.volume[idx] = volume;
      this.pes[idx] = pes;
      this.co2[idx] = co2;
      // Clear the erase bar ahead of the write position.
      const gap = Math.round(ERASE_SECONDS * RATE);
      for (let g = 1; g <= gap; g++) {
        const j = (idx + g) % this.size;
        this.t[j] = NaN;
        this.paw[j] = NaN;
        this.flow[j] = NaN;
        this.volume[j] = NaN;
        this.pes[j] = NaN;
        this.co2[j] = NaN;
      }
      this.head = idx;
    }
    this.version++;
  }

  clear(): void {
    for (const a of [this.t, this.paw, this.flow, this.volume, this.pes, this.co2]) a.fill(NaN);
    this.head = -1;
    this.loop = { paw: [], flow: [], volume: [] };
    this.previousLoop = null;
    this.breathStarts = [];
    this.version++;
  }
}
