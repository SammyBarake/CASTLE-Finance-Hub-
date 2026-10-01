"use client";

import { useMemo, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { AboutData, Kpi, Kpis, PageHeading, PanelHead, SectorDot, Segment, Takeaways } from "@/components/ui/primitives";
import { EmptyRow, RowLink, ShowMore } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { SECTOR_COLORS } from "@/lib/sectors";
import { MIN_CLOSE_DAYS, months, STALE_OPEN_DAYS, timelineInsights, timelineStats, type DealTimeline } from "@/lib/timelines";

const PAGE = 20;

const stage = (t: DealTimeline) => {
  const m = t.deal.milestones!;
  if (m.path === "tender") return "Tender offer under way";
  if (m.voteHeld) return "Approved by shareholders, awaiting regulators";
  if (m.definitiveProxy) return "Awaiting shareholder vote";
  if (m.firstFiling) return m.firstFiling.form.startsWith("S-4") || m.firstFiling.form.startsWith("F-4") ? "Registration filed" : "Proxy filed";
  return "Announced, no filing yet";
};

export function TimelinesView() {
  const { data } = useHubData();
  const { openDeal } = useDetails();
  const s = useMemo(() => timelineStats(data.deals, data.asOf), [data.deals, data.asOf]);
  const notes = useMemo(() => timelineInsights(s), [s]);
  const [list, setList] = useState<"waiting" | "closed">("waiting");
  const [shown, setShown] = useState(PAGE);

  const maxSector = Math.max(1, ...s.bySector.map((x) => x.median ?? 0));
  const recentlyClosed = useMemo(() => [...s.closed].sort((a, b) => b.deal.milestones!.closed!.localeCompare(a.deal.milestones!.closed!)), [s.closed]);
  const rows = list === "waiting" ? s.open : recentlyClosed;
  const hasData = s.closed.length + s.open.length > 0;

  return (
    <>
      <PageHeading title="Deal Timelines" subtitle="How long takeovers take, from handshake to closing" />

      {!hasData ? (
        <section className="panel">
          <div className="empty-small">{data.isSample ? "Timelines are built from real SEC filing dates, so they appear once the site is showing live data." : "No timeline data yet."}</div>
        </section>
      ) : (
        <>
          <Kpis label="Timeline summary">
            <Kpi label="Typical time to close" value={months(s.medianDaysToClose)} note={`Median of ${s.closed.length} closed deals`} text />
            <Kpi label="Tender offer vs. vote" value={`${months(s.byPath.tender.median)} · ${months(s.byPath.vote.median)}`} note="Median time to close for each path" text />
            <Kpi label="Still waiting" value={s.open.length} note="Announced, not yet closed" />
            <Kpi label="Fell apart" value={s.terminationPct != null ? `${s.terminationPct}%` : "—"} note={`${s.terminated.length} terminated deals`} />
          </Kpis>

          <Takeaways items={notes} />

          <div className="two-col timeline-grid">
            <section className="panel">
              <PanelHead title="How long deals took" subtitle="Closed deals by time from announcement to closing" />
              <LineChart
                className="chart-wrap timeline-chart"
                type="bar"
                labels={s.histogram.map((b) => b.label)}
                series={[{ label: "Deals", color: "#bdbdbd", data: s.histogram.map((b) => b.count), hidden: false }]}
                format={(v) => `${v} deals`}
                formatTick={(v) => String(v)}
                ariaLabel="Histogram of time to close for closed deals"
              />
            </section>
            <section className="panel">
              <PanelHead title="By sector" subtitle="Median time to close" />
              <div className="timeline-sectors">
                {s.bySector.map((x) => (
                  <div key={x.sector} className="timeline-sector">
                    <span className="timeline-sector-name">
                      <SectorDot sector={x.sector} />
                      {x.sector}
                    </span>
                    <span className="timeline-sector-bar">
                      <i style={{ width: `${((x.median ?? 0) / maxSector) * 100}%`, background: SECTOR_COLORS[x.sector] }} />
                    </span>
                    <span className="timeline-sector-value">
                      {months(x.median)}
                      <small>{x.n} deals</small>
                    </span>
                  </div>
                ))}
              </div>
              <div className="timeline-compare">
                <div>
                  <span>Paid in cash</span>
                  <b>{months(s.byConsideration.cash.median)}</b>
                </div>
                <div>
                  <span>Paid in stock or mixed</span>
                  <b>{months(s.byConsideration.stock.median)}</b>
                </div>
                <div>
                  <span>Announcement to first filing</span>
                  <b>{months(s.medianDaysToFirstFiling)}</b>
                </div>
              </div>
            </section>
          </div>

          <section className="panel">
            <PanelHead
              title={list === "waiting" ? "Still waiting" : "Recently closed"}
              subtitle={list === "waiting" ? "Open deals, longest wait first · bar = time so far vs. the sector's typical time" : "Newest closings first"}
            >
              <Segment
                label="List"
                value={list}
                onChange={(v) => (setList(v), setShown(PAGE))}
                options={[
                  { value: "waiting", label: `Still waiting (${s.open.length})` },
                  { value: "closed", label: `Closed (${s.closed.length})` },
                ]}
              />
            </PanelHead>
            <div className="table-scroll">
              <table>
                <caption className="sr-only">{list === "waiting" ? "Open deals" : "Closed deals"}</caption>
                <thead>
                  <tr>
                    <th scope="col">TARGET</th>
                    <th scope="col">BUYER</th>
                    <th scope="col">ANNOUNCED</th>
                    <th scope="col">{list === "waiting" ? "STAGE" : "CLOSED"}</th>
                    <th scope="col" className="right">{list === "waiting" ? "WAITING" : "TOOK"}</th>
                    {list === "waiting" && <th scope="col">VS. TYPICAL</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((t) => {
                    const open = "progressPct" in t ? (t as (typeof s.open)[number]) : null;
                    return (
                      <RowLink key={t.deal.id} label={`${t.deal.acquirer.name} to acquire ${t.deal.target.name}`} onOpen={() => openDeal(t.deal)}>
                        <td className="company">
                          <CompanyLink company={t.deal.target} />
                        </td>
                        <td className="company">
                          <CompanyLink company={t.deal.acquirer} />
                        </td>
                        <td className="table-date">{formatDate(t.deal.announcedDate)}</td>
                        <td className="dim">{list === "waiting" ? stage(t) : formatDate(t.deal.milestones!.closed!)}</td>
                        <td className="right mono">{months(list === "waiting" ? t.daysElapsed : t.daysToClose)}</td>
                        {open && (
                          <td className="timeline-progress-cell">
                            <span className={`timeline-progress ${(open.progressPct ?? 0) > 150 ? "late" : ""}`}>
                              <i style={{ width: `${Math.min(open.progressPct ?? 0, 100)}%` }} />
                            </span>
                            <small>{open.progressPct != null ? `${(open.progressPct / 100).toFixed(1)}×` : "—"}</small>
                          </td>
                        )}
                      </RowLink>
                    );
                  })}
                  {!rows.length && <EmptyRow colSpan={6}>Nothing here.</EmptyRow>}
                </tbody>
              </table>
            </div>
            <ShowMore shown={shown} total={rows.length} onMore={() => setShown((n) => n + PAGE * 2)} />
          </section>

          <AboutData>
            <p>
              <strong>Why paths differ.</strong> A tender offer goes straight to shareholders; a merger vote needs a proxy statement, SEC review and a
              shareholder meeting. Stock deals also need the buyer to register its new shares and often its own shareholders&apos; vote. Terminations
              usually come from a rival bid, a regulator or a failed vote.
            </p>
            <p>
              <strong>Sources.</strong> Dates come from the target&apos;s SEC filings: announcement, first proxy or tender-offer document, definitive proxy,
              and the delisting or change-of-control filing at closing.
              {s.excluded.seenAtCompletion ? ` ${s.excluded.seenAtCompletion} deals first seen at completion (closed within ${MIN_CLOSE_DAYS} days of the first filing Castle found) are left out of the timings.` : ""}
              {s.excluded.stale ? ` ${s.excluded.stale} deals open more than ${Math.round(STALE_OPEN_DAYS / 30)} months with no closing filing are left out as likely data gaps.` : ""}
            </p>
          </AboutData>
        </>
      )}
    </>
  );
}
