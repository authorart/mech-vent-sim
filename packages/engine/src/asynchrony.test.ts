/**
 * M9: each asynchrony appears with the setting that causes it and goes away with the fix
 * Hess & Kacmarek give (ch. 7, 9, 15, 18). Breathing is "regular" unless a test is about variability.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES, type PatientFeatures, type SedationLevel } from "./drive";
import type { ProfileId } from "./profiles";
import { createProfileSession } from "./session";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";
import { SAMPLE, type PcvSettings, type PsvSettings, type VentSettings } from "./types";

interface Run {
  breaths: number;
  efforts: number;
  triggered: number;
  /** Patient-triggered breaths starting < 0.4 s after the previous inspiration ended. */
  stacked: number;
  maxPexp: number;
  minInspPaw: number;
  minInspFlow: number;
  meanTi: number;
  intervalCv: number;
}

function run(
  id: ProfileId,
  settings: VentSettings,
  sedation: SedationLevel,
  features: Partial<PatientFeatures> = {},
  seconds = 60,
): Run {
  const s = createProfileSession(id, {
    settings,
    sedation,
    features: { ...DEFAULT_FEATURES, breathing: "regular", cardiacOscillation: "off", ...features },
  });
  s.advance(40);
  const r = s.sim.advance(seconds);
  const windows = r.breaths.map((b) => [b.startTime + 0.06, b.startTime + b.inspTime] as const);
  let efforts = 0;
  let prev = 0;
  let maxPexp = 0;
  let minInspPaw = Infinity;
  let minInspFlow = Infinity;
  for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
    const t = r.samples[i + SAMPLE.T]!;
    const pmus = r.samples[i + SAMPLE.PMUS]!;
    if (pmus > 0.5 && prev <= 0.5) efforts++;
    prev = pmus;
    maxPexp = Math.max(maxPexp, r.samples[i + SAMPLE.PEXP]!);
    if (windows.some(([a, b]) => t >= a && t <= b)) {
      minInspPaw = Math.min(minInspPaw, r.samples[i + SAMPLE.PAW]!);
      minInspFlow = Math.min(minInspFlow, r.samples[i + SAMPLE.FLOW]!);
    }
  }
  const b = r.breaths;
  let stacked = 0;
  for (let i = 1; i < b.length; i++) {
    const gap = b[i]!.startTime - (b[i - 1]!.startTime + b[i - 1]!.inspTime);
    if (gap < 0.4 && b[i]!.trigger === "patient") stacked++;
  }
  const iv = b.slice(1).map((x, i) => x.startTime - b[i]!.startTime);
  const mean = iv.reduce((a, x) => a + x, 0) / iv.length;
  const sd = Math.sqrt(iv.reduce((a, x) => a + (x - mean) ** 2, 0) / iv.length);
  return {
    breaths: b.length,
    efforts,
    triggered: b.filter((x) => x.trigger === "patient").length,
    stacked,
    maxPexp,
    minInspPaw,
    minInspFlow,
    meanTi: b.reduce((a, x) => a + x.inspTime, 0) / b.length,
    intervalCv: sd / mean,
  };
}

const psv = (pSupport: number, esens: number): PsvSettings => ({
  ...(settingsForMode("PSV", INITIAL_SETTINGS) as PsvSettings),
  pSupport,
  esens,
});

describe("Cycle asynchrony", () => {
  it("delayed cycling (COPD, PSV 20, Esens 5%): long Ti, the patient pushes back, efforts are missed; raising Esens fixes it", () => {
    const late = run("copd", psv(20, 0.05), "awake");
    expect(late.meanTi).toBeGreaterThan(1);
    expect(late.maxPexp).toBeGreaterThan(4);
    expect(late.triggered).toBeLessThan(late.efforts / 2);
    const fixed = run("copd", psv(20, 0.5), "awake");
    expect(fixed.meanTi).toBeLessThan(0.6);
    expect(fixed.maxPexp).toBeLessThan(1.5);
    expect(fixed.triggered).toBeGreaterThan(late.triggered);
  });

  it("double triggering (metabolic acidosis, VCV Ti 0.5 s); a decelerating ramp (longer Ti) removes it", () => {
    const short = run("metabolicAcidosis", INITIAL_SETTINGS, "awake");
    expect(short.stacked).toBeGreaterThan(10);
    const longer = run("metabolicAcidosis", { ...INITIAL_SETTINGS, flowPattern: "decelerating" }, "awake");
    expect(longer.stacked).toBe(0);
  });

  it("an inspiratory time set too long makes the patient exhale actively (flow reverses in PCV)", () => {
    const pcv: PcvSettings = { ...(settingsForMode("PCV", INITIAL_SETTINGS) as PcvSettings), inspTime: 2 };
    const x = run("normal", pcv, "awake");
    expect(x.maxPexp).toBeGreaterThan(2);
    expect(x.minInspFlow).toBeLessThan(0);
    const ok = run("normal", { ...pcv, inspTime: 0.8 }, "awake");
    expect(ok.maxPexp).toBeLessThan(x.maxPexp / 2);
  });
});

