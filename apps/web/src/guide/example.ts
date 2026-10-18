import { createProfileSession, SAMPLE, type AsynchronyKind } from "@mech-vent/engine";
import type { Example } from "./asynchrony";

export interface ExampleTrace {
  t: number[];
  paw: number[];
  flow: number[];
  marks: { t: number; kind: AsynchronyKind }[];
  /**
   * For comparison examples: the airway pressure of the same breath with no patient effort,
   * drawn from each breath's start (Hess & Kacmarek fig. 15-6, the dashed line).
   */
  passive: { start: number; t: number[]; paw: number[] }[];
}

const SETTLE = 40;
const SHOWN = 8;

/** Mean airway pressure against time since breath start, over inspiration, for a passive patient. */
function passiveBreath(ex: Example): { t: number[]; paw: number[] } {
  const s = createProfileSession(ex.profileId, {
    settings: ex.settings,
    sedation: "deep",
    noiseSeed: null,
    features: { ...ex.features, breathing: "regular", cardiacOscillation: "off" },
  });
  s.advance(SETTLE);
  const r = s.sim.advance(12);
  const bins: number[][] = [];
  for (const b of r.breaths) {
    for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
      const dt = r.samples[i + SAMPLE.T]! - b.startTime;
      if (dt < 0 || dt > b.inspTime) continue;
      (bins[Math.round(dt * 50)] ??= []).push(r.samples[i + SAMPLE.PAW]!);
    }
  }
  const t: number[] = [];
  const paw: number[] = [];
  bins.forEach((v, k) => {
    if (!v) return;
    t.push(k / 50);
    paw.push(v.reduce((a, x) => a + x, 0) / v.length);
  });
  return { t, paw };
}

/**
 * Run an example on the Engine in the page (about 50 s of simulation in a few milliseconds) and
 * keep 8 s of pressure and flow, with the asynchronies detected in that stretch.
 */
export function runExample(ex: Example): ExampleTrace {
  const s = createProfileSession(ex.profileId, {
    settings: ex.settings,
    sedation: ex.sedation,
    noiseSeed: null,
    features: { ...ex.features, breathing: "regular" },
  });
  s.advance(SETTLE);
  const step = s.advance(SHOWN);
  const out: ExampleTrace = { t: [], paw: [], flow: [], marks: [], passive: [] };
  const d = step.samples;
  for (let i = 0; i < d.length; i += SAMPLE.STRIDE * 2) {
    out.t.push(d[i + SAMPLE.T]! - SETTLE);
    out.paw.push(d[i + SAMPLE.PAW]!);
    out.flow.push(d[i + SAMPLE.FLOW]! * 60);
  }
  for (const e of step.events) {
    if (e.type === "asynchrony") out.marks.push({ t: e.t - SETTLE, kind: e.kind });
  }
  out.marks.sort((a, b) => a.t - b.t);
  if (ex.comparePassive) {
    const ref = passiveBreath(ex);
    for (const e of step.events) {
      if (e.type === "breathStart") out.passive.push({ start: e.t - SETTLE, ...ref });
    }
  }
  return out;
}
