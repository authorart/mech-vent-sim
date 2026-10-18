/**
 * M13 Scenario Events: each event shows the signs Hess & Kacmarek describe, and treating it
 * reverses them.
 */
import { describe, expect, it } from "vitest";
import { decodeCase, encodeCase, type CaseState } from "./case";
import type { SedationLevel } from "./drive";
import type { ProfileId } from "./profiles";
import { progression, ScenarioTimeline, type ScenarioEventKind } from "./scenario";
import { createProfileSession, type Session } from "./session";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";
import { SAMPLE, type PcvSettings, type PsvSettings, type VentSettings } from "./types";

function window(s: Session, seconds: number) {
  const r = s.advance(seconds);
  const m = r.metrics;
  const mean = (f: (x: (typeof m)[number]) => number) => m.reduce((a, x) => a + f(x), 0) / m.length;
  let maxDisplayedVolumeAtBreathStart = 0;
  let lastStartVolume = 0;
  const d = r.samples;
  for (let i = 0; i < d.length; i += SAMPLE.STRIDE) lastStartVolume = d[i + SAMPLE.VOLUME]!;
  maxDisplayedVolumeAtBreathStart = lastStartVolume;
  return {
    ppeak: mean((x) => x.ppeak),
    vti: mean((x) => x.vti),
    vte: mean((x) => x.vte),
    ti: mean((x) => x.ti),
    breaths: m.length,
    autoTriggers: r.events.filter((e) => e.type === "asynchrony" && e.kind === "autoTrigger").length,
    endVolume: maxDisplayedVolumeAtBreathStart,
    scenario: r.events.filter((e) => e.type === "scenario"),
    vitals: s.circulation.state!,
    spo2: s.gas.state!.spo2,
  };
}

function start(id: ProfileId, settings: VentSettings, sedation: SedationLevel = "deep") {
  const s = createProfileSession(id, { settings, sedation, noiseSeed: null });
  s.advance(30);
  return s;
}

const pcv = (o: Partial<PcvSettings> = {}): PcvSettings => ({
  ...(settingsForMode("PCV", INITIAL_SETTINGS) as PcvSettings),
  ...o,
});
const psv = (o: Partial<PsvSettings> = {}): PsvSettings => ({
  ...(settingsForMode("PSV", INITIAL_SETTINGS) as PsvSettings),
  ...o,
});

describe("Timeline", () => {
  it("an event ramps up over its onset and fades after treatment", () => {
    const tl = new ScenarioTimeline();
    const e = tl.schedule("bronchospasm", 10);
    expect(progression(e, 5)).toBe(0);
    expect(progression(e, 25)).toBeCloseTo(0.5, 5); // onset 30 s
    expect(tl.resolve(e.id, 40)).toBe(true);
    expect(progression(e, 40)).toBeCloseTo(1, 5);
    expect(progression(e, 200)).toBeLessThan(0.05);
  });

  it("a scheduled event waits for its time and reports start and resolve", () => {
    const s = start("normal", INITIAL_SETTINGS);
    const e = s.scheduleEvent("bronchospasm", 10, 20);
    const early = window(s, 5);
    expect(early.scenario).toEqual([]);
    const later = window(s, 30);
    expect(later.scenario.map((x) => (x.type === "scenario" ? x.phase : ""))).toEqual([
      "started",
      "resolved",
    ]);
    expect(s.scenario.events[0]!.id).toBe(e.id);
  });
});

describe("Tension pneumothorax (table 25-1)", () => {
  it("VCV: peak pressure climbs; HR rises; BP rises then collapses; SpO2 falls; decompression reverses it", () => {
    const s = start("normal", INITIAL_SETTINGS);
    const before = window(s, 20);
    const e = s.scheduleEvent("tensionPneumothorax");
    const early = window(s, 40);
    expect(early.vitals.sbp).toBeGreaterThan(before.vitals.sbp + 5);
    window(s, 80);
    const late = window(s, 60);
    expect(late.ppeak).toBeGreaterThan(before.ppeak + 10);
    expect(late.vitals.hr).toBeGreaterThan(before.vitals.hr + 30);
    expect(late.vitals.sbp).toBeLessThan(70);
    expect(late.spo2).toBeLessThan(92);
    s.resolveEvent(e.id);
    window(s, 60);
    const after = window(s, 30);
    expect(after.ppeak).toBeLessThan(before.ppeak + 2);
    expect(after.vitals.sbp).toBeGreaterThan(105);
  });

  it("PCV: tidal volume falls at the same pressure", () => {
    const s = start("normal", pcv());
    const before = window(s, 20);
    s.scheduleEvent("tensionPneumothorax");
    window(s, 120);
    const late = window(s, 20);
    expect(late.vte).toBeLessThan(before.vte * 0.6);
    expect(Math.abs(late.ppeak - before.ppeak)).toBeLessThan(1.5); // pressure-controlled
  });
});

