"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/engine/store";
import { GUIDE, GUIDE_BY_KIND, type GuideEntry } from "@/guide/asynchrony";
import { runExample, type ExampleTrace } from "@/guide/example";
import { messages as m } from "@/i18n";

const W = 640;
const ROW = 96;
const GAP = 14;
const H = ROW * 2 + GAP + 22;

/** Pressure and flow of an example, with the detected asynchronies marked. */
function ExampleChart({ trace }: { trace: ExampleTrace }) {
  const tMax = trace.t.at(-1) ?? 8;
  const x = (t: number) => (t / tMax) * W;
  const pHi = Math.max(20, Math.ceil(Math.max(...trace.paw) / 10) * 10);
  const fAbs = Math.max(30, Math.ceil(Math.max(...trace.flow.map(Math.abs)) / 30) * 30);
  const yP = (p: number) => 22 + ROW - (Math.max(0, p) / pHi) * ROW;
  const yF = (f: number) => 22 + ROW + GAP + ROW / 2 - (f / fAbs) * (ROW / 2);
  const line = (ys: number[], y: (v: number) => number) =>
    ys.map((v, i) => `${x(trace.t[i]!).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Example pressure and flow traces with ${trace.marks.length} detected events.`}
    >
      <line x1="0" x2={W} y1={yF(0)} y2={yF(0)} stroke="var(--grid)" />
      <line x1="0" x2={W} y1={yP(0)} y2={yP(0)} stroke="var(--grid)" />
      <text x="4" y={22 + 11} fill="var(--ink-3)" fontSize="11">
        Paw {pHi} cmH₂O
      </text>
      <text x="4" y={22 + ROW + GAP + 11} fill="var(--ink-3)" fontSize="11">
        Flow ±{fAbs} L/min
      </text>
      {trace.marks.map((mk, i) => (
        <g key={i}>
          <line
            x1={x(mk.t)}
            x2={x(mk.t)}
            y1="18"
            y2={H}
            stroke="var(--ink-2)"
            strokeDasharray="3 3"
            opacity="0.7"
          />
          <text x={x(mk.t)} y="12" fill="var(--ink)" fontSize="11" textAnchor="middle">
            {GUIDE_BY_KIND[mk.kind].label}
          </text>
        </g>
      ))}
      <polyline
        points={line(trace.paw, yP)}
        fill="none"
        stroke="var(--trace-pressure)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <polyline
        points={line(trace.flow, yF)}
        fill="none"
        stroke="var(--trace-flow)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
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
        <ExampleChart trace={trace} />
        <figcaption className="px-1 pt-1 text-xs text-ink-3">{m.exampleCaption}</figcaption>
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
  const [kind, setKind] = useState(GUIDE[0]!.kind);

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
