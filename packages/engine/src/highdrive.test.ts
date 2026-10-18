/**
 * High drive (severe metabolic acidosis): premature cycling and, with stronger efforts, double
 * triggering keep happening until the cause is treated (bicarbonate) or the ventilator meets the
 * demand. Runs step in short chunks, as the simulator does, so the chemoreflex is live.
 */
import { describe, expect, it } from "vitest";
import { AlarmEngine } from "./alarms";
import { DEFAULT_FEATURES } from "./drive";
import type { BreathMetrics } from "./monitor";
import { createProfileSession, type Session } from "./session";
import { INITIAL_SETTINGS } from "./settings";
import { recommendedStart } from "./targets";
import type { AsynchronyKind, BreathRecord, VentSettings } from "./types";

const STEP = 0.5;

function acidosis(settings: VentSettings = INITIAL_SETTINGS): Session {
  return createProfileSession("metabolicAcidosis", { settings, features: DEFAULT_FEATURES });
}

/** Asynchronies per minute over the next `minutes`, and the alarms raised. */
function watch(s: Session, minutes: number) {
  const counts: Partial<Record<AsynchronyKind, number>> = {};
  const alarms = new Set<string>();
  for (let t = 0; t < minutes * 60 - 1e-9; t += STEP) {
    const step = s.advance(STEP);
    for (const e of step.events)
      if (e.type === "asynchrony") counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    for (const a of step.alarms) if (a.type === "alarmRaised") alarms.add(a.id);
  }
  const perMin = (k: AsynchronyKind) => (counts[k] ?? 0) / minutes;
  return { perMin, alarms };
}

describe("Severe metabolic acidosis: high drive", () => {
  it("doesn't calm down within seconds: the chemoreflex follows the blood gas with inertia", () => {
    const s = acidosis();
    const base = s.baseDrive.pmusMax;
    watch(s, 20 / 60);
    expect(s.appliedDrive.pmusMax).toBeGreaterThan(0.75 * base);
  });

  it("untreated on VCV: premature cycling every breath, double triggering often, for minutes", () => {
    const s = acidosis();
    watch(s, 3);
    for (let minute = 0; minute < 3; minute++) {
      const x = watch(s, 1);
      expect(x.perMin("prematureCycling")).toBeGreaterThan(15);
      expect(x.perMin("doubleTrigger")).toBeGreaterThan(4);
    }
  });

  it("stacked breaths (one barely exhales) don't raise a circuit disconnect alarm", () => {
    const s = acidosis();
    expect(watch(s, 4).alarms.has("DISCONNECT")).toBe(false);
  });

  it("correcting the bicarbonate calms the drive and the asynchrony goes away", () => {
    const s = acidosis();
    watch(s, 3);
    s.setGas({ hco3: 22 });
    watch(s, 3);
    const x = watch(s, 2);
    expect(s.appliedDrive.pmusMax).toBeLessThan(6);
    expect(x.perMin("doubleTrigger")).toBeLessThan(1);
    expect(x.perMin("flowStarvation")).toBeLessThan(10);
  });

  it("a ventilator set for the demand (recommended start) cuts double triggering", () => {
    const untreated = acidosis();
    watch(untreated, 3);
    const before = watch(untreated, 2);
    const s = acidosis();
    watch(s, 3);
    s.sim.applySettings(recommendedStart("metabolicAcidosis", 65));
    watch(s, 1);
    const after = watch(s, 2);
    expect(after.perMin("doubleTrigger")).toBeLessThan(before.perMin("doubleTrigger") / 2);
    expect(after.perMin("prematureCycling")).toBeLessThan(before.perMin("prematureCycling"));
  });

  it("untreated on PSV: premature cycling keeps going", () => {
    const s = acidosis({
      ...INITIAL_SETTINGS,
      mode: "PSV",
      pSupport: 10,
      riseTime: 0.1,
      esens: 0.25,
      apneaTime: 20,
      backup: { pInsp: 15, rate: 12, inspTime: 1 },
    } as VentSettings);
    watch(s, 3);
    expect(watch(s, 2).perMin("prematureCycling")).toBeGreaterThan(15);
  });
});

describe("Circuit disconnect alarm", () => {
  const metrics = (vti: number, vte: number, t: number) =>
    ({
      t,
      vti,
      vte,
      ppeak: 20,
      ve: 10,
      rrTotal: 20,
      truth: { peepI: 0, drivingPressure: 10 },
    }) as BreathMetrics;
  const record = { highPressureCycled: false } as BreathRecord;

  it("needs the volume lost over several breaths, not one stacked breath", () => {
    const a = new AlarmEngine();
    const raised: string[] = [];
    for (let i = 0; i < 10; i++) {
      // Double triggering: a breath that barely exhales, then one that exhales both.
      const vte = i % 2 === 0 ? 0 : 1;
      for (const e of a.onBreath(metrics(0.5, vte, i), record, INITIAL_SETTINGS, false)) {
        if (e.type === "alarmRaised") raised.push(e.id);
      }
    }
    expect(raised).not.toContain("DISCONNECT");
  });

  it("still alarms when exhaled volume is lost breath after breath", () => {
    const a = new AlarmEngine();
    const raised: string[] = [];
    for (let i = 0; i < 4; i++) {
      for (const e of a.onBreath(metrics(0.5, 0.02, i), record, INITIAL_SETTINGS, false)) {
        if (e.type === "alarmRaised") raised.push(e.id);
      }
    }
    expect(raised).toContain("DISCONNECT");
  });
});
