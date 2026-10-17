import { describe, expect, it } from "vitest";
import { Simulator } from "./simulator";
import { SAMPLE } from "./types";
import type {
  BreathRecord,
  Drive,
  Mechanics,
  PcvSettings,
  PsvSettings,
  VcvSettings,
  VentSettings,
} from "./types";

const passive: Drive = { neuralRate: 0, pmusMax: 0, inspFraction: 0.35 };
const normal: Mechanics = { compliance: 0.06, rInsp: 5, rExp: 5 };
const ards: Mechanics = { compliance: 0.02, rInsp: 8, rExp: 8 };
const asthma: Mechanics = { compliance: 0.045, rInsp: 25, rExp: 55 };

const common = {
  peep: 5,
  fio2: 1,
  trigger: { type: "flow", threshold: 2 / 60 },
  highPressureLimit: 80,
} as const;

const vcv = (o: Partial<VcvSettings> = {}): VcvSettings => ({
  ...common,
  mode: "VCV",
  tidalVolume: 0.5,
  rate: 10,
  peakFlow: 1,
  flowPattern: "square",
  pauseTime: 0,
  ...o,
});

const pcv = (o: Partial<PcvSettings> = {}): PcvSettings => ({
  ...common,
  mode: "PCV",
  pInsp: 15,
  rate: 10,
  inspTime: 1,
  riseTime: 0,
  ...o,
});

const psv = (o: Partial<PsvSettings> = {}): PsvSettings => ({
  ...common,
  mode: "PSV",
  pSupport: 10,
  riseTime: 0.1,
  esens: 0.25,
  apneaTime: 20,
  backup: { pInsp: 15, rate: 12, inspTime: 1 },
  ...o,
});

function run(mechanics: Mechanics, settings: VentSettings, seconds: number, drive = passive) {
  const sim = new Simulator({ patient: { mechanics, drive }, settings });
  const r = sim.advance(seconds);
  return { sim, ...r };
}

const last = (b: BreathRecord[]): BreathRecord => {
  const x = b.at(-1);
  if (!x) throw new Error("no breaths");
  return x;
};

describe("VCV: exact formulas (passive)", () => {
  it("P_peak = PEEP + Vt/C + R·flow, P_plat = PEEP + Vt/C", () => {
    const { breaths } = run(normal, vcv({ pauseTime: 0.5 }), 60);
    const b = last(breaths);
    expect(b.vti).toBeCloseTo(0.5, 2);
    expect(b.peakPaw).toBeCloseTo(5 + 0.5 / 0.06 + 5 * 1, 1);
    expect(b.plateauPaw).not.toBeNull();
    expect(b.plateauPaw!).toBeCloseTo(5 + 0.5 / 0.06, 1);
    expect(b.trigger).toBe("mandatory");
  });

  it("decelerating flow doubles Ti and still delivers Vt", () => {
    const { breaths } = run(normal, vcv({ flowPattern: "decelerating" }), 30);
    const b = last(breaths);
    expect(b.vti).toBeCloseTo(0.5, 2);
    expect(b.inspTime).toBeCloseTo(1.0, 2);
  });

  it("delivers the set rate", () => {
    const { breaths } = run(normal, vcv({ rate: 15 }), 60.5);
    expect(breaths.length).toBe(15);
  });
});

describe("PCV: exact formulas (passive)", () => {
  it("Vt = ΔP·C·(1 − e^(−Ti/τ))", () => {
    const { breaths } = run(ards, pcv(), 30);
    const tau = 8 * 0.02;
    const expected = 15 * 0.02 * (1 - Math.exp(-1 / tau));
    expect(last(breaths).vti).toBeCloseTo(expected, 3);
  });

  it("falling compliance lowers delivered Vt (pneumothorax-like change)", () => {
    const { sim, breaths } = run(normal, pcv(), 18);
    const before = last(breaths).vti;
    sim.setPatient({ mechanics: { ...normal, compliance: 0.015 } });
    const after = last(sim.advance(18).breaths).vti;
    expect(after).toBeLessThan(before * 0.4);
  });
});

describe("Expiration", () => {
  it("expiratory flow decays with τ = R_exp·C", () => {
    const sim = new Simulator({
      patient: { mechanics: normal, drive: passive },
      settings: vcv({ pauseTime: 0.5 }),
    });
    const { samples } = sim.advance(6);
    const tau = 5 * 0.06;
    const expStart = 0.5 + 0.5; // flow time + pause
    const flowAt = (t: number) => {
      const i = Math.round(t * 100) - 1;
      return samples[i * SAMPLE.STRIDE + SAMPLE.FLOW]!;
    };
    const q0 = -(0.5 / 0.06) / 5;
    expect(flowAt(expStart + 0.01)).toBeCloseTo(q0 * Math.exp(-0.01 / tau), 2);
    expect(flowAt(expStart + tau)).toBeCloseTo(q0 * Math.exp(-1), 2);
  });
});

