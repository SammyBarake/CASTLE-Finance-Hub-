"use client";

import { useMemo, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { useHubData } from "@/components/data/HubDataProvider";
import { PageHeading, SectorLabel, Select } from "@/components/ui/primitives";
import { useUi } from "@/components/ui/UiProvider";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatQuarter } from "@/lib/format";
import { valuationCards, type ValuationMetric } from "@/lib/metrics";
import { SECTOR_COLORS, SECTORS } from "@/lib/sectors";
import type { SectorValuation } from "@/lib/types";
import { BuyerTypes } from "./BuyerTypes";
import { Legend, useSectorToggle, ValuationCards, ValuationMetricToggle, VALUATION_METRICS } from "./sections";

type Sort = "sector" | "latest" | "change";
const FIELD: Record<ValuationMetric, keyof SectorValuation> = { evEbitda: "medianEvEbitda", evRevenue: "medianEvRevenue", premium: "medianPremiumPct" };

export function ValuationsView() {
  const { data } = useHubData();
  const { toast } = useUi();
  const [metric, setMetric] = useState<ValuationMetric>("evEbitda");
  const [sort, setSort] = useState<Sort>("sector");
  const { visible, toggle } = useSectorToggle();
  const m = VALUATION_METRICS[metric];

  const quarters = useMemo(() => [...new Set(data.valuations.map((v) => v.quarter))].sort(), [data.valuations]);
  const latestQ = quarters.at(-1);
  const priorQ = quarters.at(-2);
  const fmt = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}${m.unit}`);

  const series = useMemo(
    () =>
      SECTORS.map((s) => ({
        label: s,
        color: SECTOR_COLORS[s],
        data: quarters.map((q) => (data.valuations.find((v) => v.sector === s && v.quarter === q)?.[FIELD[metric]] as number | null) ?? null),
        hidden: !visible.has(s),
      })),
    [data.valuations, quarters, metric, visible],
  );

  const { cards } = valuationCards(data.valuations, metric);
  const SAMPLE_KEY = { evEbitda: "evEbitda", evRevenue: "evRevenue", premium: "premium" } as const;
  const sampleLtm = (s: string) => data.valuations.find((v) => v.sector === s && v.quarter === latestQ)?.sample?.[SAMPLE_KEY[metric]] ?? 0;
  const tableRows = [...cards].sort((a, b) =>
    sort === "latest" ? (b.latest ?? -1) - (a.latest ?? -1) : sort === "change" ? (b.latest ?? 0) - (b.previous ?? 0) - ((a.latest ?? 0) - (a.previous ?? 0)) : SECTORS.indexOf(a.sector) - SECTORS.indexOf(b.sector),
  );

  const exportRows = () => {
    const csv = toCsv(["Sector", ...quarters.map(formatQuarter)], SECTORS.map((s, i) => [s, ...series[i].data]), data.isSample);
    downloadCsv(csv, `Castle_Valuations_${m.tab.replace("/", "-")}${data.isSample ? "_Sample" : ""}.csv`);
    toast("Valuations exported.");
  };

  return (
    <>
      <PageHeading title="Valuations" subtitle={`Transaction ${m.tab} · LTM to ${latestQ ? formatQuarter(latestQ) : ""}`} onExport={exportRows} />

      <div className="section-heading">
        <h2>
          By sector <small>{m.title}</small>
        </h2>
        <ValuationMetricToggle value={metric} onChange={setMetric} />
      </div>
      <ValuationCards metric={metric} expanded />

      <section className="panel">
        <div className="panel-head">
          <h2>Transaction multiples</h2>
          <span className="dim" style={{ fontSize: 10 }}>
            LTM {m.title.replace(/^Median/, "median")} · trailing four quarters
          </span>
        </div>
        <div className="chart-main">
          <div className="chart-meta">
            <Legend visible={visible} onToggle={toggle} label="Visible valuation sectors" />
            <span className="chart-unit">{metric === "premium" ? "Percent" : "Multiple (x)"}</span>
          </div>
        </div>
        <LineChart
          className="quarter-chart"
          labels={quarters.map(formatQuarter)}
          series={series}
          points
          format={(v) => `${v.toFixed(1)}${m.unit}`}
          formatTick={(v) => `${v}${m.unit}`}
          ariaLabel={`${m.title} by sector, ${quarters[0] ? formatQuarter(quarters[0]) : ""} to ${latestQ ? formatQuarter(latestQ) : ""}`}
        />
        <div className="panel-foot">
          <span>
            {quarters[0] && formatQuarter(quarters[0])} – {latestQ && formatQuarter(latestQ)}
          </span>
          <span>Shown when 3+ deals disclose the figure · {latestQ && formatQuarter(latestQ)} to date</span>
        </div>
      </section>

      <BuyerTypes />

      <section className="panel">
        <div className="table-tools">
          <h2>Sector comparison</h2>
          <Select
            id="valuation-sort"
            label="Sort valuation table"
            value={sort}
            onChange={setSort}
            options={[
              { value: "sector", label: "Sector order" },
              { value: "latest", label: "Highest latest" },
              { value: "change", label: "Largest increase" },
            ]}
          />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">SECTOR</th>
                <th scope="col" className="right">{latestQ ? formatQuarter(latestQ).toUpperCase() : "LATEST"}</th>
                <th scope="col" className="right">{priorQ ? formatQuarter(priorQ).toUpperCase() : "PRIOR"}</th>
                <th scope="col" className="right">CHANGE</th>
                <th scope="col" className="right">8-QUARTER RANGE</th>
                <th scope="col" className="right">DEALS IN MEDIAN (LTM)</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((c) => {
                const change = c.latest != null && c.previous != null ? c.latest - c.previous : null;
                return (
                  <tr key={c.sector}>
                    <td>
                      <SectorLabel sector={c.sector} />
                    </td>
                    <td className="right table-value">{fmt(c.latest)}</td>
                    <td className="right mono">{fmt(c.previous)}</td>
                    <td className={`right mono ${change == null ? "" : change >= 0 ? "up" : "down"}`}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}${m.deltaUnit}`}</td>
                    <td className="right mono">{c.series.length ? `${fmt(Math.min(...c.series))} – ${fmt(Math.max(...c.series))}` : "—"}</td>
                    <td className="right mono">{sampleLtm(c.sector)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
