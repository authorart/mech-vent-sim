/**
 * Scenario Events (M13, R1-Q7): changes that happen to the patient during a session, on a
 * timeline the instructor controls. Signs follow Hess & Kacmarek ch. 7, 15, 18, 25 and 31.
 */

export type ScenarioEventKind =
  | "tensionPneumothorax"
  | "cuffLeak"
  | "bronchopleuralFistula"
  | "bronchospasm"
  | "secretions"
  | "agitation"
  | "sedationWearsOff";

export const SCENARIO_KINDS: ScenarioEventKind[] = [
  "tensionPneumothorax",
  "cuffLeak",
  "bronchopleuralFistula",
  "bronchospasm",
  "secretions",
  "agitation",
  "sedationWearsOff",
];

export interface ScenarioEvent {
  id: number;
  kind: ScenarioEventKind;
  /** Session time it starts (s). */
  at: number;
  /** Session time it was (or will be) treated, or null. */
  resolvedAt: number | null;
}

/** How fast each event develops after it starts, and fades after it is treated (s). */
export const SCENARIO_TIMING: Record<ScenarioEventKind, { onset: number; offset: number }> = {
  tensionPneumothorax: { onset: 120, offset: 20 },
  cuffLeak: { onset: 5, offset: 3 },
  bronchopleuralFistula: { onset: 10, offset: 30 },
  bronchospasm: { onset: 30, offset: 40 },
  secretions: { onset: 20, offset: 3 },
  agitation: { onset: 1, offset: 1 },
  sedationWearsOff: { onset: 90, offset: 1 },
};

/** Leak conductance at full severity (L/s per cmH2O): ~0.2 L/s (11 L/min) at 15 cmH2O. */
export const LEAK_CONDUCTANCE = 0.012;
/** Sedation wearing off: light at the start, awake this long after. */
export const AWAKE_AFTER = 90;

/** 0 before the event, rising to 1 over its onset, falling after it is treated. */
export function progression(e: ScenarioEvent, t: number): number {
  if (t < e.at) return 0;
  const { onset, offset } = SCENARIO_TIMING[e.kind];
  const rise = (end: number) => Math.min(1, (end - e.at) / onset);
  if (e.resolvedAt === null || t < e.resolvedAt) return rise(t);
  return rise(e.resolvedAt) * Math.exp(-(t - e.resolvedAt) / offset);
}

/** What the active events do to the patient right now. */
export interface ScenarioEffects {
  complianceFactor: number;
  resistanceFactor: number;
  /** Leak around the tube cuff, at airway pressure (L/s per cmH2O). */
  cuffLeak: number;
  /** Leak from the alveoli into the pleural space, at alveolar pressure (L/s per cmH2O). */
  fistulaLeak: number;
  shuntAdd: number;
  hrAdd: number;
  /** Multiplies systolic and diastolic pressure. */
  bpFactor: number;
  /** Secretions in the airway (0–1): sawtooth on the flow and pressure traces. */
  secretions: number;
}

export const NO_EFFECTS: ScenarioEffects = {
  complianceFactor: 1,
  resistanceFactor: 1,
  cuffLeak: 0,
  fistulaLeak: 0,
  shuntAdd: 0,
  hrAdd: 0,
  bpFactor: 1,
  secretions: 0,
};

/**
 * Tension pneumothorax (Hess & Kacmarek table 25-1): harder to ventilate (compliance falls:
 * VCV peak pressure rises, PCV tidal volume falls), worse oxygenation, HR and BP rise at first,
 * then cardiovascular collapse.
 */
function pneumothoraxBp(p: number): number {
  return p < 0.35 ? 1 + 0.15 * (p / 0.35) : 1.15 - 0.7 * ((p - 0.35) / 0.65);
}

export function scenarioEffects(events: ScenarioEvent[], t: number): ScenarioEffects {
  const fx = { ...NO_EFFECTS };
  for (const e of events) {
    const p = progression(e, t);
    if (p <= 0.01) continue; // treated and faded: gone
    switch (e.kind) {
      case "tensionPneumothorax":
        fx.complianceFactor *= 1 - 0.6 * p;
        fx.shuntAdd += 0.6 * p;
        fx.hrAdd += 45 * p;
        fx.bpFactor *= pneumothoraxBp(p);
        break;
      case "cuffLeak":
        fx.cuffLeak += LEAK_CONDUCTANCE * p;
        break;
      case "bronchopleuralFistula":
        fx.fistulaLeak += LEAK_CONDUCTANCE * p;
        break;
      case "bronchospasm":
        fx.resistanceFactor *= 1 + 2 * p;
        break;
      case "secretions":
        fx.resistanceFactor *= 1 + 0.3 * p;
        fx.secretions = Math.max(fx.secretions, p);
        break;
      case "agitation":
      case "sedationWearsOff":
        break; // discrete changes, applied by the Session
    }
  }
  return fx;
}

/** The events of one session: scheduled, active and treated. */
export class ScenarioTimeline {
  events: ScenarioEvent[] = [];
  private nextId = 1;

  schedule(kind: ScenarioEventKind, at: number, resolvedAt: number | null = null): ScenarioEvent {
    const e = { id: this.nextId++, kind, at, resolvedAt };
    this.events.push(e);
    return e;
  }

  /** Treat an event now (no effect if it hasn't started or is already treated). */
  resolve(id: number, t: number): boolean {
    const e = this.events.find((x) => x.id === id);
    if (!e || t < e.at || (e.resolvedAt !== null && e.resolvedAt <= t)) return false;
    e.resolvedAt = t;
    return true;
  }

  cancel(id: number): void {
    this.events = this.events.filter((x) => x.id !== id);
  }

  effects(t: number): ScenarioEffects {
    return scenarioEffects(this.events, t);
  }
}
