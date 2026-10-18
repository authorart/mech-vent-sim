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
/** Patient-triggered breaths during Apnea Backup that hand control back to PSV. */
export const BACKUP_EXIT_BREATHS = 2;
/** Duration of an Inspiratory Pause or Expiratory Hold maneuver (s). */
export const HOLD_TIME = 0.5;
/** Muscle Pressure above this during a pause or hold makes the measurement unreliable (cmH2O). */
export const MANEUVER_EFFORT_LIMIT = 0.5;
/**
 * Resistance of the expiratory limb and exhalation valve (cmH2O/(L/s)). Airway pressure sits a
 * little above PEEP while gas leaves, so the pressure trace and P–V loop round off instead of
 * dropping straight to PEEP; a patient drawing on the bias flow pulls it slightly below.
 */
export const CIRCUIT_RESISTANCE = 2;
/**
 * Bias flow through the circuit between breaths when flow triggering (L/s): 5 L/min, and always
 * 2 L/min above the trigger threshold. A patient pulling harder than this drops airway pressure.
 */
export function biasFlow(triggerThreshold: number): number {
  return Math.max(5 / 60, triggerThreshold + 2 / 60);
}
/** Exhalation valve opening: extra resistance R0·e^(−t/τ) at the start of expiration (rounds the corner). */
export const VALVE_OPENING_RESISTANCE = 40;
export const VALVE_OPENING_TIME = 0.04;
/** Time the VCV flow valve takes to reach the set flow (s). Ti is lengthened so Vt stays exact. */
export const FLOW_RAMP_TIME = 0.05;

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
  | { kind: "expiratory"; peep: number; oneWay: boolean; /** L/s, flow triggering only */ bias: number };

/** The breath currently being delivered, resolved from settings at breath start. */
type ActiveBreath =
  | { kind: "VCV"; tiFlow: number; pause: number; peakFlow: number; decel: boolean }
  | { kind: "PCV"; pInsp: number; inspTime: number; riseTime: number }
  | { kind: "PSV"; pSupport: number; riseTime: number; esens: number };

