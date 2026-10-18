/** M15 capnogram (Hess & Kacmarek ch. 28, fig. 28-3 and 28-4). */
import { describe, expect, it } from "vitest";
import type { ProfileId } from "./profiles";
import { createProfileSession } from "./session";
import { INITIAL_SETTINGS } from "./settings";
import { SAMPLE } from "./types";

/** CO2 through one whole breath, split into inspiration and expiration. */
function breath(id: ProfileId) {
  const s = createProfileSession(id, {
    settings: { ...INITIAL_SETTINGS, highPressureLimit: 60 },
    noiseSeed: null,
  });
  s.gasTimeScale = 10;
  s.advance(60);
  s.advance(0.1); // hands the current EtCO2 to the simulator
  const r = s.sim.advance(10);
  const b = r.breaths.find((x) => x.startTime > r.samples[0]!)!;
  const insp: number[] = [];
  const exp: number[] = [];
  for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
    const t = r.samples[i + SAMPLE.T]!;
    const co2 = r.samples[i + SAMPLE.CO2]!;
    if (t >= b.startTime + 0.1 && t < b.startTime + b.inspTime) insp.push(co2);
    if (t >= b.startTime + b.inspTime && t < b.endTime) exp.push(co2);
  }
  return { insp, exp, etco2: s.gas.state!.etco2 };
}

describe("Capnogram", () => {
  it("reads zero during inspiration and in early expiration (phase I), then rises to EtCO2", () => {
    const x = breath("normal");
    expect(Math.max(...x.insp)).toBeLessThan(2);
    expect(x.exp[2]!).toBeLessThan(2); // first 20 ms: dead space
    expect(x.exp.at(-1)!).toBeCloseTo(x.etco2, 0);
  });

  it("normal lungs: a flat alveolar plateau (phase III)", () => {
    const x = breath("normal");
    const mid = x.exp[Math.floor(x.exp.length / 2)]!;
    expect(mid / x.exp.at(-1)!).toBeGreaterThan(0.95);
  });

  it("obstruction: phase III keeps rising (the 'shark fin')", () => {
    const normal = breath("normal");
    const copd = breath("copd");
    const ratio = (x: typeof normal) => x.exp[Math.floor(x.exp.length / 4)]! / x.exp.at(-1)!;
    expect(ratio(copd)).toBeLessThan(ratio(normal) - 0.1);
  });
});
