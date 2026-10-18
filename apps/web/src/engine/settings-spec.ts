import type { Mode, VentSettings } from "@mech-vent/engine";

/** One adjustable ventilator setting, shown in display units. */
export interface KnobSpec {
  /** Path into VentSettings, e.g. "tidalVolume" or "backup.rate". */
  key: string;
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  decimals: number;
  /** Engine value → display value. */
  scale: number;
}

const k = (
  key: string,
  label: string,
  unit: string,
  step: number,
  min: number,
  max: number,
  decimals = 0,
  scale = 1,
): KnobSpec => ({ key, label, unit, step, min, max, decimals, scale });

const COMMON: KnobSpec[] = [
  k("peep", "PEEP", "cmH₂O", 1, 0, 25),
  k("fio2", "FiO₂", "%", 5, 21, 100, 0, 100),
  k("highPressureLimit", "P limit", "cmH₂O", 1, 20, 80),
];

export const KNOBS: Record<Mode, KnobSpec[]> = {
  VCV: [
    k("tidalVolume", "Vt", "mL", 10, 200, 1200, 0, 1000),
    k("rate", "RR", "/min", 1, 4, 40),
    k("peakFlow", "Peak flow", "L/min", 5, 20, 120, 0, 60),
    k("pauseTime", "Pause", "s", 0.1, 0, 2, 1),
    ...COMMON,
  ],
  PCV: [
    k("pInsp", "P insp", "cmH₂O", 1, 5, 50),
    k("rate", "RR", "/min", 1, 4, 40),
    k("inspTime", "Ti", "s", 0.1, 0.3, 3, 1),
    k("riseTime", "Rise", "s", 0.05, 0, 0.5, 2),
    ...COMMON,
  ],
  PSV: [
    k("pSupport", "PS", "cmH₂O", 1, 0, 30),
    k("riseTime", "Rise", "s", 0.05, 0, 0.5, 2),
    k("esens", "Esens", "%", 5, 5, 70, 0, 100),
    k("apneaTime", "Apnea", "s", 5, 10, 60),
    ...COMMON,
  ],
  "V-SIMV": [
    k("tidalVolume", "Vt", "mL", 10, 200, 1200, 0, 1000),
    k("rate", "SIMV rate", "/min", 1, 1, 40),
    k("peakFlow", "Peak flow", "L/min", 5, 20, 120, 0, 60),
    k("pauseTime", "Pause", "s", 0.1, 0, 2, 1),
    k("pSupport", "PS", "cmH₂O", 1, 0, 30),
    k("riseTime", "PS rise", "s", 0.05, 0, 0.5, 2),
    k("esens", "Esens", "%", 5, 5, 70, 0, 100),
    ...COMMON,
  ],
  "P-SIMV": [
    k("pInsp", "P insp", "cmH₂O", 1, 5, 50),
    k("rate", "SIMV rate", "/min", 1, 1, 40),
    k("inspTime", "Ti", "s", 0.1, 0.3, 3, 1),
    k("riseTime", "Rise", "s", 0.05, 0, 0.5, 2),
    k("pSupport", "PS", "cmH₂O", 1, 0, 30),
    k("esens", "Esens", "%", 5, 5, 70, 0, 100),
    ...COMMON,
  ],
};

export const BACKUP_KNOBS: KnobSpec[] = [
  k("backup.pInsp", "P insp", "cmH₂O", 1, 5, 50),
  k("backup.rate", "RR", "/min", 1, 4, 40),
  k("backup.inspTime", "Ti", "s", 0.1, 0.3, 3, 1),
];

export const TRIGGER_KNOB = {
  flow: k("trigger.threshold", "Trigger", "L/min", 0.5, 0.5, 10, 1, 60),
  pressure: k("trigger.threshold", "Trigger", "cmH₂O", 0.5, 0.5, 10, 1),
};

export function getValue(s: VentSettings, key: string): number {
  let v: unknown = s;
  for (const part of key.split(".")) v = (v as Record<string, unknown>)[part];
  return typeof v === "number" ? v : NaN;
}

export function setValue<T extends VentSettings>(s: T, key: string, value: number): T {
  const parts = key.split(".");
  const out = structuredClone(s) as unknown as Record<string, unknown>;
  let o = out;
  for (const p of parts.slice(0, -1)) o = o[p] as Record<string, unknown>;
  o[parts.at(-1)!] = value;
  return out as unknown as T;
}

/** Step a display value, snapping to the step grid and clamping to the knob range. */
export function stepDisplay(spec: KnobSpec, display: number, dir: 1 | -1): number {
  const next = Math.round((display + dir * spec.step) / spec.step) * spec.step;
  return Math.min(spec.max, Math.max(spec.min, Number(next.toFixed(4))));
}
