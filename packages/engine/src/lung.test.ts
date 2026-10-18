/**
 * M11 lung realism (Hess & Kacmarek ch. 17, 18, 30, 31): COPD flow limitation, ARDS recruitment
 * with hysteresis, stress index, viscoelastic plateau decay, esophageal pressure.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES } from "./drive";
import type { ProfileId } from "./profiles";
import { createProfileSession, type Session } from "./session";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";
import { SAMPLE, type PcvSettings, type VentSettings } from "./types";

const quiet = { ...DEFAULT_FEATURES, breathing: "regular" as const, cardiacOscillation: "off" as const };

const vcv = (o: Partial<VentSettings>): VentSettings =>
  ({ ...INITIAL_SETTINGS, highPressureLimit: 80, ...o }) as VentSettings;

/** ARDS recruitment maneuver: PCV 25 above PEEP 20 (45 cmH2O), Ti 2 s, for 40 s. */
const RECRUITMENT_MANEUVER = {
  ...(settingsForMode("PCV", INITIAL_SETTINGS) as PcvSettings),
  pInsp: 25,
  peep: 20,
  inspTime: 2,
  rate: 10,
  highPressureLimit: 60,
};

interface Measured {
  pplat: number;
  totalPeep: number;
  cstat: number;
  stressIndex: number | null;
  recruited: number;
  pf: number;
}

function session(id: ProfileId, settings: VentSettings): Session {
  const s = createProfileSession(id, { settings, noiseSeed: null, features: quiet });
  s.gasTimeScale = 10;
  return s;
}

/** Settle 40 s, then an Inspiratory Pause and an Expiratory Hold. */
function measure(s: Session, vt: number): Measured {
  s.advance(40);
  const b = s.sim.advance(8).breaths.at(-1)!;
  s.sim.inspiratoryPause();
  const e = s.advance(8).events.find((x) => x.type === "plateauMeasured");
  s.sim.expiratoryHold();
  const h = s.advance(8).events.find((x) => x.type === "totalPeepMeasured");
  const pplat = e?.type === "plateauMeasured" ? e.plateau : NaN;
  const totalPeep = h?.type === "totalPeepMeasured" ? h.totalPeep : NaN;
  return {
    pplat,
    totalPeep,
    cstat: vt / (pplat - totalPeep),
    stressIndex: b.stressIndex,
    recruited: b.endExpRecruited,
    pf: s.gas.state!.pf,
  };
}

/** Go from `from` settings to `to` after 40 s, then measure. */
function after(id: ProfileId, from: VentSettings, to: VentSettings): Measured {
  const s = session(id, from);
  s.advance(40);
  s.sim.applySettings(to);
  return measure(s, (to as { tidalVolume: number }).tidalVolume);
}

describe("COPD expiratory flow limitation (waterfall)", () => {
  const totalPeep = (peep: number) =>
    measure(session("copd", vcv({ peep, highPressureLimit: 60 })), 0.5).totalPeep;

  it("PEEP up to the critical pressure doesn't raise Total PEEP; above it, it adds", () => {
    const at0 = totalPeep(0);
    expect(totalPeep(7) - at0).toBeLessThan(0.5);
    expect(totalPeep(12) - at0).toBeGreaterThan(1.5);
    expect(at0).toBeGreaterThan(12); // PEEP_i ≈ 9 on PEEP 5 stays in the spec's range
  });
});

describe("ARDS recruitment", () => {
  const vt = 0.4;
  const atPeep = (peep: number) => vcv({ peep, tidalVolume: vt, rate: 25 });

  it("low PEEP: tidal recruitment bends the pressure rise downward (stress index < 1)", () => {
    const x = measure(session("ards", vcv({})), 0.5);
    expect(x.stressIndex!).toBeLessThan(0.96);
    expect(x.recruited).toBeLessThan(0.15);
  });

  it("a recruitment maneuver keeps more lung open at the same PEEP (hysteresis)", () => {
    const direct = after("ards", atPeep(5), atPeep(14));
    const recruited = after("ards", RECRUITMENT_MANEUVER, atPeep(14));
    expect(recruited.recruited).toBeGreaterThan(direct.recruited + 0.2);
    expect(recruited.cstat).toBeGreaterThan(direct.cstat * 1.15);
    expect(recruited.pf).toBeGreaterThan(direct.pf * 1.2);
  });

  it("decremental PEEP after a maneuver: compliance peaks at a middle PEEP; too high overdistends (stress index > 1.2)", () => {
    const trial = [24, 20, 16, 12, 8].map((peep) => ({
      peep,
      ...after("ards", RECRUITMENT_MANEUVER, atPeep(peep)),
    }));
    const best = trial.reduce((a, b) => (b.cstat > a.cstat ? b : a));
    expect(best.peep).toBeGreaterThanOrEqual(12);
    expect(best.peep).toBeLessThanOrEqual(20);
    expect(trial[0]!.cstat).toBeLessThan(best.cstat * 0.8);
    expect(trial.at(-1)!.cstat).toBeLessThan(best.cstat);
    expect(trial[0]!.stressIndex!).toBeGreaterThan(1.2);
    expect(best.stressIndex!).toBeGreaterThan(0.9);
    expect(best.stressIndex!).toBeLessThan(1.1);
  });

  it("normal lungs: a straight pressure rise (stress index ≈ 1)", () => {
    const x = measure(session("normal", vcv({})), 0.5);
    expect(x.stressIndex!).toBeGreaterThan(0.95);
    expect(x.stressIndex!).toBeLessThan(1.05);
  });
});

describe("Viscoelastic tissue", () => {
  it("during an inspiratory pause pressure drops fast (resistance) then slowly (P1 → P2)", () => {
    const s = session("ards", vcv({ pauseTime: 1 }));
    s.advance(20);
    const r = s.sim.advance(8);
    const b = r.breaths.find((x) => x.startTime >= 20)!;
    const flowEnd = b.startTime + 0.5 + 0.025;
    const pawAt = (t: number) => {
      for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
        if (r.samples[i + SAMPLE.T]! >= t) return r.samples[i + SAMPLE.PAW]!;
      }
      return NaN;
    };
    const p1 = pawAt(flowEnd + 0.03);
    const p2 = pawAt(flowEnd + 0.95);
    expect(p1 - p2).toBeGreaterThan(0.8);
    expect(p1 - p2).toBeLessThan(5);
  });
});

describe("Esophageal pressure", () => {
  it("passive inflation raises Pes by about Vt / chest-wall compliance", () => {
    const s = session("normal", vcv({}));
    s.advance(20);
    const r = s.sim.advance(3.75);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
      min = Math.min(min, r.samples[i + SAMPLE.PES]!);
      max = Math.max(max, r.samples[i + SAMPLE.PES]!);
    }
    expect(max - min).toBeCloseTo(0.5 / 0.2, 0); // normal chest wall 200 mL/cmH2O
  });

  it("a patient's effort makes Pes swing negative", () => {
    const s = createProfileSession("normal", {
      settings: settingsForMode("PSV", INITIAL_SETTINGS),
      sedation: "awake",
      noiseSeed: null,
      features: quiet,
    });
    s.advance(20);
    const r = s.sim.advance(10);
    let min = Infinity;
    for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
      min = Math.min(min, r.samples[i + SAMPLE.PES]!);
    }
    expect(min).toBeLessThan(2); // end-expiratory Pes is about 3
  });
});
