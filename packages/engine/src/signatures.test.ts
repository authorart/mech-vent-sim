/**
 * Profile signatures (R2-Q13 level 2 + 3): each Patient Profile on the Initial Settings must
 * show the waveform and gas signatures that simulation-engine.md describes.
 */
import { describe, expect, it } from "vitest";
import type { SedationLevel } from "./drive";
import type { ProfileId } from "./profiles";
import { createProfileSession, type Session } from "./session";
import { INITIAL_SETTINGS, settingsForMode } from "./settings";
import type { VentSettings } from "./types";

interface Snapshot {
  s: Session;
  ppeak: number;
  pplat: number | null;
  pplatReliable: boolean;
  peepI: number | null;
  peepIReliable: boolean;
  rrSpont: number;
  vte: number;
  pf: number;
  paco2: number;
  etco2: number;
  ph: number;
  sbp: number;
  alarms: string[];
}

/** Run 60 s (gas fast-forwarded ×10), then an Inspiratory Pause and an Expiratory Hold (12 s each, enough at slow rates). */
function measure(
  id: ProfileId,
  settings: VentSettings = INITIAL_SETTINGS,
  sedation: SedationLevel = "deep",
): Snapshot {
  const s = createProfileSession(id, { settings, sedation });
  s.gasTimeScale = 10;
  for (let i = 0; i < 60; i++) s.advance(1);
  s.sim.inspiratoryPause();
  s.advance(12);
  s.sim.expiratoryHold();
  const hold = s.advance(12).events.find((e) => e.type === "totalPeepMeasured");
  const m = s.latestMetrics!;
  const g = s.gas.state!;
  return {
    s,
    ppeak: m.ppeak,
    pplat: m.pplat?.value ?? null,
    pplatReliable: m.pplat?.reliable ?? false,
    peepI: hold?.type === "totalPeepMeasured" ? hold.peepI : null,
    peepIReliable: hold?.type === "totalPeepMeasured" ? hold.reliable : false,
    rrSpont: m.rrSpont,
    vte: m.vte,
    pf: g.pf,
    paco2: g.paco2,
    etco2: g.etco2,
    ph: g.ph,
    sbp: s.circulation.state!.sbp,
    alarms: s.alarms.activeAlarms.map((a) => a.id),
  };
}

describe("Normal lungs", () => {
  it("no alarms on Initial Settings", () => {
    expect(measure("normal").alarms).toEqual([]);
  });
});

describe("Severe ARDS", () => {
  const x = measure("ards");
  it("VCV: P_plat ≥ 30 with a narrow peak–plateau gap", () => {
    expect(x.pplat!).toBeGreaterThanOrEqual(29.5);
    expect(x.ppeak - x.pplat!).toBeLessThan(10);
  });
  it("refractory hypoxemia: P/F < 100 on FiO2 1.0", () => {
    expect(x.pf).toBeLessThan(100);
  });
  it("High Driving Pressure alarm", () => {
    expect(x.alarms).toContain("HIGH_DRIVING_PRESSURE");
  });
  it("PCV: markedly reduced Vt for a standard driving pressure", () => {
    const pcv = settingsForMode("PCV", INITIAL_SETTINGS);
    expect(measure("ards", pcv).vte).toBeLessThan(measure("normal", pcv).vte * 0.5);
  });
});

describe("Status asthmaticus", () => {
  it("Initial Settings: every breath hits the 40 cmH2O limit (High Pressure alarm)", () => {
    expect(measure("asthma").alarms).toContain("HIGH_PRESSURE");
  });
  const raised = measure("asthma", { ...INITIAL_SETTINGS, highPressureLimit: 60 });
  it("limit raised: high P_peak, mildly elevated P_plat, gap > 15", () => {
    expect(raised.ppeak - raised.pplat!).toBeGreaterThan(15);
    expect(raised.pplat!).toBeLessThan(30);
  });
  it("PEEP_i 8–18 by Expiratory Hold", () => {
    expect(raised.peepI!).toBeGreaterThanOrEqual(8);
    expect(raised.peepI!).toBeLessThanOrEqual(18);
  });
  it("lowering RR reduces PEEP_i", () => {
    const slow = measure("asthma", { ...INITIAL_SETTINGS, highPressureLimit: 60, rate: 10 });
    expect(slow.peepI!).toBeLessThan(raised.peepI! / 2);
  });
});

describe("COPD exacerbation", () => {
  const x = measure("copd", { ...INITIAL_SETTINGS, highPressureLimit: 60 });
  it("PEEP_i 8–18 and a wide gap", () => {
    expect(x.peepI!).toBeGreaterThanOrEqual(8);
    expect(x.peepI!).toBeLessThanOrEqual(18);
    expect(x.ppeak - x.pplat!).toBeGreaterThan(15);
    expect(x.alarms).toContain("AUTO_PEEP");
  });
});

describe("Severe metabolic acidosis", () => {
  it("sedated on Initial Settings: pH < 7.0", () => {
    expect(measure("metabolicAcidosis").ph).toBeLessThan(7.0);
  });
  it("awake: patient triggers extra breaths and compensates partly", () => {
    const x = measure("metabolicAcidosis", INITIAL_SETTINGS, "awake");
    expect(x.rrSpont).toBeGreaterThan(10);
    expect(x.ph).toBeGreaterThan(7.1);
    expect(x.paco2).toBeLessThan(25);
  });
  it("awake in PSV: large tidal volumes", () => {
    const x = measure("metabolicAcidosis", settingsForMode("PSV", INITIAL_SETTINGS), "awake");
    expect(x.vte).toBeGreaterThan(0.6);
  });
});

describe("Cardiogenic pulmonary edema", () => {
  it("shunt responds well to PEEP", () => {
    const low = measure("cardiogenicEdema");
    const high = measure("cardiogenicEdema", { ...INITIAL_SETTINGS, peep: 12 });
    expect(high.pf).toBeGreaterThan(low.pf * 1.5);
  });
});

describe("Massive PE", () => {
  const x = measure("massivePe");
  it("wide PaCO2–EtCO2 gradient with near-normal mechanics", () => {
    expect(x.paco2 - x.etco2).toBeGreaterThan(10);
    expect(x.pplat!).toBeLessThan(20);
  });
  it("hypotension", () => {
    expect(x.sbp).toBeLessThan(100);
  });
});

describe("Central apnea", () => {
  it("no patient-triggered breaths, even 'awake'", () => {
    expect(measure("centralApnea", INITIAL_SETTINGS, "awake").rrSpont).toBe(0);
  });
  it("PSV: Apnea alarm and Apnea Backup", () => {
    const x = measure("centralApnea", settingsForMode("PSV", INITIAL_SETTINGS), "awake");
    expect(x.alarms).toContain("APNEA");
    expect(x.s.sim.isApneaBackupActive).toBe(true);
  });
});

describe("Maneuvers during patient effort", () => {
  it("are flagged unreliable", () => {
    const x = measure("ards", INITIAL_SETTINGS, "awake");
    expect(x.peepIReliable && x.pplatReliable).toBe(false);
  });
});
