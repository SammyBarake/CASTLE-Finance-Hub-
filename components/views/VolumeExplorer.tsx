"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LineChart } from "@/components/charts/LineChart";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { Icon } from "@/components/ui/Icon";
import { FilterSearch, SectorDot, Segment, Select, StatusTag } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  EXPLORER_METRICS,
  explorerSeries,
  filterDeals,
  leaders,
  median,
  metricOf,
  monthOf,
  monthRange,
  periodKey,
  periodLabel,
  sortDeals,
  type ExplorerFilters,
  type ExplorerMetric,
  type ExplorerSort,
  type Granularity,
} from "@/lib/explorer";
import { considerationLabel, formatDate, formatMultiple, formatPct, formatUsd } from "@/lib/format";
import { SECTOR_COLORS, SECTORS } from "@/lib/sectors";
import { CONSIDERATION_OPTIONS } from "@/lib/screen";
import { DEAL_STATUSES, type Deal, type Sector } from "@/lib/types";

const PAGE = 50;

type ChartMode = "line" | "bar" | "stacked";

export interface ExplorerSeed {
  metric: "value" | "count";
  /** Months shown on the panel the explorer was opened from. */
  range: number;
  sectors: Sector[];
}

const fmtMetric = (metric: ExplorerMetric, v: number) =>
  metric === "value" || metric === "avgSize" ? `$${v}B` : metric === "count" ? `${v} deal${v === 1 ? "" : "s"}` : metric === "medianPremium" ? `${v}%` : `${v}x`;
const fmtTick = (metric: ExplorerMetric, v: number) => (metric === "value" || metric === "avgSize" ? `$${v}B` : metric === "medianPremium" ? `${v}%` : metric === "medianEvEbitda" ? `${v}x` : String(v));

