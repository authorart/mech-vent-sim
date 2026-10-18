"use client";

import { useState } from "react";
import { useEngine } from "@/engine/useEngine";
import { useStore, type ExtraTrace } from "@/engine/store";
import { fmt, messages as m } from "@/i18n";
import { AsynchronyGuide } from "./AsynchronyGuide";
import { InstructorPanel } from "./InstructorPanel";
import { ResumePrompt } from "./ResumePrompt";
import { Loops } from "./Loops";
import { GasPanel, Numerics } from "./Numerics";
import { SettingsStrip } from "./SettingsStrip";
import { TargetsCard } from "./TargetsCard";
import { TopBar } from "./TopBar";
import { Waveforms } from "./Waveforms";

export function VentilatorApp() {
  useEngine("normal");
  const connection = useStore((s) => s.connection);
  const error = useStore((s) => s.error);
  const backup = useStore((s) => s.engine?.apneaBackupActive);
  const paused = useStore((s) => s.engine?.paused);
  const showTargets = useStore((s) => s.showTargets);
  const extraTrace = useStore((s) => s.extraTrace);
  const [view, setView] = useState<"waveforms" | "loops">("waveforms");
  const [frozen, setFrozen] = useState(false);
  const [instructor, setInstructor] = useState(false);
  const [guide, setGuide] = useState(false);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0">
      <TopBar onInstructor={() => setInstructor((v) => !v)} onGuide={() => setGuide(true)} />
      {/* Phones: the disclaimer scrolls with the page instead of taking room in the fixed bar. */}
      <p className="flex flex-wrap items-center gap-2 px-3 pt-2 text-xs text-ink-3 sm:px-4 lg:hidden">
        <span className="rounded border border-edge px-2 py-0.5 text-ink-2">{m.disclaimer}</span>
        {m.copyright}
      </p>

      {connection === "error" && (
        <p role="alert" className="bg-alarm-high px-4 py-2 text-sm text-white">
          {fmt(m.engineError, { message: error ?? "" })}
        </p>
      )}
      <ResumePrompt />
      {backup && (
        <p role="status" className="bg-panel px-4 py-1.5 text-sm text-ink">
          {m.apneaBackupActive}
        </p>
      )}

      <main className="grid flex-1 grid-cols-1 gap-3 p-3 sm:gap-4 sm:p-4 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section
          aria-label="Waveforms"
          className="flex min-h-[340px] flex-col rounded-lg bg-glass p-2 sm:min-h-[380px] sm:p-3"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
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
              <label className="ml-auto flex min-w-0 items-center gap-1.5 text-sm text-ink-2">
                <span className="hidden sm:inline">{m.extraTrace}</span>
                <select
                  aria-label={m.extraTrace}
                  value={extraTrace}
                  onChange={(e) => useStore.setState({ extraTrace: e.target.value as ExtraTrace })}
                  className="max-w-[9.5rem] min-w-0 rounded border border-edge bg-panel px-1.5 py-1 text-ink sm:max-w-none"
                >
                  {(["off", "pes", "co2"] as const).map((v) => (
                    <option key={v} value={v}>
                      {m.extraTraceOption[v]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {view === "waveforms" && (
              <button
                type="button"
                aria-pressed={frozen}
                onClick={() => setFrozen((f) => !f)}
                className={`rounded border px-3 py-1 text-sm ${
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
          {showTargets && (
            <div className="border-t border-edge pt-4">
              <h2 className="mb-2 text-sm font-medium text-ink-2">{m.targetsHeading}</h2>
              <TargetsCard />
            </div>
          )}
        </aside>
      </main>

      <SettingsStrip />

      <InstructorPanel open={instructor} onClose={() => setInstructor(false)} />
      <AsynchronyGuide
        open={guide}
        onClose={() => {
          setGuide(false);
          setView("waveforms");
        }}
      />
    </div>
  );
}
