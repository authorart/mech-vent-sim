"use client";

import { PROFILES, type AlarmId, type AlarmState } from "@mech-vent/engine";
import { useEffect, useState } from "react";
import { mmss } from "@/engine/format";
import { useStore } from "@/engine/store";
import { fmt, messages as m } from "@/i18n";

function alarmText(id: AlarmId, limits: { autoPeep: number; drivingPressure: number } | undefined) {
  const t = m.alarm[id];
  if (id === "AUTO_PEEP") return fmt(t, { limit: limits?.autoPeep ?? 5 });
  if (id === "HIGH_DRIVING_PRESSURE") return fmt(t, { limit: limits?.drivingPressure ?? 15 });
  return t;
}

function AlarmChip({ a, text }: { a: AlarmState; text: string }) {
  const high = a.priority === "high";
  return (
    <li
      className={`flex shrink-0 items-center gap-2 rounded px-2.5 py-1 text-sm font-medium whitespace-nowrap ${
        high ? "bg-alarm-high text-white" : "bg-alarm-medium text-chrome"
      }`}
    >
      {/* Shape differs by priority so it never depends on color alone. */}
      <svg aria-hidden width="14" height="14" viewBox="0 0 14 14">
        {high ? (
          <path d="M7 1 L13 12 H1 Z" fill="currentColor" />
        ) : (
          <circle cx="7" cy="7" r="5.5" fill="currentColor" />
        )}
      </svg>
      <span className="sr-only">{m.priority[a.priority]}: </span>
      {text}
    </li>
  );
}

export function TopBar({
  onInstructor,
  onGuide,
}: {
  onInstructor: () => void;
  onGuide: () => void;
}) {
  const alarms = useStore((s) => s.alarms);
  const silencedUntil = useStore((s) => s.silencedUntil);
  const engine = useStore((s) => s.engine);
  const send = useStore((s) => s.send);
  // Real time is read in effects only (no Date.now() during render under Cache Components).
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!silencedUntil) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [silencedUntil]);

  const silenced = silencedUntil !== null && silencedUntil > now;
  const profile = engine ? PROFILES[engine.profileId] : null;
  const mode = engine?.apneaBackupActive ? "PCV (backup)" : engine?.settings.mode;

  return (
    // Fixed at the top. Row 1: who and what (title) and the menu. Row 2: alarms, one line high,
    // so alarms coming and going never move the page.
    <header className="sticky top-0 z-30 border-b border-edge bg-chrome px-3 py-2 sm:px-4">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-semibold">MedVent</span>
          {profile && <span className="text-ink-2">{profile.name}</span>}
          {mode && <span className="font-readout text-lg text-ink">{mode}</span>}
          {engine && (
            <span className="text-sm text-ink-3">
              {m.sedation}: {m.sedationLevel[engine.sedation].toLowerCase()}
            </span>
          )}
        </div>
        <span className="hidden rounded border border-edge px-2 py-1 text-xs text-ink-2 lg:inline">
          {m.disclaimer}
        </span>
        <span className="hidden text-xs text-ink-3 xl:inline">{m.copyright}</span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onGuide}
            aria-label={m.guide}
            className="rounded border border-edge px-3 py-1.5 text-sm text-ink hover:bg-panel"
          >
            <span className="sm:hidden">{m.guideShort}</span>
            <span className="hidden sm:inline">{m.guide}</span>
          </button>
          <button
            type="button"
            onClick={onInstructor}
            className="rounded bg-panel px-3 py-1.5 text-sm text-ink hover:bg-edge"
          >
            {m.instructor}
          </button>
        </div>
      </div>

      <div className="mt-2 flex h-9 items-center gap-2">
        <ul
          aria-live="assertive"
          aria-label={m.alarmsHeading}
          className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto"
        >
          {alarms.length === 0 ? (
            <li className="flex items-center gap-2 text-sm whitespace-nowrap text-ink-3">
              <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
              {m.noAlarms}
            </li>
          ) : (
            alarms.map((a) => (
              <AlarmChip key={a.id} a={a} text={alarmText(a.id, engine?.alarmLimits)} />
            ))
          )}
        </ul>
        <button
          type="button"
          disabled={alarms.length === 0 && !silenced}
          onClick={() => send({ type: "silenceAlarms" })}
          className="shrink-0 rounded border border-edge px-3 py-1.5 text-sm whitespace-nowrap text-ink hover:bg-panel disabled:opacity-40"
        >
          {silenced && silencedUntil
            ? fmt(m.silenced, { time: mmss(silencedUntil - now) })
            : m.silence}
        </button>
      </div>
    </header>
  );
}
