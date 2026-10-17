import type { BreathMetrics } from "./monitor";
import type { BreathRecord, EngineEvent, VentSettings } from "./types";

export type AlarmId =
  | "HIGH_PRESSURE"
  | "APNEA"
  | "LOW_MINUTE_VENT"
  | "DISCONNECT"
  | "AUTO_PEEP"
  | "HIGH_DRIVING_PRESSURE"
  | "LOW_VTE"
  | "HIGH_VTE"
  | "HIGH_MINUTE_VENT"
  | "HIGH_RATE";

export type AlarmPriority = "high" | "medium";

export const ALARM_PRIORITY: Record<AlarmId, AlarmPriority> = {
  HIGH_PRESSURE: "high",
  APNEA: "high",
  LOW_MINUTE_VENT: "high",
  DISCONNECT: "high",
  AUTO_PEEP: "medium",
  HIGH_DRIVING_PRESSURE: "medium",
  LOW_VTE: "medium",
  HIGH_VTE: "medium",
  HIGH_MINUTE_VENT: "medium",
  HIGH_RATE: "medium",
};

/**
 * Settable alarm limits. The high pressure limit is a ventilator setting
 * (`highPressureLimit`) because it also ends inspiration.
 */
export interface AlarmLimits {
  /** L */
  lowVte: number;
  /** L */
  highVte: number;
  /** L/min */
  lowMinuteVent: number;
  /** L/min */
  highMinuteVent: number;
  /** breaths/min */
  highRate: number;
  /** cmH2O */
  autoPeep: number;
  /** cmH2O */
  drivingPressure: number;
}

/** Defaults: the spec's thresholds (Auto-PEEP > 5, Driving Pressure > 15) plus common bedside values. */
export const DEFAULT_ALARM_LIMITS: AlarmLimits = {
  lowVte: 0.25,
  highVte: 1.0,
  lowMinuteVent: 4,
  highMinuteVent: 20,
  highRate: 35,
  autoPeep: 5,
  drivingPressure: 15,
};

/** Silence lasts 2 minutes. */
export const SILENCE_TIME = 120;
/** Volume and rate alarms wait for this many breaths so the rolling window can fill. */
const WARMUP_BREATHS = 3;

export interface AlarmState {
  id: AlarmId;
  priority: AlarmPriority;
  /** When the alarm became active (s). */
  since: number;
}

export type AlarmEvent =
  | { type: "alarmRaised"; t: number; id: AlarmId; priority: AlarmPriority }
  | { type: "alarmCleared"; t: number; id: AlarmId };

export class AlarmEngine {
  private active = new Map<AlarmId, AlarmState>();
  private silencedUntil = -Infinity;
  private breathCount = 0;

  constructor(public limits: AlarmLimits = { ...DEFAULT_ALARM_LIMITS }) {}

  /** Re-evaluate breath-based alarms after a completed breath. */
  onBreath(
    metrics: BreathMetrics,
    record: BreathRecord,
    settings: VentSettings,
    apneaBackupActive: boolean,
  ): AlarmEvent[] {
    this.breathCount++;
    const l = this.limits;
    const warm = this.breathCount >= WARMUP_BREATHS;
    const conditions: Partial<Record<AlarmId, boolean>> = {
      HIGH_PRESSURE: record.highPressureCycled || metrics.ppeak >= settings.highPressureLimit,
      APNEA: apneaBackupActive,
      AUTO_PEEP: metrics.truth.peepI > l.autoPeep,
      HIGH_DRIVING_PRESSURE: metrics.truth.drivingPressure > l.drivingPressure,
      LOW_VTE: metrics.vte < l.lowVte,
      HIGH_VTE: metrics.vte > l.highVte,
      DISCONNECT: metrics.vti > 0.05 && metrics.vte < 0.2 * metrics.vti,
      LOW_MINUTE_VENT: warm && metrics.ve < l.lowMinuteVent,
      HIGH_MINUTE_VENT: warm && metrics.ve > l.highMinuteVent,
      HIGH_RATE: warm && metrics.rrTotal > l.highRate,
    };
    return this.apply(metrics.t, conditions);
  }

  /** React to Engine events that raise or clear alarms between breaths. */
  onEvent(e: EngineEvent): AlarmEvent[] {
    if (e.type === "apneaBackupStarted") return this.apply(e.t, { APNEA: true });
    if (e.type === "apneaBackupEnded") return this.apply(e.t, { APNEA: false });
    if (e.type === "highPressureCycle") return this.apply(e.t, { HIGH_PRESSURE: true });
    return [];
  }

  /** Silence audible alarms for two minutes. Alarms stay visible. */
  silence(t: number): void {
    this.silencedUntil = t + SILENCE_TIME;
  }

  isSilenced(t: number): boolean {
    return t < this.silencedUntil;
  }

  get activeAlarms(): AlarmState[] {
    return [...this.active.values()].sort((a, b) =>
      a.priority === b.priority ? a.since - b.since : a.priority === "high" ? -1 : 1,
    );
  }

  private apply(t: number, conditions: Partial<Record<AlarmId, boolean>>): AlarmEvent[] {
    const events: AlarmEvent[] = [];
    for (const [id, on] of Object.entries(conditions) as [AlarmId, boolean][]) {
      const was = this.active.has(id);
      if (on && !was) {
        const priority = ALARM_PRIORITY[id];
        this.active.set(id, { id, priority, since: t });
        events.push({ type: "alarmRaised", t, id, priority });
      } else if (!on && was) {
        this.active.delete(id);
        events.push({ type: "alarmCleared", t, id });
      }
    }
    return events;
  }
}
