/**
 * M16 SIMV (Hess & Kacmarek ch. 6, fig. 6-6 to 6-8; ch. 15, fig. 15-10): Mandatory Breaths at the
 * SIMV rate, synchronized through the Assist Window, pressure-supported Spontaneous Breaths in
 * between, and mode asynchrony.
 */
import { describe, expect, it } from "vitest";
import { decodeCase, encodeCase, type CaseState } from "./case";
import { DEFAULT_FEATURES, type SedationLevel } from "./drive";
import { Monitor } from "./monitor";
import type { ProfileId } from "./profiles";
import { createProfileSession } from "./session";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";
import { ASSIST_WINDOW } from "./simulator";
import {
  SAMPLE,
  type AdvanceResult,
  type BreathRecord,
  type PsimvSettings,
  type VsimvSettings,
} from "./index";

const vsimv = (o: Partial<VsimvSettings> = {}): VsimvSettings => ({
  ...(settingsForMode("V-SIMV", INITIAL_SETTINGS) as VsimvSettings),
  ...o,
});
const psimv = (o: Partial<PsimvSettings> = {}): PsimvSettings => ({
  ...(settingsForMode("P-SIMV", INITIAL_SETTINGS) as PsimvSettings),
  ...o,
});

function run(
  id: ProfileId,
  settings: VsimvSettings | PsimvSettings,
  sedation: SedationLevel,
  seconds = 60,
): AdvanceResult {
  const s = createProfileSession(id, {
    settings,
    sedation,
    noiseSeed: null,
    features: { ...DEFAULT_FEATURES, breathing: "regular", cardiacOscillation: "off" },
  });
  s.advance(60);
  return s.sim.advance(seconds);
}

const mandatory = (bs: BreathRecord[]) => bs.filter((b) => b.breathType === "mandatory");
const spontaneous = (bs: BreathRecord[]) => bs.filter((b) => b.breathType === "spontaneous");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("SIMV timing", () => {
  it("gives exactly the SIMV rate, evenly spaced, when the patient makes no effort", () => {
    const r = run("normal", vsimv({ rate: 10 }), "deep");
    const m = mandatory(r.breaths);
    expect(m).toHaveLength(10);
    expect(spontaneous(r.breaths)).toHaveLength(0);
    for (let i = 1; i < m.length; i++) {
      expect(m[i]!.startTime - m[i - 1]!.startTime).toBeCloseTo(6, 2);
    }
    for (const b of m) {
      expect(b.trigger).toBe("mandatory");
      expect(b.mode).toBe("VCV");
      expect(b.vte).toBeCloseTo(0.5, 1);
    }
  });

  it("synchronizes each Mandatory Breath to an effort in the Assist Window, one per cycle", () => {
    const period = 6;
    const r = run("normal", vsimv({ rate: 10 }), "light", 120);
    const m = mandatory(r.breaths);
    expect(m.length).toBeGreaterThanOrEqual(19);
    expect(m.length).toBeLessThanOrEqual(20);
    // An untriggered Mandatory Breath comes when the window closes, so cycles start at
    // (its start − window); every triggered one starts inside a window on that grid.
    const timed = m.find((b) => b.trigger === "mandatory")!;
    const grid = timed.startTime - ASSIST_WINDOW * period;
    const triggered = m.filter((b) => b.trigger === "patient");
    expect(triggered.length).toBeGreaterThan(0);
    for (const b of m) {
      const intoCycle = (((b.startTime - grid) % period) + period) % period;
      expect(intoCycle).toBeLessThanOrEqual(ASSIST_WINDOW * period + 0.01);
    }
    // One Mandatory Breath per cycle.
    const cycles = m.map((b) => Math.floor((b.startTime - grid + 1e-6) / period));
    expect(new Set(cycles).size).toBe(cycles.length);
  });

  it("enters SIMV from VCV without stacking: the first window opens one cycle after the last breath", () => {
    const s = createProfileSession("normal", {
      settings: INITIAL_SETTINGS,
      sedation: "deep",
      noiseSeed: null,
      features: { ...DEFAULT_FEATURES, breathing: "regular", cardiacOscillation: "off" },
    });
    s.advance(30);
    s.sim.applySettings(vsimv({ rate: 6 }));
    const r = s.sim.advance(50);
    const starts = r.breaths.map((b) => b.startTime);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(60 / 16 - 0.01);
    }
    const after = r.breaths.filter((b) => b.startTime > 31 + 60 / 16);
    expect(after.length).toBeGreaterThan(2);
    for (let i = 1; i < after.length; i++) {
      expect(after[i]!.startTime - after[i - 1]!.startTime).toBeCloseTo(10, 1);
    }
  });
});

