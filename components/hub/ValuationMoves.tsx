"use client";

import { useState } from "react";
import { DOWN_COLOR, SectorDot, Segment, Sparkline, UP_COLOR } from "@/components/ui/primitives";
import { formatQuarter } from "@/lib/format";
import { valuationCards, type ValuationMetric } from "@/lib/metrics";
import type { SectorValuation } from "@/lib/types";

const METRICS: Record<ValuationMetric, { tab: string; subtitle: string; unit: string; deltaUnit: string; noun: string }> = {
  evEbitda: { tab: "EV/EBITDA", subtitle: "Median transaction EV / EBITDA", unit: "x", deltaUnit: "x", noun: "times" },
  evRevenue: { tab: "EV/Revenue", subtitle: "Median transaction EV / Revenue", unit: "x", deltaUnit: "x", noun: "times" },
  premium: { tab: "Premium", subtitle: "Median premium paid", unit: "%", deltaUnit: " pts", noun: "percent" },
};

export function ValuationMoves({ valuations }: { valuations: SectorValuation[] }) {
  const [metric, setMetric] = useState<ValuationMetric>("evEbitda");
  const m = METRICS[metric];
  const { latestQuarter, cards } = valuationCards(valuations, metric);

  return (
    <section id="valuations" aria-labelledby="valuation-heading" className="mb-[23px] scroll-mt-[90px] max-phone:mb-4">
      <div className="mb-3 flex items-center justify-between gap-3 max-phone:flex-wrap">
        <div className="flex items-center gap-[9px] max-phone:block">
          <h2 id="valuation-heading" className="text-[13px] font-[550] tracking-[-0.1px] max-phone:text-[12px]">
            Valuation moves
          </h2>
          <span className="text-[10px] text-muted max-tablet:text-[9px] max-phone:mt-[3px] max-phone:block max-phone:text-[8px]">{m.subtitle}</span>
        </div>
        <div className="flex items-center gap-3">
          <Segment
            label="Valuation metric"
            value={metric}
            onChange={setMetric}
            options={(Object.keys(METRICS) as ValuationMetric[]).map((k) => ({ value: k, label: METRICS[k].tab }))}
          />
          {latestQuarter && (
            <span className="eyebrow !text-[8px] !tracking-[0.8px] max-phone:hidden">{formatQuarter(latestQuarter)} to date</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-[11px] max-tablet:grid-cols-[repeat(5,minmax(0,1fr))] max-tablet:gap-[7px] max-phone:flex max-phone:gap-2 max-phone:overflow-x-auto max-phone:pb-[5px]">
        {cards.map((c) => {
          const delta = c.latest != null && c.previous != null ? c.latest - c.previous : 0;
          const up = delta >= 0;
          return (
            <div
              key={c.sector}
              className="relative overflow-hidden rounded-md border border-line bg-panel px-[15px] pt-[13px] pb-3 wide:py-[15px] max-laptop:pl-3 max-tablet:px-[9px] max-tablet:py-[11px] max-phone:flex-[0_0_135px] max-phone:p-3"
            >
              <div className="mb-[9px] flex items-center gap-1.5 text-[10px] text-[#b1b5c4] max-tablet:text-[9px]">
                <SectorDot sector={c.sector} />
                {c.sector}
              </div>
              <div className="flex items-baseline gap-[7px] max-laptop:gap-[5px] max-tablet:block max-phone:flex max-phone:gap-[7px]">
                <div className="num text-[23px] leading-[1.15] font-medium tracking-[-0.5px] wide:text-[26px] max-laptop:text-[20px] max-phone:text-[23px]">
                  {c.latest != null ? c.latest.toFixed(1) : "n/a"}
                  <span className="ml-0.5 text-[14px] text-muted">{m.unit}</span>
                </div>
                <span
                  className={`text-[9px] whitespace-nowrap max-laptop:text-[8px] max-tablet:mt-[5px] max-tablet:block max-phone:inline max-phone:text-[8px] ${up ? "text-up" : "text-down"}`}
                >
                  {up ? "↗" : "↘"} {up ? "+" : ""}
                  {delta.toFixed(1)}
                  {m.deltaUnit}
                </span>
              </div>
              <div className="mt-[7px] text-[8px] text-dim max-tablet:mt-1 max-tablet:text-[7px] max-phone:mt-[7px] max-phone:text-[8px]">vs. last quarter</div>
              <Sparkline
                values={c.series}
                width={63}
                height={26}
                stroke={up ? UP_COLOR : DOWN_COLOR}
                label={`${c.sector} ${m.tab} trend across ${c.series.length} quarters: ${c.series.join(", ")} ${m.noun}`}
                className="absolute right-3 bottom-2 h-[26px] w-[63px] max-laptop:w-[46px] max-tablet:right-1.5 max-tablet:bottom-[26px] max-tablet:h-[22px] max-tablet:w-9 max-tablet:opacity-65 max-phone:right-[9px] max-phone:bottom-2 max-phone:w-10 max-phone:opacity-100"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
