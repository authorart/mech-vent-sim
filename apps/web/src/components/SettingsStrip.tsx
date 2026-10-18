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

const MODES: Mode[] = ["VCV", "PCV", "PSV", "V-SIMV", "P-SIMV"];
const MANEUVER_TIMEOUT_MS = 15_000;

/** Every knob for one settings object. `base` marks which values differ (pending). */
function SettingsEditor({
  value,
  base,
  onChange,
  showBackup,
  layout = "wrap",
}: {
  value: VentSettings;
  base: VentSettings | null;
  /** Receives an updater so rapid changes compose instead of overwriting each other. */
  onChange: (update: (s: VentSettings) => VentSettings) => void;
  showBackup: boolean;
  /** "strip" keeps knobs on one scrolling row on phones. */
  layout?: "strip" | "wrap";
}) {
  const pbw = usePbw();
  const volumeBreath = value.mode === "VCV" || value.mode === "V-SIMV";
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
        spec.key === "tidalVolume" && volumeBreath
          ? `${num((getValue(value, "tidalVolume") * 1000) / pbw, 1)} mL/kg`
          : null
      }
    />
  );

  const trig = value.trigger;
  return (
    <div
      className={`flex items-stretch gap-2 ${layout === "strip" ? "flex-nowrap lg:flex-wrap" : "flex-wrap"}`}
    >
      {KNOBS[value.mode].map(knob)}
      {(value.mode === "VCV" || value.mode === "V-SIMV") && (
        <Toggle
          label="Flow"
          value={value.flowPattern}
          options={[
            { value: "square", label: "Square" },
            { value: "decelerating", label: "Decel" },
          ]}
          changed={
            (base?.mode === "VCV" || base?.mode === "V-SIMV") &&
            base.flowPattern !== value.flowPattern
          }
          onChange={(flowPattern) =>
            onChange((s) => (s.mode === "VCV" || s.mode === "V-SIMV" ? { ...s, flowPattern } : s))
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
        <div className="flex basis-full flex-wrap items-stretch gap-2 border-t border-edge pt-2 lg:basis-auto lg:border-t-0 lg:border-l lg:pt-0 lg:pl-2">
          <span className="basis-full text-sm text-ink-2 lg:basis-auto lg:self-center lg:text-xs lg:text-ink-3 lg:[writing-mode:vertical-rl]">
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
  noEffort,
  onClose,
}: {
  mode: Mode | null;
  from: VentSettings;
  /** The patient makes no effort (deep sedation or no drive). */
  noEffort: boolean;
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
      className="m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-4xl overflow-y-auto rounded-lg border border-edge bg-chrome p-4 text-ink backdrop:bg-black/60 sm:p-5"
    >
      <h2 className="text-xl font-semibold">{fmt(m.changeMode, { mode })}</h2>
      <p className="mt-1 mb-4 max-w-prose text-sm text-ink-2">{m.modeDialogHint}</p>
      {mode === "PSV" && noEffort && (
        <p className="mb-4 max-w-prose rounded border border-pending/60 px-3 py-2 text-sm text-ink">
          {m.psvNoEffort}
        </p>
      )}
      {(mode === "V-SIMV" || mode === "P-SIMV") && (
        <p className="mb-4 max-w-prose text-sm text-ink-2">{m.simvHint}</p>
      )}
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

  const actions = (cls: string) => (
    <div className={cls}>
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
            className="rounded border border-edge px-4 py-2 text-sm hover:bg-panel lg:py-1.5"
          >
            {m.cancel}
          </button>
        </>
      ) : (
        <Maneuvers />
      )}
    </div>
  );

  return (
    <section
      aria-label="Ventilator settings"
      className="sticky bottom-0 z-20 overflow-x-clip border-t border-edge bg-chrome px-3 py-2 lg:static lg:overflow-x-visible lg:px-4 lg:py-3"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-3">
        {/* Phone: mode + actions on one row. Desktop: these become direct children (lg:contents). */}
        <div className="flex flex-wrap items-center gap-2 lg:contents">
          <div
            role="radiogroup"
            aria-label="Mode"
            className="flex max-w-full shrink-0 overflow-x-auto rounded-md border border-edge bg-panel p-1 lg:grid lg:max-w-none lg:grid-flow-col lg:grid-rows-3 lg:content-between lg:overflow-visible"
          >
            {MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={value.mode === mode}
                onClick={() => mode !== value.mode && setModeTarget(mode)}
                className={`rounded px-2.5 py-1.5 font-readout text-base leading-6 whitespace-nowrap sm:px-3 lg:px-2 lg:py-0 ${
                  value.mode === mode ? "bg-ink text-chrome" : "text-ink-2 hover:bg-panel"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          {actions("ml-auto flex gap-2 lg:hidden")}
        </div>

        {/* Phone: knobs scroll sideways in one row. Desktop: they wrap. */}
        <div className="-mx-3 overflow-x-auto px-3 pb-1 lg:mx-0 lg:overflow-visible lg:px-0 lg:pb-0">
          <SettingsEditor
            value={value}
            base={current}
            onChange={(u) => setDraft((d) => u(d ?? current))}
            showBackup={false}
            layout="strip"
          />
        </div>

        {actions("hidden lg:ml-auto lg:flex lg:flex-col lg:justify-center lg:gap-2")}
      </div>
      {engine.pendingSettings && (
        <p role="status" className="mt-2 text-sm text-pending">
          {m.pendingNextBreath}
        </p>
      )}
      {engine.apneaBackupActive && (
        <p role="status" className="mt-2 max-w-prose text-sm text-ink-2">
          {m.backupNote} {engine.sedation === "deep" && m.backupNoteDeep}
        </p>
      )}
      <ModeDialog
        mode={modeTarget}
        from={current}
        noEffort={engine.sedation === "deep" || engine.baseDrive.neuralRate === 0}
        onClose={() => setModeTarget(null)}
      />
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
      className="rounded border border-edge px-3 py-2 text-sm whitespace-nowrap hover:bg-panel disabled:opacity-50 lg:px-4 lg:py-1.5"
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
