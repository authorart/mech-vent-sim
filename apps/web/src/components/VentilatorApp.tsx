"use client";

import { useState } from "react";
import { useEngine } from "@/engine/useEngine";
import { useStore } from "@/engine/store";
import { fmt, messages as m } from "@/i18n";
import { InstructorPanel } from "./InstructorPanel";
import { Loops } from "./Loops";
import { GasPanel, Numerics } from "./Numerics";
import { SettingsStrip } from "./SettingsStrip";
import { TopBar } from "./TopBar";
import { Waveforms } from "./Waveforms";

export function VentilatorApp() {
  useEngine("ards");
  const connection = useStore((s) => s.connection);
  const error = useStore((s) => s.error);
  const backup = useStore((s) => s.engine?.apneaBackupActive);
  const paused = useStore((s) => s.engine?.paused);
  const [view, setView] = useState<"waveforms" | "loops">("waveforms");
  const [frozen, setFrozen] = useState(false);
  const [instructor, setInstructor] = useState(false);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0">
      <TopBar onInstructor={() => setInstructor((v) => !v)} />

      {connection === "error" && (
        <p role="alert" className="bg-alarm-high px-4 py-2 text-sm text-white">
          {fmt(m.engineError, { message: error ?? "" })}
        </p>
      )}
      {backup && (
        <p role="status" className="bg-panel px-4 py-1.5 text-sm text-ink">
          {m.apneaBackupActive}
        </p>
      )}

      <main className="grid flex-1 grid-cols-1 gap-4 p-4 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section
          aria-label="Waveforms"
          className="flex min-h-[380px] flex-col rounded-lg bg-glass p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <div role="tablist" aria-label="Display" className="flex gap-1">
              {(["waveforms", "loops"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`rounded px-3 py-1 text-sm ${
                    view === v ? "bg-edge text-ink" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {v === "waveforms" ? m.waveforms : m.loops}
                </button>
              ))}
            </div>
            {view === "waveforms" && (
              <button
                type="button"
                aria-pressed={frozen}
                onClick={() => setFrozen((f) => !f)}
                className={`ml-auto rounded border px-3 py-1 text-sm ${
                  frozen ? "border-pending text-pending" : "border-edge text-ink-2 hover:text-ink"
                }`}
              >
                {frozen ? m.unfreeze : m.freeze}
              </button>
            )}
            {paused && (
              <span className="text-sm text-ink-3">{m.resume.replace("Resume", "Paused:")}</span>
            )}
          </div>
          {frozen && view === "waveforms" && (
            <p className="mb-1 text-xs text-ink-3">{m.frozenHint}</p>
          )}
          <div className="relative flex-1">
            {connection === "connecting" ? (
              <p className="p-6 text-ink-3">{m.connecting}</p>
            ) : view === "waveforms" ? (
              <Waveforms frozen={frozen} />
            ) : (
              <Loops />
            )}
          </div>
        </section>

        <aside
          aria-label="Measured values"
          className="flex flex-col gap-6 rounded-lg bg-panel p-4 lg:overflow-y-auto"
        >
          <Numerics />
          <div className="border-t border-edge pt-4">
            <GasPanel />
          </div>
        </aside>
      </main>

      <div className="hidden lg:block">
        <SettingsStrip />
      </div>
      <p className="px-4 pb-4 text-sm text-ink-3 lg:hidden">
        Controls need a screen at least 1024 px wide. This view shows waveforms and values only.
      </p>

      <InstructorPanel open={instructor} onClose={() => setInstructor(false)} />
    </div>
  );
}
