import { PatientEffort } from "./effort";
import { LinearLung } from "./lung";
import type {
  BreathRecord,
  BreathTrigger,
  EngineEvent,
  Mode,
  Patient,
  VentSettings,
} from "./types";

/** Internal integration step (s): 1 kHz. */
export const DT = 0.001;
/** Emit one Sample every N internal steps: 100 Hz output. */
export const OUTPUT_EVERY = 10;
/** Delay between detecting a patient effort and starting the breath (s). */
export const TRIGGER_DELAY = 0.08;
/** No patient triggering this soon after expiration starts (s). */
export const TRIGGER_LOCKOUT = 0.05;
/** Safety cap on pressure-support inspiration (s). */
export const MAX_PSV_INSP_TIME = 3;

export interface AdvanceResult {
  /** Interleaved Samples; see `SAMPLE` for the layout. */
  samples: Float32Array;
  /** Breaths completed during this advance. */
  breaths: BreathRecord[];
  events: EngineEvent[];
}

/** How the ventilator controls the circuit during one integration step. */
type Control =
  | { kind: "flow"; q: (t: number) => number }
  | { kind: "pressure"; paw: (t: number) => number }
  | { kind: "closed" }
  | { kind: "expiratory"; peep: number; oneWay: boolean };

/** The breath currently being delivered, resolved from settings at breath start. */
type ActiveBreath =
  | { kind: "VCV"; tiFlow: number; pause: number; peakFlow: number; decel: boolean }
  | { kind: "PCV"; pInsp: number; inspTime: number; riseTime: number }
  | { kind: "PSV"; pSupport: number; riseTime: number; esens: number };

type Phase = "inspiration" | "pause" | "expiration";

interface BreathAccumulator {
  startTime: number;
  trigger: BreathTrigger;
  mode: Mode;
  inspEnd: number | null;
  vti: number;
  vte: number;
  peakPaw: number;
  sumPaw: number;
  n: number;
  plateauPaw: number | null;
  peakInspFlow: number;
  cycleFlow: number;
  highPressureCycled: boolean;
}

export interface SimulatorOptions {
  patient: Patient;
  settings: VentSettings;
  /** Time of the patient's first effort (s). */
  firstEffortAt?: number;
}

/**
 * Deterministic, stateful ventilator + patient simulation. It has no timers: the caller advances time.
 */
export class Simulator {
  readonly lung: LinearLung;
  readonly effort: PatientEffort;

  private settings: VentSettings;
  private pending: VentSettings | null = null;
  private backupActive = false;

  private step = 0;
  private stepCarry = 0;
  private volume: number;
  private displayVolume = 0;

  private phase: Phase = "expiration";
  private phaseStart = 0;
  private breath: ActiveBreath | null = null;
  private acc: BreathAccumulator | null = null;
  private lastBreathStart = 0;
  private triggerAt: number | null = null;
  private psvPeakFlow = 0;

  private lastPaw: number;
  private lastFlow = 0;
  private lastPalv: number;

  private outSamples: number[] = [];
  private outBreaths: BreathRecord[] = [];
  private outEvents: EngineEvent[] = [];

  constructor(opts: SimulatorOptions) {
    this.settings = opts.settings;
    this.lung = new LinearLung({ ...opts.patient.mechanics });
    this.effort = new PatientEffort({ ...opts.patient.drive }, opts.firstEffortAt ?? 1);
    this.volume = this.lung.volumeAtPressure(this.settings.peep);
    this.lastPaw = this.settings.peep;
    this.lastPalv = this.settings.peep;
    if (this.settings.mode !== "PSV") this.startBreath(0, "mandatory");
  }

  get time(): number {
    return this.step * DT;
  }

  get currentSettings(): VentSettings {
    return this.settings;
  }

  get isApneaBackupActive(): boolean {
    return this.backupActive;
  }

  /** Queue new settings. They take effect at the start of the next Breath. */
  applySettings(settings: VentSettings): void {
    this.pending = settings;
  }

  /** Change the patient immediately (Instructor Panel). */
  setPatient(patient: Partial<Patient>): void {
    if (patient.mechanics) this.lung.mechanics = { ...patient.mechanics };
    if (patient.drive) this.effort.drive = { ...patient.drive };
  }

  /** Leave Apnea Backup and go back to pressure support. */
  endApneaBackup(): void {
    if (!this.backupActive) return;
    this.backupActive = false;
    this.lastBreathStart = this.time;
    this.outEvents.push({ type: "apneaBackupEnded", t: this.time });
  }

  /** Advance simulated time by `seconds`. */
  advance(seconds: number): AdvanceResult {
    const exact = seconds / DT + this.stepCarry;
    const n = Math.floor(exact + 1e-9);
    this.stepCarry = exact - n;
    for (let i = 0; i < n; i++) this.tick();

    const result: AdvanceResult = {
      samples: Float32Array.from(this.outSamples),
      breaths: this.outBreaths,
      events: this.outEvents,
    };
    this.outSamples = [];
    this.outBreaths = [];
    this.outEvents = [];
    return result;
  }

