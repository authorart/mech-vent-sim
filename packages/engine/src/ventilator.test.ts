/**
 * M10 ventilator realism (Hess & Kacmarek ch. 7, 9, 15): pressure servo with overshoot and
 * concave rise, PSV pressure cycling, cardiogenic autotriggering, display noise.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES, type PatientFeatures, type SedationLevel } from "./drive";
import type { ProfileId } from "./profiles";
import { createProfileSession } from "./session";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";
import { SAMPLE, type PcvSettings, type PsvSettings, type VentSettings } from "./types";

interface Run {
  target: number;
  maxInspPaw: number;
  /** Mean airway pressure halfway through the rise time. */
  pawAtHalfRise: number;
  linearHalfRise: number;
  breaths: number;
  triggered: number;
  cycles: Record<string, number>;
}

function run(
  id: ProfileId,
  settings: VentSettings,
  sedation: SedationLevel,
  features: Partial<PatientFeatures> = {},
): Run {
  const s = createProfileSession(id, {
    settings,
    sedation,
    noiseSeed: null,
    features: { ...DEFAULT_FEATURES, breathing: "regular", cardiacOscillation: "off", ...features },
  });
  s.advance(40);
  const r = s.sim.advance(30);
  const dp = settings.mode === "PCV" ? settings.pInsp : settings.mode === "PSV" ? settings.pSupport : 0;
  const rise = settings.mode === "VCV" ? 0.04 : Math.max(settings.riseTime, 0.04);
  let maxInspPaw = -Infinity;
  let sum = 0;
  let n = 0;
  for (const b of r.breaths) {
    for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
      const t = r.samples[i + SAMPLE.T]! - b.startTime;
      if (t < 0 || t > b.inspTime) continue;
      const paw = r.samples[i + SAMPLE.PAW]!;
      maxInspPaw = Math.max(maxInspPaw, paw);
      if (Math.abs(t - rise / 2) < 0.006) {
        sum += paw;
        n++;
      }
    }
  }
  const cycles: Record<string, number> = {};
  for (const b of r.breaths) cycles[b.cycle] = (cycles[b.cycle] ?? 0) + 1;
  return {
    target: settings.peep + dp,
    maxInspPaw,
    pawAtHalfRise: sum / n,
    linearHalfRise: settings.peep + dp / 2,
    breaths: r.breaths.length,
    triggered: r.breaths.filter((b) => b.trigger === "patient").length,
    cycles,
  };
}

const pcv = (riseTime: number): PcvSettings => ({
  ...(settingsForMode("PCV", INITIAL_SETTINGS) as PcvSettings),
  riseTime,
});
const psv = (o: Partial<PsvSettings>): PsvSettings => ({
  ...(settingsForMode("PSV", INITIAL_SETTINGS) as PsvSettings),
  ...o,
});

describe("Rise time (pressure servo)", () => {
  it("a very fast rise overshoots the set pressure; a slower rise doesn't", () => {
    const fast = run("normal", pcv(0), "deep");
    expect(fast.maxInspPaw).toBeGreaterThan(fast.target + 2);
    const slow = run("normal", pcv(0.2), "deep");
    expect(slow.maxInspPaw).toBeLessThan(slow.target + 1.6);
  });

  it("a slow rise against a strong pull gives a concave, sagging rise (flow starvation)", () => {
    const hungry = run("metabolicAcidosis", psv({ riseTime: 0.4 }), "awake");
    expect(hungry.pawAtHalfRise).toBeLessThan(hungry.linearHalfRise - 5);
    const quiet = run("normal", psv({ riseTime: 0.4 }), "awake");
    expect(quiet.pawAtHalfRise).toBeGreaterThan(quiet.linearHalfRise - 1);
  });

  it("peak flow in pressure modes can reach the ventilator's limit (~180 L/min)", () => {
    const s = createProfileSession("normal", { settings: pcv(0), noiseSeed: null });
    s.advance(20);
    const peak = Math.max(...s.sim.advance(10).breaths.map((b) => b.peakInspFlow));
    expect(peak * 60).toBeGreaterThan(150);
    expect(peak * 60).toBeLessThan(220);
  });
});

describe("PSV secondary cycling", () => {
  it("a patient pushing against a late-cycling breath (COPD, Esens 5%) pressure-cycles it: the end-inspiratory spike (fig. 15-9); raising Esens fixes it", () => {
    const late = run("copd", psv({ pSupport: 20, esens: 0.05 }), "awake", { agitation: "severe" });
    expect(late.cycles.pressure ?? 0).toBeGreaterThan(late.breaths / 2);
    expect(late.maxInspPaw).toBeGreaterThan(late.target + 2.5);
    const fixed = run("copd", psv({ pSupport: 20, esens: 0.4 }), "awake", { agitation: "severe" });
    expect(fixed.cycles.pressure ?? 0).toBe(0);
  });
});

describe("Cardiogenic oscillations", () => {
  it("a strong heartbeat ripple autotriggers a 2 L/min flow trigger; 8 L/min stops it (fig. 15-2)", () => {
    const auto = run("normal", INITIAL_SETTINGS, "deep", { cardiacOscillation: "strong" });
    expect(auto.triggered).toBeGreaterThan(0);
    expect(auto.breaths).toBeGreaterThan(10); // set rate gives 8 in 30 s
    const fixed = run(
      "normal",
      { ...INITIAL_SETTINGS, trigger: { type: "flow", threshold: 8 / 60 } },
      "deep",
      { cardiacOscillation: "strong" },
    );
    expect(fixed.triggered).toBe(0);
    expect(fixed.breaths).toBe(8);
  });

  it("the usual small ripple doesn't trigger", () => {
    expect(run("normal", INITIAL_SETTINGS, "deep", { cardiacOscillation: "small" }).triggered).toBe(0);
  });
});

describe("Display noise", () => {
  it("adds a little noise to displayed pressure and flow, but not to the measured breath values", () => {
    const record = (noiseSeed: number | null) => {
      const s = createProfileSession("normal", { noiseSeed });
      s.advance(20);
      return s.sim.advance(4);
    };
    const quiet = record(null);
    const noisy = record(5);
    const sd = (ch: number) => {
      const d: number[] = [];
      for (let i = 0; i < quiet.samples.length; i += SAMPLE.STRIDE) {
        d.push(noisy.samples[i + ch]! - quiet.samples[i + ch]!);
      }
      return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
    };
    expect(sd(SAMPLE.PAW)).toBeGreaterThan(0.02);
    expect(sd(SAMPLE.PAW)).toBeLessThan(0.1);
    expect(sd(SAMPLE.FLOW) * 60).toBeLessThan(0.5); // L/min
    expect(sd(SAMPLE.VOLUME)).toBe(0);
    expect(noisy.breaths[0]!.peakPaw).toBe(quiet.breaths[0]!.peakPaw);
  });
});
