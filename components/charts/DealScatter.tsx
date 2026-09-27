"use client";

import { Chart, LinearScale, LogarithmicScale, PointElement, ScatterController, Tooltip, type Plugin, type TooltipModel } from "chart.js";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatPct, formatUsd } from "@/lib/format";
import { SECTOR_COLORS } from "@/lib/sectors";
import type { Deal } from "@/lib/types";

Chart.register(ScatterController, PointElement, LinearScale, LogarithmicScale, Tooltip);

interface Point {
  x: number;
  y: number;
  deal: Deal;
}

/** Name labels next to the largest deals, so the biggest companies can be read straight off the chart. */
const nameLabels: Plugin<"scatter"> = {
  id: "castleNames",
  afterDatasetsDraw(chart) {
    const opts = (chart.options.plugins as { castleNames?: { ids: Set<string> } }).castleNames;
    if (!opts?.ids.size) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = "10px " + (Chart.defaults.font.family ?? "sans-serif");
    ctx.textBaseline = "middle";
    const placed: { x: number; y: number; w: number }[] = [];
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      (ds.data as unknown as Point[]).forEach((p, i) => {
        if (!opts.ids.has(p.deal.id)) return;
        const el = meta.data[i] as unknown as { x: number; y: number; options: { radius: number } };
        const text = p.deal.target.name.replace(/,? (Inc|Corp|Corporation|Holdings|Ltd|plc|Co)\.?$/i, "");
        const w = ctx.measureText(text).width;
        const x = el.x + el.options.radius + 4;
        const y = el.y;
        // Skip labels that would overlap one already drawn or run off the chart.
        if (x + w > chart.chartArea.right || placed.some((q) => Math.abs(q.y - y) < 12 && x < q.x + q.w && q.x < x + w)) return;
        placed.push({ x, y, w });
        ctx.fillStyle = "#d8d8d8";
        ctx.fillText(text, x, y);
      });
    });
    ctx.restore();
  },
};

const radius = (usd: number) => Math.min(18, 3 + Math.sqrt(usd / 1e9) * 1.6);
const monthTick = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " ’");

/**
 * Every deal as a dot: announcement date across, deal value up (log scale), sized by value and
 * coloured by sector. Hover for the deal, click to open it.
 */
export function DealScatter({ deals, onOpen, focusMonth, className = "chart-wrap" }: { deals: Deal[]; onOpen: (d: Deal) => void; focusMonth?: string | null; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart<"scatter", Point[]> | null>(null);
  const openRef = useRef(onOpen);
  const [tip, setTip] = useState<{ visible: boolean; left: number; top: number; deal: Deal | null }>({ visible: false, left: 0, top: 0, deal: null });

  useEffect(() => {
    openRef.current = onOpen;
  });

  useEffect(() => {
    if (!canvasRef.current) return;
    const external = ({ chart, tooltip }: { chart: Chart; tooltip: TooltipModel<"scatter"> }) => {
      if (!tooltip.opacity || !tooltip.dataPoints?.length) {
        setTip((t) => (t.visible ? { ...t, visible: false } : t));
        return;
      }
      const w = tipRef.current?.offsetWidth ?? 220;
      const h = tipRef.current?.offsetHeight ?? 100;
      setTip({
        visible: true,
        left: Math.max(4, Math.min(chart.width - w - 4, tooltip.caretX + 14)),
        top: Math.max(4, Math.min(chart.height - h - 4, tooltip.caretY - h / 2)),
        deal: (tooltip.dataPoints[0].raw as Point).deal,
      });
    };
    chartRef.current = new Chart<"scatter", Point[]>(canvasRef.current, {
      type: "scatter",
      data: { datasets: [] },
      plugins: [nameLabels],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: "nearest", intersect: true },
        plugins: { legend: { display: false }, tooltip: { enabled: false, external } },
        onClick(_e, elements, chart) {
          const el = elements[0];
          if (el) openRef.current((chart.data.datasets[el.datasetIndex].data[el.index] as unknown as Point).deal);
        },
        onHover(event, elements) {
          const target = event.native?.target as HTMLElement | undefined;
          if (target) target.style.cursor = elements.length ? "pointer" : "";
        },
        scales: {
          x: {
            type: "linear",
            grid: { color: "#1c1c1c" },
            border: { display: false },
            ticks: { font: { size: 9 }, maxTicksLimit: 10, callback: (v) => monthTick(Number(v)) },
          },
          y: {
            type: "logarithmic",
            grid: { color: "#242424" },
            border: { display: false },
            ticks: {
              font: { size: 9 },
              callback: (v) => {
                const n = Number(v);
                const lead = n / 10 ** Math.floor(Math.log10(n));
                return [1, 2, 5].includes(Math.round(lead)) ? formatUsd(n) : "";
              },
            },
          },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const plotted = deals.filter((d) => d.valueUsd != null && d.valueUsd > 0);
    const bySector = new Map<string, Point[]>();
    for (const d of plotted) bySector.set(d.sector, [...(bySector.get(d.sector) ?? []), { x: Date.parse(`${d.announcedDate}T12:00:00Z`), y: d.valueUsd!, deal: d }]);
    const focus = (p: Point) => !focusMonth || p.deal.announcedDate.startsWith(focusMonth);
    chart.data.datasets = [...bySector].map(([sector, points]) => {
      const color = SECTOR_COLORS[sector as keyof typeof SECTOR_COLORS];
      return {
        label: sector,
        data: points,
        pointRadius: points.map((p) => radius(p.y)),
        pointHoverRadius: points.map((p) => radius(p.y) + 2),
        pointBackgroundColor: points.map((p) => (focus(p) ? `${color}99` : `${color}22`)),
        pointBorderColor: points.map((p) => (focus(p) ? color : `${color}44`)),
        pointBorderWidth: 1,
      };
    });
    // Label the ten largest (in the focused month, if any).
    const ids = new Set(sortByValue(plotted.filter((d) => !focusMonth || d.announcedDate.startsWith(focusMonth))).slice(0, 10).map((d) => d.id));
    (chart.options.plugins as { castleNames?: { ids: Set<string> } }).castleNames = { ids };
    chart.update();
    setTip((t) => ({ ...t, visible: false }));
  }, [deals, focusMonth]);

  const d = tip.deal;
  return (
    <div className={className}>
      <canvas ref={canvasRef} role="img" aria-label="Every deal plotted by announcement date and value. Hover a dot for details." />
      <div ref={tipRef} aria-hidden="true" className="chart-tooltip scatter-tooltip" style={{ left: tip.left, top: tip.top, opacity: tip.visible ? 1 : 0 }}>
        {d && (
          <>
            <div className="tooltip-title">{d.target.name}</div>
            <div className="scatter-tip-line">bought by {d.acquirer.name}</div>
            <div className="tooltip-line">
              Value<b>{formatUsd(d.valueUsd)}</b>
            </div>
            <div className="tooltip-line">
              Premium<b>{formatPct(d.premiumPct)}</b>
            </div>
            <div className="tooltip-line">
              Announced<b>{formatDate(d.announcedDate)}</b>
            </div>
            <div className="scatter-tip-hint">Click for the full deal</div>
          </>
        )}
      </div>
    </div>
  );
}

const sortByValue = (deals: Deal[]) => [...deals].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
