"use client";

import { useMemo, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { Icon } from "@/components/ui/Icon";
import { CompanyMark, FilterSearch, Kpi, Kpis, PageHeading, Select } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate, formatDateFull, formatUsd, formatUsdB1 } from "@/lib/format";
import { sum } from "@/lib/metrics";
import { matchAdvisor } from "@/lib/search";

type Sort = "value" | "deals";

export function AdvisorsView() {
  const { data } = useHubData();
  const { openAdvisor } = useDetails();
  const { toast } = useUi();
  const [sort, setSort] = useState<Sort>("value");
  const [query, setQuery] = useState("");
  const [minDeals, setMinDeals] = useState("");
  const entries = data.leagueTable.entries;

  // Rank follows the chosen sort across all advisors; filters only hide rows.
  const rows = useMemo(() => {
    const ranked = entries.map((e, i) => ({ e, valueRank: i + 1 }));
    const sorted = sort === "value" ? ranked : [...ranked].sort((a, b) => b.e.dealCount - a.e.dealCount || b.e.dealValueUsd - a.e.dealValueUsd);
    return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [entries, sort]);
  const visibleRows = rows.filter(({ e }) => matchAdvisor(e, query.trim().toLowerCase()) && (!minDeals || e.dealCount >= Number(minDeals)));
  const top = entries[0];
  const maxValue = top?.dealValueUsd || 1;

  const exportRows = () => {
    const csv = toCsv(
      ["Rank", "Advisor", "Deals advised", "Deal value (USD)", "Rank change vs prior quarter"],
      rows.map(({ e }, i) => [i + 1, e.advisor.name, e.dealCount, e.dealValueUsd, e.rankChange]),
      data.isSample,
    );
    downloadCsv(csv, `Castle_Advisors${data.isSample ? "_Sample" : ""}.csv`);
    toast(`${rows.length} rows exported.`);
  };

  return (
    <>
      <PageHeading title="Advisors" subtitle={`U.S. M&A league table · ${data.leagueTable.period}`} date={formatDateFull(data.asOf)} onExport={exportRows} />

      <Kpis label="Advisor summary">
        <Kpi label="Top advisor by value" value={top?.advisor.name ?? "—"} note={top ? `${formatUsdB1(top.dealValueUsd)} advised` : "No data"} text />
        <Kpi label="Advisors ranked" value={entries.length} note="U.S. M&A · financial advisors" />
        <Kpi label="Advisory mandates" value={sum(entries.map((e) => e.dealCount)).toLocaleString("en-US")} note="Includes shared mandates" />
        <Kpi label="Gross advised value" value={formatUsd(sum(entries.map((e) => e.dealValueUsd)))} note="Includes shared advisory credit" />
      </Kpis>

      <section className="panel">
        <div className="table-tools">
          <FilterSearch id="advisor-search" label="Filter advisors" placeholder="Find an advisor" value={query} onChange={setQuery} />
          <div className="table-filters">
            <Select
              id="advisor-min"
              label="Minimum deals advised"
              value={minDeals}
              onChange={setMinDeals}
              options={[
                { value: "", label: "Any deal count" },
                { value: "3", label: "3+ deals" },
                { value: "5", label: "5+ deals" },
                { value: "10", label: "10+ deals" },
              ]}
            />
          <Select
            id="advisor-sort"
            label="Rank advisors by"
            value={sort}
            onChange={setSort}
            options={[
              { value: "value", label: "Rank by deal value" },
              { value: "deals", label: "Rank by deal count" },
            ]}
          />
          </div>
        </div>
        <div className="table-scroll">
          <table>
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
              {visibleRows.map(({ e, valueRank, rank }) => {
                const change = e.rankChange;
                const showChange = sort === "value" && change !== 0;
                return (
                  <RowLink key={e.advisor.name} label={`${e.advisor.name} advisory activity`} onOpen={() => openAdvisor(e, valueRank)}>
                    <td className="table-date">
                      {String(rank).padStart(2, "0")}
                      <span className={`rank-change ${showChange ? (change > 0 ? "up" : "down") : "muted"}`} aria-label={sort !== "value" ? "Prior rank shown for value ranking only" : change === 0 ? "Unchanged" : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)}`}>
                        {showChange ? (
                          <>
                            <Icon name={change > 0 ? "arrow-up" : "arrow-down"} />
                            {Math.abs(change)}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </td>
                    <td className="company">
                      <span className="company-line">
                        <CompanyMark name={e.advisor.name} letters={e.advisor.shortName} />
                        {e.advisor.name}
                      </span>
                    </td>
                    <td className="right mono">{e.dealCount}</td>
                    <td className="right table-value">
                      {formatUsdB1(e.dealValueUsd)}
                      <span className="value-bar">
                        <i style={{ width: `${Math.min((e.dealValueUsd / maxValue) * 100, 100)}%` }} />
                      </span>
                    </td>
                    <td className="right table-value">{e.dealCount ? formatUsd(e.dealValueUsd / e.dealCount) : "—"}</td>
                  </RowLink>
                );
              })}
              {!visibleRows.length && <EmptyRow colSpan={5}>{rows.length ? "No advisors match this selection." : "No advisor data yet."}</EmptyRow>}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <span>
            {data.leagueTable.period} · Through {formatDate(data.asOf.slice(0, 10))}
          </span>
          <span>Rank change vs. prior quarter · value ranking only</span>
        </div>
      </section>
      <p className="note">A transaction may be credited to multiple advisors. Gross totals include shared mandates and do not represent unique market volume.</p>
    </>
  );
}
