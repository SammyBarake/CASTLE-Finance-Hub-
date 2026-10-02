import { DOWN, UP } from "@/components/ui/primitives";
import type { Band } from "@/lib/ripple/engine";

const W = 340;
const H = 190;
const PAD = { left: 40, right: 24, top: 16, bottom: 28 };

const pct = (v: number) => (v ? `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}%` : "0%");

/**
 * One result over the quarters: the middle estimate as a line, its range shaded, the selected quarter marked.
 * A small SVG of its own (four points), so the shared Chart.js line chart stays untouched.
 */
export function RangeChart({ points, quarter, label }: { points: Band[]; quarter: number; label: string }) {
  const values = points.flatMap((p) => [p.low, p.high, p.mid]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const yMin = lo - span * 0.12;
  const yMax = hi + span * 0.12;
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(1, points.length - 1);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const peak = points.reduce((m, p) => (Math.abs(p.mid) > Math.abs(m) ? p.mid : m), 0);
  const color = peak < 0 ? DOWN : UP;
  const band = [...points.map((p, i) => `${x(i)},${y(p.high)}`), ...points.map((p, i) => `${x(i)},${y(p.low)}`).reverse()].join(" ");
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.mid)}`).join(" ");
  // Zero always, plus the real extremes when they sit clear of it (no padded "+1.4%" over an all-negative chart).
  const ticks = [0, hi, lo].filter((t, i, a) => a.findIndex((u) => Math.abs(y(u) - y(t)) < 14) === i);

  return (
    <svg className="range-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${points.map((p, i) => `Q${i + 1} ${pct(p.mid)} (range ${pct(p.low)} to ${pct(p.high)})`).join("; ")}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? "rc-zero" : "rc-grid"} />
          <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" className="rc-tick">
            {pct(t)}
          </text>
        </g>
      ))}
      <line x1={x(quarter - 1)} x2={x(quarter - 1)} y1={PAD.top - 4} y2={H - PAD.bottom} className="rc-marker" />
      <polygon points={band} fill={color} className="rc-band" />
      <path d={line} stroke={color} className="rc-line" />
      {points.map((p, i) => (
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
