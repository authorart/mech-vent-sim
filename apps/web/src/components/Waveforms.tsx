"use client";

import { useEffect, useRef, useState } from "react";
import { num } from "@/engine/format";
import { SWEEP_SECONDS } from "@/engine/ring";
import { asynchronyMarks, sweep, useStore } from "@/engine/store";
import { GUIDE_BY_KIND } from "@/guide/asynchrony";
import { messages as m } from "@/i18n";

type Channel = "paw" | "flow" | "volume";

interface Row {
  channel: Channel;
  label: string;
  unit: string;
  color: string;
  decimals: number;
  /** Picks the y-range from the data's extent, using fixed steps so the scale doesn't jitter. */
  range: (lo: number, hi: number) => [number, number];
}

const nice = (v: number, steps: number[]) => steps.find((s) => s >= v) ?? steps.at(-1)!;

const ROWS: Row[] = [
  {
    channel: "paw",
    label: m.trace.pressure,
    unit: "cmH₂O",
    color: "--trace-pressure",
    decimals: 0,
    range: (lo, hi) => [
      lo < -2 ? Math.floor(lo / 5) * 5 : 0,
      nice(hi + 2, [20, 30, 40, 50, 60, 80]),
    ],
  },
  {
    channel: "flow",
    label: m.trace.flow,
    unit: "L/min",
    color: "--trace-flow",
    decimals: 0,
    range: (lo, hi) => {
      const r = nice(Math.max(Math.abs(lo), Math.abs(hi)) * 1.1, [30, 60, 90, 120, 180, 240]);
      return [-r, r];
    },
  },
  {
    channel: "volume",
    label: m.trace.volume,
    unit: "mL",
    color: "--trace-volume",
    decimals: 0,
    range: (lo, hi) => [
      lo < -50 ? Math.floor(lo / 100) * 100 : 0,
      nice(hi * 1.1, [300, 500, 800, 1000, 1500, 2000]),
    ],
  },
];

const AXIS_W = 44;
const ROW_GAP = 10;