describe("Flow asynchrony", () => {
  it("flow starvation scoops airway pressure below PEEP; more flow lifts it (and shortens Ti)", () => {
    const low = run("metabolicAcidosis", INITIAL_SETTINGS, "awake");
    expect(low.minInspPaw).toBeLessThan(INITIAL_SETTINGS.peep);
    const high = run("metabolicAcidosis", { ...INITIAL_SETTINGS, peakFlow: 100 / 60 }, "awake");
    expect(high.minInspPaw).toBeGreaterThan(low.minInspPaw + 4);
    expect(high.meanTi).toBeLessThan(low.meanTi);
  });
});

describe("Trigger asynchrony", () => {
  it("ineffective triggering from PEEP_i (COPD); PEEP 10 counterbalances it", () => {
    const x = run("copd", INITIAL_SETTINGS, "awake");
    expect(x.efforts).toBeGreaterThan(15);
    expect(x.triggered).toBe(0);
    const fixed = run("copd", { ...INITIAL_SETTINGS, peep: 10 }, "awake");
    expect(fixed.triggered).toBeGreaterThanOrEqual(fixed.efforts - 1);
  });

  it("reverse triggering: each machine breath entrains an effort in a deeply sedated patient", () => {
    expect(run("ards", INITIAL_SETTINGS, "deep").efforts).toBe(0);
    const ards = run("ards", INITIAL_SETTINGS, "deep", { reverseTriggering: true });
    expect(ards.efforts).toBe(ards.breaths);
    // Compliant lungs: the entrained effort triggers a second breath after each machine breath.
    const normal = run("normal", INITIAL_SETTINGS, "deep", { reverseTriggering: true });
    expect(normal.triggered).toBeGreaterThan(10);
    expect(normal.breaths).toBeGreaterThan(24);
  });
});

describe("Breathing pattern", () => {
  const p = psv(10, 0.25);
  it("natural breathing varies breath to breath; regular breathing doesn't", () => {
    expect(run("normal", p, "awake").intervalCv).toBeLessThan(0.01);
    expect(run("normal", p, "awake", { breathing: "natural" }).intervalCv).toBeGreaterThan(0.05);
  });

  it("the same seed replays exactly the same breaths", () => {
    const sample = () => {
      const s = createProfileSession("normal", { settings: p, sedation: "awake" });
      return Array.from(s.advance(60).samples.slice(0, 20000));
    };
    expect(sample()).toEqual(sample());
  });

  it("natural breathing includes sighs (about one in 60 efforts)", () => {
    const s = createProfileSession("normal", { settings: p, sedation: "awake" });
    let sighs = 0;
    let last = false;
    for (let i = 0; i < 1200; i++) {
      s.advance(1);
      if (s.sim.effort.lastWasSigh && !last) sighs++;
      last = s.sim.effort.lastWasSigh;
    }
    expect(sighs).toBeGreaterThanOrEqual(1);
  });

  it("severe agitation makes breathing faster and more irregular", () => {
    const calm = run("normal", p, "awake", { breathing: "natural" });
    const agitated = run("normal", p, "awake", { breathing: "natural", agitation: "severe" });
    expect(agitated.breaths).toBeGreaterThan(calm.breaths * 1.4);
    expect(agitated.intervalCv).toBeGreaterThan(calm.intervalCv);
  });
});
