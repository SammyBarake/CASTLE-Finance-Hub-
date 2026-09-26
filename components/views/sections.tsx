"use client";

import { useMemo, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { useHubData } from "@/components/data/HubDataProvider";
import { DOWN, PageLink, SectorDot, Segment, Sparkline, UP } from "@/components/ui/primitives";
import { useUi } from "@/components/ui/UiProvider";
import { formatMonth, formatQuarter, formatSignedPct } from "@/lib/format";
import { sectorMomentum, valuationCards, type ValuationMetric, type VolumeMetric } from "@/lib/metrics";
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
        <button key={s} type="button" aria-pressed={visible.has(s)} aria-label={`Toggle ${s}`} onClick={() => onToggle(s)}>
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

const RANGES = [
  { value: 6, label: "6M" },
  { value: 12, label: "1Y" },
  { value: 24, label: "2Y" },
];

export function VolumePanel({ state, large = false }: { state: VolumeState; large?: boolean }) {
  const { matrix, data } = useHubData();
  const { visible, toggle } = useSectorToggle();
  const { metric, range } = state;

  const labels = useMemo(() => matrix.months.slice(-range).map(formatMonth), [matrix, range]);
  const series = useMemo(
    () =>
      SECTORS.map((s) => ({
        label: s,
        color: SECTOR_COLORS[s],
        data: matrix.bySector[s][metric].slice(-range).map((v) => (metric === "value" ? Math.round((v / 1e9) * 10) / 10 : v)),
        hidden: !visible.has(s),
      })),
    [matrix, metric, range, visible],
  );
  const momentum = sectorMomentum(matrix, metric);
  const months = matrix.months;
  const latest = months.at(-1);
  const prev = months.at(-2);
  const shortMonth = (m?: string) => (m ? formatMonth(m).split(" ")[0] : "");

  return (
    <section className="panel" aria-label="M&A volume">
      <div className="panel-head">
        <div className="panel-heading">
          <h2>{large ? "Monthly activity" : "M&A volume"}</h2>
          {!data.isSample && <small>Announced deals for U.S.-listed targets tracked by Castle</small>}
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
          <Segment label="Chart time range" value={range} onChange={state.setRange} options={RANGES} />
          {!large && <PageLink href="/deal-volume">Open</PageLink>}
        </div>
      </div>
      <div className="chart-layout">
        <div className="chart-main">
          <div className="chart-meta">
            <Legend visible={visible} onToggle={toggle} label="Visible sectors" />
            <span className="chart-unit">{metric === "value" ? "USD billions" : "Transactions"}</span>
          </div>
          <LineChart
            className={`chart-wrap ${large ? "large" : ""}`}
            labels={labels}
            series={series}
            format={(v) => (metric === "value" ? `$${v}B` : `${v} deals`)}
            formatTick={(v) => (metric === "value" ? `$${v}B` : String(v))}
            ariaLabel={`${metric === "value" ? "M&A value in USD billions" : "M&A deal count"}, ${labels[0]} to ${labels.at(-1)}. Visible sectors: ${[...visible].join(", ")}.`}
          />
        </div>
        <aside className="momentum" aria-label="Sector momentum">
          <div className="momentum-label">
            <span>
              {shortMonth(latest)} vs. {shortMonth(prev)}
            </span>
            <span>MoM</span>
          </div>
          {momentum.map(({ sector, changePct }) => {
            const up = changePct >= 0;
            return (
              <div key={sector} className="momentum-row">
                <div>
                  <div className="momentum-sector">
                    <SectorDot sector={sector} />
                    {sector}
                  </div>
                  <div className="momentum-state">{up ? "Heating up" : "Cooling down"}</div>
                </div>
                <span className={`momentum-change mono ${up ? "up" : "down"}`}>{formatSignedPct(changePct)}</span>
              </div>
            );
          })}
        </aside>
      </div>
      <div className="panel-foot volume-foot">
        <span>
          {labels[0]} – {labels.at(-1)}
        </span>
        <span className="secondary-note">Announced transactions · Monthly totals{data.isSample ? "" : " · SEC EDGAR"}</span>
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
  const { latestQuarter, cards } = valuationCards(data.valuations, metric);
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
                {c.latest != null ? c.latest.toFixed(1) : "—"}
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
                ? `No priced deals in ${latestQuarter ? formatQuarter(latestQuarter) : "this quarter"}`
                : delta == null
                  ? "No prior-quarter data"
                  : `vs. ${priorQuarter ? formatQuarter(priorQuarter) : "prior quarter"}`}
            </div>
            <Sparkline values={c.series} stroke={up ? UP : DOWN} label={`${c.sector}: ${m.title} over ${c.series.length} quarters`} />
          </div>
        );
      })}
    </div>
  );
}