/** `pause` = valves closed after inspiration; `expiratoryHold` = valves closed before the next breath. */
type Phase = "inspiration" | "pause" | "expiration" | "expiratoryHold";

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
  plateauReliable: boolean;
  totalPeep: number | null;
  totalPeepReliable: boolean;
  endInspRecoil: number;
  endInspPaw: number;
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
  /** Patient-triggered breaths since Apnea Backup started. */
  private backupPatientRun = 0;

  private step = 0;
  private stepCarry = 0;
  private volume: number;
  private displayVolume = 0;

  private phase: Phase = "expiration";
  private phaseStart = 0;
  private phaseEnd = 0;
  private breath: ActiveBreath | null = null;
  private acc: BreathAccumulator | null = null;
  private lastBreathStart = 0;
  private triggerAt: number | null = null;
  private heldTrigger: BreathTrigger = "mandatory";
  private psvPeakFlow = 0;

  /** Largest Muscle Pressure seen during the current pause or hold. */
  private maneuverEffort = 0;
  private inspPauseRequested = false;
  private expHoldRequested = false;

  private lastPaw: number;
  private lastFlow = 0;

  private outSamples: number[] = [];
  private outBreaths: BreathRecord[] = [];
  private outEvents: EngineEvent[] = [];

  constructor(opts: SimulatorOptions) {
    this.settings = opts.settings;
    this.lung = new LinearLung({ ...opts.patient.mechanics });
    this.effort = new PatientEffort({ ...opts.patient.drive }, opts.firstEffortAt ?? 1);
    this.volume = this.lung.volumeAtPressure(this.settings.peep);
    this.lastPaw = this.settings.peep;
    if (this.settings.mode !== "PSV") this.startBreath(0, "mandatory");
  }

  get time(): number {
    return this.step * DT;
  }

  get currentSettings(): VentSettings {
    return this.settings;
  }

  get pendingSettings(): VentSettings | null {
    return this.pending;
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

  /** Hold the end of the next inspiration (no flow) to measure P_plat. */
  inspiratoryPause(): void {
    this.inspPauseRequested = true;
  }

  /** Hold the end of the next expiration (no flow) to measure Total PEEP. */
  expiratoryHold(): void {
    this.expHoldRequested = true;
  }

  /** Leave Apnea Backup and go back to pressure support. */
  endApneaBackup(): void {
    if (!this.backupActive) return;
    this.backupActive = false;
    this.backupPatientRun = 0;
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
    if (this.phase === "pause" || this.phase === "expiratoryHold") {
      this.maneuverEffort = Math.max(this.maneuverEffort, pmus);
    }

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

  /** Elastic recoil pressure (cmH2O): alveolar pressure with no effort. */
  private get recoil(): number {
    return this.lung.alveolarPressure(this.volume, 0);
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
        const q = this.expiratoryFlow(control.peep, v, pmus, t);
        if (q <= 0) return q;
        return control.oneWay ? 0 : Math.min(q, control.bias);
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
        if (flow === 0 && control.oneWay) return this.lung.alveolarPressure(v, pmus);
        // Demand beyond the bias flow: the circuit can't keep up and airway pressure falls.
        if (flow > 0 && flow >= control.bias - 1e-12) return this.lung.pressureForFlow(flow, v, pmus);
        return control.peep - this.circuitResistance(t) * flow;
    }
  }

  /** Expiratory circuit plus the exhalation valve, which is still opening early in expiration. */
  private circuitResistance(t: number): number {
    const opening = this.phase === "expiration" && this.breath ? t - this.phaseStart : Infinity;
    return CIRCUIT_RESISTANCE + VALVE_OPENING_RESISTANCE * Math.exp(-opening / VALVE_OPENING_TIME);
  }

  /** Flow through the patient and the expiratory circuit in series, with the valve held at PEEP. */
  private expiratoryFlow(peep: number, v: number, pmus: number, t: number): number {
    const drive = peep - this.lung.alveolarPressure(v, pmus);
    const r = drive >= 0 ? this.lung.mechanics.rInsp : this.lung.expiratoryResistance(v);
    return drive / (r + this.circuitResistance(t));
  }

  private control(): Control {
    const peep = this.settings.peep;
    const b = this.breath;
    if (this.phase === "pause" || this.phase === "expiratoryHold") return { kind: "closed" };
    if (this.phase === "expiration" || !b) {
      // Flow triggering assumes bias flow, so the patient can draw gas at PEEP.
      const trig = this.settings.trigger;
      return trig.type === "flow"
        ? { kind: "expiratory", peep, oneWay: false, bias: biasFlow(trig.threshold) }
        : { kind: "expiratory", peep, oneWay: true, bias: 0 };
    }

    const start = this.phaseStart;
    switch (b.kind) {
      case "VCV": {
        const { peakFlow, decel, tiFlow } = b;
        const ramp = (t: number) => Math.min(1, (t - start) / FLOW_RAMP_TIME);
        return {
          kind: "flow",
          q: decel
            ? (t) => peakFlow * ramp(t) * Math.max(0, 1 - (t - start) / tiFlow)
            : (t) => peakFlow * ramp(t),
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
    switch (this.phase) {
      case "inspiration":
        return this.inspirationTransition(t, flow, paw);
      case "pause":
        if (t >= this.phaseEnd - DT / 2) {
          const reliable = this.maneuverEffort < MANEUVER_EFFORT_LIMIT;
          if (this.acc) {
            this.acc.plateauPaw = paw;
            this.acc.plateauReliable = reliable;
          }
          this.outEvents.push({ type: "plateauMeasured", t, plateau: paw, reliable });
          this.beginExpiration(t);
        }
        return;
      case "expiratoryHold":
        if (t >= this.phaseEnd - DT / 2) {
          const peep = this.settings.peep;
          const reliable = this.maneuverEffort < MANEUVER_EFFORT_LIMIT;
          if (this.acc) {
            this.acc.totalPeep = paw;
            this.acc.totalPeepReliable = reliable;
          }
          this.outEvents.push({
            type: "totalPeepMeasured",
            t,
            totalPeep: paw,
            peepI: paw - peep,
            reliable,
          });
          this.startBreath(t, this.heldTrigger);
        }
        return;
      case "expiration":
        return this.expirationTransition(t, flow, paw);
    }
  }

  private inspirationTransition(t: number, flow: number, paw: number): void {
    const b = this.breath;
    if (!b) return;
    const tIn = t - this.phaseStart;

    if (paw > this.settings.highPressureLimit) {
      if (this.acc) this.acc.highPressureCycled = true;
      this.outEvents.push({ type: "highPressureCycle", t, paw });
      this.inspPauseRequested = false;
      this.endInspiration(t, flow, 0);
      return;
    }
    switch (b.kind) {
      case "VCV":
        if (tIn >= b.tiFlow - DT / 2) this.endInspiration(t, flow, b.pause);
        break;
      case "PCV":
        if (tIn >= b.inspTime - DT / 2) this.endInspiration(t, flow, 0);
        break;
      case "PSV":
        this.psvPeakFlow = Math.max(this.psvPeakFlow, flow);
        if ((tIn >= b.riseTime && flow <= b.esens * this.psvPeakFlow) || tIn >= MAX_PSV_INSP_TIME) {
          this.endInspiration(t, flow, 0);
        }
        break;
    }
  }

  private expirationTransition(t: number, flow: number, paw: number): void {
    // Order: delayed patient trigger, mandatory timing, apnea, then trigger detection.
    if (this.triggerAt !== null && t >= this.triggerAt - DT / 2) {
      this.triggerAt = null;
      this.breathDue(t, "patient");
      return;
    }

    const timing = this.pending ?? this.settings;
    const rate = this.mandatoryRate(timing);
    if (rate > 0 && t - this.lastBreathStart >= 60 / rate - DT / 2) {
      this.breathDue(t, this.backupActive ? "backup" : "mandatory");
      return;
    }

    if (
      timing.mode === "PSV" &&
      !this.backupActive &&
      t - this.lastBreathStart >= timing.apneaTime
    ) {
      this.backupActive = true;
      this.outEvents.push({ type: "apneaBackupStarted", t });
      this.breathDue(t, "backup");
      return;
    }

    if (this.triggerAt === null && t - this.phaseStart >= TRIGGER_LOCKOUT) {
      const trig = this.settings.trigger;
      const fired =
        trig.type === "flow" ? flow >= trig.threshold : paw <= this.settings.peep - trig.threshold;
      if (fired) this.triggerAt = t + TRIGGER_DELAY;
    }
  }

  /** A breath should start now, unless an Expiratory Hold was requested first. */
  private breathDue(t: number, trigger: BreathTrigger): void {
    if (this.expHoldRequested) {
      this.expHoldRequested = false;
      this.heldTrigger = trigger;
      this.phase = "expiratoryHold";
      this.maneuverEffort = 0;
      this.phaseStart = t;
      this.phaseEnd = t + HOLD_TIME;
      return;
    }
    this.startBreath(t, trigger);
  }

  private mandatoryRate(s: VentSettings): number {
    if (s.mode === "PSV") return this.backupActive ? s.backup.rate : 0;
    return s.rate;
  }

  private endInspiration(t: number, flow: number, setPause: number): void {
    if (this.acc) {
      this.acc.cycleFlow = flow;
      this.acc.endInspRecoil = this.recoil;
      this.acc.endInspPaw = this.lastPaw;
    }
    const pause = this.inspPauseRequested ? Math.max(HOLD_TIME, setPause) : setPause;
    this.inspPauseRequested = false;
    if (pause > 0) {
      this.phase = "pause";
      this.maneuverEffort = 0;
      this.phaseStart = t;
      this.phaseEnd = t + pause;
    } else {
      this.beginExpiration(t);
    }
  }

  private beginExpiration(t: number): void {
    if (this.acc) this.acc.inspEnd = t;
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
    if (this.backupActive) {
      if (trigger === "patient") this.backupPatientRun++;
      // The patient is breathing again: return to PSV, as ICU ventilators do.
      if (this.backupPatientRun >= BACKUP_EXIT_BREATHS && this.settings.mode === "PSV") {
        this.endApneaBackup();
      }
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
      plateauReliable: true,
      totalPeep: null,
      totalPeepReliable: true,
      endInspRecoil: this.recoil,
      endInspPaw: this.lastPaw,
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
        const r = FLOW_RAMP_TIME;
        const v = s.tidalVolume / s.peakFlow;
        // Flow time that delivers exactly Vt after the opening ramp. Square: Vt/peak + r/2.
        // Decelerating (ramp up over r, then linear to zero at T): T/2 − r/2 + r²/(6T) = Vt/peak.
        const tiFlow = decel
          ? (r + 2 * v + Math.sqrt((r + 2 * v) ** 2 - (4 * r * r) / 3)) / 2
          : v + r / 2;
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
      peep: this.settings.peep,
      inspTime: (a.inspEnd ?? t) - a.startTime,
      vti: a.vti,
      vte: a.vte,
      peakPaw: a.peakPaw,
      endInspPaw: a.endInspPaw,
      meanPaw: a.n > 0 ? a.sumPaw / a.n : this.lastPaw,
      endExpPaw: this.lastPaw,
      endInspRecoil: a.endInspRecoil,
      endExpRecoil: this.recoil,
      plateauPaw: a.plateauPaw,
      plateauReliable: a.plateauReliable,
      totalPeep: a.totalPeep,
      totalPeepReliable: a.totalPeepReliable,
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
