import { describe, expect, it } from "vitest";
import { o2Saturation, type BloodGas, type GasParams } from "./gas";
import { NORMAL_GAS, Session } from "./session";
import type { Drive, Mechanics, PsvSettings, VcvSettings } from "./types";

const passive: Drive = { neuralRate: 0, pmusMax: 0, inspFraction: 0.35 };
const normal: Mechanics = { compliance: 0.06, rInsp: 5, rExp: 5 };

/** Alveolar dead-space fraction that gives the profile's Vd/Vt at Vt = 0.5 L. */
const alvDs = (vdvt: number) => (vdvt * 0.5 - 0.125) / (0.5 - 0.125);
/** Shunt at PEEP 0 that gives `atPeep5` at PEEP 5. */
const shuntMax = (atPeep5: number, recruitable: number, half: number) =>
  atPeep5 / (1 - recruitable / (1 + Math.exp(-(5 - half) / 3)));

const ARDS_GAS: GasParams = {
  ...NORMAL_GAS,
  vco2: 220,
  alveolarDeadSpaceFraction: alvDs(0.55),
  shuntMax: shuntMax(0.45, 0.5, 12),
  recruitableFraction: 0.5,
  peepHalf: 12,
  vqMismatch: 0.05,
  hco3: 22,
};
const COPD_GAS: GasParams = {
  ...NORMAL_GAS,
  alveolarDeadSpaceFraction: alvDs(0.5),
  shuntMax: 0.08,
  vqMismatch: 0.15,
  hco3: 32,
};

const vcv = (o: Partial<VcvSettings> = {}): VcvSettings => ({
  peep: 5,
  fio2: 1,
  trigger: { type: "flow", threshold: 2 / 60 },
  highPressureLimit: 80,
  mode: "VCV",
  tidalVolume: 0.5,
  rate: 16,
  peakFlow: 1,
  flowPattern: "square",
  pauseTime: 0,
  ...o,
});

function gasAfter(s: Session, seconds: number): BloodGas & { sbp: number; hr: number } {
  let last: BloodGas | null = null;
  let sbp = 0;
  let hr = 0;
  const chunk = 1 / 60;
  for (let i = 0; i < Math.round(seconds / chunk); i++) {
    const p = s.advance(chunk).physiology;
    if (p) {
      last = p.gas;
      sbp = p.vitals.sbp;
      hr = p.vitals.hr;
    }
  }
  if (!last) throw new Error("no gas reported");
  return { ...last, sbp, hr };
}

const session = (m: Mechanics, settings: VcvSettings, gas: GasParams = NORMAL_GAS) =>
  new Session({ patient: { mechanics: m, drive: passive }, settings, gas });

describe("O2 dissociation curve", () => {
  it("matches reference points", () => {
    expect(o2Saturation(27)).toBeCloseTo(0.5, 1);
    expect(o2Saturation(60)).toBeCloseTo(0.9, 1);
    expect(o2Saturation(100)).toBeGreaterThan(0.97);
  });
});

