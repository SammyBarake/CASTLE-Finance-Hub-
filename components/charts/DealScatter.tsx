"use client";

import { Chart, LinearScale, LogarithmicScale, PointElement, ScatterController, Tooltip, type Plugin, type TooltipModel } from "chart.js";
import { useEffect, useRef, useState } from "react";
import { usePhone } from "@/components/ui/usePhone";
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

const radius = (usd: number, phone = false) => Math.min(phone ? 10 : 18, 3 + Math.sqrt(usd / 1e9) * 1.6);
/** Desktop value ticks: 1, 2 and 5 of each power of ten. */
const valueTick = (n: number) => {
  const lead = n / 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5].includes(Math.round(lead)) ? formatUsd(n) : "";
};
/** Phone value ticks: powers of ten only, written short ($1M … $100B), so they don't run into each other. */
const phoneValueTick = (n: number) => {
  const exp = Math.log10(n);
  if (Math.abs(exp - Math.round(exp)) > 1e-9) return "";
  return n >= 1e9 ? `$${Math.round(n / 1e9)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${Math.round(n / 1e3)}K`;
};
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
  const phone = usePhone();
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
        // Touch: only a tap shows a deal's tooltip, never a finger scrolling past.
        ...(window.matchMedia("(pointer: coarse)").matches ? { events: ["click" as const] } : {}),
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
            ticks: { font: { size: 9 }, callback: (v) => valueTick(Number(v)) },
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
    // On a phone: 10px ticks, short value ticks, smaller and lighter dots, no name labels, and the date axis running
    // from the first deal's month to the last's, not to round steps either side. Desktop keeps its own drawing.
    type Axis = { min?: number; max?: number; ticks: { font: { size: number }; callback: (v: string | number) => string } };
    const scales = chart.options.scales as unknown as { x: Axis; y: Axis };
    scales.x.ticks.font.size = scales.y.ticks.font.size = phone ? 10 : 9;
    scales.y.ticks.callback = (v) => (phone ? phoneValueTick : valueTick)(Number(v));
    const dates = plotted.map((d) => d.announcedDate).sort();
    const monthStart = (iso: string, plus = 0) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + plus, 1);
    scales.x.min = phone && dates.length ? monthStart(dates[0]) : undefined;
    scales.x.max = phone && dates.length ? monthStart(dates.at(-1)!, 1) : undefined;
    chart.data.datasets = [...bySector].map(([sector, points]) => {
      const color = SECTOR_COLORS[sector as keyof typeof SECTOR_COLORS];
      return {
        label: sector,
        data: points,
        pointRadius: points.map((p) => radius(p.y, phone)),
        pointHoverRadius: points.map((p) => radius(p.y, phone) + 2),
        // Lighter fills on a phone, where several hundred dots share a 300px plot.
        pointBackgroundColor: points.map((p) => (focus(p) ? `${color}${phone ? "55" : "99"}` : `${color}22`)),
        pointBorderColor: points.map((p) => (focus(p) ? color : `${color}44`)),
        pointBorderWidth: 1,
      };
    });
    // Label the ten largest (in the focused month, if any).
    const ids = new Set(phone ? [] : sortByValue(plotted.filter((d) => !focusMonth || d.announcedDate.startsWith(focusMonth))).slice(0, 10).map((d) => d.id));
    (chart.options.plugins as { castleNames?: { ids: Set<string> } }).castleNames = { ids };
    chart.update();
    setTip((t) => ({ ...t, visible: false }));
  }, [deals, focusMonth, phone]);

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
