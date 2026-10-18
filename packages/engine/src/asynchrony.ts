import { ASYNCHRONY_KINDS, type AsynchronyKind, type BreathRecord } from "./types";

/** Rolling window for the Asynchrony Index (s). */
export const ASYNCHRONY_WINDOW = 120;
/** An index above this is usually called frequent asynchrony (Thille 2006, cited in ch. 15). */
export const ASYNCHRONY_INDEX_HIGH = 10;

export interface AsynchronySummary {
  /** Asynchrony events ÷ (ventilator breaths + ineffective efforts) × 100, over the window. */
  index: number;
  counts: Record<AsynchronyKind, number>;
  breaths: number;
  /** The window actually covered (s), shorter at the start. */
  window: number;
}

const emptyCounts = (): Record<AsynchronyKind, number> =>
  Object.fromEntries(ASYNCHRONY_KINDS.map((k) => [k, 0])) as Record<AsynchronyKind, number>;

/** Keeps the last two minutes of breaths and asynchrony events. */
export class AsynchronyTracker {
  private events: { t: number; kind: AsynchronyKind }[] = [];
  private breaths: number[] = [];
  private start: number | null = null;

  onEvent(t: number, kind: AsynchronyKind): void {
    this.events.push({ t, kind });
    this.start ??= t;
  }

  onBreath(b: BreathRecord): void {
    this.breaths.push(b.endTime);
    this.start ??= b.startTime;
  }

  summary(now: number): AsynchronySummary {
    const from = now - ASYNCHRONY_WINDOW;
    this.events = this.events.filter((e) => e.t > from);
    this.breaths = this.breaths.filter((t) => t > from);
    const counts = emptyCounts();
    for (const e of this.events) counts[e.kind]++;
    const cycles = this.breaths.length + counts.ineffectiveTrigger;
    return {
      index: cycles > 0 ? Math.round((this.events.length / cycles) * 1000) / 10 : 0,
      counts,
      breaths: this.breaths.length,
      window: this.start === null ? 0 : Math.min(ASYNCHRONY_WINDOW, now - this.start),
    };
  }
}
