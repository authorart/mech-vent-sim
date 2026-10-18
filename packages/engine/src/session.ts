import {
  AGITATION_EFFECT,
  CARDIAC_OSCILLATION,
  chemoreflexMultiplier,
  DEFAULT_FEATURES,
  effectiveDrive,
  type PatientFeatures,
  type SedationLevel,
} from "./drive";
import { NATURAL_VARIABILITY, type EffortVariability } from "./effort";
import { AlarmEngine, type AlarmEvent, type AlarmLimits } from "./alarms";
import { AsynchronyTracker } from "./asynchrony";
import { GasExchange, type BloodGas, type GasInputs, type GasParams } from "./gas";
import { Monitor, type BreathMetrics } from "./monitor";
import { Simulator, type SimulatorOptions } from "./simulator";
import { PROFILES, type ProfileId } from "./profiles";
import { INITIAL_SETTINGS } from "./settings";
import type { BreathRecord, Drive, EngineEvent, VentSettings } from "./types";
import { Circulation, type CirculationParams, type Vitals } from "./vitals";

export interface SessionStep {
  samples: Float32Array;
  metrics: BreathMetrics[];
  events: EngineEvent[];
  alarms: AlarmEvent[];
  /** Blood gas and vital signs, reported once per simulated second (after priming). */
  physiology: { t: number; gas: BloodGas; vitals: Vitals } | null;
}

export interface SessionOptions extends SimulatorOptions {
  alarmLimits?: AlarmLimits;
  gas?: GasParams;
  circulation?: CirculationParams;
  /** Starting sedation (default: deep). The patient's drive is scaled from `patient.drive`. */
  sedation?: SedationLevel;
  /** Chemoreflex reference pH (default 7.40). */
  referencePh?: number;
  /** How the patient breathes (default: natural, no agitation, no reverse triggering). */
  features?: PatientFeatures;
  /** Seed for the breathing variability (default 1), so a case replays the same breaths. */
  seed?: number;
  /** Seed for display noise (default seed + 1000); null turns noise off. */
  noiseSeed?: number | null;
}

/** Healthy adult gas exchange, used when a Session is created without profile values. */
export const NORMAL_GAS: GasParams = {
  vco2: 200,
  anatomicDeadSpace: 0.125,
  alveolarDeadSpaceFraction: 0.067,
  shuntMax: 0.05,
  recruitableFraction: 0,
  peepHalf: 10,
  vqMismatch: 0.02,
  hco3: 24,
  hb: 12,
};

export const NORMAL_CIRCULATION: CirculationParams = { hr: 80, sbp: 120, dbp: 75 };

/** Gas and vitals start reporting once this much time has passed, already at steady state. */
export const PHYSIOLOGY_PRIME_TIME = 10;

/** Simulator + Monitor + AlarmEngine + gas exchange + circulation, stepped together. */
export class Session {
  readonly sim: Simulator;
  readonly monitor = new Monitor();
  readonly asynchrony = new AsynchronyTracker();
  readonly alarms: AlarmEngine;
  readonly gas: GasExchange;
  readonly circulation: Circulation;
  /** Physiological time runs this many times faster than the waveforms (fast-forward). */
  gasTimeScale = 1;

  /** The profile's drive at its reference pH, before sedation and chemoreflex. */
  baseDrive: Drive;
  sedation: SedationLevel;
  referencePh: number;
  features: PatientFeatures;
  readonly seed: number;

  private latest: BreathMetrics | null = null;
  private latestRecord: BreathRecord | null = null;
  private lastReport = 0;

  constructor(opts: SessionOptions) {
    this.baseDrive = { ...opts.patient.drive };
    this.sedation = opts.sedation ?? "deep";
    this.referencePh = opts.referencePh ?? 7.4;
    this.features = { ...(opts.features ?? DEFAULT_FEATURES) };
    this.seed = opts.seed ?? 1;
    this.sim = new Simulator({
      ...opts,
      patient: {
        ...opts.patient,
        drive: effectiveDrive(this.baseDrive, this.sedation, 1, this.features.agitation),
      },
      variability: this.variability(),
      noiseSeed: opts.noiseSeed === undefined ? this.seed + 1000 : opts.noiseSeed,
    });
    this.applyFeatures();
    this.alarms = new AlarmEngine(opts.alarmLimits);
    this.gas = new GasExchange({ ...(opts.gas ?? NORMAL_GAS) });
    this.circulation = new Circulation({ ...(opts.circulation ?? NORMAL_CIRCULATION) });
  }

  get latestMetrics(): BreathMetrics | null {
    return this.latest;
  }

  /** The drive currently applied, after sedation and chemoreflex. */
  get appliedDrive(): Drive {
    return this.sim.effort.drive;
  }

  /** Change how the patient breathes (Instructor Panel). */
  setFeatures(patch: Partial<PatientFeatures>): void {
    this.features = { ...this.features, ...patch };
    this.sim.effort.setVariability(this.variability());
    this.applyFeatures();
    this.updateDrive();
  }

