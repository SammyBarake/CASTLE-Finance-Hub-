"use client";

import { useCallback, useMemo, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Icon } from "@/components/ui/Icon";
import { VolumeExplorer } from "./VolumeExplorer";
import { useHubData } from "@/components/data/HubDataProvider";
import { DOWN, PageLink, SectorDot, Segment, Sparkline, UP } from "@/components/ui/primitives";
import { useUi } from "@/components/ui/UiProvider";
import { formatMonth, formatQuarter, formatSignedPct } from "@/lib/format";
import { completeMonths, sectorMomentum, valuationCards, type ValuationMetric, type VolumeMetric } from "@/lib/metrics";
import { SECTOR_COLORS, SECTORS } from "@/lib/sectors";
import type { Sector } from "@/lib/types";

// ---------------------------------------------------------------------------
// Shared "keep at least one sector visible" toggle
// ---------------------------------------------------------------------------

export function useSectorToggle() {
  const { toast } = useUi();
  const [visible, setVisible] = useState<Set<Sector>>(() => new Set(SECTORS));
  const toggle = (s: Sector) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        if (next.size === 1) {
          toast("Keep at least one sector visible.");
          return prev;
        }
        next.delete(s);
      } else next.add(s);
      return next;
    });
  return { visible, toggle };
}

