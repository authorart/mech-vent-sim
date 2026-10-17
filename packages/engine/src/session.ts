import { AlarmEngine, type AlarmEvent, type AlarmLimits } from "./alarms";
import { Monitor, type BreathMetrics } from "./monitor";
import { Simulator, type SimulatorOptions } from "./simulator";
import type { EngineEvent } from "./types";

export interface SessionStep {
  samples: Float32Array;
  metrics: BreathMetrics[];
  events: EngineEvent[];
  alarms: AlarmEvent[];
}

export interface SessionOptions extends SimulatorOptions {
  alarmLimits?: AlarmLimits;
}

/** Simulator + Monitor + AlarmEngine, stepped together. */
export class Session {
  readonly sim: Simulator;
  readonly monitor = new Monitor();
  readonly alarms: AlarmEngine;
  private latest: BreathMetrics | null = null;

  constructor(opts: SessionOptions) {
    this.sim = new Simulator(opts);
    this.alarms = new AlarmEngine(opts.alarmLimits);
  }

  get latestMetrics(): BreathMetrics | null {
    return this.latest;
  }

  advance(seconds: number): SessionStep {
    const r = this.sim.advance(seconds);
    const alarms: AlarmEvent[] = [];
    const metrics: BreathMetrics[] = [];

    // Breaths and events are processed in time order so alarms rise and clear in order.
    type Item = { t: number; breath?: (typeof r.breaths)[number]; event?: EngineEvent };
    const items: Item[] = [
      ...r.breaths.map((b) => ({ t: b.endTime, breath: b })),
      ...r.events.map((e) => ({ t: e.t, event: e })),
    ].sort((a, b) => a.t - b.t);

    for (const it of items) {
      if (it.breath) {
        const m = this.monitor.update(it.breath);
        metrics.push(m);
        this.latest = m;
        alarms.push(
          ...this.alarms.onBreath(
            m,
            it.breath,
            this.sim.currentSettings,
            this.sim.isApneaBackupActive,
          ),
        );
      } else if (it.event) {
        alarms.push(...this.alarms.onEvent(it.event));
      }
    }
    return { samples: r.samples, metrics, events: r.events, alarms };
  }
}
