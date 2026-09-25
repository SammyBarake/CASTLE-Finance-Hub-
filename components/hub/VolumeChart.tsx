"use client";

import {
  CategoryScale,
  Chart,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type Plugin,
  type TooltipModel,
} from "chart.js";
import { useEffect, useRef, useState } from "react";
import type { VolumeMetric } from "@/lib/metrics";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

export interface ChartSeries {
  label: string;
  color: string;
  data: number[];
  hidden: boolean;
}

interface TooltipState {
  visible: boolean;
  left: number;
  top: number;
  title: string;
  rows: { label: string; color: string; value: number }[];
}

const hoverLine: Plugin<"line"> = {
  id: "hoverLine",
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
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#6d688780";
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.restore();
  },
};

const formatTick = (metric: VolumeMetric, v: number | string) => (metric === "value" ? `$${v}B` : String(v));

/** Multi-series line chart with the design's custom tooltip and hover guide. */
export function VolumeChart({ labels, series, metric, ariaLabel }: { labels: string[]; series: ChartSeries[]; metric: VolumeMetric; ariaLabel: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart<"line"> | null>(null);
  const metricRef = useRef(metric);
  const [tip, setTip] = useState<TooltipState>({ visible: false, left: 0, top: 0, title: "", rows: [] });

  // Create once.
  useEffect(() => {
    if (!canvasRef.current) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = "#7c8396";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const external = ({ chart, tooltip }: { chart: Chart; tooltip: TooltipModel<"line"> }) => {
      if (!tooltip.opacity) {
        setTip((t) => (t.visible ? { ...t, visible: false } : t));
        return;
      }
      const el = tooltipRef.current;
      const w = el?.offsetWidth ?? 173;
      const h = el?.offsetHeight ?? 120;
      setTip({
        visible: true,
        left: Math.min(chart.width - w - 6, Math.max(6, tooltip.caretX + 15)),
        top: Math.max(3, Math.min(chart.height - h - 3, tooltip.caretY - h / 2)),
        title: tooltip.title[0] ?? "",
        rows: tooltip.dataPoints.map((p) => ({ label: p.dataset.label ?? "", color: p.dataset.borderColor as string, value: p.raw as number })),
      });
    };

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: { labels: [], datasets: [] },
      plugins: [hoverLine],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 350 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 5, right: 4, bottom: 0, left: 0 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false, external } },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              font: { size: 9 },
              color: "#737a8e",
              autoSkip: true,
              autoSkipPadding: 12,
              maxTicksLimit: 8,
              maxRotation: 0,
              padding: 9,
              callback(value) {
                return String(this.getLabelForValue(value as number)).replace(" 20", " ’");
              },
            },
          },
          y: {
            beginAtZero: true,
            grid: { color: "#242731", drawTicks: false },
            border: { display: false, dash: [3, 4] },
            ticks: { font: { size: 9 }, padding: 9, maxTicksLimit: 5, callback: (v) => formatTick(metricRef.current, v) },
          },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  // Update on data change.
  useEffect(() => {
    metricRef.current = metric;
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets = series.map((s) => ({
      label: s.label,
      data: s.data,
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: 1.9,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: s.color,
      pointHoverBorderColor: "#111318",
      pointHoverBorderWidth: 2,
      tension: 0.28,
      hidden: s.hidden,
    }));
    chart.update();
    setTip((t) => ({ ...t, visible: false }));
  }, [labels, series, metric]);

  return (
    <div className="relative h-[244px] w-full wide:h-[280px] max-tablet:h-[250px] max-phone:h-[220px]">
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} className="!h-full !w-full" />
      <div
        ref={tooltipRef}
        aria-hidden="true"
        className="pointer-events-none absolute z-10 min-w-[173px] rounded-md border border-[#444151] bg-[#1b1d27] px-[13px] py-[11px] text-[10px] shadow-[0_10px_35px_#0006] transition-opacity duration-[120ms] max-phone:min-w-[150px] max-phone:text-[9px]"
        style={{ left: tip.left, top: tip.top, opacity: tip.visible ? 1 : 0 }}
      >
        <div className="mb-2 text-[10px] font-semibold text-[#e9e8f2]">{tip.title}</div>
        {tip.rows.map((r) => (
          <div key={r.label} className="my-1 flex items-center gap-1.5 text-[#a5a9b9]">
            <span className="inline-block size-[5px] rounded-full" style={{ background: r.color }} />
            {r.label}
            <b className="ml-auto pl-[18px] font-mono font-medium text-[#e8e9f0] max-phone:pl-2.5">
              {metric === "value" ? `$${r.value}B` : `${r.value} deals`}
            </b>
          </div>
        ))}
      </div>
    </div>
  );
}
