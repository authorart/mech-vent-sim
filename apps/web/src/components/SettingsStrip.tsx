"use client";

import { settingsForMode, type Mode, type VentSettings } from "@mech-vent/engine";
import { useEffect, useRef, useState } from "react";
import { num } from "@/engine/format";
import {
  BACKUP_KNOBS,
  KNOBS,
  TRIGGER_KNOB,
  getValue,
  setValue,
  stepDisplay,
  type KnobSpec,
} from "@/engine/settings-spec";
import { usePbw, useStore } from "@/engine/store";
import { fmt, messages as m } from "@/i18n";
import { Knob, Toggle } from "./Knob";

const MODES: Mode[] = ["VCV", "PCV", "PSV"];
const MANEUVER_TIMEOUT_MS = 15_000;

/** Every knob for one settings object. `base` marks which values differ (pending). */
function SettingsEditor({
  value,
  base,
  onChange,
  showBackup,
}: {
  value: VentSettings;
  base: VentSettings | null;
  /** Receives an updater so rapid changes compose instead of overwriting each other. */
  onChange: (update: (s: VentSettings) => VentSettings) => void;
  showBackup: boolean;
}) {
  const pbw = usePbw();
  const changed = (key: string) => base !== null && getValue(base, key) !== getValue(value, key);
  const knob = (spec: KnobSpec) => (
    <Knob
      key={spec.key}
      spec={spec}
      value={getValue(value, spec.key)}
      changed={changed(spec.key)}
      onStep={(dir) =>
        onChange((s) =>
          setValue(
            s,
            spec.key,
            stepDisplay(spec, getValue(s, spec.key) * spec.scale, dir) / spec.scale,
          ),
        )
      }
      note={
        spec.key === "tidalVolume" && value.mode === "VCV"
          ? `${num((value.tidalVolume * 1000) / pbw, 1)} mL/kg`
          : null
      }
    />
  );

  const trig = value.trigger;
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {KNOBS[value.mode].map(knob)}
      {value.mode === "VCV" && (
        <Toggle
          label="Flow"
          value={value.flowPattern}
          options={[
            { value: "square", label: "Square" },
            { value: "decelerating", label: "Decel" },
          ]}
          changed={base?.mode === "VCV" && base.flowPattern !== value.flowPattern}
          onChange={(flowPattern) =>
            onChange((s) => (s.mode === "VCV" ? { ...s, flowPattern } : s))
          }
        />
      )}
      <Toggle
        label="Trigger type"
        value={trig.type}
        options={[
          { value: "flow", label: "Flow" },
          { value: "pressure", label: "Pressure" },
        ]}
        changed={base !== null && base.trigger.type !== trig.type}
        onChange={(type) =>
          onChange((s) => ({
            ...s,
            trigger: type === "flow" ? { type, threshold: 2 / 60 } : { type, threshold: 2 },
          }))
        }
      />
      {knob(TRIGGER_KNOB[trig.type])}
      {showBackup && value.mode === "PSV" && (
        <div className="flex items-stretch gap-2 border-l border-edge pl-2">
          <span className="self-center text-xs text-ink-3 [writing-mode:vertical-rl]">
            {m.backupHeading}
          </span>
          {BACKUP_KNOBS.map(knob)}
        </div>
      )}
    </div>
  );
}

