"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PanelTitle, SectorDot, Segment } from "@/components/ui/primitives";
import { useUi } from "@/components/ui/UiProvider";
import { formatMonth, formatSignedPct } from "@/lib/format";
import { sectorMomentum, type VolumeMatrix, type VolumeMetric } from "@/lib/metrics";
import { SECTOR_COLORS, SECTORS } from "@/lib/sectors";
import type { Sector } from "@/lib/types";
import { VolumeChart } from "./VolumeChart";

const RANGES = [
  { value: 6, label: "6M" },
  { value: 12, label: "1Y" },
  { value: 24, label: "2Y" },
];

export function DealVolumePanel({ matrix, isSample }: { matrix: VolumeMatrix; isSample: boolean }) {
  const { toast } = useUi();
  const [metric, setMetric] = useState<VolumeMetric>("value");
  const [range, setRange] = useState(24);
  const [visible, setVisible] = useState<Set<Sector>>(() => new Set(SECTORS));

  const labels = useMemo(() => matrix.months.slice(-range).map(formatMonth), [matrix, range]);
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
  const momentum = sectorMomentum(matrix, metric);

  const first = labels[0] ?? "";
  const last = labels.at(-1) ?? "";
  const unit = metric === "value" ? "USD billions" : "deal count";
  const latestMonth = matrix.months.at(-1);

  const toggleSector = (s: Sector) => {
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
  };

  return (
    <section id="deal-volume" aria-labelledby="volume-heading" className="panel mb-[21px] max-phone:mb-[17px]">
      <div className="flex items-center justify-between gap-4 px-5 pt-[19px] pb-4 max-tablet:p-[17px] max-phone:flex-wrap max-phone:gap-2.5">
        <PanelTitle id="volume-heading" title="Deal volume" tag="M&A" subtitle={isSample ? "Announced U.S. transactions, by sector" : "Announced deals for U.S.-listed targets tracked by Castle, by sector"} />
        <div className="flex items-center gap-2.5 max-tablet:gap-1.5 max-phone:gap-[7px]">
          <Segment
            label="Chart metric"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "value", label: "$ Value" },
              { value: "count", label: "Deal count" },
            ]}
          />
          <span className="h-[19px] w-px bg-line" />
          <Segment label="Chart time range" accent value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>

      <div className="grid min-h-[289px] grid-cols-[minmax(0,1fr)_207px] wide:min-h-[324px] max-laptop:grid-cols-[minmax(0,1fr)_174px] max-tablet:grid-cols-1">
        <div className="min-w-0 px-5 pb-2 max-tablet:px-[17px]">
          <div className="mb-[13px] flex items-center justify-between gap-[15px] max-tablet:mb-2 max-phone:flex-col max-phone:items-start max-phone:gap-1.5">
            <div className="flex flex-wrap gap-[15px] max-laptop:gap-2.5 max-tablet:gap-3.5" role="group" aria-label="Toggle sectors">
              {SECTORS.map((s) => {
                const on = visible.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    aria-label={`Toggle ${s} on chart`}
                    onClick={() => toggleSector(s)}
                    className={`inline-flex items-center gap-1.5 py-0.5 text-[9px] text-[#a6aabb] hover:text-fg max-laptop:text-[8px] ${on ? "" : "line-through opacity-40"}`}
                  >
                    <span className="size-1.5 rounded-full" style={{ background: SECTOR_COLORS[s] }} />
                    {s}
                  </button>
                );
              })}
            </div>
            <span className="text-[9px] text-dim max-tablet:text-[8px]">
              {first} – {last} · {unit}
            </span>
          </div>
          <VolumeChart
            labels={labels}
            series={series}
            metric={metric}
            ariaLabel={`Monthly announced M&A ${metric === "value" ? "deal value in billions of dollars" : "deal count"} by sector, ${first} to ${last}. Visible sectors: ${[...visible].join(", ")}.`}
          />
        </div>

        <aside
          aria-label="Sector momentum"
          className="border-l border-line px-[18px] pb-2.5 max-laptop:px-[13px] max-tablet:grid max-tablet:grid-cols-5 max-tablet:border-t max-tablet:border-l-0 max-tablet:px-3 max-phone:px-1.5"
        >
          <div className="mt-px mb-[9px] flex items-center gap-[5px] text-[9px] text-muted max-tablet:hidden">
            <Icon name="pulse" className="!size-[11px]" />
            Sector momentum <span className="ml-auto text-[8px] text-dim">MoM</span>
          </div>
          {momentum.map(({ sector, changePct }) => {
            const up = changePct >= 0;
            return (
              <div
                key={sector}
                className="flex items-center justify-between gap-2.5 border-b border-soft pt-2.5 pb-[11px] last:border-0 wide:pt-[13px] wide:pb-3.5 max-tablet:block max-tablet:border-b-0 max-tablet:px-[7px] max-tablet:py-[11px] max-phone:px-1 max-phone:py-2.5"
              >
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] text-[#c9cbd6] max-tablet:gap-[5px] max-tablet:text-[9px] max-phone:gap-[3px] max-phone:text-[8px]">
                    <SectorDot sector={sector} />
                    {sector}
                  </div>
                  <div className="mt-[3px] ml-[11px] text-[8px] text-dim max-tablet:ml-2.5 max-phone:ml-2 max-phone:text-[6px] max-phone:whitespace-nowrap">
                    {up ? "Heating up" : "Cooling down"}
                  </div>
                </div>
                <div
                  className={`text-[10px] whitespace-nowrap tabular-nums max-laptop:text-[9px] max-tablet:mt-1 max-tablet:ml-2.5 max-tablet:text-[10px] max-phone:ml-2 max-phone:text-[9px] ${up ? "text-up" : "text-down"}`}
                >
                  <Icon name={up ? "trend-up" : "trend-down"} className="mr-0.5 !size-2.5" />
                  {formatSignedPct(changePct)}
                </div>
              </div>
            );
          })}
        </aside>
      </div>

      <div className="panel-foot max-phone:px-3.5 max-phone:text-[7px]">
        <span className="flex items-center">
          <Icon name="info" className="mr-1 !size-2.5" />
          Monthly totals through {latestMonth ? formatMonth(latestMonth) : "n/a"}. Momentum compares the latest two months.
        </span>
        <span className="text-[#858999] max-phone:hidden">{isSample ? "Illustrative data" : "SEC EDGAR"} · USD</span>
      </div>
    </section>
  );
}
