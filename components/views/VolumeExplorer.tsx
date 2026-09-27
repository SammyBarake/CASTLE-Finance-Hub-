"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DealScatter } from "@/components/charts/DealScatter";
import { LineChart } from "@/components/charts/LineChart";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { Icon } from "@/components/ui/Icon";
import { SectorDot, Segment, Select, StatusTag } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { insights, monthOf, periodLabel, selectionStats, sortDeals, type ExplorerSort } from "@/lib/explorer";
import { formatDate, formatPct, formatUsd } from "@/lib/format";
import type { VolumeMetric } from "@/lib/metrics";
import { SECTOR_COLORS, SECTORS } from "@/lib/sectors";
import type { Sector } from "@/lib/types";
import { Legend, rangesFor } from "./sections";

const PAGE = 50;

export interface ExplorerSeed {
  metric: VolumeMetric;
  range: number;
  sectors: Sector[];
}

type View = "trend" | "deals";

/**
 * Full-screen explorer behind the volume chart. Two views of the same deals: the monthly trend
 * (click a month to focus it) and every deal as a dot (hover for who bought whom). A side panel
 * explains the current selection in plain English; the full list sits underneath.
 */
export function VolumeExplorer({ seed, onClose }: { seed: ExplorerSeed; onClose: () => void }) {
  const { data, matrix } = useHubData();
  const { openDeal } = useDetails();
  const { toast } = useUi();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [view, setView] = useState<View>("trend");
  const [metric, setMetric] = useState<VolumeMetric>(seed.metric);
  const [range, setRange] = useState(seed.range);
  const [visible, setVisible] = useState<Set<Sector>>(() => new Set(seed.sectors));
  const [month, setMonth] = useState<string | null>(null);
  const [sort, setSort] = useState<ExplorerSort>("value");
  const [shown, setShown] = useState(PAGE);

  // Full screen: lock page scroll, Esc closes (unless a deal drawer is open on top), return focus on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const prev = root.style.overflow;
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
      root.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  // Trend: the same monthly totals as the panel it was opened from.
  const months = matrix.months.slice(-range);
  const labels = useMemo(() => months.map(periodLabel), [months]);
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

  const toggleSector = (s: Sector) =>
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

  // Deals in the window and visible sectors (terminated deals excluded, like the totals).
  const inWindow = useMemo(
    () =>
      data.deals.filter((d) => {
        const m = monthOf(d.announcedDate);
        return d.status !== "Terminated" && visible.has(d.sector) && m >= (months[0] ?? "") && m <= (months.at(-1) ?? "");
      }),
    [data.deals, visible, months],
  );
  const selected = useMemo(() => (month ? inWindow.filter((d) => monthOf(d.announcedDate) === month) : inWindow), [inWindow, month]);
  const stats = useMemo(() => selectionStats(selected), [selected]);
  const notes = useMemo(() => insights(stats), [stats]);
  const rows = useMemo(() => sortDeals(selected, sort), [selected, sort]);
  const monthIndex = month ? months.indexOf(month) : -1;
  const scopeLabel = month ? periodLabel(month) : `${labels[0]} – ${labels.at(-1)}`;
  const unplotted = inWindow.filter((d) => d.valueUsd == null).length;

  const pickMonth = (i: number) => {
    setMonth((cur) => (cur === months[i] ? null : months[i]));
    setShown(PAGE);
  };

  return createPortal(
    <div className="explorer" role="dialog" aria-modal="true" aria-labelledby="explorer-title">
      <header className="explorer-head">
        <div>
          <h1 id="explorer-title">M&amp;A activity</h1>
          <p className="explorer-sub">Every U.S.-listed company agreed to be bought · {labels[0]} – {labels.at(-1)}</p>
        </div>
        <button ref={closeRef} type="button" className="button" onClick={onClose} aria-label="Close (Esc)">
          <Icon name="close" />
          Close
        </button>
      </header>

      <div className="explorer-scroll">
        <div className="explorer-controls">
          <Segment
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "trend", label: "Trend over time" },
              { value: "deals", label: "Every deal" },
            ]}
          />
          {view === "trend" && (
            <Segment
              label="Chart metric"
              value={metric}
              onChange={setMetric}
              options={[
                { value: "value", label: "$ Value" },
                { value: "count", label: "Deal count" },
              ]}
            />
          )}
          <Segment label="Time range" value={range} onChange={(r) => (setRange(r), setMonth(null), setShown(PAGE))} options={rangesFor(matrix.months.length)} />
        </div>

        <div className="explorer-grid">
          <section className="panel explorer-chart-panel">
            <div className="chart-meta explorer-chart-meta">
              <Legend visible={visible} onToggle={toggleSector} label="Visible sectors" />
              <span className="chart-unit">
                {view === "deals" ? "Deal value (log scale) · dot size = value" : metric === "value" ? "USD billions per month" : "Deals per month"}
              </span>
            </div>
            {view === "trend" ? (
              <LineChart
                className="chart-wrap explorer-chart"
                points
                labels={labels}
                series={series}
                highlight={monthIndex >= 0 ? monthIndex : null}
                onPointClick={pickMonth}
                maxTicks={12}
                format={(v) => (metric === "value" ? `$${v}B` : `${v} deals`)}
                formatTick={(v) => (metric === "value" ? `$${v}B` : String(v))}
                ariaLabel={`${metric === "value" ? "M&A value" : "Deal count"} by month, ${labels[0]} to ${labels.at(-1)}. Click a month to focus on it.`}
              />
            ) : (
              <DealScatter className="chart-wrap explorer-chart" deals={inWindow} onOpen={openDeal} focusMonth={month} />
            )}
            <div className="explorer-chart-foot">
              {view === "trend"
                ? "Click any month to see what happened in it. Spikes usually mean one giant deal, not a busy month: switch to “Every deal” to see which."
                : `Each dot is one acquisition. Higher = bigger. Hover to see who bought whom, click for the full deal.${unplotted ? ` ${unplotted} deals without a disclosed value aren't plotted.` : ""}`}
            </div>
          </section>

          <aside className="panel explorer-side" aria-label="About this selection">
            <div className="explorer-side-head">
              <div>
                <div className="explorer-side-eyebrow">{month ? "Selected month" : "Whole period"}</div>
                <h2>{scopeLabel}</h2>
              </div>
              {month && (
                <button type="button" className="explorer-clear" onClick={() => setMonth(null)}>
                  Clear
                </button>
              )}
            </div>

            <div className="explorer-stats">
              <div>
                <b className="num">{stats.count}</b>
                <span>deals agreed</span>
              </div>
              <div>
                <b className="num">{formatUsd(stats.totalUsd || null)}</b>
                <span>total value</span>
              </div>
              <div>
                <b className="num">{formatPct(stats.medianPremium, 0)}</b>
                <span>median premium</span>
              </div>
            </div>

            {!!notes.length && (
              <div className="explorer-block">
                <h3>What stands out</h3>
                <ul className="explorer-notes">
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

            {!!stats.biggest.length && (
              <div className="explorer-block">
                <h3>Biggest deals</h3>
                {stats.biggest.map((d, i) => (
                  <button key={d.id} type="button" className="explorer-deal" onClick={() => openDeal(d)}>
                    <span className="explorer-rank">{i + 1}</span>
                    <span className="explorer-deal-names">
                      <strong>{d.target.name}</strong>
                      <small>
                        bought by {d.acquirer.name} · {formatDate(d.announcedDate)}
                      </small>
                    </span>
                    <span className="mono">{formatUsd(d.valueUsd)}</span>
                  </button>
                ))}
              </div>
            )}

            {stats.sectors.length > 1 && (
              <div className="explorer-block">
                <h3>Where the deals were</h3>
                {stats.sectors.map((s) => (
                  <div key={s.sector} className="explorer-bar-row">
                    <span className="explorer-bar-label">
                      <SectorDot sector={s.sector} />
                      {s.sector}
                    </span>
                    <span className="explorer-bar">
                      <i style={{ width: `${s.sharePct}%`, background: SECTOR_COLORS[s.sector] }} />
                    </span>
                    <span className="mono">{s.count}</span>
                  </div>
                ))}
              </div>
            )}

            {!!stats.buyers.length && (
              <div className="explorer-block">
                <h3>Most active buyers</h3>
                {stats.buyers.map((b) => (
                  <div key={b.name} className="explorer-buyer">
                    <CompanyLink company={b.deals[0].acquirer} />
                    <span className="dim">
                      {b.count} deal{b.count === 1 ? "" : "s"}
                      {b.valueUsd ? ` · ${formatUsd(b.valueUsd)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {!stats.count && <p className="dim explorer-empty">{data.isSample ? "The sample data only has individual deals for the latest months." : "No deals in this selection."}</p>}
          </aside>
        </div>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-heading">
              <h2>
                {rows.length} deal{rows.length === 1 ? "" : "s"} · {scopeLabel}
              </h2>
              <small>Click a row for the full deal, or a company name for its page</small>
            </div>
            <Select
              id="ex-sort"
              label="Sort deals"
              value={sort}
              onChange={(s) => (setSort(s), setShown(PAGE))}
              options={[
                { value: "value", label: "Largest first" },
                { value: "date", label: "Newest first" },
                { value: "premium", label: "Highest premium" },
              ]}
            />
          </div>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Deals in this selection</caption>
              <thead>
                <tr>
                  <th scope="col">ANNOUNCED</th>
                  <th scope="col">TARGET</th>
                  <th scope="col">BUYER</th>
                  <th scope="col">SECTOR</th>
                  <th scope="col" className="right">VALUE</th>
                  <th scope="col" className="right">PREMIUM</th>
                  <th scope="col">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((d) => (
                  <RowLink key={d.id} label={`${d.acquirer.name} to acquire ${d.target.name}`} onOpen={() => openDeal(d)}>
                    <td className="table-date">{formatDate(d.announcedDate)}</td>
                    <td className="company">
                      <CompanyLink company={d.target} />
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
                    <td>
                      <StatusTag status={d.status} />
                    </td>
                  </RowLink>
                ))}
                {!rows.length && <EmptyRow colSpan={7}>No deals in this selection.</EmptyRow>}
              </tbody>
            </table>
          </div>
          {rows.length > shown && (
            <div className="panel-foot">
              <span>
                Showing {shown} of {rows.length}
              </span>
              <button type="button" className="small-link" onClick={() => setShown((n) => n + PAGE * 2)}>
                Show more
              </button>
            </div>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}
