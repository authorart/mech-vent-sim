import { PatientEffort, type EffortVariability } from "./effort";
import { mulberry32, normalFrom } from "./random";
import { LinearLung } from "./lung";
import type {
  BreathRecord,
  AsynchronyKind,
  BreathTrigger,
  CycleReason,
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
/**
 * Expiratory muscles (ADR-0002 amendment): when the ventilator keeps inflating after the patient
 * has stopped breathing in, the patient pushes back, up to this fraction of their peak Muscle
 * Pressure, building with PEXP_RISE and fading with PEXP_FALL time constants (s).
 */
export const PEXP_GAIN = 0.8;
export const PEXP_RISE = 0.08;
export const PEXP_FALL = 0.2;
/** Grace after neural inspiration ends before expiratory muscles join in (s). */
export const PEXP_DELAY = 0.05;

/**
 * Pressure servo for PCV/PSV (M10, Hess & Kacmarek ch. 7, 9). The rise time sets how fast the
 * ventilator may ramp its flow, up to SERVO_MAX_FLOW (L/s). The flow valve answers like an
 * underdamped second-order system, so a very fast rise overshoots the set pressure and a slow
 * rise against a strong patient pull gives a concave, sagging pressure rise.
 */
export const SERVO_MAX_FLOW = 3;
export const SERVO_MIN_RISE = 0.02;
export const SERVO_NATURAL_FREQ = 80; // rad/s
export const SERVO_DAMPING = 0.5;
/**
 * The valve cuts flow no faster than SERVO_MAX_DECEL + ventFlow/SERVO_CLOSE_TIME (L/s²): a sudden
 * drop in demand, such as the patient pushing back, briefly overshoots pressure.
 */
export const SERVO_MAX_DECEL = 6;
export const SERVO_CLOSE_TIME = 0.15;
/** The active exhalation valve vents gas once airway pressure passes the target by this much. */
export const RELIEF_PRESSURE = 4;
/** PSV secondary cycle criterion: airway pressure this far above target ends the breath. */
export const PSV_PRESSURE_CYCLE = 3;
/** Pressure cycling is ignored this long after the rise, so a start-up overshoot can't end the breath (s). */
export const PSV_PRESSURE_CYCLE_GUARD = 0.15;

/**
 * Asynchrony detection (M12). An effort counts if its Muscle Pressure peaks above
 * ASYNC_MIN_EFFORT; cycling is premature/delayed when the mismatch with neural inspiration
 * exceeds these margins (s); flow starvation when the patient pulls harder than
 * ASYNC_STARVATION_PMUS during a volume breath, or airway pressure falls below PEEP in a
 * pressure breath.
 */
export const ASYNC_MIN_EFFORT = 1;
export const ASYNC_PREMATURE_MARGIN = 0.12;
export const ASYNC_DELAYED_MARGIN = 0.2;
export const ASYNC_STARVATION_PMUS = 3;
/** Premature cycling counts only if the patient is still pulling at least this hard (cmH2O), so it shows. */
export const ASYNC_PREMATURE_PMUS = 2.5;

/** Displayed-signal noise (1 SD): pressure cmH2O, flow L/s. Physics and metrics stay noise-free. */
export const SIGNAL_NOISE = { paw: 0.04, flow: 0.004 };

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
  | { kind: "expiratory"; peep: number; oneWay: boolean; /** L/s, flow triggering only */ bias: number }
  /** PCV/PSV: the servo's delivered flow, with exhalation-valve relief above `relief` cmH2O. */
  | { kind: "servo"; q: number; relief: number };

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
  cycle: CycleReason;
  asynchronies: AsynchronyKind[];
  /** Largest Muscle Pressure during inspiration, and lowest airway pressure after 0.1 s. */
  maxPullPmus: number;
  minInspPaw: number;
  siT: number[];
  siP: number[];
  maxInspPmus: number;
}