describe("Intrinsic PEEP (comes out of the mechanics, ADR-0002/0003)", () => {
  const steadyPeepI = (rate: number) => {
    const { breaths } = run(asthma, vcv({ tidalVolume: 0.6, rate }), 90);
    return last(breaths).endExpPalv - 5;
  };

  it("matches the analytic steady state for obstructive mechanics", () => {
    const rate = 22;
    const ti = 0.6;
    const te = 60 / rate - ti;
    const k = Math.exp(-te / (55 * 0.045));
    const expected = (0.6 / 0.045) * (k / (1 - k));
    expect(steadyPeepI(rate)).toBeCloseTo(expected, 1);
    expect(steadyPeepI(rate)).toBeGreaterThan(8);
  });

  it("falls when the rate is reduced", () => {
    expect(steadyPeepI(12)).toBeLessThan(steadyPeepI(22) / 3);
  });

  it("gives a wide peak–plateau gap from R_insp", () => {
    const { breaths } = run(asthma, vcv({ tidalVolume: 0.6, rate: 22, pauseTime: 0.3 }), 60);
    const b = last(breaths);
    expect(b.peakPaw - b.plateauPaw!).toBeCloseTo(25, 0);
  });
});

describe("Triggering", () => {
  const breathing: Drive = { neuralRate: 20, pmusMax: 6, inspFraction: 0.35 };

  it("flow trigger: PSV breaths follow the neural rate, all patient-triggered", () => {
    const { breaths, events } = run(normal, psv(), 61, breathing);
    expect(events.some((e) => e.type === "apneaBackupStarted")).toBe(false);
    expect(breaths.length).toBeGreaterThanOrEqual(18);
    expect(breaths.length).toBeLessThanOrEqual(20);
    expect(breaths.every((b) => b.trigger === "patient")).toBe(true);
  });

  it("pressure trigger also detects effort", () => {
    const s = psv({ trigger: { type: "pressure", threshold: 2 } });
    const { breaths } = run(normal, s, 61, breathing);
    expect(breaths.length).toBeGreaterThanOrEqual(18);
  });

  it("ineffective triggering: effort cannot overcome PEEP_i", () => {
    const weak: Drive = { neuralRate: 30, pmusMax: 5, inspFraction: 0.35 };
    const s = vcv({ tidalVolume: 0.6, rate: 22 });
    const obstructed = run(asthma, s, 90, weak).breaths.slice(-15);
    const healthy = run(normal, s, 90, weak).breaths.slice(-15);
    expect(obstructed.filter((b) => b.trigger === "patient").length).toBe(0);
    expect(healthy.filter((b) => b.trigger === "patient").length).toBeGreaterThan(5);
  });
});

describe("PSV cycling", () => {
  it("cycles to expiration when flow falls to Esens × peak flow", () => {
    const strong: Drive = { neuralRate: 15, pmusMax: 4, inspFraction: 0.3 };
    const { breaths } = run(ards, psv({ esens: 0.25 }), 30, strong);
    const b = last(breaths);
    expect(b.mode).toBe("PSV");
    expect(b.cycleFlow / b.peakInspFlow).toBeGreaterThan(0.2);
    expect(b.cycleFlow / b.peakInspFlow).toBeLessThanOrEqual(0.26);
  });
});

describe("Apnea Backup", () => {
  it("starts after the apnea time when there is no drive, then delivers backup breaths", () => {
    const { sim, breaths, events } = run(normal, psv(), 61);
    const start = events.find((e) => e.type === "apneaBackupStarted");
    expect(start?.t).toBeCloseTo(20, 2);
    expect(sim.isApneaBackupActive).toBe(true);
    // Backup at 12/min from t = 20 s: breaths at 20, 25, …, 60.
    expect(breaths.length).toBe(8);
    expect(breaths.every((b) => b.trigger === "backup" && b.mode === "PCV")).toBe(true);
  });
});

describe("High pressure limit", () => {
  it("ends inspiration immediately and delivers less than the set Vt", () => {
    const { breaths, events } = run(ards, vcv({ tidalVolume: 0.7, highPressureLimit: 40 }), 30);
    const b = last(breaths);
    expect(b.highPressureCycled).toBe(true);
    expect(b.peakPaw).toBeLessThan(40.5);
    expect(b.vti).toBeLessThan(0.7);
    expect(events.some((e) => e.type === "highPressureCycle")).toBe(true);
  });
});

describe("Applying settings", () => {
  it("takes effect at the next Breath, not mid-breath", () => {
    const sim = new Simulator({ patient: { mechanics: normal, drive: passive }, settings: vcv() });
    sim.advance(0.2); // in the middle of the first inspiration
    sim.applySettings(vcv({ tidalVolume: 0.3 }));
    const { breaths, events } = sim.advance(12.1);
    expect(breaths[0]!.vti).toBeCloseTo(0.5, 2);
    expect(breaths[1]!.vti).toBeCloseTo(0.3, 2);
    expect(events.filter((e) => e.type === "settingsApplied")).toHaveLength(1);
  });

  it("is deterministic", () => {
    const a = run(normal, psv(), 30, { neuralRate: 18, pmusMax: 6, inspFraction: 0.35 });
    const b = run(normal, psv(), 30, { neuralRate: 18, pmusMax: 6, inspFraction: 0.35 });
    expect(a.samples).toEqual(b.samples);
  });
});
