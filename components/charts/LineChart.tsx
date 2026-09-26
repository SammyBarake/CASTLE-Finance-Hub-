"use client";

import { BarController, BarElement, CategoryScale, Chart, LinearScale, LineController, LineElement, PointElement, Tooltip, type Plugin, type TooltipModel } from "chart.js";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Tooltip);

export interface ChartSeries {
  label: string;
  color: string;
  data: (number | null)[];
  hidden: boolean;
}

interface TooltipState {
  visible: boolean;
  left: number;
  top: number;
  title: string;
  rows: { label: string; color: string; value: number | null }[];
}

const crosshair: Plugin<"line" | "bar"> = {
  id: "castleCrosshair",
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements();
    if (!active?.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.strokeStyle = "#64646488";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.restore();
  },
};

/**
 * Multi-series line chart with the design's tooltip and crosshair.
 * `format` renders values in the tooltip; `formatTick` the y axis.
 */
export function LineChart({
  labels,
  series,
  format,
  formatTick,
  ariaLabel,
  className = "chart-wrap",
  points = false,
  type = "line",
  grid = true,
}: {
  labels: string[];
  series: ChartSeries[];
  format: (v: number) => string;
  formatTick: (v: number) => string;
  ariaLabel: string;
  className?: string;
  points?: boolean;
  type?: "line" | "bar";
  grid?: boolean;
}) {
  const { prefs } = useWorkspace();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart<"line" | "bar"> | null>(null);
  const motionRef = useRef(prefs.motion);
  const fmt = useRef({ format, formatTick });
  const [tip, setTip] = useState<TooltipState>({ visible: false, left: 0, top: 0, title: "", rows: [] });

  useEffect(() => {
    fmt.current = { format, formatTick };
    motionRef.current = prefs.motion;
  });

  // Create (again only when switching between line and bar).
  useEffect(() => {
    if (!canvasRef.current) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 10;
    Chart.defaults.color = "#858585";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches || !motionRef.current;

    const external = ({ chart, tooltip }: { chart: Chart; tooltip: TooltipModel<"line" | "bar"> }) => {
      if (!tooltip.opacity) {
        setTip((t) => (t.visible ? { ...t, visible: false } : t));
        return;
      }
      const w = tipRef.current?.offsetWidth ?? 165;
      const h = tipRef.current?.offsetHeight ?? 120;
      setTip({
        visible: true,
        left: Math.max(4, Math.min(chart.width - w - 4, tooltip.caretX + 14)),
        top: Math.max(4, Math.min(chart.height - h - 4, tooltip.caretY - h / 2)),
        title: tooltip.title[0] ?? "",
        rows: tooltip.dataPoints.map((p) => ({ label: p.dataset.label ?? "", color: p.dataset.borderColor as string, value: p.raw as number | null })),
      });
    };

    chartRef.current = new Chart<"line" | "bar">(canvasRef.current, {
      type,
      data: { labels: [], datasets: [] },
      plugins: [crosshair],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 300 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 7, right: 4, left: 0, bottom: 0 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false, external } },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              font: { size: 9 },
              maxRotation: 0,
              autoSkip: true,
              autoSkipPadding: 12,
              maxTicksLimit: 8,
              padding: 9,
              callback(value) {
                return String(this.getLabelForValue(value as number)).replace(" 20", " ’");
              },
            },
          },
          y: {
            beginAtZero: true,
            grid: { color: "#242424", drawTicks: false },
            border: { display: false, dash: [2, 4] },
            ticks: { font: { size: 9 }, padding: 8, maxTicksLimit: 5, callback: (v) => fmt.current.formatTick(Number(v)) },
          },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [type]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.options.animation = prefs.motion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? { duration: 300 } : false;
    if (chart.options.scales?.y?.grid) chart.options.scales.y.grid.display = grid;
    chart.data.labels = labels;
    chart.data.datasets = series.map((s) =>
      type === "bar"
        ? { type: "bar" as const, label: s.label, data: s.data, borderColor: s.color, backgroundColor: `${s.color}b0`, borderWidth: 0, borderRadius: 2, maxBarThickness: 14, hidden: s.hidden }
        : {
            type: "line" as const,
            label: s.label,
            data: s.data,
            borderColor: s.color,
            backgroundColor: s.color,
            borderWidth: 1.8,
            pointRadius: points ? 2 : 0,
            pointHoverRadius: 4,
            pointHoverBorderWidth: 2,
            pointHoverBorderColor: "#080808",
            tension: 0.24,
            spanGaps: true,
            hidden: s.hidden,
          },
    );
    chart.update();
    setTip((t) => ({ ...t, visible: false }));
  }, [labels, series, points, type, grid, prefs.motion]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
      <div ref={tipRef} aria-hidden="true" className="chart-tooltip" style={{ left: tip.left, top: tip.top, opacity: tip.visible ? 1 : 0 }}>
        <div className="tooltip-title">{tip.title}</div>
        {tip.rows.map((r) => (
          <div key={r.label} className="tooltip-line">
            <span className="dot" style={{ "--color": r.color } as React.CSSProperties} />
            {r.label}
            <b>{r.value == null ? "n/a" : format(r.value)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
