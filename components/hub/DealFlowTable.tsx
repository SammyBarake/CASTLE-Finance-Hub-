"use client";

import { Icon } from "@/components/ui/Icon";
import { CompanyIcon, PanelTitle, SectorLabel, Select, StatusTag } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { formatDate, formatPct, formatUsd } from "@/lib/format";
import { sum } from "@/lib/metrics";
import type { DealFilters } from "@/lib/search";
import { DEAL_STATUSES, SECTORS, type Deal } from "@/lib/types";
import { useState } from "react";

const COLLAPSED_ROWS = 12;

export function DealFlowTable({
  deals,
  totalCount,
  filters,
  onFiltersChange,
  onSelect,
  onReset,
}: {
  deals: Deal[];
  totalCount: number;
  filters: DealFilters;
  onFiltersChange: (f: Partial<DealFilters>) => void;
  onSelect: (d: Deal) => void;
  onReset: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? deals : deals.slice(0, COLLAPSED_ROWS);
  return (
    <section id="deal-flow" aria-labelledby="flow-heading" className="panel mb-[21px] max-phone:mb-[17px]">
      <div className="flex items-center justify-between gap-4 px-5 pt-[19px] pb-4 max-tablet:p-[17px] max-phone:flex-wrap max-phone:gap-2.5">
        <PanelTitle id="flow-heading" title="Deal flow" tag="LATEST" subtitle="The latest announced mergers and acquisitions" />
        <div className="flex items-center gap-2 max-phone:gap-1.5">
          <Select
            id="sector-filter"
            label="Filter deals by sector"
            value={filters.sector}
            onChange={(sector) => onFiltersChange({ sector })}
            options={[{ value: "all" as const, label: "All sectors" }, ...SECTORS.map((s) => ({ value: s, label: s }))]}
          />
          <Select
            id="status-filter"
            label="Filter deals by status"
            value={filters.status}
            onChange={(status) => onFiltersChange({ status })}
            options={[{ value: "all" as const, label: "All statuses" }, ...DEAL_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <caption className="sr-only">Announced M&amp;A deals. Select a row for transaction details.</caption>
          <thead>
            <tr>
              <th scope="col">ANNOUNCED</th>
              <th scope="col">ACQUIRER</th>
              <th scope="col">TARGET</th>
              <th scope="col" className="text-right">DEAL VALUE</th>
              <th scope="col" className="text-right">PREMIUM</th>
              <th scope="col">SECTOR</th>
              <th scope="col">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <RowLink key={d.id} label={`View ${d.acquirer.name} acquisition of ${d.target.name}`} onOpen={() => onSelect(d)}>
                <td className="font-mono !text-[9px] !text-[#858b9e] tabular-nums">{formatDate(d.announcedDate)}</td>
                <td className="company-cell">{d.acquirer.name}</td>
                <td className="company-cell">
                  <span className="flex items-center gap-[9px]">
                    <CompanyIcon name={d.target.name} sector={d.sector} />
                    {d.target.name}
                  </span>
                </td>
                <td className="value-cell text-right">{formatUsd(d.valueUsd)}</td>
                <td className="text-right font-mono !text-[#b3b9c7] tabular-nums">{formatPct(d.premiumPct)}</td>
                <td>
                  <SectorLabel sector={d.sector} />
                </td>
                <td>
                  <StatusTag status={d.status} />
                </td>
              </RowLink>
            ))}
            {!deals.length && (
              <EmptyRow colSpan={7}>
                No deals match these filters.
                <button type="button" onClick={onReset} className="ml-[5px] p-0 text-accent underline">
                  Reset filters
                </button>
              </EmptyRow>
            )}
          </tbody>
        </table>
      </div>
      <div className="panel-foot max-phone:px-3.5">
        <span className="text-[9px] max-phone:text-[8px]">
          {deals.length} of {totalCount} transactions · {formatUsd(sum(deals.map((d) => d.valueUsd ?? 0)))} disclosed value
        </span>
        {deals.length > COLLAPSED_ROWS ? (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="inline-flex items-center gap-1 p-0 text-[9px] text-[#a9a1d7] hover:text-[#d5ccff]">
            {expanded ? "Show fewer" : `Show all ${deals.length}`} <Icon name="chevron" className={`!size-2.5 transition-transform ${expanded ? "-rotate-90" : "rotate-90"}`} />
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[8px] text-[#717689] max-phone:hidden">
            Select any transaction to explore <Icon name="right" className="!size-2.5" />
          </span>
        )}
      </div>
    </section>
  );
}