function ModeDialog({
  mode,
  from,
  onClose,
}: {
  mode: Mode | null;
  from: VentSettings;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const send = useStore((s) => s.send);
  const [draft, setDraft] = useState<VentSettings | null>(null);
  const fromRef = useRef(from);
  useEffect(() => {
    fromRef.current = from;
  }, [from]);

  // Build the draft only when a new mode is chosen; later engine updates must not reset it.
  useEffect(() => {
    if (!mode) return;
    setDraft(settingsForMode(mode, fromRef.current));
    ref.current?.showModal();
  }, [mode]);

  if (!mode || !draft) return <dialog ref={ref} />;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto max-w-4xl rounded-lg border border-edge bg-chrome p-5 text-ink backdrop:bg-black/60"
    >
      <h2 className="text-xl font-semibold">{fmt(m.changeMode, { mode })}</h2>
      <p className="mt-1 mb-4 max-w-prose text-sm text-ink-2">{m.modeDialogHint}</p>
      <SettingsEditor
        value={draft}
        base={null}
        onChange={(u) => setDraft((d) => (d ? u(d) : d))}
        showBackup
      />
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="rounded border border-edge px-4 py-2 text-sm hover:bg-panel"
        >
          {m.cancel}
        </button>
        <button
          type="button"
          onClick={() => {
            send({ type: "applySettings", settings: draft });
            ref.current?.close();
          }}
          className="rounded bg-pending px-4 py-2 text-sm font-medium text-chrome hover:brightness-110"
        >
          {fmt(m.confirmMode, { mode })}
        </button>
      </div>
    </dialog>
  );
}

/** The ventilator's settings: change knobs (pending), then Confirm. Takes effect next breath. */
export function SettingsStrip() {
  const engine = useStore((s) => s.engine);
  const send = useStore((s) => s.send);
  const [draft, setDraft] = useState<VentSettings | null>(null);
  const [modeTarget, setModeTarget] = useState<Mode | null>(null);

  if (!engine) return null;
  const current = engine.pendingSettings ?? engine.settings;
  const value = draft ?? current;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(current);

  return (
    <section aria-label="Ventilator settings" className="border-t border-edge bg-chrome px-4 py-3">
      <div className="flex flex-wrap items-stretch gap-3">
        <div
          role="radiogroup"
          aria-label="Mode"
          className="flex flex-col justify-between rounded-md border border-edge bg-panel p-1"
        >
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={value.mode === mode}
              onClick={() => mode !== value.mode && setModeTarget(mode)}
              className={`rounded px-3 font-readout text-base leading-6 ${
                value.mode === mode ? "bg-ink text-chrome" : "text-ink-2 hover:bg-panel"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        <SettingsEditor
          value={value}
          base={current}
          onChange={(u) => setDraft((d) => u(d ?? current))}
          showBackup={false}
        />

        <div className="ml-auto flex flex-col justify-center gap-2">
          {dirty ? (
            <>
              <button
                type="button"
                onClick={() => {
                  send({ type: "applySettings", settings: draft });
                  setDraft(null);
                }}
                className="rounded bg-pending px-5 py-2 font-medium text-chrome hover:brightness-110"
              >
                {m.confirm}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded border border-edge px-5 py-1.5 text-sm hover:bg-panel"
              >
                {m.cancel}
              </button>
            </>
          ) : (
            <Maneuvers />
          )}
        </div>
      </div>
      {engine.pendingSettings && (
        <p role="status" className="mt-2 text-sm text-pending">
          {m.pendingNextBreath}
        </p>
      )}
      <ModeDialog mode={modeTarget} from={current} onClose={() => setModeTarget(null)} />
    </section>
  );
}

function Maneuvers() {
  const send = useStore((s) => s.send);
  const measuring = useStore((s) => s.measuring);
  const btn = (type: "inspiratoryPause" | "expiratoryHold", label: string) => (
    <button
      type="button"
      disabled={measuring !== null}
      onClick={() => {
        useStore.setState({ measuring: type });
        send({ type });
        // A pause cut short by the pressure limit never reports; don't leave the button stuck.
        setTimeout(() => {
          if (useStore.getState().measuring === type) useStore.setState({ measuring: null });
        }, MANEUVER_TIMEOUT_MS);
      }}
      className="rounded border border-edge px-4 py-1.5 text-sm hover:bg-panel disabled:opacity-50"
    >
      {measuring === type ? m.measuring : label}
    </button>
  );
  return (
    <>
      {btn("inspiratoryPause", m.inspiratoryPause)}
      {btn("expiratoryHold", m.expiratoryHold)}
    </>
  );
}
