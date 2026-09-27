"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LineChart } from "@/components/charts/LineChart";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { Icon } from "@/components/ui/Icon";
import { SectorDot, Segment, Select, StatusTag } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { monthOf, periodLabel, sortDeals, type ExplorerSort } from "@/lib/explorer";
import { formatDate, formatPct, formatUsd } from "@/lib/format";
import type { VolumeMetric } from "@/lib/metrics";
import { SECTOR_COLORS, SECTORS } from "@/lib/sectors";
import type { Sector } from "@/lib/types";
import { Legend } from "./sections";

const PAGE = 50;
const RANGES = [
  { value: 6, label: "6M" },
  { value: 12, label: "1Y" },
  { value: 24, label: "2Y" },
];

export interface ExplorerSeed {
  metric: VolumeMetric;
  range: number;
  sectors: Sector[];
}

/**
 * Full-screen version of the volume chart: the same monthly totals, bigger, and a list of the
 * deals behind them. Click a month to list only that month's deals.
 */
export function VolumeExplorer({ seed, onClose }: { seed: ExplorerSeed; onClose: () => void }) {
  const { data, matrix } = useHubData();
  const { openDeal } = useDetails();
  const { toast } = useUi();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [metric, setMetric] = useState<VolumeMetric>(seed.metric);
  const [range, setRange] = useState(seed.range);
  const [visible, setVisible] = useState<Set<Sector>>(() => new Set(seed.sectors));
  const [month, setMonth] = useState<string | null>(null);
  const [sort, setSort] = useState<ExplorerSort>("date");
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

  // The chart uses the same monthly totals as the panel it was opened from.
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

  // Deals behind the chart: visible sectors, the chosen window (or the clicked month), terminated deals excluded like the totals.
  const deals = useMemo(() => {
    const inWindow = data.deals.filter((d) => {
      const m = monthOf(d.announcedDate);
      return d.status !== "Terminated" && visible.has(d.sector) && (month ? m === month : m >= (months[0] ?? "") && m <= (months.at(-1) ?? ""));
    });
    return sortDeals(inWindow, sort);
  }, [data.deals, visible, month, months, sort]);
  const total = deals.reduce((s, d) => s + (d.valueUsd ?? 0), 0);

  const chartTotal = (i: number) => SECTORS.filter((s) => visible.has(s)).reduce((sum, s) => sum + matrix.bySector[s][metric].slice(-range)[i], 0);
  const monthIndex = month ? months.indexOf(month) : -1;
  const monthSummary =
    monthIndex >= 0 ? (metric === "value" ? `${formatUsd(chartTotal(monthIndex))} announced` : `${chartTotal(monthIndex)} deals announced`) : null;

  return createPortal(
    <div className="explorer" role="dialog" aria-modal="true" aria-labelledby="explorer-title">
      <header className="explorer-head">
        <div>
          <h1 id="explorer-title">M&amp;A activity</h1>
          <p className="explorer-sub">
            {labels[0]} – {labels.at(-1)} · Click any month to see its deals
          </p>
        </div>
        <button ref={closeRef} type="button" className="button" onClick={onClose} aria-label="Close (Esc)">
          <Icon name="close" />
          Close
        </button>
      </header>

      <div className="explorer-scroll">
        <section className="panel explorer-chart-panel">
          <div className="explorer-controls">
            <Segment
              label="Chart metric"
              value={metric}
              onChange={setMetric}
              options={[
                { value: "value", label: "$ Value" },
                { value: "count", label: "Deal count" },
              ]}
            />
            <Segment label="Time range" value={range} onChange={(r) => (setRange(r), setMonth(null), setShown(PAGE))} options={RANGES} />
          </div>
          <div className="chart-meta explorer-chart-meta">
            <Legend visible={visible} onToggle={toggleSector} label="Visible sectors" />
            <span className="chart-unit">{metric === "value" ? "USD billions" : "Transactions"}</span>
          </div>
          <LineChart
            className="chart-wrap explorer-chart"
            points
            labels={labels}
            series={series}
            highlight={monthIndex >= 0 ? monthIndex : null}
            onPointClick={(i) => {
              setMonth((cur) => (cur === months[i] ? null : months[i]));
              setShown(PAGE);
            }}
            maxTicks={12}
            format={(v) => (metric === "value" ? `$${v}B` : `${v} deals`)}
            formatTick={(v) => (metric === "value" ? `$${v}B` : String(v))}
            ariaLabel={`${metric === "value" ? "M&A value" : "Deal count"} by month, ${labels[0]} to ${labels.at(-1)}. Click a month to list its deals.`}
          />
        </section>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-heading">
              <h2>
                {month ? `Deals announced in ${periodLabel(month)}` : `All deals, ${labels[0]} – ${labels.at(-1)}`}
                {month && (
                  <button type="button" className="explorer-clear" onClick={() => setMonth(null)}>
                    Show all months
                  </button>
                )}
              </h2>
              <small>
                {deals.length} deal{deals.length === 1 ? "" : "s"} · {formatUsd(total)} disclosed value{monthSummary && ` · Chart total ${monthSummary}`}
              </small>
            </div>
            <Select
              id="ex-sort"
              label="Sort deals"
              value={sort}
              onChange={(s) => (setSort(s), setShown(PAGE))}
              options={[
                { value: "date", label: "Newest first" },
                { value: "value", label: "Largest first" },
                { value: "premium", label: "Highest premium" },
              ]}
            />
          </div>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Deals behind the chart</caption>
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
                {deals.slice(0, shown).map((d) => (
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
                {!deals.length && (
                  <EmptyRow colSpan={7}>{data.isSample ? "The sample data only lists individual deals for the latest months." : "No deals for this selection."}</EmptyRow>
                )}
              </tbody>
            </table>
          </div>
          {deals.length > shown && (
            <div className="panel-foot">
              <span>
                Showing {shown} of {deals.length}
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