describe("Leaks (ch. 25, 31)", () => {
  it.each(["cuffLeak", "bronchopleuralFistula"] as ScenarioEventKind[])(
    "%s: exhaled volume below inhaled, volume trace doesn't return to zero, autotriggering",
    (kind) => {
      const s = start("normal", INITIAL_SETTINGS);
      s.scheduleEvent(kind);
      window(s, 20);
      const x = window(s, 30);
      expect(x.vte).toBeLessThan(x.vti * 0.8);
      expect(x.endVolume).toBeGreaterThan(0.1);
      expect(x.autoTriggers).toBeGreaterThan(3);
    },
  );

  it("a cuff leak prolongs PSV breaths if Esens is low (flow never falls to it)", () => {
    const s = start("normal", psv({ esens: 0.05 }), "awake");
    const before = window(s, 30);
    s.scheduleEvent("cuffLeak");
    window(s, 10);
    const x = window(s, 30);
    expect(x.ti).toBeGreaterThan(before.ti + 0.3);
  });

  it("fixing the cuff leak restores exhaled volume", () => {
    const s = start("normal", INITIAL_SETTINGS);
    const e = s.scheduleEvent("cuffLeak");
    window(s, 20);
    s.resolveEvent(e.id);
    window(s, 10);
    const x = window(s, 30);
    expect(x.vte).toBeGreaterThan(x.vti * 0.95);
    expect(x.autoTriggers).toBe(0);
  });
});

describe("Bronchospasm and secretions", () => {
  it("bronchospasm raises peak pressure; a bronchodilator brings it back", () => {
    const s = start("normal", { ...INITIAL_SETTINGS, highPressureLimit: 60 });
    const before = window(s, 20);
    const e = s.scheduleEvent("bronchospasm");
    window(s, 30);
    const peak = window(s, 20);
    expect(peak.ppeak).toBeGreaterThan(before.ppeak + 6);
    s.resolveEvent(e.id);
    window(s, 150);
    expect(window(s, 20).ppeak).toBeLessThan(before.ppeak + 1);
  });

  it("secretions put a sawtooth on the displayed flow; suction removes it", () => {
    const wiggles = (s: Session) => {
      const d = s.advance(8).samples;
      let changes = 0;
      let prevSlope = 0;
      for (let i = SAMPLE.STRIDE; i < d.length; i += SAMPLE.STRIDE) {
        const slope = Math.sign(d[i + SAMPLE.FLOW]! - d[i - SAMPLE.STRIDE + SAMPLE.FLOW]!);
        if (slope !== 0 && slope !== prevSlope) changes++;
        if (slope !== 0) prevSlope = slope;
      }
      return changes;
    };
    const s = start("normal", INITIAL_SETTINGS);
    const clean = wiggles(s);
    const e = s.scheduleEvent("secretions");
    s.advance(25);
    expect(wiggles(s)).toBeGreaterThan(clean * 3);
    s.resolveEvent(e.id);
    s.advance(15);
    expect(wiggles(s)).toBeLessThan(clean * 1.5);
  });
});

describe("Sedation and agitation", () => {
  it("sedation wears off: light, then awake; re-sedating returns to deep", () => {
    const s = start("normal", INITIAL_SETTINGS);
    const e = s.scheduleEvent("sedationWearsOff");
    s.advance(5);
    expect(s.sedation).toBe("light");
    s.advance(90);
    expect(s.sedation).toBe("awake");
    s.resolveEvent(e.id);
    s.advance(1);
    expect(s.sedation).toBe("deep");
  });

  it("agitation makes breathing faster until treated", () => {
    const s = start("normal", psv(), "awake");
    const calmRate = s.appliedDrive.neuralRate;
    const e = s.scheduleEvent("agitation");
    s.advance(20);
    expect(s.features.agitation).toBe("severe");
    expect(s.appliedDrive.neuralRate).toBeGreaterThan(calmRate * 1.4);
    s.resolveEvent(e.id);
    s.advance(1);
    expect(s.features.agitation).toBe("none");
  });
});

describe("Case links", () => {
  it("carry the scenario timeline", () => {
    const c: CaseState = {
      v: 1,
      profileId: "normal",
      settings: INITIAL_SETTINGS,
      sedation: "deep",
      sex: "male",
      heightCm: 170,
      patch: {},
      events: [
        { kind: "tensionPneumothorax", at: 60, resolvedAt: null },
        { kind: "secretions", at: 10, resolvedAt: 40 },
      ],
    };
    expect(decodeCase(encodeCase(c))?.events).toEqual(c.events);
    const bad = { ...c, events: [{ kind: "meteor", at: 5, resolvedAt: null }] } as unknown as CaseState;
    expect(decodeCase(encodeCase(bad))?.events).toEqual([]);
  });
});
