"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useStore } from "@/engine/store";
import { GUIDE, GUIDE_BY_KIND, type GuideEntry, type GuideKind } from "@/guide/asynchrony";
import { runExample, type ExampleTrace } from "@/guide/example";
import { labelRows, labelWidth } from "@/guide/labels";
import { fmt, messages as m } from "@/i18n";

const W = 640;
const ROW = 96;
const GAP = 14;
const LANE = 14;

/**
 * Pressure and flow of an example, with the detected asynchronies marked. Effort examples add
 * esophageal pressure and mark breaths by type instead.
 */
function ExampleChart({ trace, focus }: { trace: ExampleTrace; focus: GuideKind }) {
  const tMax = trace.t.at(-1) ?? 8;
  const x = (t: number) => (t / tMax) * W;
  const effort = trace.pes.length > 0;

  // Event labels in up to three rows above the plot so they never overlap.
  const labels = trace.labelBreaths
    ? trace.breaths
        .filter((b) => b.t >= 0)
        .map((b) => ({
          text: b.type === "mandatory" ? m.mandatoryShort : m.spontaneousShort,
          own: b.type === "mandatory",
          x: x(b.t),
        }))
    : trace.marks.map((mk) => ({
        text: GUIDE_BY_KIND[mk.kind].label,
        own: mk.kind === focus,
        x: x(mk.t),
      }));
  const rows = labelRows(labels.map((l) => ({ x: l.x, width: labelWidth(l.text) })));
  const lanes = Math.max(1, ...rows.map((r) => r + 1));
  const top = lanes * LANE + 8;
  const pesTop = top + ROW * 2 + GAP * 2;
  // Time scale under the traces, one tick a second.
  const axisY = (effort ? pesTop + ROW : top + ROW * 2 + GAP) + 6;
  const H = axisY + 18;
  const seconds = Array.from({ length: Math.floor(tMax + 1e-6) + 1 }, (_, s) => s);

  const passiveMax = Math.max(0, ...trace.passive.flatMap((p) => p.paw));
  const pHi = Math.max(20, Math.ceil(Math.max(...trace.paw, passiveMax) / 10) * 10);
  const pLo = Math.min(0, Math.floor(Math.min(...trace.paw) / 5) * 5);
  const fAbs =
    trace.flowZoom ?? Math.max(30, Math.ceil(Math.max(...trace.flow.map(Math.abs)) / 30) * 30);
  const flowClip = useId();
  const yP = (p: number) => top + ROW - ((p - pLo) / (pHi - pLo)) * ROW;
  const yF = (f: number) => top + ROW + GAP + ROW / 2 - (f / fAbs) * (ROW / 2);
  const pesLo = Math.floor(Math.min(0, ...trace.pes));
  const pesHi = Math.ceil(Math.max(1, ...trace.pes));
  const yE = (p: number) => pesTop + ROW - ((p - pesLo) / (pesHi - pesLo)) * ROW;
  const line = (ys: number[], y: (v: number) => number) =>
    ys.map((v, i) => `${x(trace.t[i]!).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const pawAt = (t: number) => {
    const k = Math.round((t / tMax) * (trace.t.length - 1));
    return trace.paw[Math.min(trace.t.length - 1, Math.max(0, k))]!;
  };

  // Passive comparison: dashed curve per breath, and the shaded gap (the patient's work).
  const passive = trace.passive
    .filter((p) => p.start >= 0 && p.start + (p.t.at(-1) ?? 0) <= tMax)
    .map((p) => {
      const pts = p.t.map((dt, i) => [p.start + dt, p.paw[i]!] as const);
      const dashed = pts.map(([t, v]) => `${x(t).toFixed(1)},${yP(v).toFixed(1)}`).join(" ");
      const under = pts
        .map(([t]) => `${x(t).toFixed(1)},${yP(pawAt(t)).toFixed(1)}`)
        .reverse()
        .join(" ");
      return { dashed, area: `${dashed} ${under}`, key: p.start };
    });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={
        effort
          ? `Example pressure, flow and esophageal pressure traces over ${trace.breaths.length} breaths.`
          : `Example pressure and flow traces with ${trace.marks.length} detected events.`
      }
    >
      <line x1="0" x2={W} y1={yF(0)} y2={yF(0)} stroke="var(--grid)" />
      <line x1="0" x2={W} y1={yP(0)} y2={yP(0)} stroke="var(--grid)" />
      {effort && (
        <>
          <line x1="0" x2={W} y1={yE(0)} y2={yE(0)} stroke="var(--grid)" />
          <polyline
            points={line(trace.pes, yE)}
            fill="none"
            stroke="var(--trace-aux)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </>
      )}
      {labels.map((l, i) => {
        const own = l.own;
        const y = (rows[i] ?? 0) * LANE + 11;
        return (
          <g key={i}>
            <line
              x1={l.x}
              x2={l.x}
              y1={y + 3}
              y2={axisY}
              stroke={own ? "var(--ink-2)" : "var(--ink-3)"}
              strokeDasharray="3 3"
              opacity={own ? 0.8 : 0.45}
            />
            <text
              x={Math.min(W - labelWidth(l.text) / 2, Math.max(labelWidth(l.text) / 2, l.x))}
              y={y}
              fill={own ? "var(--ink)" : "var(--ink-3)"}
              fontSize="11"
              fontWeight={own ? 600 : 400}
              textAnchor="middle"
            >
              {l.text}
            </text>
          </g>
        );
      })}
      {passive.map((p) => (
        <g key={p.key}>
          <polygon points={p.area} fill="var(--trace-pressure)" opacity="0.18" />
          <polyline
            points={p.dashed}
            fill="none"
            stroke="var(--ink-2)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
          />
        </g>
      ))}
      <polyline
        points={line(trace.paw, yP)}
        fill="none"
        stroke="var(--trace-pressure)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <clipPath id={flowClip}>
        <rect x="0" y={top + ROW + GAP} width={W} height={ROW} />
      </clipPath>
      <polyline
        clipPath={`url(#${flowClip})`}
        points={line(trace.flow, yF)}
        fill="none"
        stroke="var(--trace-flow)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <g stroke="var(--grid)">
        <line x1="0" x2={W} y1={axisY} y2={axisY} />
        {seconds.map((s) => (
          <line key={s} x1={x(s)} x2={x(s)} y1={axisY} y2={axisY + 4} />
        ))}
      </g>
      <g fill="var(--ink-3)" fontSize="11">
        {seconds.map((s) => (
          <text
            key={s}
            x={x(s)}
            y={axisY + 15}
            textAnchor={s === 0 ? "start" : x(s) > W - 8 ? "end" : "middle"}
          >
            {s === seconds.at(-1) ? `${s} s` : s}
          </text>
        ))}
      </g>
      {/* Axis names last, with a halo, so marker lines and traces never run through them. */}
      <g
        fill="var(--ink-3)"
        fontSize="11"
        stroke="var(--glass)"
        strokeWidth="4"
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        <text x="4" y={top + 11}>
          Paw {pHi} cmH₂O
        </text>
        <text x="4" y={top + ROW + GAP + 11}>
          Flow ±{fAbs} L/min{trace.flowZoom && `, ${m.flowZoomed}`}
        </text>
        {effort && (
          <text x="4" y={pesTop + 11}>
            Pes {pesLo} to {pesHi} cmH₂O
          </text>
        )}
      </g>
    </svg>
  );
}

function Card({ entry, onShow }: { entry: GuideEntry; onShow: () => void }) {
  // The example is simulated in the page the first time its card is shown.
  const trace = useMemo(() => runExample(entry.example), [entry]);
  const list = (title: string, items: string[]) => (
    <section>
      <h4 className="mb-1.5 font-medium text-ink">{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
    </section>
  );
  return (
    <article className="flex flex-col gap-4">
      <header>
        <p className="text-sm text-ink-3">{m.family[entry.family]}</p>
        <h3 className="text-2xl font-semibold">{entry.title}</h3>
        <p className="mt-1 max-w-prose text-ink-2">{entry.summary}</p>
      </header>
      <figure className="rounded-md border border-edge bg-glass p-2">
        <ExampleChart trace={trace} focus={entry.kind} />
        <figcaption className="px-1 pt-1 text-xs text-ink-3">
          {fmt(entry.example.showEffort ? m.exampleEffort : m.exampleCaption, {
            seconds: entry.example.seconds ?? 8,
          })}{" "}
          {entry.example.comparePassive && m.exampleCompare}
          {entry.example.showPes && m.examplePes}
        </figcaption>
      </figure>
      <div className="grid gap-5 md:grid-cols-3">
        {list(m.recognize, entry.recognize)}
        {list(m.why, entry.why)}
        {list(m.fix, entry.fix)}
      </div>
      <div className="flex flex-col gap-2 rounded-md border border-edge p-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-ink-2">{entry.example.watch}</p>
        <button
          type="button"
          onClick={onShow}
          className="rounded bg-pending px-4 py-2 text-sm font-medium whitespace-nowrap text-chrome hover:brightness-110"
        >
          {m.showMe}
        </button>
      </div>
      <p className="text-xs text-ink-3">
        {m.source} {entry.source}.
      </p>
    </article>
  );
}

/** The Asynchrony Guide menu (M12, R6-Q13): one card per type, with a live "Show me". */
export function AsynchronyGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const send = useStore((s) => s.send);
  const [kind, setKind] = useState<GuideKind>(GUIDE[0]!.kind);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const show = (entry: GuideEntry) => {
    const ex = entry.example;
    send({ type: "loadProfile", profileId: ex.profileId, settings: ex.settings });
    send({ type: "setSedation", level: ex.sedation });
    send({ type: "setPatientFeatures", features: ex.features });
    useStore.setState({ showLabels: true });
    if (ex.showEffort || ex.showPes) useStore.setState({ extraTrace: "pes" });
    onClose();
  };

  const entry = GUIDE_BY_KIND[kind];
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="guide-title"
      className="m-auto h-[100dvh] max-h-[100dvh] w-full max-w-5xl overflow-y-auto bg-chrome p-4 text-ink backdrop:bg-black/60 sm:h-auto sm:max-h-[92dvh] sm:w-[calc(100%-2rem)] sm:rounded-lg sm:border sm:border-edge sm:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 id="guide-title" className="text-xl font-semibold">
            {m.guide}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-ink-2">{m.guideIntro}</p>
        </div>
        <button
          type="button"
          aria-label={m.closeGuide}
          onClick={onClose}
          className="rounded px-2 py-1 text-xl leading-none text-ink-2 hover:bg-panel hover:text-ink"
        >
          ×
        </button>
      </div>

      <div
        role="tablist"
        aria-label={m.guide}
        className="-mx-4 my-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {GUIDE.map((g) => (
          <button
            key={g.kind}
            type="button"
            role="tab"
            aria-selected={g.kind === kind}
            onClick={() => setKind(g.kind)}
            className={`rounded-full border px-3 py-1.5 text-sm whitespace-nowrap ${
              g.kind === kind
                ? "border-ink bg-ink text-chrome"
                : "border-edge text-ink-2 hover:text-ink"
            }`}
          >
            {g.title}
          </button>
        ))}
      </div>

      {open && <Card key={entry.kind} entry={entry} onShow={() => show(entry)} />}
    </dialog>
  );
}