export interface SimulatorOptions {
  patient: Patient;
  settings: VentSettings;
  /** Time of the patient's first effort (s). */
  firstEffortAt?: number;
  /** Breath-to-breath variability of the patient's effort (default: none, every cycle identical). */
  variability?: EffortVariability | null;
  /** Seeded measurement noise on the displayed pressure and flow (default off). */
  noiseSeed?: number | null;
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

  /** Reverse triggering: passive inflations entrain a patient effort (R6-Q2). */
  reverseTriggering = false;
  /** Expiratory Muscle Pressure (cmH2O, ≥ 0), held constant within a tick. */
  private pexp = 0;
  /** When the effort that belongs to the current breath stops breathing in (null = none). */
  private breathNeuralEnd: number | null = null;
  /** Effort that the current and the previous breath answered (for double triggers). */
  private breathEffortId: number | null = null;
  private lastBreathEffortId: number | null = null;
  /** The effort being watched for an ineffective trigger. */
  private watched: {
    id: number;
    entrained: boolean;
    peak: number;
    /** When it peaked: ineffective efforts are labeled there, where the flow notch shows. */
    peakT: number;
    /** A breath answered it, or it arrived while the ventilator was already inflating. */
    answered: boolean;
    /** It triggered a breath (and was labeled then). */
    triggered: boolean;
  } | null = null;

  /** Servo flow (L/s) and its rate of change, during PCV/PSV inspiration. */
  private ventFlow = 0;
  private ventFlowRate = 0;

  /** Heart rate (beats/min) and the cardiogenic oscillation it drives (cmH2O amplitude). */
  heartRate = 80;
  cardiacAmplitude = 0;
  private cardiacPhase = 0;
  private pcard = 0;

  private noise: (() => number) | null = null;

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
    this.effort = new PatientEffort(
      { ...opts.patient.drive },
      opts.firstEffortAt ?? 1,
      opts.variability ?? null,
    );
    this.lung.settle(this.settings.peep);
    this.volume = this.lung.volumeAtPressure(this.settings.peep);
    if (opts.noiseSeed != null) this.noise = normalFrom(mulberry32(opts.noiseSeed));
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
    this.updateServo(t0);
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
    const net = pmus - this.pexp - this.pcard;
    const flow = this.flowFor(control, t, this.volume);
    const paw = this.pawFor(control, t, this.volume, net, flow);
    const palv = this.lung.alveolarPressure(this.volume, net);
    this.lastPaw = paw;
    this.lastFlow = flow;
    if (this.phase === "pause" || this.phase === "expiratoryHold") {
      this.maneuverEffort = Math.max(this.maneuverEffort, pmus, this.pexp);
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
      const n = this.noise;
      this.outSamples.push(
        t,
        n ? paw + SIGNAL_NOISE.paw * n() : paw,
        n ? flow + SIGNAL_NOISE.flow * n() : flow,
        this.displayVolume,
        palv,
        pmus,
        this.pexp,
        this.lung.pleuralPressure(this.volume, pmus, this.pexp) + this.pcard,
      );
    }
    this.lung.step(DT, this.lung.recoil(this.volume), flow);
    this.collectStressIndex(t, paw, pmus);
    this.updateExpiratoryMuscles(t);
    this.updateCardiac();
    this.watchEffort(t, pmus, paw);

