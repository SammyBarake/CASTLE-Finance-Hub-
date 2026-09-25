"use client";

import { Icon } from "@/components/ui/Icon";
import { CompanyIcon, PanelTitle, StatusTag } from "@/components/ui/primitives";
import { compactPanelHead, EmptyRow, RowLink } from "@/components/ui/table";
import { formatDate, formatRaise } from "@/lib/format";
import type { Ipo } from "@/lib/types";

export function IpoPipelineTable({ ipos, totalCount, onSelect }: { ipos: Ipo[]; totalCount: number; onSelect: (i: Ipo) => void }) {
  return (
    <section id="ipo-pipeline" aria-labelledby="ipo-heading" className="panel">
      <div className={compactPanelHead}>
        <PanelTitle id="ipo-heading" title="IPO pipeline" tag={`${totalCount} COMPANIES`} subtitle="From registration to the opening bell" />
        <Icon name="ipo" className="!w-4 text-muted" />
      </div>
      <div className="overflow-x-auto">
        <table className="data-table compact [&_td]:h-[57px] max-laptop:[&_td]:h-12">
          <caption className="sr-only">IPO filings, expected raises and lead underwriters</caption>
          <thead>
            <tr>
              <th scope="col">COMPANY / SECTOR</th>
              <th scope="col">FILED / RAISE</th>
              <th scope="col">LEAD UNDERWRITERS</th>
              <th scope="col">STAGE</th>
            </tr>
          </thead>
          <tbody>
            {ipos.map((i) => (
              <RowLink key={i.id} label={`View ${i.company.name} IPO details`} onOpen={() => onSelect(i)}>
                <td className="min-w-[147px]">
                  <span className="flex items-center gap-[9px]">
                    <CompanyIcon name={i.company.name} sector={i.sector} />
                    <span className="company-cell text-[10px]">
                      {i.company.name}
                      <span className="mt-px block text-[8px] font-normal text-dim">{i.sector}</span>
                    </span>
                  </span>
                </td>
                <td>
                  <div className="value-cell">{formatRaise(i.expectedRaiseUsd)}</div>
                  <div className="mt-[3px] text-[8px] text-dim">{formatDate(i.filedDate)}</div>
                </td>
                <td>
                  <div className="text-[8px] text-[#989daf]">
                    {i.underwriters.map((u) => (
                      <div key={u}>{u}</div>
                    ))}
                  </div>
                </td>
                <td>
                  <StatusTag status={i.stage} />
                </td>
              </RowLink>
            ))}
            {!ipos.length && <EmptyRow colSpan={4}>No matching companies.</EmptyRow>}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        <span className="text-[9px] max-phone:text-[8px]">{ipos.length} companies in view</span>
        <span>Expected proceeds, before fees</span>
      </div>
    </section>
  );
}
