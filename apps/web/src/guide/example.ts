import { createProfileSession, SAMPLE, type AsynchronyKind } from "@mech-vent/engine";
import type { Example } from "./asynchrony";

export interface ExampleTrace {
  t: number[];
  paw: number[];
  flow: number[];
  marks: { t: number; kind: AsynchronyKind }[];
}

const SETTLE = 40;
const SHOWN = 8;

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
  const out: ExampleTrace = { t: [], paw: [], flow: [], marks: [] };
  const d = step.samples;
  for (let i = 0; i < d.length; i += SAMPLE.STRIDE * 2) {
    out.t.push(d[i + SAMPLE.T]! - SETTLE);
    out.paw.push(d[i + SAMPLE.PAW]!);
    out.flow.push(d[i + SAMPLE.FLOW]! * 60);
  }
  for (const e of step.events) {
    if (e.type === "asynchrony") out.marks.push({ t: e.t - SETTLE, kind: e.kind });
  }
  return out;
}