  // ---------------------------------------------------------------------------

  private tick(): void {
    const t0 = this.step * DT;
    const control = this.control();

    // RK4 on elastic volume.
    const f = (t: number, v: number) => this.flowFor(control, t, v);
    const v0 = this.volume;
    const k1 = f(t0, v0);
    const k2 = f(t0 + DT / 2, v0 + (DT / 2) * k1);
    const k3 = f(t0 + DT / 2, v0 + (DT / 2) * k2);
    const k4 = f(t0 + DT, v0 + DT * k3);
    const dv = (DT / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    this.volume = v0 + dv;
    this.displayVolume += dv;
    this.step++;

    const t = this.step * DT;
    const pmus = this.effort.pmus(t);
    const flow = this.flowFor(control, t, this.volume);
    const paw = this.pawFor(control, t, this.volume, pmus, flow);
    const palv = this.lung.alveolarPressure(this.volume, pmus);
    this.lastPaw = paw;
    this.lastFlow = flow;
    this.lastPalv = palv;

    if (this.acc) {
      if (dv > 0) this.acc.vti += dv;
      else this.acc.vte -= dv;
      this.acc.peakPaw = Math.max(this.acc.peakPaw, paw);
      this.acc.sumPaw += paw;
      this.acc.n++;
      if (this.phase === "inspiration") {
        this.acc.peakInspFlow = Math.max(this.acc.peakInspFlow, flow);
      }
    }

    if (this.step % OUTPUT_EVERY === 0) {
      this.outSamples.push(t, paw, flow, this.displayVolume, palv, pmus);
    }

    this.transition(t, flow, paw);
  }

  private flowFor(control: Control, t: number, v: number): number {
    const pmus = this.effort.pmus(t);
    switch (control.kind) {
      case "flow":
        return control.q(t);
      case "pressure":
        return this.lung.flow(control.paw(t), v, pmus);
      case "closed":
        return 0;
      case "expiratory": {
        const q = this.lung.flow(control.peep, v, pmus);
        return control.oneWay && q > 0 ? 0 : q;
      }
    }
  }

  private pawFor(control: Control, t: number, v: number, pmus: number, flow: number): number {
    switch (control.kind) {
      case "flow":
        return this.lung.pressureForFlow(flow, v, pmus);
      case "pressure":
        return control.paw(t);
      case "closed":
        return this.lung.alveolarPressure(v, pmus);
      case "expiratory":
        // A one-way expiratory valve with no inflow source: airway pressure follows the alveoli.
        return flow === 0 && control.oneWay ? this.lung.alveolarPressure(v, pmus) : control.peep;
    }
  }

  private control(): Control {
    const peep = this.settings.peep;
    const b = this.breath;
    if (this.phase === "expiration" || !b) {
      // Flow triggering assumes bias flow, so the patient can draw gas at PEEP.
      return { kind: "expiratory", peep, oneWay: this.settings.trigger.type === "pressure" };
    }
    if (this.phase === "pause") return { kind: "closed" };

    const start = this.phaseStart;
    switch (b.kind) {
      case "VCV": {
        const { peakFlow, decel, tiFlow } = b;
        return {
          kind: "flow",
          q: decel ? (t) => peakFlow * Math.max(0, 1 - (t - start) / tiFlow) : () => peakFlow,
        };
      }
      case "PCV":
      case "PSV": {
        const dp = b.kind === "PCV" ? b.pInsp : b.pSupport;
        const rise = b.riseTime;
        return {
          kind: "pressure",
          paw: (t) => peep + dp * (rise > 0 ? Math.min(1, (t - start) / rise) : 1),
        };
      }
    }
  }

  private transition(t: number, flow: number, paw: number): void {
    const tIn = t - this.phaseStart;
    const b = this.breath;

    if (this.phase === "inspiration" && b) {
      if (paw > this.settings.highPressureLimit) {
        if (this.acc) this.acc.highPressureCycled = true;
        this.outEvents.push({ type: "highPressureCycle", t, paw });
        this.beginExpiration(t, flow);
        return;
      }
      switch (b.kind) {
        case "VCV":
          if (tIn >= b.tiFlow - DT / 2) {
            if (b.pause > 0) {
              this.phase = "pause";
              if (this.acc) this.acc.cycleFlow = flow;
            } else this.beginExpiration(t, flow);
          }
          break;
        case "PCV":
          if (tIn >= b.inspTime - DT / 2) this.beginExpiration(t, flow);
          break;
        case "PSV":
          this.psvPeakFlow = Math.max(this.psvPeakFlow, flow);
          if (
            (tIn >= b.riseTime && flow <= b.esens * this.psvPeakFlow) ||
            tIn >= MAX_PSV_INSP_TIME
          ) {
            this.beginExpiration(t, flow);
          }
          break;
      }
      return;
    }

    if (this.phase === "pause" && b?.kind === "VCV") {
      if (tIn >= b.tiFlow + b.pause - DT / 2) {
        if (this.acc) this.acc.plateauPaw = paw;
        this.beginExpiration(t, this.acc?.cycleFlow ?? 0);
      }
      return;
    }

    // Expiration: delayed patient trigger, then mandatory timing, then apnea, then trigger detection.
    if (this.triggerAt !== null && t >= this.triggerAt - DT / 2) {
      this.triggerAt = null;
      this.startBreath(t, "patient");
      return;
    }

    const timing = this.pending ?? this.settings;
    const rate = this.mandatoryRate(timing);
    if (rate > 0 && t - this.lastBreathStart >= 60 / rate - DT / 2) {
      this.startBreath(t, this.backupActive ? "backup" : "mandatory");
      return;
    }

    if (
      timing.mode === "PSV" &&
      !this.backupActive &&
      t - this.lastBreathStart >= timing.apneaTime
    ) {
      this.backupActive = true;
      this.outEvents.push({ type: "apneaBackupStarted", t });
      this.startBreath(t, "backup");
      return;
    }

    if (this.triggerAt === null && tIn >= TRIGGER_LOCKOUT) {
      const trig = this.settings.trigger;
      const fired =
        trig.type === "flow" ? flow >= trig.threshold : paw <= this.settings.peep - trig.threshold;
      if (fired) this.triggerAt = t + TRIGGER_DELAY;
    }
  }

  private mandatoryRate(s: VentSettings): number {
    if (s.mode === "PSV") return this.backupActive ? s.backup.rate : 0;
    return s.rate;
  }

  private beginExpiration(t: number, flowAtCycle: number): void {
    if (this.acc) {
      this.acc.inspEnd = t;
      if (this.phase === "inspiration") this.acc.cycleFlow = flowAtCycle;
    }
    this.phase = "expiration";
    this.phaseStart = t;
  }

  private startBreath(t: number, trigger: BreathTrigger): void {
    this.finishBreath(t);

    if (this.pending) {
      this.settings = this.pending;
      this.pending = null;
      this.outEvents.push({ type: "settingsApplied", t });
    }
    this.breath = this.resolveBreath(this.settings);
    this.phase = "inspiration";
    this.phaseStart = t;
    this.lastBreathStart = t;
    this.triggerAt = null;
    this.psvPeakFlow = 0;
    this.displayVolume = 0;
    this.acc = {
      startTime: t,
      trigger,
      mode: this.breath.kind,
      inspEnd: null,
      vti: 0,
      vte: 0,
      peakPaw: this.lastPaw,
      sumPaw: 0,
      n: 0,
      plateauPaw: null,
      peakInspFlow: 0,
      cycleFlow: 0,
      highPressureCycled: false,
    };
    this.outEvents.push({ type: "breathStart", t, trigger });
  }

  private resolveBreath(s: VentSettings): ActiveBreath {
    switch (s.mode) {
      case "VCV": {
        const decel = s.flowPattern === "decelerating";
        // A linear ramp to zero delivers half the volume of a square wave at the same peak flow.
        const tiFlow = (decel ? 2 : 1) * (s.tidalVolume / s.peakFlow);
        return { kind: "VCV", tiFlow, pause: s.pauseTime, peakFlow: s.peakFlow, decel };
      }
      case "PCV":
        return { kind: "PCV", pInsp: s.pInsp, inspTime: s.inspTime, riseTime: s.riseTime };
      case "PSV":
        if (this.backupActive) {
          return {
            kind: "PCV",
            pInsp: s.backup.pInsp,
            inspTime: s.backup.inspTime,
            riseTime: s.riseTime,
          };
        }
        return { kind: "PSV", pSupport: s.pSupport, riseTime: s.riseTime, esens: s.esens };
    }
  }

  private finishBreath(t: number): void {
    const a = this.acc;
    if (!a) return;
    this.outBreaths.push({
      startTime: a.startTime,
      endTime: t,
      trigger: a.trigger,
      mode: a.mode,
      inspTime: (a.inspEnd ?? t) - a.startTime,
      vti: a.vti,
      vte: a.vte,
      peakPaw: a.peakPaw,
      meanPaw: a.n > 0 ? a.sumPaw / a.n : this.lastPaw,
      endExpPaw: this.lastPaw,
      endExpPalv: this.lastPalv,
      plateauPaw: a.plateauPaw,
      peakInspFlow: a.peakInspFlow,
      cycleFlow: a.cycleFlow,
      highPressureCycled: a.highPressureCycled,
    });
    this.acc = null;
  }

  /** Last computed flow (L/s), for diagnostics. */
  get flow(): number {
    return this.lastFlow;
  }
}
