/**
 * M14 disease behavior: the new profiles, per-profile hemodynamics and pulse pressure variation,
 * disease targets and the recommended start, dynamic compliance.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES } from "./drive";
import { predictedBodyWeight, PROFILES, type ProfileId } from "./profiles";
import { createProfileSession } from "./session";
import { INITIAL_SETTINGS } from "./settings";
import { evaluateTargets, recommendedStart, TARGETS } from "./targets";
import type { VentSettings } from "./types";

const PBW = predictedBodyWeight("male", 170);

function settle(id: ProfileId, settings: VentSettings, seconds = 90) {
  const s = createProfileSession(id, { settings, noiseSeed: null });
  s.gasTimeScale = 10;
  s.advance(seconds);
  const r = s.advance(20);
  return { s, r, m: r.metrics.at(-1)!, vitals: s.circulation.state!, gas: s.gas.state! };
}

describe("Neuromuscular weakness", () => {
  it("weak efforts trigger a flow trigger but not a 2 cmH2O pressure trigger", () => {
    const run = (trigger: VentSettings["trigger"]) => {
      const s = createProfileSession("neuromuscular", {
        settings: { ...INITIAL_SETTINGS, trigger },
        noiseSeed: null,
        features: { ...DEFAULT_FEATURES, breathing: "regular" },
      });
      s.advance(40);
      const r = s.advance(60);
      return { triggered: r.metrics.filter((m) => m.trigger === "patient").length };
    };
    const flow = run({ type: "flow", threshold: 2 / 60 });
    const pressure = run({ type: "pressure", threshold: 2 });
    expect(flow.triggered).toBeGreaterThan(2);
    expect(pressure.triggered).toBeLessThan(flow.triggered / 2);
  });

  it("has normal lungs: oxygenation is fine once ventilated", () => {
    const x = settle("neuromuscular", recommendedStart("neuromuscular", PBW));
    expect(x.gas.spo2).toBeGreaterThan(95);
    expect(PROFILES.neuromuscular.patient.mechanics.compliance).toBe(0.06);
  });
});

describe("ARDS with stiff chest wall (ch. 31, fig. 31-13)", () => {
  it("high plateau, but transpulmonary pressure is safe; PEEP near esophageal pressure keeps the lung open", () => {
    const start = recommendedStart("ardsStiffChestWall", PBW);
    const x = settle("ardsStiffChestWall", start);
    expect(x.m.esophageal.plEndInsp).toBeLessThan(25);
    expect(x.m.esophageal.pesEndExp).toBeGreaterThan(start.peep - 3);
    expect(x.m.esophageal.pesEndExp).toBeLessThan(start.peep + 3);
    expect(x.m.esophageal.plEndExp).toBeGreaterThan(-3);
    const low = settle("ardsStiffChestWall", { ...start, peep: 5 });
    expect(low.m.esophageal.plEndExp).toBeLessThan(-5); // negative: alveoli tend to collapse
    expect(low.gas.spo2).toBeLessThan(x.gas.spo2);
  });
});

describe("Hemodynamics per profile (ch. 23)", () => {
  const sbp = (id: ProfileId, peep: number) =>
    settle(id, { ...INITIAL_SETTINGS, peep, highPressureLimit: 60 }).vitals.sbp;

  it("PEEP doesn't lower BP in cardiogenic edema (it unloads the failing LV)", () => {
    expect(sbp("cardiogenicEdema", 15)).toBeGreaterThan(sbp("cardiogenicEdema", 5) - 2);
  });

  it("PEEP lowers BP in a preload-dependent patient (massive PE)", () => {
    expect(sbp("massivePe", 15)).toBeLessThan(sbp("massivePe", 5) - 8);
  });

  it("pulse pressure variation: small in normal lungs, larger when preload dependent, absent with effort", () => {
    const normal = settle("normal", INITIAL_SETTINGS).vitals.ppv!;
    const pe = settle("massivePe", INITIAL_SETTINGS).vitals.ppv!;
    expect(normal).toBeGreaterThan(3);
    expect(normal).toBeLessThan(8);
    expect(pe).toBeGreaterThan(normal * 1.3);
    const s = createProfileSession("metabolicAcidosis", { noiseSeed: null });
    s.advance(40);
    expect(s.circulation.state!.ppv).toBeNull();
  });
});

describe("Disease targets and the recommended start", () => {
  it("builds volume control from the targets (Vt per kg PBW, Ti through flow)", () => {
    const ards = recommendedStart("ards", PBW);
    expect(ards.tidalVolume * 1000).toBeCloseTo(6 * PBW, -1);
    expect(ards.rate).toBe(TARGETS.ards.rr.start);
    expect(ards.peep).toBe(TARGETS.ards.peep.start);
    expect(ards.tidalVolume / ards.peakFlow).toBeCloseTo(TARGETS.ards.ti.start, 1);
    expect(recommendedStart("asthma", PBW).highPressureLimit).toBe(60);
    expect(recommendedStart("copd", PBW).fio2).toBe(0.4);
  });

  it.each(Object.keys(PROFILES) as ProfileId[])(
    "%s: the recommended start keeps plateau and transpulmonary pressure within target, without hitting the pressure limit",
    (id) => {
      const x = settle(id, recommendedStart(id, PBW));
      expect(x.r.metrics.every((m) => m.vte > 0.1)).toBe(true);
      const t = TARGETS[id];
      expect(x.m.esophageal.plEndInsp).toBeLessThan(t.plMax);
      // P peak below the start's limit (no breath cut short).
      expect(x.m.ppeak).toBeLessThan(recommendedStart(id, PBW).highPressureLimit);
    },
  );

  it("evaluates current values against the targets", () => {
    const rows = evaluateTargets("ards", {
      vtPerKg: 9,
      rr: 26,
      ti: 0.6,
      peep: 5,
      pplat: 33,
      pl: 18,
      ph: 7.3,
      spo2: 99,
    });
    const status = Object.fromEntries(rows.map((r) => [r.key, r.status]));
    expect(status).toEqual({
      vtPerKg: "high",
      rr: "ok",
      ti: "ok",
      peep: "low",
      pplat: "high",
      pl: "ok",
      ph: "ok",
      spo2: "high",
    });
    expect(evaluateTargets("normal", { vtPerKg: null, rr: null, ti: null, peep: null, pplat: null, pl: null, ph: null, spo2: null }).every((r) => r.status === "unknown")).toBe(true);
  });
});

describe("Dynamic compliance", () => {
  it("is Vte ÷ (P peak − PEEP), lower than static compliance", () => {
    const x = settle("normal", INITIAL_SETTINGS);
    // Uses the set PEEP; the displayed PEEP is the measured end-expiratory pressure.
    expect(x.m.cdyn!).toBeCloseTo(x.m.vte / (x.m.ppeak - x.m.peep), 3);
    expect(x.m.cdyn!).toBeLessThan(0.06);
  });
});
