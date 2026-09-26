"use client";

import { useMemo, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyMark, FilterSearch, Kpi, Kpis, PageHeading, SectorLabel, Select, StatusTag } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { dealsToCsv, downloadCsv } from "@/lib/csv";
import { formatDate, formatDateFull, formatPct, formatUsd } from "@/lib/format";
import { median, sum } from "@/lib/metrics";
import { matchDeal, type DealFilters } from "@/lib/search";
import { DEAL_STATUSES, SECTORS } from "@/lib/types";

type Sort = "date" | "value" | "premium";
const PAGE_SIZE = 25;

export function DealFlowView() {
  const { data } = useHubData();
  const { openDeal } = useDetails();
  const { toast } = useUi();
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState<DealFilters["sector"]>("all");
  const [status, setStatus] = useState<DealFilters["status"]>("all");
  const [sort, setSort] = useState<Sort>("date");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = data.deals.filter((d) => matchDeal(d, { query: q, sector, status }));
    return [...filtered].sort((a, b) =>
      sort === "value" ? (b.valueUsd ?? -1) - (a.valueUsd ?? -1) : sort === "premium" ? (b.premiumPct ?? -1) - (a.premiumPct ?? -1) : b.announcedDate.localeCompare(a.announcedDate),
    );
  }, [data.deals, query, sector, status, sort]);

  const medianPrem = median(rows.map((d) => d.premiumPct).filter((p): p is number => p != null));
  const reset = () => {
    setQuery("");
    setSector("all");
    setStatus("all");
  };
  const exportRows = () => {
    if (!rows.length) return toast("No rows to export. Clear the filters first.");
    downloadCsv(dealsToCsv(rows, data.isSample), data.isSample ? "Castle_Deals_Sample.csv" : "Castle_Deals.csv");
    toast(`${rows.length} rows exported.`);
  };

  return (
    <>
      <PageHeading title="Deal Flow" subtitle={`Announced U.S. M&A · ${data.isSample ? "Transaction details" : "From SEC filings"}`} date={formatDateFull(data.asOf)} onExport={exportRows} />

      <Kpis label="Filtered transaction summary">
        <Kpi label="Transactions" value={rows.length} note="Current selection" />
        <Kpi label="Total deal value" value={formatUsd(sum(rows.map((d) => d.valueUsd ?? 0)))} note="Disclosed transaction value" />
        <Kpi label="Median premium" value={medianPrem == null ? "—" : formatPct(medianPrem)} note="Offer vs. unaffected share price" />
        <Kpi label="Pending" value={rows.filter((d) => d.status === "Pending").length} note="Current selection" />
      </Kpis>

      <section className="panel" aria-label="Announced transactions">
        <div className="table-tools">
          <FilterSearch id="deal-search" label="Filter transactions" placeholder="Company, ticker or advisor" value={query} onChange={setQuery} />
          <div className="table-filters">
            <Select id="deal-sector" label="Sector" value={sector} onChange={setSector} options={[{ value: "all" as const, label: "All sectors" }, ...SECTORS.map((s) => ({ value: s, label: s }))]} />
            <Select id="deal-status" label="Status" value={status} onChange={setStatus} options={[{ value: "all" as const, label: "All statuses" }, ...DEAL_STATUSES.map((s) => ({ value: s, label: s }))]} />
            <Select
              id="deal-sort"
              label="Sort transactions"
              value={sort}
              onChange={setSort}
              options={[
                { value: "date", label: "Newest first" },
                { value: "value", label: "Largest first" },
                { value: "premium", label: "Highest premium" },
              ]}
            />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Announced M&amp;A transactions. Select a row for details.</caption>
            <thead>
              <tr>
                <th scope="col">ANNOUNCED</th>
                <th scope="col">ACQUIRER</th>
                <th scope="col">TARGET</th>
                <th scope="col" className="right">DEAL VALUE</th>
                <th scope="col" className="right">PREMIUM</th>
                <th scope="col">SECTOR</th>
                <th scope="col">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((d) => (
                <RowLink key={d.id} label={`${d.acquirer.name} acquires ${d.target.name}`} onOpen={() => openDeal(d)}>
                  <td className="table-date">{formatDate(d.announcedDate)}</td>
                  <td className="company">{d.acquirer.name}</td>
                  <td className="company">
                    <span className="company-line">
                      <CompanyMark name={d.target.name} />
                      {d.target.name}
                    </span>
                  </td>
                  <td className="right table-value">{formatUsd(d.valueUsd)}</td>
                  <td className="right mono">{formatPct(d.premiumPct)}</td>
                  <td>
                    <SectorLabel sector={d.sector} />
                  </td>
                  <td>
                    <StatusTag status={d.status} />
                  </td>
                </RowLink>
              ))}
              {!rows.length && (
                <EmptyRow colSpan={7}>
                  No transactions match these filters.
                  <button type="button" onClick={reset}>
                    Reset filters
                  </button>
                </EmptyRow>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <button type="button" className="show-more" onClick={() => setLimit((l) => l + 50)}>
            Show more ({rows.length - limit} remaining)
          </button>
        )}
        <div className="panel-foot">
          <span>
            {rows.length} of {data.deals.length} transactions
          </span>
          <span>USD · As of {formatDate(data.asOf.slice(0, 10))}</span>
        </div>
      </section>
    </>
  );
}