export function Legend({ visible, onToggle, label }: { visible: Set<Sector>; onToggle: (s: Sector) => void; label: string }) {
  return (
    <div className="legend" role="group" aria-label={label}>
      {SECTORS.map((s) => (
        <button key={s} type="button" aria-pressed={visible.has(s)} onClick={() => onToggle(s)}>
          <SectorDot sector={s} />
          {s}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// M&A volume panel (hub + deal volume page)
// ---------------------------------------------------------------------------

export interface VolumeState {
  metric: VolumeMetric;
  setMetric: (m: VolumeMetric) => void;
  range: number;
  setRange: (r: number) => void;
}

export function useVolumeState(): VolumeState {
  const [metric, setMetric] = useState<VolumeMetric>("value");
  const [range, setRange] = useState(24);
  return { metric, setMetric, range, setRange };
}

const ALL_RANGES = [
  { value: 6, label: "6M" },
  { value: 12, label: "1Y" },
  { value: 24, label: "2Y" },
  { value: 36, label: "3Y" },
  { value: 60, label: "5Y" },
];
/** Ranges the data actually covers (3Y / 5Y appear once the history is that long). */
export const rangesFor = (months: number) => ALL_RANGES.filter((r) => r.value <= Math.max(24, months));

/** Group the last `range` months into calendar quarters; a quarter with fewer than 3 months is marked "*". */
/** Chart periods. The month in progress (`partial`) is starred, like a quarter that isn't complete. */
function periodGroups(months: string[], granularity: "month" | "quarter", partial: string | null = null) {
  if (granularity === "month") return months.map((m, i) => ({ label: m === partial ? `${formatMonth(m)}*` : formatMonth(m), idx: [i] }));
  const groups = new Map<string, number[]>();
  months.forEach((m, i) => {
    const key = `Q${Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1} ${m.slice(0, 4)}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  return [...groups].map(([label, idx]) => ({ label: idx.length < 3 || idx.some((i) => months[i] === partial) ? `${label}*` : label, idx }));
}

type ChartStyle = "stacked" | "bars" | "lines";

export function VolumePanel({ state, large = false }: { state: VolumeState; large?: boolean }) {
  const { matrix, data } = useHubData();
  const { openMenu } = useUi();
  const { visible, toggle } = useSectorToggle();
  const { metric, range } = state;
  const [chartStyle, setChartStyle] = useState<ChartStyle>("stacked");
  const [granularity, setGranularity] = useState<"month" | "quarter">("month");
  const [grid, setGrid] = useState(true);
  const [exploring, setExploring] = useState(false);
  const closeExplorer = useCallback(() => setExploring(false), []);
  const tick = (on: boolean) => (on ? "✓" : "  ");
  const openOptions = (anchor: HTMLElement) =>
    openMenu(
      [
        { kind: "title", label: "Chart" },
        { kind: "action", label: `${tick(chartStyle === "stacked")} Stacked bars`, onSelect: () => setChartStyle("stacked") },
        { kind: "action", label: `${tick(chartStyle === "bars")} Side-by-side bars`, onSelect: () => setChartStyle("bars") },
        { kind: "action", label: `${tick(chartStyle === "lines")} Lines`, onSelect: () => setChartStyle("lines") },
        { kind: "rule" },
        { kind: "title", label: "Period" },
        { kind: "action", label: `${tick(granularity === "month")} Monthly`, onSelect: () => setGranularity("month") },
        { kind: "action", label: `${tick(granularity === "quarter")} Quarterly`, onSelect: () => setGranularity("quarter") },
        { kind: "rule" },
        { kind: "check", label: "Gridlines", checked: grid, onToggle: setGrid },
      ],
      { anchor },
    );

  const months = matrix.months.slice(-range);
  const groups = useMemo(() => periodGroups(matrix.months.slice(-range), granularity, matrix.partial), [matrix, range, granularity]);
  // The period holding the month in progress: drawn lighter, its tooltip says "to date".
  const partialIndex = matrix.partial && months.includes(matrix.partial) ? groups.findIndex((g) => g.idx.includes(months.indexOf(matrix.partial!))) : -1;
  const labels = useMemo(() => groups.map((g) => g.label), [groups]);
  const series = useMemo(
    () =>
      SECTORS.map((s) => {
        const values = matrix.bySector[s][metric].slice(-range);
        return {
          label: s,
          color: SECTOR_COLORS[s],
          data: groups.map((g) => {
            const v = g.idx.reduce((a, i) => a + values[i], 0);
            return metric === "value" ? Math.round((v / 1e9) * 10) / 10 : v;
          }),
          hidden: !visible.has(s),
        };
      }),
    [matrix, metric, range, visible, groups],
  );
  const momentum = new Map(sectorMomentum(matrix, metric).map((m) => [m.sector, m.changePct]));
  // The scoreboard compares the last two complete months.
  const latest = matrix.months[completeMonths(matrix) - 1];
  const prev = matrix.months[completeMonths(matrix) - 2];
  const periodLabel = months.length ? `${formatMonth(months[0])} – ${formatMonth(months.at(-1)!)}` : "";
  const shortMonth = (m?: string) => (m ? formatMonth(m).split(" ")[0] : "");

  return (
    <section className="panel" aria-label="M&A volume">
      <div className="panel-head">
        <div className="panel-heading">
          <h2>{large ? "Monthly activity" : "M&A volume"}</h2>
          <small>Announced U.S. M&A by target sector · {periodLabel}</small>
        </div>
        <div className="panel-controls">
          <Segment
            label="Chart metric"
            value={metric}
            onChange={state.setMetric}
            options={[
              { value: "value", label: "$ Value" },
              { value: "count", label: "Deal count" },
            ]}
          />
          <Segment label="Chart time range" value={range} onChange={state.setRange} options={rangesFor(matrix.months.length)} />
          <button type="button" className="tool-icon" aria-label="Chart options" title="Chart options" onClick={(e) => openOptions(e.currentTarget)}>
            <Icon name="settings" />
          </button>
          <button type="button" className="button explorer-open" onClick={() => setExploring(true)} title="Open the full-screen explorer">
            <Icon name="expand" />
            Expand
          </button>
          {!large && <PageLink href="/deal-volume">Open</PageLink>}
        </div>
      </div>
      {exploring && <VolumeExplorer seed={{ metric, range, sectors: SECTORS.filter((s) => visible.has(s)) }} onClose={closeExplorer} />}
      <div className="chart-main">
        <div className="chart-meta">
          {/* Legend doubles as the month-on-month scoreboard: click a sector to hide or show it. */}
          <div className="legend" role="group" aria-label="Visible sectors">
            {SECTORS.map((s) => {
              const change = momentum.get(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={visible.has(s)}
                  title={change == null ? s : `${s}: ${formatSignedPct(change)} in ${shortMonth(latest)} vs. ${shortMonth(prev)}`}
                  onClick={() => toggle(s)}
                >
                  <SectorDot sector={s} />
                  {s}
                  {change != null && <span className={`legend-change mono ${change >= 0 ? "up" : "down"}`}>{formatSignedPct(change)}</span>}
                </button>
              );
            })}
          </div>
          <span className="chart-unit">
            {metric === "value" ? "USD billions" : "Transactions"} · change {shortMonth(latest)} vs. {shortMonth(prev)}
          </span>
        </div>
        <LineChart
          className={`chart-wrap ${large ? "large" : ""}`}
          type={chartStyle === "lines" ? "line" : "bar"}
          stacked={chartStyle === "stacked"}
          grid={grid}
          labels={labels}
          series={series}
          partialIndex={partialIndex >= 0 ? partialIndex : null}
          showTotal
          format={(v) => (metric === "value" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}B` : `${v} deals`)}
          formatTick={(v) => (metric === "value" ? `$${v}B` : String(v))}
          ariaLabel={`${metric === "value" ? "M&A value in USD billions" : "M&A deal count"}, ${labels[0]} to ${labels.at(-1)}. Visible sectors: ${[...visible].join(", ")}.`}
        />
      </div>
      <div className="panel-foot volume-foot">
        <span>
          {granularity === "month" ? "Monthly" : "Quarterly"} totals
          {granularity === "quarter" && labels.some((l) => l.endsWith("*")) ? " · * Partial quarter" : ""}
          {granularity === "month" && partialIndex >= 0 ? ` · * ${formatMonth(matrix.partial!).split(" ")[0]} to date` : ""}
        </span>
        <span className="secondary-note">
          U.S.-listed targets and private companies bought by listed acquirers{data.isSample ? "" : " · SEC EDGAR"}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Valuation cards (hub + valuations page)
// ---------------------------------------------------------------------------

export const VALUATION_METRICS: Record<ValuationMetric, { tab: string; title: string; unit: string; deltaUnit: string }> = {
  evEbitda: { tab: "EV/EBITDA", title: "Median EV / EBITDA", unit: "x", deltaUnit: "x" },
  evRevenue: { tab: "EV/Revenue", title: "Median EV / Revenue", unit: "x", deltaUnit: "x" },
  premium: { tab: "Premium", title: "Median premium paid", unit: "%", deltaUnit: " pts" },
};

export function ValuationMetricToggle({ value, onChange }: { value: ValuationMetric; onChange: (m: ValuationMetric) => void }) {
  return (
    <Segment
      label="Valuation metric"
      value={value}
      onChange={onChange}
      options={(Object.keys(VALUATION_METRICS) as ValuationMetric[]).map((k) => ({ value: k, label: VALUATION_METRICS[k].tab }))}
    />
  );
}

export function ValuationCards({ metric, expanded = false }: { metric: ValuationMetric; expanded?: boolean }) {
  const { data } = useHubData();
  const m = VALUATION_METRICS[metric];
  const { cards } = valuationCards(data.valuations, metric);
  const quarters = [...new Set(data.valuations.map((v) => v.quarter))].sort();
  const priorQuarter = quarters.at(-2);

  return (
    <div className={`valuation-grid ${expanded ? "expanded" : ""}`}>
      {cards.map((c) => {
        const delta = c.latest != null && c.previous != null ? c.latest - c.previous : null;
        const up = (delta ?? 0) >= 0;
        return (
          <div key={c.sector} className="valuation-card">
            <div className="valuation-sector">
              <SectorDot sector={c.sector} />
              {c.sector}
            </div>
            <div>
              <span className="valuation-number num">
                {c.latest != null ? <AnimatedNumber text={c.latest.toFixed(1)} /> : "—"}
                {c.latest != null && <span>{m.unit}</span>}
              </span>
              {delta != null && (
                <span className={`valuation-delta ${up ? "up" : "down"}`}>
                  {up ? "+" : ""}
                  {delta.toFixed(1)}
                  {m.deltaUnit}
                </span>
              )}
            </div>
            <div className="valuation-label">
              {c.latest == null
                ? "Too few priced deals (LTM)"
                : delta == null
                  ? "LTM · no prior-quarter figure"
                  : `LTM · vs. ${priorQuarter ? formatQuarter(priorQuarter) : "prior quarter"}`}
            </div>
            <Sparkline values={c.series} stroke={up ? UP : DOWN} label={`${c.sector}: ${m.title} over ${c.series.length} quarters`} />
          </div>
        );
      })}
    </div>
  );
}