function extent(a: Float32Array): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of a) {
    if (Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}

/** Three stacked sweep traces, drawn like a bedside monitor. */
export function Waveforms({ frozen }: { frozen: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [readout, setReadout] = useState<{
    t: number;
    paw: number;
    flow: number;
    volume: number;
  } | null>(null);
  const [width, setWidth] = useState(0);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    sweep.frozen = frozen;
  }, [frozen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const color = (v: string) => css.getPropertyValue(v).trim();
    const colors = {
      grid: color("--grid"),
      ink2: color("--ink-2"),
      ink3: color("--ink-3"),
      cursor: color("--ink"),
      panel: color("--panel"),
    };
    const family = color("--font-barlow") || "system-ui, sans-serif";

    let w = 0;
    let h = 0;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      w = r.width;
      h = r.height;
      setWidth(w);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastVersion = -1;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let lastVersion = -1;
    let lastCursor: { x: number; y: number } | null = null;
    let lastLabels = false;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cur = cursorRef.current;
      const labels = useStore.getState().showLabels;
      if (sweep.version === lastVersion && cur === lastCursor && labels === lastLabels) return;
      lastVersion = sweep.version;
      lastCursor = cur;
      lastLabels = labels;

      ctx.clearRect(0, 0, w, h);
      const rowH = (h - ROW_GAP * (ROWS.length - 1)) / ROWS.length;
      const plotW = w - AXIS_W;
      const n = sweep.size;
      const xAt = (i: number) => AXIS_W + (i / (n - 1)) * plotW;

      ctx.font = `12px ${family}`;
      ctx.textBaseline = "middle";

      ROWS.forEach((row, r) => {
        const top = r * (rowH + ROW_GAP);
        const data = sweep[row.channel];
        const [lo, hi] = row.range(...extent(data));
        const yAt = (v: number) => top + rowH - ((v - lo) / (hi - lo)) * rowH;

        // Recessive grid: zero line plus top and bottom ticks.
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(AXIS_W, Math.round(yAt(0)) + 0.5);
        ctx.lineTo(w, Math.round(yAt(0)) + 0.5);
        ctx.stroke();

        ctx.fillStyle = colors.ink3;
        ctx.textAlign = "right";
        ctx.fillText(String(hi), AXIS_W - 8, top + 7);
        ctx.fillText(String(lo), AXIS_W - 8, top + rowH - 7);
        if (lo < 0) ctx.fillText("0", AXIS_W - 8, yAt(0));

        // Row name in text ink, with a short swatch carrying the trace color.
        ctx.textAlign = "left";
        ctx.fillStyle = color(row.color);
        ctx.fillRect(AXIS_W + 8, top + 6, 12, 2);
        ctx.fillStyle = colors.ink2;
        ctx.fillText(`${row.label}  ${row.unit}`, AXIS_W + 26, top + 8);

        // The trace: one polyline per contiguous run (the erase bar breaks it).
        ctx.strokeStyle = color(row.color);
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < n; i++) {
          const v = data[i]!;
          if (Number.isNaN(v)) {
            pen = false;
            continue;
          }
          const x = xAt(i);
          const y = yAt(v);
          if (pen) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          pen = true;
        }
        ctx.stroke();
      });

      // Asynchrony labels (instructor's choice): a tick on the flow trace and a short name.
      if (labels) {
        const flowTop = rowH + ROW_GAP;
        ctx.font = `11px ${family}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        let lastX = -Infinity;
        for (const mark of asynchronyMarks) {
          const i = Math.round(mark.t * 100) % n;
          const ts = sweep.t[i];
          // Only while that stretch of trace is still on screen.
          if (ts === undefined || !Number.isFinite(ts) || Math.abs(ts - mark.t) > 0.02) continue;
          const x = xAt(i);
          ctx.strokeStyle = colors.ink2;
          ctx.globalAlpha = 0.7;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, flowTop + 18);
          ctx.lineTo(Math.round(x) + 0.5, flowTop + rowH);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          const text = GUIDE_BY_KIND[mark.kind].label;
          const tw = ctx.measureText(text).width + 8;
          const y = flowTop + 18 + (x - lastX < tw ? 15 : 0);
          ctx.fillStyle = colors.panel;
          ctx.fillRect(x - tw / 2, y, tw, 15);
          ctx.fillStyle = colors.cursor;
          ctx.fillText(text, x, y + 2);
          lastX = x;
        }
        ctx.font = `12px ${family}`;
        ctx.textBaseline = "middle";
      }

      if (cur && cur.x >= AXIS_W) {
        const i = Math.min(n - 1, Math.max(0, Math.round(((cur.x - AXIS_W) / plotW) * (n - 1))));
        const x = xAt(i);
        ctx.strokeStyle = colors.cursor;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, h);
        ctx.stroke();
        ctx.globalAlpha = 1;
        const t = sweep.t[i];
        setReadout(
          t === undefined || !Number.isFinite(t)
            ? null
            : { t, paw: sweep.paw[i]!, flow: sweep.flow[i]!, volume: sweep.volume[i]! },
        );
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-[300px] w-full touch-pan-y select-none sm:min-h-[360px]"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onPointerLeave={() => {
        setCursor(null);
        setReadout(null);
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Airway pressure, flow and volume over the last ${SWEEP_SECONDS} seconds. Values are listed in the numbers panel.`}
        className="absolute inset-0"
      />
      {cursor && readout && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-edge bg-panel/95 px-3 py-2 text-sm shadow-lg"
          style={{
            left: Math.min(cursor.x + 14, width - 170),
            top: Math.max(4, cursor.y - 40),
          }}
        >
          <div className="mb-1 text-xs text-ink-3 tabular">t = {num(readout.t, 2)} s</div>
          {ROWS.map((row) => (
            <div key={row.channel} className="flex items-center gap-2 tabular">
              <span className="h-0.5 w-3" style={{ background: `var(${row.color})` }} />
              <span className="w-14 text-ink-2">{row.label}</span>
              <span className="font-readout text-base text-ink">
                {num(readout[row.channel], row.decimals)}
              </span>
              <span className="text-xs text-ink-3">{row.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
