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
      className={`flex items-center gap-2 rounded px-2.5 py-1 text-sm font-medium ${
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

export function TopBar({ onInstructor }: { onInstructor: () => void }) {
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
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-edge bg-chrome px-4 py-2">
      <div className="flex items-baseline gap-3">
        <span className="font-semibold">MedVent</span>
        {profile && <span className="text-ink-2">{profile.name}</span>}
        {mode && <span className="font-readout text-lg text-ink">{mode}</span>}
        {engine && (
          <span className="text-sm text-ink-3">
            {m.sedation}: {m.sedationLevel[engine.sedation].toLowerCase()}
          </span>
        )}
      </div>

      <ul aria-live="assertive" className="flex flex-1 flex-wrap items-center gap-2">
        {alarms.length === 0 ? (
          <li className="flex items-center gap-2 text-sm text-ink-3">
            <span aria-hidden className="h-2 w-2 rounded-full bg-ok" />
            {m.noAlarms}
          </li>
        ) : (
          alarms.map((a) => (
            <AlarmChip key={a.id} a={a} text={alarmText(a.id, engine?.alarmLimits)} />
          ))
        )}
      </ul>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={alarms.length === 0 && !silenced}
          onClick={() => send({ type: "silenceAlarms" })}
          className="rounded border border-edge px-3 py-1.5 text-sm text-ink hover:bg-panel disabled:opacity-40"
        >
          {silenced && silencedUntil
            ? fmt(m.silenced, { time: mmss(silencedUntil - now) })
            : m.silence}
        </button>
        <button
          type="button"
          onClick={onInstructor}
          className="hidden rounded bg-panel px-3 py-1.5 text-sm text-ink hover:bg-edge lg:block"
        >
          {m.instructor}
        </button>
        <span className="rounded border border-edge px-2 py-1 text-xs text-ink-2">
          {m.disclaimer}
        </span>
      </div>
    </header>
  );
}