describe("Gas exchange", () => {
  it("is null before priming, then reports at 1 Hz", () => {
    const s = session(normal, vcv());
    expect(s.advance(5).physiology).toBeNull();
    expect(s.advance(6).physiology).not.toBeNull();
  });

  it("normal lungs on sensible settings: normal blood gas", () => {
    const g = gasAfter(session(normal, vcv({ tidalVolume: 0.45, rate: 14, fio2: 0.4 })), 20);
    expect(g.paco2).toBeGreaterThan(37);
    expect(g.paco2).toBeLessThan(44);
    expect(g.ph).toBeGreaterThan(7.36);
    expect(g.ph).toBeLessThan(7.44);
    expect(g.spo2).toBeGreaterThan(97);
    expect(g.paco2 - g.etco2).toBeLessThan(5);
  });

  it("PaCO2 follows ventilation with a time constant of minutes; fast-forward speeds it up", () => {
    const s = session(normal, vcv({ tidalVolume: 0.45, rate: 14 }));
    const before = gasAfter(s, 20).paco2;
    s.sim.applySettings(vcv({ tidalVolume: 0.45, rate: 28 }));
    const after30s = gasAfter(s, 30).paco2;
    expect(after30s).toBeLessThan(before);
    expect(after30s).toBeGreaterThan(before * 0.75); // still far from the new steady state

    s.gasTimeScale = 20;
    const fast = gasAfter(s, 30).paco2; // 10 physiological minutes
    expect(fast).toBeCloseTo(before / 2, 0);
  });

  it("apnea: PaCO2 rises ~15 mmHg in the first minute and EtCO2 falls to 0", () => {
    const s = session(normal, vcv({ tidalVolume: 0.45, rate: 14 }));
    const before = gasAfter(s, 20);
    const apnea: PsvSettings = {
      ...vcv(),
      mode: "PSV",
      pSupport: 10,
      riseTime: 0.1,
      esens: 0.25,
      apneaTime: 600,
      backup: { pInsp: 15, rate: 12, inspTime: 1 },
    };
    s.sim.applySettings(apnea);
    const after = gasAfter(s, 64);
    expect(after.paco2 - before.paco2).toBeGreaterThan(10);
    expect(after.paco2 - before.paco2).toBeLessThan(20);
    expect(after.etco2).toBe(0);
  });

  it("ARDS on post-intubation settings: P/F < 100; PEEP recruits and FiO2 helps little", () => {
    const ards: Mechanics = { compliance: 0.02, rInsp: 8, rExp: 8 };
    const s = session(ards, vcv({ fio2: 1 }), ARDS_GAS);
    const base = gasAfter(s, 20);
    expect(base.pf).toBeLessThan(100);

    s.sim.applySettings(vcv({ fio2: 1, peep: 15, tidalVolume: 0.35, rate: 24 }));
    s.gasTimeScale = 10;
    expect(gasAfter(s, 30).pf).toBeGreaterThan(base.pf * 1.5);
  });

  it("FiO2 helps V/Q mismatch (COPD) much more than shunt (ARDS)", () => {
    const rise = (gas: GasParams, m: Mechanics) => {
      const lo = gasAfter(session(m, vcv({ fio2: 0.3 }), gas), 20).pao2;
      const hi = gasAfter(session(m, vcv({ fio2: 0.6 }), gas), 20).pao2;
      return hi - lo;
    };
    const copd = rise(COPD_GAS, { compliance: 0.08, rInsp: 20, rExp: 50 });
    const ards = rise(ARDS_GAS, { compliance: 0.02, rInsp: 8, rExp: 8 });
    expect(copd).toBeGreaterThan(3 * ards);
  });

  it("massive PE: wide PaCO2–EtCO2 gradient", () => {
    const pe: GasParams = {
      ...NORMAL_GAS,
      vco2: 220,
      alveolarDeadSpaceFraction: alvDs(0.65),
      hco3: 22,
    };
    const g = gasAfter(session({ compliance: 0.052, rInsp: 4.5, rExp: 4.5 }, vcv(), pe), 20);
    expect(g.paco2 - g.etco2).toBeGreaterThan(10);
  });

  it("metabolic acidosis on post-intubation settings: pH < 7.0", () => {
    const ma: GasParams = { ...NORMAL_GAS, vco2: 280, hco3: 8 };
    const g = gasAfter(session({ compliance: 0.06, rInsp: 4, rExp: 4 }, vcv(), ma), 20);
    expect(g.ph).toBeLessThan(7.0);
  });
});

describe("Circulation", () => {
  it("auto-PEEP lowers blood pressure and raises HR", () => {
    const asthma: Mechanics = { compliance: 0.045, rInsp: 25, rExp: 55 };
    const sick = gasAfter(session(asthma, vcv({ tidalVolume: 0.6, rate: 22 })), 40);
    const ok = gasAfter(session(normal, vcv({ tidalVolume: 0.45, rate: 14 })), 40);
    expect(ok.sbp - sick.sbp).toBeGreaterThan(20);
    expect(sick.hr).toBeGreaterThan(ok.hr);
  });
});
