"use client";

import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip } from "chart.js";
import { useEffect, useRef } from "react";
import { usePhone } from "@/components/ui/usePhone";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export interface BarSeries {
  label: string;
  data: (number | null)[];
  /** One colour for all bars, or one per bar. */
  color: string | string[];
}

/** Horizontal bar chart (World Economies). Values are percentages. At phone width every label is 10px. */
export function BarChart({
  labels,
  series,
  ariaLabel,
  legend = false,
  className,
}: {
  labels: string[];
  series: BarSeries[];
  ariaLabel: string;
  legend?: boolean;
  /** An extra class on the chart box (its height). */
  className?: string;
}) {
  const { prefs } = useWorkspace();
  const phone = usePhone();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"bar"> | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: {
            display: legend,
            position: "bottom",
            align: "start",
            labels: { usePointStyle: true, pointStyle: "rect", boxWidth: 6, boxHeight: 6, padding: 17, font: { size: 9 }, color: "#aeaeae" },
          },
          tooltip: {
            backgroundColor: "#151515",
            borderColor: "#444",
            borderWidth: 1,
            titleColor: "#eee",
            bodyColor: "#bbb",
            padding: 11,
            cornerRadius: 4,
            callbacks: { label: (c) => `${c.dataset.label}: ${c.raw == null ? "—" : `${(c.raw as number).toFixed(2).replace(/0$/, "")}%`}` },
          },
        },
        scales: {
          x: { beginAtZero: true, border: { display: false }, grid: { color: "#262626" }, ticks: { font: { size: 9 }, callback: (v) => `${v}%` } },
          y: { border: { display: false }, grid: { display: false }, ticks: { font: { size: 10 }, color: "#a6a6a6" } },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [legend]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.options.animation = prefs.motion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? { duration: 300 } : false;
    const small = phone ? 10 : 9;
    const scales = chart.options.scales as { x: { ticks: { font: { size: number } } } };
    const plugins = chart.options.plugins as { legend: { labels: { font: { size: number } } } };
    scales.x.ticks.font.size = plugins.legend.labels.font.size = small;
    chart.data.labels = labels;
    chart.data.datasets = series.map((s) => ({
      label: s.label,
      data: s.data,
      backgroundColor: s.color,
      borderRadius: 2,
      barThickness: series.length > 1 ? 7 : 12,
    }));
    chart.update();
  }, [labels, series, prefs.motion, phone]);

  return (
    <div className={className ? `horizontal-chart ${className}` : "horizontal-chart"}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
    </div>
  );
}
