"use client";

import { useMemo, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { Icon } from "@/components/ui/Icon";
import { AboutData, CompanyMark, FilterSearch, Kpi, Kpis, PageHeading, Segment, Select } from "@/components/ui/primitives";
import { AdvisorFees } from "./AdvisorFees";
import { EmptyRow, RowLink, ShowMore, TABLE_PAGE } from "@/components/ui/table";
import { usePhone } from "@/components/ui/usePhone";
import { useUi } from "@/components/ui/UiProvider";
import { exportContext } from "@/components/export/excel";
import { downloadCsv, toCsv } from "@/lib/csv";
import { leagueWorkbook } from "@/lib/excel/workbooks";
import { formatDate, formatUsd, formatUsdB1 } from "@/lib/format";
import { dataDay } from "@/lib/freshness";
import { averageDealUsd, sum } from "@/lib/metrics";
import { matchAdvisor } from "@/lib/search";

type Sort = "value" | "deals";

export function AdvisorsView() {
  const { data } = useHubData();
  const { openAdvisor } = useDetails();
  const { toast } = useUi();
  const [view, setView] = useState<"deals" | "fees">("deals");
  const [sort, setSort] = useState<Sort>("value");
  const [query, setQuery] = useState("");
  const [minDeals, setMinDeals] = useState("");
  // On a phone the two filters' options are written short, so both fit on one row at the touch font size.
  const phone = usePhone();
  // A long table shows a page at a time; a new search, filter or ranking starts again from the top.
  const [shown, setShown] = useState(TABLE_PAGE);
  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setShown(TABLE_PAGE));
  const entries = data.leagueTable.entries;

  // Rank follows the chosen sort across all advisors; filters only hide rows.
  const rows = useMemo(() => {
    const ranked = entries.map((e, i) => ({ e, valueRank: i + 1 }));
    // Same order as the league table's own count ranking (lib/aggregate.ts), so its rank changes line up.
    const sorted =
      sort === "value" ? ranked : [...ranked].sort((a, b) => b.e.dealCount - a.e.dealCount || b.e.dealValueUsd - a.e.dealValueUsd || a.e.advisor.name.localeCompare(b.e.advisor.name));
    return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [entries, sort]);
  const visibleRows = rows.filter(({ e }) => matchAdvisor(e, query.trim().toLowerCase()) && (!minDeals || e.dealCount >= Number(minDeals)));
  const top = entries[0];
  const maxValue = top?.dealValueUsd || 1;

  const exportRows = () => {
    const csv = toCsv(
      ["Rank", "Advisor", "Deals advised", "Deal value (USD)", "Rank change vs prior quarter"],
      rows.map(({ e }, i) => [i + 1, e.advisor.name, e.dealCount, e.dealValueUsd, e.isNew ? "New" : sort === "value" ? e.rankChange : (e.dealCountRankChange ?? 0)]),
      data.isSample,
    );
    downloadCsv(csv, `Castle_Advisors${data.isSample ? "_Sample" : ""}.csv`);
    toast(`${rows.length} rows exported.`);
  };

  return (
    <>
      <PageHeading
        title="Advisors"
        subtitle={view === "deals" ? `U.S. M&A league table · ${data.leagueTable.period}` : "Advisory fees disclosed in merger proxies"}
        onExport={view === "deals" ? exportRows : undefined}
        live={
          view === "deals"
            ? () => ({
                path: `/api/live/league.csv${sort === "deals" ? "?sort=deals" : ""}`,
                note: query.trim() || minDeals ? "The search and minimum-deals filters aren't part of the link: the sheet has every ranked advisor." : undefined,
              })
            : undefined
        }
        excel={
          view === "deals"
            ? () =>
                visibleRows.length
                  ? leagueWorkbook(visibleRows, exportContext(data), {
                      period: data.leagueTable.period,
                      by: sort,
                      selection: [
                        `Period: ${data.leagueTable.period}`,
                        `Ranked by: ${sort === "value" ? "Deal value" : "Deal count"}`,
                        ...(minDeals ? [`Minimum deals advised: ${minDeals}`] : []),
                        ...(query.trim() ? [`Search: ${query.trim()}`] : []),
                      ],
                    })
                  : null
            : undefined
        }
      />
      <div className="advisor-view-toggle">
        <Segment
          label="Advisors view"
          value={view}
          onChange={setView}
          options={[
            { value: "deals", label: "Deals advised" },
            { value: "fees", label: "Fees earned" },
          ]}
        />
      </div>

      {view === "fees" ? (
        <AdvisorFees />
      ) : (
        <>
      <Kpis label="Advisor summary">
        <Kpi label="Top advisor by value" value={top?.advisor.name ?? "—"} note={top ? `${formatUsdB1(top.dealValueUsd)} advised` : "No data"} text />
        <Kpi label="Advisors ranked" value={entries.length} note="U.S. M&A · financial advisors" />
        <Kpi label="Advisory mandates" value={sum(entries.map((e) => e.dealCount)).toLocaleString("en-US")} note="Includes shared mandates" />
        <Kpi label="Gross advised value" value={formatUsd(sum(entries.map((e) => e.dealValueUsd)))} note="Includes shared advisory credit" />
      </Kpis>

      <section className="panel">
        <div className="table-tools">
          <FilterSearch id="advisor-search" label="Filter advisors" placeholder="Find an advisor" value={query} onChange={reset(setQuery)} />
          <div className="table-filters">
            <Select
              id="advisor-min"
              label="Minimum deals advised"
              value={minDeals}
              onChange={reset(setMinDeals)}
              options={[
                { value: "", label: phone ? "Any count" : "Any deal count" },
                { value: "3", label: "3+ deals" },
                { value: "5", label: "5+ deals" },
                { value: "10", label: "10+ deals" },
              ]}
            />
          <Select
            id="advisor-sort"
            label="Rank advisors by"
            value={sort}
            onChange={reset(setSort)}
            options={[
              { value: "value", label: phone ? "By value" : "Rank by deal value" },
              { value: "deals", label: phone ? "By count" : "Rank by deal count" },
            ]}
          />
          </div>
        </div>
        <div className="table-scroll">
          <table className="table-stack stack-rank">
            <caption className="sr-only">Advisor league table</caption>
            <thead>
              <tr>
                <th scope="col">RANK / CHANGE</th>
                <th scope="col">ADVISOR</th>
                <th scope="col" className="right">DEALS ADVISED</th>
                <th scope="col" className="right">DEAL VALUE</th>
                <th scope="col" className="right">AVG. DEAL SIZE</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.slice(0, shown).map(({ e, valueRank, rank }) => {
                const change = sort === "value" ? e.rankChange : (e.dealCountRankChange ?? 0);
                const showChange = change !== 0;
                const average = averageDealUsd(e);
                return (
                  <RowLink key={e.advisor.name} label={`${e.advisor.name} advisory activity`} onOpen={() => openAdvisor(e, valueRank)}>
                    <td className="table-date" data-area="rank">
                      {String(rank).padStart(2, "0")}
                      <span
                        className={`rank-change ${e.isNew ? "muted" : showChange ? (change > 0 ? "up" : "down") : "muted"}`}
                        aria-label={e.isNew ? "New this quarter" : change === 0 ? "Unchanged" : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)}`}
                        title={e.isNew ? "No credited deal before the prior quarter end" : undefined}
                      >
                        {e.isNew ? (
                          "New"
                        ) : showChange ? (
                          <>
                            <Icon name={change > 0 ? "arrow-up" : "arrow-down"} />
                            {Math.abs(change)}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </td>
                    <td className="company" data-area="main">
                      <span className="company-line">
                        <CompanyMark name={e.advisor.name} letters={e.advisor.shortName} />
                        {e.advisor.name}
                      </span>
                    </td>
                    <td className="right mono">{e.dealCount}</td>
                    {/* The phone's second line carries the deal count and the average the desktop gives columns. */}
                    <td className="phone-cell" data-area="sub">
                      {e.dealCount.toLocaleString("en-US")} {e.dealCount === 1 ? "deal" : "deals"} advised
                      {average != null ? ` · avg. ${formatUsd(average)}` : ""}
                    </td>
                    <td className="right table-value" data-area="fig">
                      {formatUsdB1(e.dealValueUsd)}
                      <span className="value-bar">
                        <i style={{ width: `${Math.min((e.dealValueUsd / maxValue) * 100, 100)}%` }} />
                      </span>
                    </td>
                    <td className="right table-value">{average != null ? formatUsd(average) : "—"}</td>
                  </RowLink>
                );
              })}
              {!visibleRows.length && <EmptyRow colSpan={5}>{rows.length ? "No advisors match this selection." : "No advisor data yet."}</EmptyRow>}
            </tbody>
          </table>
        </div>
        <ShowMore shown={shown} total={visibleRows.length} onMore={() => setShown((n) => n + TABLE_PAGE)} />
        <div className="panel-foot">
          <span>
            {data.leagueTable.period} · Through {formatDate(dataDay(data.asOf))}
          </span>
          <span>Rank change vs. prior quarter · {sort === "value" ? "by deal value" : "by deal count"}</span>
        </div>
      </section>
      <AboutData>
        <p>
          A transaction is credited to every named financial advisor, so gross totals include shared mandates and do not represent unique market volume. Rank
          change compares with the end of the prior quarter.
        </p>
      </AboutData>
        </>
      )}
    </>
  );
}
