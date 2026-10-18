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
import type { BreathRecord, Drive, EngineEvent, Mechanics, VentSettings } from "./types";
import { Circulation, type CirculationParams, type Vitals } from "./vitals";
import { AWAKE_AFTER, ScenarioTimeline, type ScenarioEventKind } from "./scenario";

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

/** Longest step taken at once while Scenario Events are on the timeline (s). */
export const SCENARIO_CHUNK = 0.1;

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

  /**
   * The patient before Scenario Events (profile + Instructor Panel changes). Each step the
   * active events are applied on top of these (M13).
   */
  baseMechanics: Mechanics;
  baseGas: GasParams;
  baseCirculation: CirculationParams;
  readonly scenario = new ScenarioTimeline();
  /** Discrete scenario changes already applied (`id:what`). */
  private fired = new Set<string>();

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
    this.baseMechanics = { ...opts.patient.mechanics };
    this.baseGas = { ...(opts.gas ?? NORMAL_GAS) };
    this.baseCirculation = { ...(opts.circulation ?? NORMAL_CIRCULATION) };
    this.gas = new GasExchange({ ...this.baseGas });
    this.circulation = new Circulation({ ...this.baseCirculation });
  }

  /** Instructor Panel changes to the patient's baseline (scenario effects stay on top). */
  setMechanics(patch: Partial<Mechanics>): void {
    this.baseMechanics = { ...this.baseMechanics, ...patch };
    this.applyScenario(this.sim.time);
  }

  setGas(patch: Partial<GasParams>): void {
    this.baseGas = { ...this.baseGas, ...patch };
    this.applyScenario(this.sim.time);
  }

  setCirculation(patch: Partial<CirculationParams>): void {
    this.baseCirculation = { ...this.baseCirculation, ...patch };
    this.applyScenario(this.sim.time);
  }

  /** Add a Scenario Event `delay` s from now; optionally treated `resolveAfter` s after it starts. */
  scheduleEvent(kind: ScenarioEventKind, delay = 0, resolveAfter: number | null = null) {
    const at = this.sim.time + Math.max(0, delay);
    return this.scenario.schedule(kind, at, resolveAfter === null ? null : at + resolveAfter);
  }

  resolveEvent(id: number): void {
    this.scenario.resolve(id, this.sim.time);
  }

  cancelEvent(id: number): void {
    this.scenario.cancel(id);
    this.applyScenario(this.sim.time);
  }

  /**
   * Apply the timeline at time t: continuous effects on the patient, plus the one-off changes
   * (agitation, sedation wearing off) when their moment passes. Returns start/resolve events.
   */
  private applyScenario(t: number): EngineEvent[] {
    const out: EngineEvent[] = [];
    for (const e of this.scenario.events) {
      const once = (what: string, when: number, action: () => void) => {
        const key = `${e.id}:${what}`;
        if (t < when || this.fired.has(key)) return;
        this.fired.add(key);
        action();
      };
      once("start", e.at, () => {
        out.push({ type: "scenario", t: e.at, id: e.id, kind: e.kind, phase: "started" });
        if (e.kind === "agitation") this.setFeatures({ agitation: "severe" });
        if (e.kind === "sedationWearsOff") this.setSedation("light");
      });
      if (e.kind === "sedationWearsOff" && (e.resolvedAt === null || e.resolvedAt > e.at + AWAKE_AFTER)) {
        once("awake", e.at + AWAKE_AFTER, () => this.setSedation("awake"));
      }
      if (e.resolvedAt !== null) {
        once("resolved", e.resolvedAt, () => {
          out.push({ type: "scenario", t: e.resolvedAt!, id: e.id, kind: e.kind, phase: "resolved" });
          if (e.kind === "agitation") this.setFeatures({ agitation: "none" });
          if (e.kind === "sedationWearsOff") this.setSedation("deep");
        });
      }
    }

    const fx = this.scenario.effects(t);
    const m = this.baseMechanics;
    this.sim.setPatient({
      mechanics: {
        ...m,
        compliance: m.compliance * fx.complianceFactor,
        rInsp: m.rInsp * fx.resistanceFactor,
        rExp: m.rExp * fx.resistanceFactor,
      },
    });
    this.sim.cuffLeak = fx.cuffLeak;
    this.sim.fistulaLeak = fx.fistulaLeak;
    this.sim.secretions = fx.secretions;
    this.gas.params = {
      ...this.baseGas,
      shuntMax: Math.min(0.95, this.baseGas.shuntMax + fx.shuntAdd),
    };
    const c = this.baseCirculation;
    this.circulation.params = {
      hr: c.hr + fx.hrAdd,
      sbp: c.sbp * fx.bpFactor,
      dbp: c.dbp * fx.bpFactor,
      ...(c.preloadSensitivity !== undefined && { preloadSensitivity: c.preloadSensitivity }),
    };
    return out;
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
    // With Scenario Events, step in short chunks so their effects follow time smoothly.
    if (this.scenario.events.length === 0 || seconds <= SCENARIO_CHUNK) return this.advanceChunk(seconds);
    const steps: SessionStep[] = [];
    for (let done = 0; done < seconds - 1e-9; done += SCENARIO_CHUNK) {
      steps.push(this.advanceChunk(Math.min(SCENARIO_CHUNK, seconds - done)));
    }
    const samples = new Float32Array(steps.reduce((n, x) => n + x.samples.length, 0));
    let offset = 0;
    for (const x of steps) {
      samples.set(x.samples, offset);
      offset += x.samples.length;
    }
    return {
      samples,
      metrics: steps.flatMap((x) => x.metrics),
      events: steps.flatMap((x) => x.events),
      alarms: steps.flatMap((x) => x.alarms),
      physiology: steps.map((x) => x.physiology).filter((x) => x !== null).at(-1) ?? null,
    };
  }

  private advanceChunk(seconds: number): SessionStep {
    const scenarioEvents = this.applyScenario(this.sim.time);
    this.updateDrive();
    this.sim.heartRate = this.circulation.state?.hr ?? this.circulation.params.hr;
    this.sim.etco2 = this.gas.state?.etco2 ?? 0;
    this.sim.deadSpace = this.baseGas.anatomicDeadSpace;
    const r = this.sim.advance(seconds);
    r.events.unshift(...scenarioEvents);
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
    const record = this.latestRecord;
    const ccw = this.baseMechanics.chestWallCompliance ?? 0.2;
    const vitalsInputs = () => ({
      pmean: this.latest?.pmean ?? this.sim.currentSettings.peep,
      peepI: this.latest?.truth.peepI ?? 0,
      spo2: this.gas.state?.spo2 ?? 97,
      pleuralSwing: record ? record.lungVti / ccw : 0,
      passive: !!record && record.trigger !== "patient" && this.appliedDrive.pmusMax < 0.5,
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