    this.transition(t, flow, paw);
  }

  /** Elastic recoil pressure (cmH2O): alveolar pressure with no effort. */
  private get recoil(): number {
    return this.lung.recoil(this.volume);
  }

  /** Fraction of the recruitable lung open (engine truth). */
  get recruited(): number {
    return this.lung.recruited;
  }

  /**
   * The patient pushes back when the ventilator keeps inflating after their own inspiration is
   * over (delayed cycling, an inspiratory time set too long): the end-inspiratory pressure bump.
   */
  private updateExpiratoryMuscles(t: number): void {
    const inflating = this.phase === "inspiration" || this.phase === "pause";
    const overrun =
      inflating && this.breathNeuralEnd !== null && t > this.breathNeuralEnd + PEXP_DELAY;
    const target = overrun && !this.effort.inspiring(t) ? PEXP_GAIN * this.effort.drive.pmusMax : 0;
    const tau = target > this.pexp ? PEXP_RISE : PEXP_FALL;
    this.pexp += (target - this.pexp) * Math.min(1, DT / tau);
  }

  /** The heart beating against the lungs: a small pressure ripple at the heart rate. */
  private updateCardiac(): void {
    this.cardiacPhase = (this.cardiacPhase + (this.heartRate / 60) * DT) % 1;
    this.pcard = this.cardiacAmplitude * Math.sin(2 * Math.PI * this.cardiacPhase);
  }

  /** Target airway pressure of the current PCV/PSV breath. */
  private pressureTarget(b: ActiveBreath): number {
    return this.settings.peep + (b.kind === "PCV" ? b.pInsp : b.kind === "PSV" ? b.pSupport : 0);
  }

  /** Advance the pressure servo's flow by one step (see SERVO_MAX_FLOW). */
  private updateServo(t: number): void {
    const b = this.breath;
    if (this.phase !== "inspiration" || !b || b.kind === "VCV") {
      this.ventFlow = 0;
      this.ventFlowRate = 0;
      return;
    }
    const tIn = t - this.phaseStart;
    const net = this.effort.pmus(t) - this.pexp - this.pcard;
    const need = Math.max(0, this.lung.flow(this.pressureTarget(b), this.volume, net));
    const cap = SERVO_MAX_FLOW * Math.min(1, tIn / Math.max(b.riseTime, SERVO_MIN_RISE));
    const command = Math.min(need, cap);
    const w = SERVO_NATURAL_FREQ;
    const accel = w * w * (command - this.ventFlow) - 2 * SERVO_DAMPING * w * this.ventFlowRate;
    const maxDecel = SERVO_MAX_DECEL + this.ventFlow / SERVO_CLOSE_TIME;
    this.ventFlowRate = Math.max(-maxDecel, this.ventFlowRate + accel * DT);
    this.ventFlow += this.ventFlowRate * DT;
    if (this.ventFlow < 0) {
      this.ventFlow = 0;
      this.ventFlowRate = 0;
    }
  }

  private flowFor(control: Control, t: number, v: number): number {
    const pmus = this.effort.pmus(t) - this.pexp - this.pcard;
    switch (control.kind) {
      case "flow":
        return control.q(t);
      case "pressure":
        return this.lung.flow(control.paw(t), v, pmus);
      case "servo":
        return this.lung.pressureForFlow(control.q, v, pmus) > control.relief
          ? this.lung.flow(control.relief, v, pmus)
          : control.q;
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
      case "servo":
        return Math.min(this.lung.pressureForFlow(flow, v, pmus), control.relief);
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
    const palv = this.lung.alveolarPressure(v, pmus);
    const rc = this.circuitResistance(t);
    if (peep >= palv) return (peep - palv) / (this.lung.mechanics.rInsp + rc);
    const r = this.lung.expiratoryResistance(v);
    const q = (palv - peep) / (r + rc);
    // Waterfall (COPD): if airway pressure would sit below the critical pressure, the collapsed
    // airways set the flow instead, and PEEP up to that pressure makes no difference.
    const pcrit = this.lung.criticalPressure;
    if (peep + rc * q >= pcrit) return -q;
    return -Math.max(0, palv - pcrit) / r;
  }

  private asynchrony(t: number, kind: AsynchronyKind): void {
    this.outEvents.push({ type: "asynchrony", t, kind });
    if (this.acc && kind !== "ineffectiveTrigger") this.acc.asynchronies.push(kind);
  }

  /**
   * Follow each effort from start to end. One that peaks above ASYNC_MIN_EFFORT while the
   * ventilator is in expiration and is never answered by a breath is an ineffective trigger; an
   * entrained one is a reverse trigger. Also tracks the patient's pull during inspiration.
   */
  private watchEffort(t: number, pmus: number, paw: number): void {
    if (this.acc && this.phase === "inspiration") {
      this.acc.maxPullPmus = Math.max(this.acc.maxPullPmus, pmus);
      if (t - this.phaseStart > 0.1) this.acc.minInspPaw = Math.min(this.acc.minInspPaw, paw);
    }
    const e = this.effort.activeEffort(t);
    const w = this.watched;
    if (w && (!e || e.id !== w.id)) {
      if (w.peak >= ASYNC_MIN_EFFORT && !w.triggered) {
        // An entrained effort is a reverse trigger whenever it happens; an own effort that no
        // breath answered is an ineffective trigger.
        if (w.entrained) this.asynchrony(w.peakT, "reverseTrigger");
        else if (!w.answered) this.asynchrony(w.peakT, "ineffectiveTrigger");
      }
      this.watched = null;
    }
    if (e && !this.watched) {
      const inflating = this.phase === "inspiration" || this.phase === "pause";
      this.watched = {
        id: e.id,
        entrained: e.entrained,
        peak: 0,
        peakT: t,
        answered: inflating,
        triggered: false,
      };
      // A breath triggered by this effort is pending (trigger delay): count it as answered.
      if (this.triggerAt !== null) this.watched.answered = true;
    }
    if (this.watched) {
      if (pmus > this.watched.peak) {
        this.watched.peak = pmus;
        this.watched.peakT = t;
      }
      if (this.triggerAt !== null) this.watched.answered = true;
    }
  }

  /**
   * At the end of inspiration: did the ventilator stop before the patient (premature cycling)
   * or keep inflating after them (delayed cycling)? Was the patient starved of flow?
   */
  private classifyCycling(t: number): void {
    const a = this.acc;
    const b = this.breath;
    if (!a || !b) return;
    // A reverse-triggered breath is already labeled; don't pile cycling labels on it.
    if (a.asynchronies.includes("reverseTrigger")) return;
    const active = this.effort.activeEffort(t);
    if (
      active &&
      active.id === this.breathEffortId &&
      active.inspirationEnd - t > ASYNC_PREMATURE_MARGIN &&
      this.effort.pmus(t) >= ASYNC_PREMATURE_PMUS
    ) {
      this.asynchrony(t, "prematureCycling");
    } else if (this.breathNeuralEnd !== null && t - this.breathNeuralEnd > ASYNC_DELAYED_MARGIN) {
      this.asynchrony(t, "delayedCycling");
    }
    const starved =
      b.kind === "VCV"
        ? a.maxPullPmus >= ASYNC_STARVATION_PMUS
        : a.minInspPaw < this.settings.peep - 1;
    if (starved && a.trigger !== "mandatory") this.asynchrony(t, "flowStarvation");
  }

  /** Paw samples of a constant-flow VCV inspiration, for the stress index. */
  private collectStressIndex(t: number, paw: number, pmus: number): void {
    const a = this.acc;
    const b = this.breath;
    if (!a || !b || b.kind !== "VCV" || b.decel || this.phase !== "inspiration") return;
    a.maxInspPmus = Math.max(a.maxInspPmus, pmus);
    const tIn = t - this.phaseStart;
    if (tIn >= FLOW_RAMP_TIME + 0.03 && tIn <= b.tiFlow - DT && this.step % OUTPUT_EVERY === 0) {
      a.siT.push(tIn);
      a.siP.push(paw);
    }
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
      case "PSV":
        return { kind: "servo", q: this.ventFlow, relief: this.pressureTarget(b) + RELIEF_PRESSURE };
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
      this.endInspiration(t, flow, 0, "highPressure");
      return;
    }
    switch (b.kind) {
      case "VCV":
        if (tIn >= b.tiFlow - DT / 2) this.endInspiration(t, flow, b.pause);
        break;
      case "PCV":
        if (tIn >= b.inspTime - DT / 2) this.endInspiration(t, flow, 0);
        break;
      case "PSV": {
        this.psvPeakFlow = Math.max(this.psvPeakFlow, flow);
        const rise = Math.max(b.riseTime, SERVO_MIN_RISE);
        if (tIn >= rise && flow <= b.esens * this.psvPeakFlow) {
          this.endInspiration(t, flow, 0, "flow");
        } else if (
          tIn >= rise + PSV_PRESSURE_CYCLE_GUARD &&
          paw > this.pressureTarget(b) + PSV_PRESSURE_CYCLE
        ) {
          // The patient is actively exhaling against the breath (Hess & Kacmarek fig. 15-9).
          this.endInspiration(t, flow, 0, "pressure");
        } else if (tIn >= MAX_PSV_INSP_TIME) {
          this.endInspiration(t, flow, 0, "time");
        }
        break;
      }
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

  private endInspiration(
    t: number,
    flow: number,
    setPause: number,
    cycle: CycleReason = "time",
  ): void {
    if (this.acc) {
      this.acc.cycle = cycle;
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
    this.classifyCycling(t);
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
    // The effort this breath answers (a patient trigger, or an effort already under way).
    this.breathNeuralEnd = this.effort.inspirationEndsAt(t);
    const effort = this.effort.activeEffort(t);
    this.lastBreathEffortId = this.breathEffortId;
    this.breathEffortId = effort?.id ?? null;
    if (this.watched && effort && this.watched.id === effort.id) this.watched.answered = true;

    if (this.reverseTriggering && trigger !== "patient" && this.effort.drive.pmusMax <= 0) {
      this.effort.entrain(t);
    }
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
      cycle: "time",
      asynchronies: [],
      maxPullPmus: 0,
      minInspPaw: Infinity,
      siT: [],
      siP: [],
      maxInspPmus: 0,
    };
    this.outEvents.push({ type: "breathStart", t, trigger });
    if (trigger === "patient") {
      const effort = this.effort.activeEffort(t);
      if (effort && this.watched?.id === effort.id) this.watched.triggered = true;
      if (!effort) this.asynchrony(t, "autoTrigger");
      else if (effort.entrained) this.asynchrony(t, "reverseTrigger");
      else if (effort.id === this.lastBreathEffortId) this.asynchrony(t, "doubleTrigger");
    }
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
      cycle: a.cycle,
      stressIndex:
        a.siT.length >= 8 && a.maxInspPmus < 0.5 && !a.highPressureCycled
          ? stressIndex(a.siT, a.siP)
          : null,
      endExpRecruited: this.lung.recruited,
      asynchronies: a.asynchronies,
    });
    this.acc = null;
  }

  /** Last computed flow (L/s), for diagnostics. */
  get flow(): number {
    return this.lastFlow;
  }
}

/**
 * Stress index (Hess & Kacmarek ch. 31): fit Paw = a·tᵇ + c over the constant-flow part of a
 * passive VCV inspiration and return b. A grid over b with least squares for a and c is enough.
 */
export function stressIndex(t: number[], p: number[]): number {
  let best = { b: 1, sse: Infinity };
  for (let b = 0.4; b <= 2.5001; b += 0.01) {
    const x = t.map((ti) => Math.pow(ti, b));
    const n = x.length;
    const mx = x.reduce((s, v) => s + v, 0) / n;
    const mp = p.reduce((s, v) => s + v, 0) / n;
    let sxx = 0;
    let sxp = 0;
    for (let i = 0; i < n; i++) {
      sxx += (x[i]! - mx) ** 2;
      sxp += (x[i]! - mx) * (p[i]! - mp);
    }
    const a = sxx > 0 ? sxp / sxx : 0;
    const c = mp - a * mx;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (p[i]! - (a * x[i]! + c)) ** 2;
    if (sse < best.sse) best = { b, sse };
  }
  return Math.round(best.b * 100) / 100;
}
