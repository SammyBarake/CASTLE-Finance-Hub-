import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Delta, DOWN_COLOR, Sparkline, UP_COLOR } from "@/components/ui/primitives";
import { formatMonthEnd, formatPct, formatRaise, formatSignedPct, formatUsd } from "@/lib/format";
import type { YtdSummary } from "@/lib/metrics";

function Kpi({
  label,
  hint,
  value,
  aside,
  foot,
  spark,
}: {
  label: string;
  hint: string;
  value: string;
  aside?: ReactNode;
  foot: string;
  spark?: { values: number[]; up: boolean };
}) {
  return (
    <div className="relative border-r border-line px-[21px] pt-[17px] pb-4 last:border-r-0 max-laptop:p-4 max-tablet:nth-2:border-r-0 max-tablet:nth-[-n+2]:border-b max-phone:p-[15px]">
      <div className="mb-[9px] flex items-center gap-1.5 text-[10px] text-muted max-phone:text-[9px]" title={hint}>
        {label} <Icon name="info" className="!size-3 text-[#656b7d]" />
      </div>
      <div className="flex items-baseline gap-[13px] max-laptop:gap-2 max-phone:flex-wrap max-phone:gap-y-1">
        <span className="num text-[27px] leading-[1.1] font-medium tracking-[-0.8px] max-laptop:text-[24px]">{value}</span>
        {aside}
      </div>
      <div className="mt-[9px] text-[9px] text-dim max-phone:text-[8px]">{foot}</div>
      {spark && (
        <Sparkline
          values={spark.values}
          width={72}
          height={26}
          strokeWidth={1.3}
          stroke={spark.up ? UP_COLOR : DOWN_COLOR}
          className="absolute right-[19px] bottom-[18px] h-[26px] w-[72px] opacity-80 max-phone:hidden"
        />
      )}
    </div>
  );
}

export function KpiStrip({
  ytd,
  medianPremiumPct,
  ipoRaiseUsd,
  ipoFiledCount,
}: {
  ytd: YtdSummary | null;
  medianPremiumPct: number | null;
  ipoRaiseUsd: number;
  ipoFiledCount: number;
}) {
  const ytdFoot = ytd ? `${ytd.year} YTD · through ${formatMonthEnd(ytd.throughMonth)}` : "No data";
  const vsPrior = ytd ? `Versus the same months of ${ytd.year - 1}` : undefined;
  return (
    <section
      aria-label="Market snapshot"
      className="mb-[21px] grid grid-cols-4 overflow-hidden rounded-[7px] border border-line bg-panel max-tablet:grid-cols-2 max-phone:mb-[17px]"
    >
      <Kpi
        label="Announced deal value"
        hint="Total disclosed value of announced U.S. M&A, year to date."
        value={ytd ? formatUsd(ytd.value) : "—"}
        aside={ytd && <span title={vsPrior}><Delta value={ytd.valueChangePct} className="text-[10px] max-laptop:text-[9px]">{formatSignedPct(ytd.valueChangePct)}</Delta></span>}
        foot={ytdFoot}
        spark={ytd ? { values: ytd.monthlyValue, up: ytd.valueChangePct >= 0 } : undefined}
      />
      <Kpi
        label="Announced transactions"
        hint="Number of announced U.S. M&A transactions, year to date."
        value={ytd ? ytd.count.toLocaleString("en-US") : "—"}
        aside={ytd && <span title={vsPrior}><Delta value={ytd.countChangePct} className="text-[10px] max-laptop:text-[9px]">{formatSignedPct(ytd.countChangePct)}</Delta></span>}
        foot={ytdFoot}
        spark={ytd ? { values: ytd.monthlyCount, up: ytd.countChangePct >= 0 } : undefined}
      />
      <Kpi
        label="Median deal premium"
        hint="Median offer premium over the unaffected share price, across the latest deals."
        value={formatPct(medianPremiumPct)}
        aside={<span className="tiny-tag max-phone:hidden">LATEST DEALS</span>}
        foot="Offer vs. unaffected share price"
      />
      <Kpi
        label="IPO capital in the pipeline"
        hint="Sum of expected gross proceeds for companies that have filed but not yet priced."
        value={formatRaise(ipoRaiseUsd)}
        aside={<span className="text-[10px] text-muted max-laptop:text-[9px]">{ipoFiledCount} filed</span>}
        foot="Expected raise · filed companies"
      />
    </section>
  );
}