  private applyFeatures(): void {
    this.sim.reverseTriggering = this.features.reverseTriggering;
    this.sim.cardiacAmplitude = CARDIAC_OSCILLATION[this.features.cardiacOscillation];
  }

  private variability(): EffortVariability | null {
    if (this.features.breathing === "regular") return null;
    const k = AGITATION_EFFECT[this.features.agitation].variability;
    const v = NATURAL_VARIABILITY;
    return {
      seed: this.seed,
      cvRate: v.cvRate * k,
      cvAmplitude: v.cvAmplitude * k,
      cvTi: v.cvTi * k,
      sighEvery: v.sighEvery,
    };
  }

  setSedation(level: SedationLevel): void {
    this.sedation = level;
    this.updateDrive();
  }

  advance(seconds: number): SessionStep {
    this.updateDrive();
    this.sim.heartRate = this.circulation.state?.hr ?? this.circulation.params.hr;
    const r = this.sim.advance(seconds);
    const alarms: AlarmEvent[] = [];
    const metrics: BreathMetrics[] = [];

    // Breaths and events are processed in time order so alarms rise and clear in order.
    type Item = { t: number; breath?: BreathRecord; event?: EngineEvent };
    const items: Item[] = [
      ...r.breaths.map((b) => ({ t: b.endTime, breath: b })),
      ...r.events.map((e) => ({ t: e.t, event: e })),
    ].sort((a, b) => a.t - b.t);

    for (const it of items) {
      if (it.breath) {
        this.asynchrony.onBreath(it.breath);
        const m = this.monitor.update(it.breath);
        m.asynchrony = this.asynchrony.summary(it.breath.endTime);
        metrics.push(m);
        this.latest = m;
        this.latestRecord = it.breath;
        this.gas.onBreath(it.breath);
        alarms.push(
          ...this.alarms.onBreath(
            m,
            it.breath,
            this.sim.currentSettings,
            this.sim.isApneaBackupActive,
          ),
        );
      } else if (it.event) {
        if (it.event.type === "asynchrony") this.asynchrony.onEvent(it.event.t, it.event.kind);
        alarms.push(...this.alarms.onEvent(it.event));
      }
    }

    return {
      samples: r.samples,
      metrics,
      events: r.events,
      alarms,
      physiology: this.stepPhysiology(seconds),
    };
  }

  private stepPhysiology(seconds: number): SessionStep["physiology"] {
    const t = this.sim.time;
    const inputs = this.gasInputs();
    const vitalsInputs = () => ({
      pmean: this.latest?.pmean ?? this.sim.currentSettings.peep,
      peepI: this.latest?.truth.peepI ?? 0,
      spo2: this.gas.state?.spo2 ?? 97,
    });

    if (!this.gas.primed) {
      if (t < PHYSIOLOGY_PRIME_TIME) return null;
      this.gas.prime(t, inputs);
      this.circulation.prime(vitalsInputs());
    } else {
      const dt = seconds * this.gasTimeScale;
      this.gas.step(t, dt, inputs);
      this.circulation.step(dt, vitalsInputs());
    }

    if (t - this.lastReport < 1 - 1e-9) return null;
    this.lastReport = Math.floor(t);
    const gas = this.gas.state;
    const vitals = this.circulation.state;
    return gas && vitals ? { t, gas, vitals } : null;
  }

  private updateDrive(): void {
    const m = chemoreflexMultiplier(this.gas.state?.ph ?? null, this.referencePh);
    this.sim.setPatient({
      drive: effectiveDrive(this.baseDrive, this.sedation, m, this.features.agitation),
    });
  }

  private gasInputs(): GasInputs {
    return {
      fio2: this.sim.currentSettings.fio2,
      endExpAlveolarPressure: this.latestRecord?.endExpRecoil ?? this.sim.currentSettings.peep,
      ...(this.sim.lung.hasRecruitment && {
        endExpRecruited: this.latestRecord?.endExpRecruited ?? this.sim.recruited,
      }),
    };
  }
}

export interface ProfileSessionOptions {
  settings?: VentSettings;
  sedation?: SedationLevel;
  features?: PatientFeatures;
  /** Display-noise seed; null turns noise off (default: on). */
  noiseSeed?: number | null;
  alarmLimits?: AlarmLimits;
  firstEffortAt?: number;
}

/** A Session for a Patient Profile, starting on the Initial Settings at the profile's start sedation. */
export function createProfileSession(id: ProfileId, opts: ProfileSessionOptions = {}): Session {
  const p = PROFILES[id];
  return new Session({
    patient: p.patient,
    settings: opts.settings ?? INITIAL_SETTINGS,
    gas: p.gas,
    circulation: p.circulation,
    referencePh: p.referencePh,
    sedation: opts.sedation ?? p.startSedation,
    ...(opts.features ? { features: opts.features } : {}),
    ...(opts.noiseSeed !== undefined ? { noiseSeed: opts.noiseSeed } : {}),
    ...(opts.alarmLimits ? { alarmLimits: opts.alarmLimits } : {}),
    ...(opts.firstEffortAt !== undefined ? { firstEffortAt: opts.firstEffortAt } : {}),
  });
}
