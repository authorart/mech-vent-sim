"use client";

import { useEffect, useRef } from "react";
import { sweep } from "@/engine/store";
import { messages as m } from "@/i18n";

type Loop = { paw: number[]; flow: number[]; volume: number[] };
type Axis = { key: keyof Loop; label: string; unit: string };

interface Panel {
  title: string;
  x: Axis;
  y: Axis;
  color: string;
}

const PANELS: Panel[] = [
  {
    title: m.pvLoop,
    x: { key: "paw", label: "Paw", unit: "cmH₂O" },
    y: { key: "volume", label: "Volume", unit: "mL" },
    color: "--trace-volume",
  },
  {
    title: m.fvLoop,
    x: { key: "volume", label: "Volume", unit: "mL" },
    y: { key: "flow", label: "Flow", unit: "L/min" },
    color: "--trace-flow",
  },
];

const PAD = { l: 44, r: 12, t: 28, b: 30 };

function range(values: number[], symmetric: boolean): [number, number] {
  let lo = 0;
  let hi = 1;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const step = hi - lo > 200 ? 100 : 10;
  if (symmetric) {
    const r = Math.ceil(Math.max(-lo, hi) / step) * step;
    return [-r, r];
  }
  return [lo < -step / 2 ? Math.floor(lo / step) * step : 0, Math.ceil((hi * 1.1) / step) * step];
}

/** Pressure–volume and flow–volume loops: the current breath, with the last breath as a ghost. */
export function Loops() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(document.documentElement);
    const color = (v: string) => css.getPropertyValue(v).trim();
    const family = color("--font-barlow") || "system-ui, sans-serif";

    let w = 0;
    let h = 0;
    let lastVersion = -1;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastVersion = -1;
    });
    ro.observe(wrap);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (sweep.version === lastVersion) return;
      lastVersion = sweep.version;
      ctx.clearRect(0, 0, w, h);
      const panelW = w / PANELS.length;
      const loops = [sweep.previousLoop, sweep.loop].filter((l): l is Loop => !!l);

      PANELS.forEach((p, i) => {
        const left = i * panelW;
        const plotW = panelW - PAD.l - PAD.r;
        const plotH = h - PAD.t - PAD.b;
        const xs = loops.flatMap((l) => l[p.x.key]);
        const ys = loops.flatMap((l) => l[p.y.key]);
        const [x0, x1] = range(xs, false);
        const [y0, y1] = range(ys, p.y.key === "flow");
        const X = (v: number) => left + PAD.l + ((v - x0) / (x1 - x0)) * plotW;
        const Y = (v: number) => PAD.t + plotH - ((v - y0) / (y1 - y0)) * plotH;

        ctx.font = `13px ${family}`;
        ctx.fillStyle = color("--ink-2");
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.title, left + PAD.l, 18);

        ctx.strokeStyle = color("--grid");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(x0), Y(Math.max(y0, 0)));
        ctx.lineTo(X(x1), Y(Math.max(y0, 0)));
        ctx.moveTo(X(Math.max(x0, 0)), Y(y0));
        ctx.lineTo(X(Math.max(x0, 0)), Y(y1));
        ctx.stroke();

        ctx.font = `12px ${family}`;
        ctx.fillStyle = color("--ink-3");
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(String(y1), left + PAD.l - 6, Y(y1));
        ctx.fillText(String(y0), left + PAD.l - 6, Y(y0));
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(String(x0), X(x0), h - PAD.b + 6);
        ctx.fillText(String(x1), X(x1), h - PAD.b + 6);
        ctx.fillText(`${p.x.label} ${p.x.unit}`, left + PAD.l + plotW / 2, h - PAD.b + 6);
        ctx.save();
        ctx.translate(left + 12, PAD.t + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(`${p.y.label} ${p.y.unit}`, 0, -6);
        ctx.restore();

        loops.forEach((l, li) => {
          const ghost = loops.length > 1 && li === 0;
          ctx.strokeStyle = ghost ? color("--ink-3") : color(p.color);
          ctx.globalAlpha = ghost ? 0.5 : 1;
          ctx.lineWidth = 2;
          ctx.beginPath();
          l[p.x.key].forEach((xv, k) => {
            const yv = l[p.y.key][k]!;
            if (k === 0) ctx.moveTo(X(xv), Y(yv));
            else ctx.lineTo(X(xv), Y(yv));
          });
          ctx.stroke();
          ctx.globalAlpha = 1;
        });
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full min-h-[300px] w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Pressure–volume and flow–volume loops for the current and previous breath."
        className="absolute inset-0"
      />
    </div>
  );
}
