"use client";

import { evaluateTargets, type TargetRow, type TargetStatus } from "@mech-vent/engine";
import { num } from "@/engine/format";
import { usePbw, useStore } from "@/engine/store";
import { TARGET_LABELS, TARGET_NOTES } from "@/guide/targets";
import { messages as m } from "@/i18n";

/** Status as a symbol and a word, so it never depends on color alone. */
const MARK: Record<TargetStatus, { symbol: string; className: string }> = {
  ok: { symbol: "✓", className: "text-ok" },
  low: { symbol: "↓", className: "text-pending" },
  high: { symbol: "↑", className: "text-pending" },
  unknown: { symbol: "–", className: "text-ink-3" },
};

function range(r: TargetRow): string {
  const d = TARGET_LABELS[r.key].decimals;
  if (r.key === "pplat" || r.key === "pl") return `≤ ${num(r.range.max, d)}`;
  if (r.range.min === r.range.max) return num(r.range.min, d);
  return `${num(r.range.min, d)}–${num(r.range.max, d)}`;
}

/** The current profile's targets against the current values (M14, R6-Q11). */
export function TargetsCard() {
  const engine = useStore((s) => s.engine);
  const metrics = useStore((s) => s.metrics);
  const gas = useStore((s) => s.gas);
  const pbw = usePbw();
  if (!engine) return null;

  const settings = engine.pendingSettings ?? engine.settings;
  const rows = evaluateTargets(engine.profileId, {
    vtPerKg: metrics ? (metrics.vte * 1000) / pbw : null,
    rr: metrics?.rrTotal ?? null,
    ti: metrics?.ti ?? null,
    peep: settings.peep,
    pplat: metrics?.pplat?.value ?? null,
    pl: metrics?.esophageal.plEndInsp ?? null,
    ph: gas?.ph ?? null,
    spo2: gas?.spo2 ?? null,
  });
  const notes = TARGET_NOTES[engine.profileId];

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th className="pb-1 font-normal">{m.targetMeasure}</th>
            <th className="pb-1 text-right font-normal">{m.targetNow}</th>
            <th className="pb-1 pl-3 text-right font-normal whitespace-nowrap">{m.targetGoal}</th>
            <th className="pb-1 pl-2 font-normal">
              <span className="sr-only">{m.targetStatus}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = TARGET_LABELS[r.key];
            const mark = MARK[r.status];
            return (
              <tr key={r.key} className="border-t border-edge/60">
                <td className="py-1 text-ink-2">
                  {meta.label} {meta.unit && <span className="text-xs text-ink-3">{meta.unit}</span>}
                </td>
                <td className="py-1 pl-2 text-right font-readout whitespace-nowrap text-ink tabular">
                  {r.value === null ? "–" : num(r.value, meta.decimals)}
                </td>
                <td className="py-1 pl-3 text-right whitespace-nowrap text-ink-2 tabular">{range(r)}</td>
                <td className={`py-1 pl-2 ${mark.className}`}>
                  <span aria-hidden>{mark.symbol}</span>
                  <span className="sr-only">{m.targetStatusWord[r.status]}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="list-disc space-y-1 pl-5 text-xs text-ink-2">
        {notes.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="text-xs text-ink-3">
        {m.source} {notes.source}.
      </p>
    </div>
  );
}
