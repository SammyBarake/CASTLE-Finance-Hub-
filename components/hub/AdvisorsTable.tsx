"use client";

import { Icon } from "@/components/ui/Icon";
import { PanelTitle } from "@/components/ui/primitives";
import { compactPanelHead, EmptyRow, RowLink } from "@/components/ui/table";
import { formatUsdB1 } from "@/lib/format";
import type { LeagueTableEntry } from "@/lib/types";

export function AdvisorsTable({
  entries,
  allEntries,
  period,
  onSelect,
}: {
  entries: LeagueTableEntry[];
  /** Unfiltered table; ranks and bar widths are relative to it. */
  allEntries: LeagueTableEntry[];
  period: string;
  onSelect: (e: LeagueTableEntry, rank: number) => void;
}) {
  const top = allEntries[0]?.dealValueUsd || 1;
  return (
    <section id="advisors" aria-labelledby="advisors-heading" className="panel">
      <div className={compactPanelHead}>
        <PanelTitle id="advisors-heading" title="Who's advising" tag={period} subtitle="U.S. M&A league table · ranked by deal value" />
        <Icon name="bank" className="!w-4 text-muted" />
      </div>
      <div className="overflow-x-auto">
        <table className="data-table compact [&_td]:h-[49px]">
          <caption className="sr-only">Advisor rankings. Rank changes compared with the prior quarter.</caption>
          <thead>
            <tr>
              <th scope="col">RANK</th>
              <th scope="col">ADVISOR</th>
              <th scope="col" className="text-right">DEALS</th>
              <th scope="col" className="text-right">DEAL VALUE</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const rank = allEntries.indexOf(e) + 1;
              const change = e.rankChange;
              return (
                <RowLink key={e.advisor.name} label={`View ${e.advisor.name} advisory activity`} onOpen={() => onSelect(e, rank)}>
                  <td className="w-[43px] font-mono !text-[10px] !text-[#787f92]">
                    {String(rank).padStart(2, "0")}
                    <span
                      className={`ml-[5px] inline-flex w-[26px] items-center gap-[3px] text-[8px] ${change > 0 ? "text-up" : change < 0 ? "text-down" : "text-muted"}`}
                    >
                      {change === 0 ? (
                        "—"
                      ) : (
                        <>
                          <Icon name={change > 0 ? "arrow-up" : "arrow-down"} className="!size-[9px]" />
                          {Math.abs(change)}
                        </>
                      )}
                    </span>
                  </td>
                  <td>
                    <span className="flex items-center gap-[9px] text-[10px] font-medium text-[#d0d3df]">
                      <span
                        className={`grid size-6 place-items-center rounded border text-[7px] font-semibold ${
                          rank === 1 ? "border-[#344658] bg-[#253342] text-[#b4cadc]" : "border-[#2e323d] bg-[#20232b] text-[#b5bdcf]"
                        }`}
                      >
                        {e.advisor.shortName}
                      </span>
                      {e.advisor.name}
                    </span>
                  </td>
                  <td className="text-right font-mono !text-[#d3d5e0]">{e.dealCount}</td>
                  <td className="text-right">
                    <span className="value-cell relative inline-block min-w-[98px]">
                      {formatUsdB1(e.dealValueUsd)}
                      <span className="absolute -bottom-[7px] left-0 h-0.5 bg-[#514968] opacity-80" style={{ width: `${(e.dealValueUsd / top) * 100}%` }} />
                    </span>
                  </td>
                </RowLink>
              );
            })}
            {!entries.length && <EmptyRow colSpan={4}>No matching advisors.</EmptyRow>}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        <span className="text-[9px] max-phone:text-[8px]">{entries.length} advisors · announced transactions</span>
        <span>Rank change vs. prior quarter</span>
      </div>
    </section>
  );
}
