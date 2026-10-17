"use client";

import { num } from "@/engine/format";
import type { KnobSpec } from "@/engine/settings-spec";

/**
 * A ventilator knob: − / + buttons, arrow keys and the mouse wheel step the value.
 * A changed (pending) value is outlined until confirmed.
 */
export function Knob({
  spec,
  value,
  changed,
  onStep,
  note,
}: {
  spec: KnobSpec;
  /** Engine-unit value. */
  value: number;
  changed: boolean;
  /** Step by one notch; the parent applies it to the latest value (safe for fast clicks). */
  onStep: (dir: 1 | -1) => void;
  note?: string | null;
}) {
  const display = value * spec.scale;
  const step = onStep;
  const id = `knob-${spec.key}`;

  return (
    <div
      className={`flex min-w-[104px] shrink-0 flex-col rounded-md border px-2 pt-1.5 pb-1 lg:min-w-[92px] ${
        changed ? "border-pending bg-pending/10" : "border-edge bg-panel"
      }`}
    >
      <label htmlFor={id} className="text-xs text-ink-2">
        {spec.label} <span className="text-ink-3">{spec.unit}</span>
      </label>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={`Decrease ${spec.label}`}
          onClick={() => step(-1)}
          className="h-10 w-10 rounded text-xl leading-none text-ink-2 hover:bg-edge lg:h-7 lg:w-7 lg:text-lg"
        >
          −
        </button>
        <output
          id={id}
          tabIndex={0}
          role="spinbutton"
          aria-valuenow={display}
          aria-valuemin={spec.min}
          aria-valuemax={spec.max}
          aria-label={`${spec.label} ${spec.unit}`}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowRight") {
              e.preventDefault();
              step(1);
            } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
              e.preventDefault();
              step(-1);
            }
          }}
          onWheel={(e) => step(e.deltaY < 0 ? 1 : -1)}
          className={`font-readout tabular text-2xl leading-none ${changed ? "text-pending" : "text-ink"}`}
        >
          {num(display, spec.decimals)}
        </output>
        <button
          type="button"
          aria-label={`Increase ${spec.label}`}
          onClick={() => step(1)}
          className="h-10 w-10 rounded text-xl leading-none text-ink-2 hover:bg-edge lg:h-7 lg:w-7 lg:text-lg"
        >
          +
        </button>
      </div>
      {note && <div className="text-center text-[11px] text-ink-3">{note}</div>}
    </div>
  );
}

/** A two-option toggle styled like a knob (flow pattern, trigger type). */
export function Toggle<T extends string>({
  label,
  value,
  options,
  changed,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  changed: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset
      className={`flex min-w-[92px] shrink-0 flex-col rounded-md border px-2 pt-1.5 pb-1.5 ${
        changed ? "border-pending bg-pending/10" : "border-edge bg-panel"
      }`}
    >
      <legend className="sr-only">{label}</legend>
      <span aria-hidden className="text-xs text-ink-2">
        {label}
      </span>
      <div className="mt-1 flex gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded px-1.5 py-2 text-sm lg:py-1 ${
              value === o.value ? "bg-edge text-ink" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
