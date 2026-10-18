/**
 * V1.2 waveform realism: PSV hands back from Apnea Backup, obstructive expiratory flow is
 * scooped, the P–V curve bends at high volume, and the expiratory circuit rounds the pressure.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_FEATURES } from "./drive";
import { PROFILES, type ProfileId } from "./profiles";
import { createProfileSession } from "./session";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";
import { SAMPLE, type BreathRecord, type PsvSettings, type VentSettings } from "./types";

const psv = (esens = 0.25): PsvSettings => ({
  ...(settingsForMode("PSV", INITIAL_SETTINGS) as PsvSettings),
  esens,
});

/** Expiratory limb of the last complete breath: flow at mid-volume ÷ the straight line from peak to end. */
function expiratoryShape(id: ProfileId, settings: VentSettings = INITIAL_SETTINGS) {
  const s = createProfileSession(id, { settings: { ...settings, highPressureLimit: 60 } });
  s.advance(40);
  const r = s.sim.advance(8);
  const b = r.breaths.at(-1)!;
  const pts: { v: number; q: number }[] = [];
  for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
    const t = r.samples[i + SAMPLE.T]!;
    if (t > b.startTime + b.inspTime && t < b.endTime) {
      pts.push({ v: r.samples[i + SAMPLE.VOLUME]!, q: r.samples[i + SAMPLE.FLOW]! });
    }
  }
  const peak = pts.reduce((a, p) => (p.q < a.q ? p : a));
  const end = pts.at(-1)!;
  const mid = (peak.v + end.v) / 2;
  const atMid = pts.reduce((a, p) => (Math.abs(p.v - mid) < Math.abs(a.v - mid) ? p : a));
  return { scoop: atMid.q / ((peak.q + end.q) / 2), peakFlow: -peak.q, breath: b };
}

describe("PSV and Apnea Backup", () => {
  it("a deeply sedated patient on PSV gets Apnea Backup; waking up returns to PSV", () => {
    const s = createProfileSession("normal", { settings: psv() });
    s.advance(30);
    expect(s.sim.isApneaBackupActive).toBe(true);
    s.setSedation("awake");
    const r = s.advance(60);
    expect(r.events.some((e) => e.type === "apneaBackupEnded")).toBe(true);
    expect(s.sim.isApneaBackupActive).toBe(false);
    expect(r.metrics.at(-1)!.mode).toBe("PSV");
  });

  it("raising Esens shortens the breath (cycles earlier on the falling flow)", () => {
    const ti = (esens: number) => {
      const s = createProfileSession("normal", { settings: psv(esens), sedation: "awake" });
      s.advance(30);
      return s.sim.advance(20).breaths.at(-1)!.inspTime;
    };
    expect(ti(0.05)).toBeGreaterThan(ti(0.25) + 0.2);
    expect(ti(0.25)).toBeGreaterThan(ti(0.5) + 0.2);
  });
});

describe("Obstructive expiratory flow", () => {
  it("normal lungs empty along a straight flow–volume line", () => {
    expect(expiratoryShape("normal").scoop).toBeGreaterThan(0.95);
  });
  it.each(["asthma", "copd"] as const)("%s: early peak, then a scooped (concave) limb", (id) => {
    const x = expiratoryShape(id);
    expect(x.scoop).toBeLessThan(0.7);
    expect(x.peakFlow * 60).toBeGreaterThan(20);
  });
  it("COPD: added PEEP is partly absorbed (Total PEEP rises less than PEEP does)", () => {
    const totalPeep = (peep: number) => {
      const b: BreathRecord = expiratoryShape("copd", { ...INITIAL_SETTINGS, peep }).breath;
      return b.endExpRecoil;
    };
    expect(totalPeep(10) - totalPeep(5)).toBeLessThan(4);
  });
});

describe("Overdistension", () => {
  it("ARDS: static compliance falls when Vt pushes past the upper bend", () => {
    const cstat = (vt: number) => {
      const s = createProfileSession("ards", {
        settings: { ...INITIAL_SETTINGS, tidalVolume: vt, highPressureLimit: 80 },
        features: { ...DEFAULT_FEATURES, cardiacOscillation: "off" },
      });
      s.advance(20);
      s.sim.inspiratoryPause();
      const e = s.advance(6).events.find((x) => x.type === "plateauMeasured");
      return e?.type === "plateauMeasured" ? vt / (e.plateau - INITIAL_SETTINGS.peep) : NaN;
    };
    expect(cstat(0.8)).toBeLessThan(cstat(0.4) * 0.8);
  });
});

describe("Expiratory circuit", () => {
  it("airway pressure eases down to PEEP instead of dropping straight to it", () => {
    const s = createProfileSession("normal");
    s.advance(10);
    const r = s.sim.advance(8);
    const b = r.breaths.find((x) => x.startTime >= 10)!;
    const at = (t: number) => {
      for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
        if (r.samples[i + SAMPLE.T]! >= t - 1e-6) return r.samples[i + SAMPLE.PAW]!;
      }
      return NaN;
    };
    const tExp = b.startTime + b.inspTime;
    expect(at(tExp + 0.03)).toBeGreaterThan(b.peep + 1.5);
    expect(at(tExp + 1.5)).toBeCloseTo(b.peep, 0);
  });
});

it("severe metabolic acidosis opens awake (its lesson is the drive)", () => {
  expect(PROFILES.metabolicAcidosis.startSedation).toBe("awake");
  expect(createProfileSession("metabolicAcidosis").sedation).toBe("awake");
  expect(createProfileSession("normal").sedation).toBe("deep");
});

describe("Bias flow", () => {
  it("an awake, high-drive patient can't draw more than the bias flow between breaths", () => {
    const s = createProfileSession("metabolicAcidosis");
    s.advance(30);
    const r = s.sim.advance(20);
    let maxTrough = -Infinity;
    for (let i = 0; i < r.samples.length; i += SAMPLE.STRIDE) {
      const paw = r.samples[i + SAMPLE.PAW]!;
      maxTrough = Math.max(maxTrough, INITIAL_SETTINGS.peep - paw);
    }
    // Strong efforts pull airway pressure below PEEP (the trigger dip) instead of drawing free gas.
    expect(maxTrough).toBeGreaterThan(1);
    // Over many breaths (double triggers included) what goes in comes out.
    const vti = r.breaths.reduce((a, b) => a + b.vti, 0);
    const vte = r.breaths.reduce((a, b) => a + b.vte, 0);
    expect(Math.abs(vti - vte) / vti).toBeLessThan(0.1);
  });
});
