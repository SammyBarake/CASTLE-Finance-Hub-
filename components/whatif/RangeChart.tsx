"use client";

import { useId } from "react";
import { DOWN, UP } from "@/components/ui/primitives";
import type { Band } from "@/lib/ripple/engine";
import { useTween } from "./useTween";

const W = 340;
const H = 190;
const PAD = { left: 40, right: 24, top: 16, bottom: 28 };

const pct = (v: number) => {
  const r = Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  return r ? `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(Math.abs(r) >= 10 ? 0 : 1)}%` : "0%";
};

/**
 * One result over the quarters: the middle estimate as a line, its range as a soft band, the selected quarter marked.
 * A small SVG of its own (four points), so the shared Chart.js line chart stays untouched. Every number eases to its
 * new value when the selection or the scenario changes, so the line morphs instead of jumping.
 */
export function RangeChart({ points, quarter, label }: { points: Band[]; quarter: number; label: string }) {
  const id = useId().replace(/:/g, "");
  const t = useTween(points.flatMap((p) => [p.mid, p.low, p.high]));
  const shown = points.map((_, i) => ({ mid: t[i * 3], low: t[i * 3 + 1], high: t[i * 3 + 2] }));
  const values = shown.flatMap((p) => [p.low, p.high, p.mid]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const yMin = lo - span * 0.12;
  const yMax = hi + span * 0.12;
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(1, points.length - 1);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  // Colour follows the exact peak, not the tween, so it doesn't flicker mid-move.
  const peak = points.reduce((m, p) => (Math.abs(p.mid) > Math.abs(m) ? p.mid : m), 0);
  const color = peak < 0 ? DOWN : UP;
  const band = [...shown.map((p, i) => `${x(i)},${y(p.high)}`), ...shown.map((p, i) => `${x(i)},${y(p.low)}`).reverse()].join(" ");
  const line = shown.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.mid).toFixed(2)}`).join(" ");
  // Zero always, plus the real extremes when they sit clear of it (no padded "+1.4%" over an all-negative chart).
  const ticks = [0, hi, lo].filter((v, i, a) => a.findIndex((u) => Math.abs(y(u) - y(v)) < 14) === i);
  const step = (W - PAD.left - PAD.right) / Math.max(1, points.length - 1);

  return (
    <svg className="range-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${points.map((p, i) => `Q${i + 1} ${pct(p.mid)} (range ${pct(p.low)} to ${pct(p.high)})`).join("; ")}`}>
      <defs>
        <linearGradient id={`rc-fill-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={peak < 0 ? 0.06 : 0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={peak < 0 ? 0.26 : 0.06} />
        </linearGradient>
      </defs>
      {ticks.map((v) => (
        <g key={v === 0 ? "zero" : v === hi ? "hi" : "lo"}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className={v === 0 ? "rc-zero" : "rc-grid"} />
          <text x={PAD.left - 8} y={y(v) + 3} textAnchor="end" className="rc-tick">
            {pct(v)}
          </text>
        </g>
      ))}
      <rect className="rc-marker" x={PAD.left - 12} y={PAD.top - 6} width={24} height={H - PAD.top - PAD.bottom + 6} rx={4} style={{ transform: `translateX(${(quarter - 1) * step}px)` }} />
      <polygon points={band} fill={`url(#rc-fill-${id})`} className="rc-band" />
      <path d={line} stroke={color} className="rc-line" pathLength={1} />
      {shown.map((p, i) => (
        <g key={i} className={i === quarter - 1 ? "rc-point current" : "rc-point"}>
          <circle cx={x(i)} cy={y(p.mid)} r={i === quarter - 1 ? 4.5 : 3} fill={i === quarter - 1 ? color : "#080808"} stroke={color} />
          <text x={x(i)} y={y(p.mid) + (p.mid >= 0 ? -10 : 17)} textAnchor="middle" className="rc-value">
            {pct(p.mid)}
          </text>
          <text x={x(i)} y={H - 9} textAnchor="middle" className="rc-q">
            Q{i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}
