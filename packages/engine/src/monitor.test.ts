import { describe, expect, it } from "vitest";
import type { AlarmEvent } from "./alarms";
import type { BreathMetrics } from "./monitor";
import { Session } from "./session";
import { CIRCUIT_RESISTANCE, FLOW_RAMP_TIME } from "./simulator";
import type { Drive, Mechanics, PsvSettings, VcvSettings, VentSettings } from "./types";

const passive: Drive = { neuralRate: 0, pmusMax: 0, inspFraction: 0.35 };
const normal: Mechanics = { compliance: 0.06, rInsp: 5, rExp: 5 };
const ards: Mechanics = { compliance: 0.02, rInsp: 8, rExp: 8 };
const asthma: Mechanics = { compliance: 0.045, rInsp: 25, rExp: 55 };

const vcv = (o: Partial<VcvSettings> = {}): VcvSettings => ({
  peep: 5,
  fio2: 1,
  trigger: { type: "flow", threshold: 2 / 60 },
  highPressureLimit: 80,
  mode: "VCV",
  tidalVolume: 0.5,
  rate: 15,
  peakFlow: 1,
  flowPattern: "square",
  pauseTime: 0,
  ...o,
});

const psv: PsvSettings = {
  peep: 5,
  fio2: 1,
  trigger: { type: "flow", threshold: 2 / 60 },
  highPressureLimit: 40,
  mode: "PSV",
  pSupport: 10,
  riseTime: 0.1,
  esens: 0.25,
  apneaTime: 20,
  backup: { pInsp: 15, rate: 12, inspTime: 1 },
};

function session(mechanics: Mechanics, settings: VentSettings, drive = passive) {
  return new Session({ patient: { mechanics, drive }, settings });
}

const lastMetrics = (m: BreathMetrics[]): BreathMetrics => {
  const x = m.at(-1);
  if (!x) throw new Error("no metrics");
  return x;
};

const raised = (a: AlarmEvent[]) => a.filter((e) => e.type === "alarmRaised").map((e) => e.id);

describe("Maneuvers", () => {
  it("Inspiratory Pause measures P_plat, C_stat and R_aw", () => {
    const s = session(normal, vcv());
    s.advance(30);
    s.sim.inspiratoryPause();
    const { metrics, events } = s.advance(8);
    expect(events.some((e) => e.type === "plateauMeasured")).toBe(true);
    const m = metrics.find((x) => x.cstat !== null)!;
    expect(m.pplat!.value).toBeCloseTo(5 + 0.5 / 0.06, 1);
    expect(m.cstat!).toBeCloseTo(0.06, 3);
    expect(m.raw!).toBeCloseTo(5, 1);
    expect(m.drivingPressure!).toBeCloseTo(0.5 / 0.06, 1);
  });

  it("Expiratory Hold measures Total PEEP; Driving Pressure uses it", () => {
    const s = session(asthma, vcv({ tidalVolume: 0.6, rate: 22 }));
    s.advance(90);
    s.sim.expiratoryHold();
    const { events } = s.advance(5);
    const hold = events.find((e) => e.type === "totalPeepMeasured");
    const te = 60 / 22 - 0.6;
    const k = Math.exp(-te / ((55 + CIRCUIT_RESISTANCE) * 0.045));
    const expected = (0.6 / 0.045) * (k / (1 - k));
    expect(hold && hold.type === "totalPeepMeasured" && hold.peepI).toBeCloseTo(expected, 0);

    s.sim.inspiratoryPause();
    const m = lastMetrics(s.advance(6).metrics);
    expect(m.totalPeep!.value).toBeCloseTo(5 + expected, 0);
    // P_plat − Total PEEP = Vt / C, not P_plat − PEEP_e.
    expect(m.drivingPressure!).toBeCloseTo(0.6 / 0.045, 0);
  });
});

describe("Rolling values", () => {
  it("V_E and RR come from the last minute", () => {
    const s = session(normal, vcv({ rate: 15 }));
    const m = lastMetrics(s.advance(90).metrics);
    expect(m.rrTotal).toBeCloseTo(15, 0);
    expect(m.ve).toBeCloseTo(7.5, 1);
    expect(m.rrSpont).toBe(0);
    const ti = 0.5 + FLOW_RAMP_TIME / 2;
    expect(m.ieRatio).toBeCloseTo((4 - ti) / ti, 1);
  });
});

describe("Alarms", () => {
  it("ARDS on post-intubation settings: High Driving Pressure, which clears after lowering Vt", () => {
    const s = session(ards, vcv({ tidalVolume: 0.5, rate: 16 }));
    expect(raised(s.advance(20).alarms)).toContain("HIGH_DRIVING_PRESSURE");
    s.sim.applySettings(vcv({ tidalVolume: 0.25, rate: 28 }));
    s.advance(20);
    expect(s.alarms.activeAlarms.map((a) => a.id)).not.toContain("HIGH_DRIVING_PRESSURE");
  });

  it("obstructive patient: Auto-PEEP alarm", () => {
    const s = session(asthma, vcv({ tidalVolume: 0.6, rate: 22 }));
    expect(raised(s.advance(30).alarms)).toContain("AUTO_PEEP");
  });

  it("high pressure limit raises a high-priority alarm", () => {
    const s = session(asthma, vcv({ tidalVolume: 0.6, rate: 22, highPressureLimit: 40 }));
    s.advance(10);
    const a = s.alarms.activeAlarms;
    expect(a[0]?.id).toBe("HIGH_PRESSURE");
    expect(a[0]?.priority).toBe("high");
  });

  it("central apnea in PSV: Apnea alarm at the apnea time, cleared when backup is ended", () => {
    const s = session(normal, psv);
    const r = s.advance(21);
    const apnea = r.alarms.find((e) => e.type === "alarmRaised" && e.id === "APNEA");
    expect(apnea?.t).toBeCloseTo(20, 1);
    s.sim.endApneaBackup();
    expect(s.advance(0.1).alarms.some((e) => e.type === "alarmCleared" && e.id === "APNEA")).toBe(
      true,
    );
  });

  it("low minute ventilation once the window has filled", () => {
    const s = session(normal, vcv({ tidalVolume: 0.3, rate: 10 }));
    s.advance(60);
    expect(s.alarms.activeAlarms.map((a) => a.id)).toContain("LOW_MINUTE_VENT");
  });

  it("silence lasts two minutes", () => {
    const s = session(asthma, vcv({ tidalVolume: 0.6, rate: 22 }));
    s.advance(10);
    s.alarms.silence(s.sim.time);
    expect(s.alarms.isSilenced(s.sim.time + 119)).toBe(true);
    expect(s.alarms.isSilenced(s.sim.time + 121)).toBe(false);
  });

  it("normal lungs on sensible settings: no alarms", () => {
    const s = session(normal, vcv({ tidalVolume: 0.45, rate: 14 }));
    s.advance(90);
    expect(s.alarms.activeAlarms).toEqual([]);
  });
});