describe("SIMV breath types", () => {
  it("supports the Spontaneous Breaths between Mandatory ones with pressure", () => {
    const ps5 = run("normal", vsimv({ rate: 6, pSupport: 5 }), "awake");
    const ps0 = run("normal", vsimv({ rate: 6, pSupport: 0 }), "awake");
    const sp5 = spontaneous(ps5.breaths);
    const sp0 = spontaneous(ps0.breaths);
    expect(sp5.length).toBeGreaterThanOrEqual(6);
    for (const b of sp5) {
      expect(b.mode).toBe("PSV");
      expect(b.trigger).toBe("patient");
    }
    // Bigger with pressure support than as CPAP, and smaller than the Mandatory Breaths.
    expect(mean(sp5.map((b) => b.vte))).toBeGreaterThan(mean(sp0.map((b) => b.vte)) + 0.05);
    expect(mean(sp5.map((b) => b.vte))).toBeLessThan(mean(mandatory(ps5.breaths).map((b) => b.vte)));
  });

  it("P-SIMV gives pressure-controlled, time-cycled Mandatory Breaths", () => {
    const r = run("normal", psimv({ rate: 8, inspTime: 1.2 }), "light");
    const m = mandatory(r.breaths);
    expect(m).toHaveLength(8);
    for (const b of m) {
      expect(b.mode).toBe("PCV");
      expect(b.cycle).toBe("time");
      expect(b.inspTime).toBeCloseTo(1.2, 2);
    }
    for (const b of spontaneous(r.breaths)) expect(b.cycle).not.toBe("time");
  });

  it("the monitor splits rate and Vte by breath type", () => {
    const r = run("normal", vsimv({ rate: 6 }), "awake");
    const monitor = new Monitor();
    const last = r.breaths.map((b) => monitor.update(b)).at(-1)!;
    expect(last.rrMandatory).toBeCloseTo(6, 0);
    expect(last.rrTotal - last.rrMandatory).toBeGreaterThan(3);
    expect(last.vteMandatory!).toBeGreaterThan(last.vteSpontaneous!);
    expect(last.breathType).toMatch(/mandatory|spontaneous/);
  });
});

describe("Mode asynchrony (fig. 15-10)", () => {
  it("the patient's effort is about the same on Mandatory and Spontaneous Breaths at a low rate", () => {
    const r = run("cardiogenicEdema", vsimv({ rate: 6 }), "awake");
    const effort = (b: BreathRecord) => {
      let pmus = 0;
      let pesStart = NaN;
      let pesMin = Infinity;
      for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
        const t = r.samples[i + SAMPLE.T]!;
        if (t < b.startTime - 0.3 || t > b.endTime) continue;
        if (Number.isNaN(pesStart)) pesStart = r.samples[i + SAMPLE.PES]!;
        pesMin = Math.min(pesMin, r.samples[i + SAMPLE.PES]!);
        pmus = Math.max(pmus, r.samples[i + SAMPLE.PMUS]!);
      }
      return { pmus, pesSwing: pesStart - pesMin };
    };
    const m = mandatory(r.breaths).map(effort);
    const sp = spontaneous(r.breaths).map(effort);
    expect(m.length).toBeGreaterThanOrEqual(5);
    expect(sp.length).toBeGreaterThanOrEqual(10);
    // Same muscle effort, and an esophageal swing on the Mandatory Breath nearly as deep.
    expect(mean(m.map((e) => e.pmus))).toBeCloseTo(mean(sp.map((e) => e.pmus)), 0);
    expect(mean(m.map((e) => e.pesSwing))).toBeGreaterThan(0.7 * mean(sp.map((e) => e.pesSwing)));
  });
});

describe("SIMV settings", () => {
  it("carry over between matching modes (R7-Q5)", () => {
    const vcv = { ...INITIAL_SETTINGS, tidalVolume: 0.45, peakFlow: 50 / 60, peep: 8 };
    const v = settingsForMode("V-SIMV", vcv) as VsimvSettings;
    expect(v).toMatchObject({ tidalVolume: 0.45, peakFlow: 50 / 60, peep: 8, rate: 10, pSupport: 5 });

    const p = settingsForMode("P-SIMV", { ...v, rate: 8, pSupport: 12, esens: 0.4 });
    expect(p).toMatchObject({ mode: "P-SIMV", rate: 8, pSupport: 12, esens: 0.4, pInsp: 15 });

    const pcv = settingsForMode("PCV", { ...(p as PsimvSettings), pInsp: 22, inspTime: 0.9 });
    expect(pcv).toMatchObject({ mode: "PCV", pInsp: 22, inspTime: 0.9, rate: 8 });

    expect(settingsForMode("VCV", v)).toMatchObject({ mode: "VCV", tidalVolume: 0.45 });
  });

  it("survive a case link", () => {
    const c: CaseState = {
      v: 1,
      profileId: "copd",
      settings: vsimv({ rate: 8, pSupport: 10 }),
      sedation: "light",
      sex: "male",
      heightCm: 175,
      patch: {},
      events: [],
    };
    expect(decodeCase(encodeCase(c))?.settings).toEqual(c.settings);
    const p = { ...c, settings: psimv({ pInsp: 18 }) };
    expect(decodeCase(encodeCase(p))?.settings).toEqual(p.settings);
  });
});
