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

/** Shaded band behind the selected period (explorer drill-down). */
const highlightBand: Plugin<"line" | "bar"> = {
  id: "castleHighlight",
  beforeDatasetsDraw(chart) {
    const index = (chart.options.plugins as { castleHighlight?: { index: number | null } }).castleHighlight?.index;
    if (index == null || !chart.data.labels?.length) return;
    const x = chart.scales.x;
    const step = chart.data.labels.length > 1 ? Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0)) : chart.chartArea.width;
    const center = x.getPixelForValue(index);
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.fillStyle = "#ffffff12";
    ctx.fillRect(center - step / 2, top, step, bottom - top);
    ctx.restore();
  },
};

/**
 * Multi-series line chart with the design's tooltip and crosshair.
 * `format` renders values in the tooltip; `formatTick` the y axis.
 * `onPointClick` reports the clicked period (and the series under the pointer, if any); `highlight` shades a period.
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
  stacked = false,
  highlight = null,
  onPointClick,
  maxTicks = 8,
  showTotal = false,
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
  /** Bar charts only: stack sectors on top of each other. */
  stacked?: boolean;
  highlight?: number | null;
  onPointClick?: (index: number, series: string | null) => void;
  maxTicks?: number;
  /** Add a total row to the tooltip (additive series such as deal value or count). */
  showTotal?: boolean;
}) {
  const clickRef = useRef(onPointClick);
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
    clickRef.current = onPointClick;
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
      plugins: [crosshair, highlightBand],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // First draw grows in from the baseline; later updates ease between values.
        animation: reduceMotion ? false : { duration: 750, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        onClick(event, elements, chart) {
          if (!clickRef.current || !elements.length) return;
          const near = chart.getElementsAtEventForMode(event as unknown as Event, "nearest", { intersect: true }, false)[0];
          clickRef.current(elements[0].index, near ? (chart.data.datasets[near.datasetIndex]?.label ?? null) : null);
        },
        onHover(event, elements) {
          const target = event.native?.target as HTMLElement | undefined;
          if (target) target.style.cursor = clickRef.current && elements.length ? "pointer" : "";
        },
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
    chart.options.animation = prefs.motion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? { duration: 450, easing: "easeOutCubic" } : false;
    if (chart.options.scales?.y?.grid) chart.options.scales.y.grid.display = grid;
    const scales = chart.options.scales as { x: { stacked?: boolean; ticks: { maxTicksLimit?: number } }; y: { stacked?: boolean } };
    scales.x.stacked = scales.y.stacked = type === "bar" && stacked;
    scales.x.ticks.maxTicksLimit = maxTicks;
    (chart.options.plugins as { castleHighlight?: { index: number | null } }).castleHighlight = { index: highlight };
    const style = (s: ChartSeries) =>
      type === "bar"
        ? { type: "bar" as const, borderColor: s.color, backgroundColor: `${s.color}b0`, borderWidth: 0, borderRadius: stacked ? 0 : 2, maxBarThickness: stacked ? 28 : 14 }
        : {
            type: "line" as const,
            borderColor: s.color,
            backgroundColor: s.color,
            borderWidth: 1.8,
            pointRadius: points ? 2 : 0,
            pointHoverRadius: 4,
            pointHoverBorderWidth: 2,
            pointHoverBorderColor: "#080808",
            // Monotone curves never overshoot, so lines don't dip below zero around big spikes.
            cubicInterpolationMode: "monotone" as const,
            spanGaps: true,
          };

    // Update datasets in place so Chart.js animates between values instead of redrawing every line from zero.
    const sameShape = chart.data.datasets.length === series.length && series.every((s, i) => chart.data.datasets[i]?.label === s.label);
    const labelsChanged = JSON.stringify(chart.data.labels) !== JSON.stringify(labels);
    chart.data.labels = labels;
    if (sameShape) {
      series.forEach((s, i) => {
        const ds = chart.data.datasets[i];
        Object.assign(ds, style(s));
        ds.data = s.data;
        ds.hidden = s.hidden;
      });
    } else {
      chart.data.datasets = series.map((s) => ({ label: s.label, data: s.data, hidden: s.hidden, ...style(s) }));
    }
    if (!sameShape) {
      // New datasets have no previous position, so Chart.js would fly them in from the canvas corner. Lay them out,
      // put them back on the baseline, then animate: bars grow up from zero and lines rise from the axis.
      chart.update("none");
      chart.reset();
      chart.update();
    } else {
      // A different time window is a different picture: switch without a sliding animation.
      chart.update(labelsChanged ? "none" : undefined);
    }
    setTip((t) => ({ ...t, visible: false }));
  }, [labels, series, points, type, grid, prefs.motion, stacked, highlight, maxTicks]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
      <div ref={tipRef} aria-hidden="true" className="chart-tooltip" style={{ left: tip.left, top: tip.top, opacity: tip.visible ? 1 : 0 }}>
        <div className="tooltip-title">{tip.title}</div>
        {tip.rows.map((r) => (
          <div key={r.label} className="tooltip-line">
            <span className="dot" style={{ "--color": r.color } as React.CSSProperties} />
            {r.label}
            <b>{r.value == null ? "—" : format(r.value)}</b>
          </div>
        ))}
        {showTotal && tip.rows.length > 1 && (
          <div className="tooltip-line tooltip-total">
            Total
            <b>{format(Math.round(tip.rows.reduce((a, r) => a + (r.value ?? 0), 0) * 10) / 10)}</b>
          </div>
        )}
      </div>
    </div>
  );
}