export function VolumeExplorer({ seed, onClose }: { seed: ExplorerSeed; onClose: () => void }) {
  const { data, matrix } = useHubData();
  const { openDeal } = useDetails();
  const { toast } = useUi();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Every month with data, through the current (partial) month.
  const allMonths = useMemo(() => {
    const first = data.deals.reduce((m, d) => (monthOf(d.announcedDate) < m ? monthOf(d.announcedDate) : m), monthOf(data.asOf));
    return monthRange(first, monthOf(data.asOf));
  }, [data.deals, data.asOf]);
  const lastComplete = matrix.months.at(-1) ?? allMonths.at(-1)!;
  const seedFrom = matrix.months.slice(-seed.range)[0] ?? allMonths[0];

  const initial: ExplorerFilters = { from: seedFrom, to: lastComplete, sectors: seed.sectors, status: "active", consideration: "all", min: "", max: "", query: "" };
  const [filters, setFilters] = useState<ExplorerFilters>(initial);
  const [metric, setMetric] = useState<ExplorerMetric>(seed.metric);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [mode, setMode] = useState<ChartMode>("line");
  const [combined, setCombined] = useState(false);
  const [selection, setSelection] = useState<{ period: string; sector: Sector | null } | null>(null);
  const [sort, setSort] = useState<ExplorerSort>("date");
  const [shown, setShown] = useState(PAGE);
  const edit = (patch: Partial<ExplorerFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelection(null);
    setShown(PAGE);
  };

  // Full-screen behaviour: lock page scroll, Esc closes (unless a deal drawer is open on top), focus management.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const filtered = useMemo(() => filterDeals(data.deals, filters), [data.deals, filters]);
  const { keys, series } = useMemo(() => explorerSeries(filtered, filters, metric, granularity, combined), [filtered, filters, metric, granularity, combined]);
  const labels = useMemo(() => keys.map(periodLabel), [keys]);
  const chartSeries = useMemo(
    () => series.map((s) => ({ label: s.label, color: s.label === "All sectors" ? "#e6e6e6" : SECTOR_COLORS[s.label], data: s.data, hidden: false })),
    [series],
  );

  // The chart selection narrows the table and the side panels.
  const selected = useMemo(
    () => (selection ? filtered.filter((d) => periodKey(monthOf(d.announcedDate), granularity) === selection.period && (!selection.sector || d.sector === selection.sector)) : filtered),
    [filtered, selection, granularity],
  );
  const rows = useMemo(() => sortDeals(selected, sort), [selected, sort]);
  const sectorCounts = useMemo(() => {
    const all = filterDeals(data.deals, { ...filters, sectors: [...SECTORS] });
    return new Map(SECTORS.map((s) => [s, all.filter((d) => d.sector === s).length]));
  }, [data.deals, filters]);

  const values = selected.map((d) => d.valueUsd).filter((v): v is number => v != null);
  const totalValue = values.reduce((a, b) => a + b, 0);
  const topAcquirers = leaders(selected, (d) => [d.acquirer.name]);
  const topAdvisors = leaders(selected, (d) => [...d.acquirerAdvisors, ...d.targetAdvisors]);
  const largest = sortDeals(selected.filter((d) => d.valueUsd != null), "value").slice(0, 6);
  const metricDef = EXPLORER_METRICS.find((m) => m.value === metric)!;

  const toggleSector = (s: Sector) => {
    const has = filters.sectors.includes(s);
    if (has && filters.sectors.length === 1) return toast("Keep at least one sector selected.");
    edit({ sectors: has ? filters.sectors.filter((x) => x !== s) : SECTORS.filter((x) => x === s || filters.sectors.includes(x)) });
  };
  const preset = (months: number | "ytd" | "all") => {
    const to = lastComplete;
    const from = months === "all" ? allMonths[0] : months === "ytd" ? `${to.slice(0, 4)}-01` : (monthRange(allMonths[0], to).slice(-months)[0] ?? allMonths[0]);
    edit({ from, to });
  };
  const onPointClick = (index: number, seriesLabel: string | null) => {
    const period = keys[index];
    const sector = !combined && seriesLabel && (SECTORS as readonly string[]).includes(seriesLabel) ? (seriesLabel as Sector) : null;
    setSelection((cur) => (cur && cur.period === period && cur.sector === sector ? null : { period, sector }));
    setShown(PAGE);
  };
  const reset = () => {
    setFilters(initial);
    setSelection(null);
    setMetric(seed.metric);
    setGranularity("month");
    setMode("line");
    setCombined(false);
    setSort("date");
    setShown(PAGE);
  };
  const exportRows = () => {
    const csv = toCsv(
      ["Announced", "Target", "Target ticker", "Acquirer", "Sector", "Industry", "Value (USD)", "Premium (%)", "EV / EBITDA", "Consideration", "Status", "Acquirer advisors", "Target advisors"],
      rows.map((d) => [d.announcedDate, d.target.name, d.target.ticker, d.acquirer.name, d.sector, d.industry, d.valueUsd, d.premiumPct, d.evEbitda, d.consideration, d.status, d.acquirerAdvisors.join("; "), d.targetAdvisors.join("; ")]),
      data.isSample,
    );
    downloadCsv(csv, `Castle_Volume_Explorer${data.isSample ? "_Sample" : ""}.csv`);
    toast(`${rows.length} deals exported.`);
  };

  const monthOptions = allMonths.map((m) => ({ value: m, label: `${periodLabel(m)}${m > lastComplete ? " (partial)" : ""}` }));
  const selectionLabel = selection ? `${periodLabel(selection.period)}${selection.sector ? ` · ${selection.sector}` : ""}` : null;

  return createPortal(
    <div className="explorer" role="dialog" aria-modal="true" aria-labelledby="explorer-title">
      <header className="explorer-head">
        <div>
          <div className="explorer-eyebrow">Deal volume · Explorer</div>
          <h1 id="explorer-title">
            {periodLabel(filters.from)} – {periodLabel(filters.to)}
          </h1>
        </div>
        <div className="explorer-tools">
          <button type="button" className="button" onClick={reset}>
            Reset
          </button>
          <button type="button" className="button" onClick={exportRows} disabled={!rows.length}>
            <Icon name="download" />
            Export {rows.length}
          </button>
          <button ref={closeRef} type="button" className="button" onClick={onClose} aria-label="Close explorer (Esc)">
            <Icon name="close" />
            Close
          </button>
        </div>
      </header>

      <div className="explorer-body">
        <aside className="explorer-filters" aria-label="Explorer filters">
          <div className="field">
            <label>Period</label>
            <div className="explorer-presets">
              {(
                [
                  ["ytd", "YTD"],
                  [6, "6M"],
                  [12, "1Y"],
                  [24, "2Y"],
                  ["all", "All"],
                ] as const
              ).map(([v, label]) => (
                <button key={label} type="button" className="chip-button" onClick={() => preset(v)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="filter-pair">
              <Select id="ex-from" label="From month" value={filters.from} onChange={(from) => edit({ from, to: from > filters.to ? from : filters.to })} options={monthOptions} />
              <Select id="ex-to" label="To month" value={filters.to} onChange={(to) => edit({ to, from: to < filters.from ? to : filters.from })} options={monthOptions} />
            </div>
          </div>

          <div className="field">
            <label>Sectors · click a name to toggle, “only” to isolate</label>
            <div className="explorer-sectors">
              {SECTORS.map((s) => (
                <div key={s} className={`explorer-sector ${filters.sectors.includes(s) ? "on" : ""}`}>
                  <button type="button" aria-pressed={filters.sectors.includes(s)} onClick={() => toggleSector(s)}>
                    <SectorDot sector={s} />
                    {s}
                    <span className="mono">{sectorCounts.get(s)}</span>
                  </button>
                  <button type="button" className="explorer-only" onClick={() => edit({ sectors: [s] })} aria-label={`Show only ${s}`}>
                    only
                  </button>
                </div>
              ))}
              {filters.sectors.length < SECTORS.length && (
                <button type="button" className="small-link" onClick={() => edit({ sectors: [...SECTORS] })}>
                  Show all sectors
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor="ex-status">Status</label>
            <Select
              id="ex-status"
              label="Status"
              value={filters.status}
              onChange={(status) => edit({ status })}
              options={[{ value: "active", label: "Excluding terminated" }, { value: "all", label: "All statuses" }, ...DEAL_STATUSES.map((s) => ({ value: s, label: s }))]}
            />
          </div>
          <div className="field">
            <label htmlFor="ex-consideration">Consideration</label>
            <Select id="ex-consideration" label="Consideration" value={filters.consideration} onChange={(consideration) => edit({ consideration })} options={[{ value: "all", label: "Any consideration" }, ...CONSIDERATION_OPTIONS]} />
          </div>
          <div className="field">
            <label htmlFor="ex-min">Deal value · USD billions</label>
            <div className="filter-pair">
              <input id="ex-min" type="number" min="0" step=".1" placeholder="Min" aria-label="Minimum deal value in billions" value={filters.min} onChange={(e) => edit({ min: e.target.value })} />
              <input type="number" min="0" step=".1" placeholder="Max" aria-label="Maximum deal value in billions" value={filters.max} onChange={(e) => edit({ max: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ex-query">Company, ticker, industry or bank</label>
            <FilterSearch id="ex-query" label="Company, ticker, industry or bank" placeholder="e.g. Pfizer, KKR, Goldman" value={filters.query} onChange={(query) => edit({ query })} />
          </div>
          <p className="explorer-hint">Click any point on the chart to drill into that period; click the same point again to clear it. Click a buyer or bank below to filter by it.</p>
        </aside>

        <main className="explorer-main">
          <section className="explorer-kpis" aria-label="Selection summary">
            {[
              ["Deals", selected.length.toLocaleString("en-US"), selectionLabel ?? "In the filtered window"],
              ["Disclosed value", formatUsd(totalValue), `${values.length} of ${selected.length} with a value`],
              ["Median deal size", formatUsd(median(values)), "Disclosed values only"],
              ["Median premium", formatPct(metricOf(selected, "medianPremium")), "Over unaffected price"],
              ["Median EV / EBITDA", formatMultiple(metricOf(selected, "medianEvEbitda")), "Targets with LTM EBITDA"],
            ].map(([label, value, note]) => (
              <div key={label} className="explorer-kpi">
                <div className="kpi-label">{label}</div>
                <div className="explorer-kpi-value num">{value}</div>
                <div className="kpi-note">{note}</div>
              </div>
            ))}
          </section>

          <section className="panel explorer-chart-panel">
            <div className="explorer-chart-tools">
              <Segment label="Metric" value={metric} onChange={setMetric} options={EXPLORER_METRICS.map(({ value, label }) => ({ value, label }))} />
              <div className="explorer-chart-right">
                <Segment
                  label="Aggregation"
                  value={granularity}
                  onChange={(g) => (setGranularity(g), setSelection(null))}
                  options={[
                    { value: "month", label: "Monthly" },
                    { value: "quarter", label: "Quarterly" },
                  ]}
                />
                <Select
                  id="ex-mode"
                  label="Chart type"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "line", label: "Line" },
                    { value: "bar", label: "Bars" },
                    { value: "stacked", label: "Stacked bars" },
                  ]}
                />
                <label className="check-label">
                  <input type="checkbox" checked={combined} onChange={(e) => (setCombined(e.target.checked), setSelection(null))} />
                  Combine sectors
                </label>
              </div>
            </div>
            <div className="chart-meta explorer-chart-meta">
              <span className="chart-unit">{metricDef.unit}</span>
              {selectionLabel ? (
                <button type="button" className="explorer-selection" onClick={() => setSelection(null)}>
                  Showing {selectionLabel}
                  <Icon name="close" />
                </button>
              ) : (
                <span className="chart-unit">Click a point to drill in</span>
              )}
            </div>
            <LineChart
              className="chart-wrap explorer-chart"
              type={mode === "line" ? "line" : "bar"}
              stacked={mode === "stacked" && (metric === "value" || metric === "count")}
              points={keys.length <= 36}
              labels={labels}
              series={chartSeries}
              highlight={selection ? keys.indexOf(selection.period) : null}
              onPointClick={onPointClick}
              maxTicks={14}
              format={(v) => fmtMetric(metric, v)}
              formatTick={(v) => fmtTick(metric, v)}
              ariaLabel={`${metricDef.label} by ${granularity}, ${labels[0]} to ${labels.at(-1)}.`}
            />
          </section>

          <div className="explorer-leaders">
            <section className="panel">
              <div className="panel-head">
                <h2>Most active buyers</h2>
              </div>
              {topAcquirers.map((a) => (
                <button key={a.name} type="button" className="preview-row" onClick={() => edit({ query: a.name })} title={`Filter by ${a.name}`}>
                  <span className="preview-company">
                    <span>
                      <strong>{a.name}</strong>
                      <small>
                        {a.count} deal{a.count === 1 ? "" : "s"}
                      </small>
                    </span>
                  </span>
                  <span className="preview-value">{formatUsd(a.valueUsd || null)}</span>
                </button>
              ))}
              {!topAcquirers.length && <div className="empty-small">No deals in this selection.</div>}
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Most active banks</h2>
              </div>
              {topAdvisors.map((a) => (
                <button key={a.name} type="button" className="preview-row" onClick={() => edit({ query: a.name })} title={`Filter by ${a.name}`}>
                  <span className="preview-company">
                    <span>
                      <strong>{a.name}</strong>
                      <small>
                        {a.count} mandate{a.count === 1 ? "" : "s"}
                      </small>
                    </span>
                  </span>
                  <span className="preview-value">{formatUsd(a.valueUsd || null)}</span>
                </button>
              ))}
              {!topAdvisors.length && <div className="empty-small">No named advisors in this selection.</div>}
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Largest deals</h2>
              </div>
              {largest.map((d) => (
                <button key={d.id} type="button" className="preview-row" onClick={() => openDeal(d)}>
                  <span className="preview-company">
                    <span>
                      <strong>{d.target.name}</strong>
                      <small>
                        {d.acquirer.name} · {formatDate(d.announcedDate)}
                      </small>
                    </span>
                  </span>
                  <span className="preview-value">{formatUsd(d.valueUsd)}</span>
                </button>
              ))}
              {!largest.length && <div className="empty-small">No disclosed values in this selection.</div>}
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <div className="panel-heading">
                <h2>
                  {rows.length.toLocaleString("en-US")} transaction{rows.length === 1 ? "" : "s"}
                </h2>
                <small>{selectionLabel ? `${selectionLabel} · ` : ""}Click a row for the full deal, a company for its page</small>
              </div>
              <Select
                id="ex-sort"
                label="Sort deals by"
                value={sort}
                onChange={(s) => (setSort(s), setShown(PAGE))}
                options={[
                  { value: "date", label: "Newest first" },
                  { value: "value", label: "Largest value" },
                  { value: "premium", label: "Highest premium" },
                  { value: "evEbitda", label: "Highest EV/EBITDA" },
                ]}
              />
            </div>
            <div className="table-scroll">
              <table className="explorer-table">
                <caption className="sr-only">Deals in the explorer selection</caption>
                <thead>
                  <tr>
                    <th scope="col">ANNOUNCED</th>
                    <th scope="col">TARGET</th>
                    <th scope="col">ACQUIRER</th>
                    <th scope="col">SECTOR</th>
                    <th scope="col" className="right">VALUE</th>
                    <th scope="col" className="right">PREMIUM</th>
                    <th scope="col" className="right">EV / EBITDA</th>
                    <th scope="col">CONSIDERATION</th>
                    <th scope="col">STATUS</th>
                    <th scope="col">ADVISORS (TARGET · BUYER)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((d: Deal) => (
                    <RowLink key={d.id} label={`${d.acquirer.name} to acquire ${d.target.name}`} onOpen={() => openDeal(d)}>
                      <td className="table-date">{formatDate(d.announcedDate)}</td>
                      <td className="company">
                        <CompanyLink company={d.target} />
                        {d.target.ticker && <small className="dim"> {d.target.ticker}</small>}
                      </td>
                      <td className="company">
                        <CompanyLink company={d.acquirer} />
                      </td>
                      <td>
                        <span className="sector">
                          <SectorDot sector={d.sector} />
                          {d.sector}
                        </span>
                      </td>
                      <td className="right table-value">{formatUsd(d.valueUsd)}</td>
                      <td className="right mono">{formatPct(d.premiumPct)}</td>
                      <td className="right mono">{formatMultiple(d.evEbitda)}</td>
                      <td className="dim">{considerationLabel(d.consideration)}</td>
                      <td>
                        <StatusTag status={d.status} />
                      </td>
                      <td className="dim explorer-advisors">{[d.targetAdvisors.join(", ") || "—", d.acquirerAdvisors.join(", ") || "—"].join(" · ")}</td>
                    </RowLink>
                  ))}
                  {!rows.length && <EmptyRow colSpan={10}>No deals match. Widen the period or clear a filter.</EmptyRow>}
                </tbody>
              </table>
            </div>
            {rows.length > shown && (
              <div className="panel-foot">
                <span>
                  Showing {shown} of {rows.length}
                </span>
                <button type="button" className="small-link" onClick={() => setShown((n) => n + PAGE * 2)}>
                  Show {Math.min(PAGE * 2, rows.length - shown)} more
                </button>
              </div>
            )}
          </section>
          <p className="note">
            {data.isSample ? "Sample data." : "Deals Castle has detected in SEC filings for U.S.-listed targets."} Values are headline transaction values; medians skip undisclosed figures. Terminated deals are
            excluded unless you change the status filter.
          </p>
        </main>
      </div>
    </div>,
    document.body,
  );
}
