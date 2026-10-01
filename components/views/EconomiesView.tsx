"use client";

import { useMemo, useState } from "react";
import { BarChart } from "@/components/charts/BarChart";
import { useHubData } from "@/components/data/HubDataProvider";
import { Kpi, Kpis, PageHeading, Select } from "@/components/ui/primitives";
import { EmptyRow } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate } from "@/lib/format";
import type { Economy, Region } from "@/lib/types";

const pct = (v: number | null, digits = 1) => (v == null ? "—" : `${v.toFixed(digits)}%`);
/** Policy rates keep their quarter-point precision (3.875%), trimmed of trailing zeros. */
const rate = (v: number | null) => (v == null ? "—" : `${Number(v.toFixed(3))}%`);
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });

function Delta({ now, prior }: { now: number | null; prior: number | null }) {
  if (now == null || prior == null) return null;
  const d = now - prior;
  if (Math.abs(d) < 0.05) return <span className="dim" style={{ marginLeft: 6, fontSize: 9 }}>±0.0</span>;
  return (
    <span className={d > 0 ? "up" : "down"} style={{ marginLeft: 6, fontSize: 9 }}>
      {d > 0 ? "+" : ""}
      {d.toFixed(1)}
    </span>
  );
}

export function EconomiesView() {
  const { data } = useHubData();
  const { toast } = useUi();
  const macro = data.macro;
  const [region, setRegion] = useState<Region | "all">("all");

  const rows = useMemo(() => (macro?.economies ?? []).filter((e) => region === "all" || e.region === region), [macro, region]);
  const us = macro?.economies.find((e) => e.code === "US");
  const year = macro?.forecastYear ?? new Date(data.asOf).getUTCFullYear();

  const exportRows = () => {
    if (!rows.length) return toast("No rows to export.");
    const csv = toCsv(
      ["Economy", "Region", `GDP growth ${year - 1} (%)`, `GDP growth ${year} est. (%)`, `Inflation ${year - 1} (%)`, `Inflation ${year} est. (%)`, "Policy rate (%)", "Policy rate date"],
      rows.map((e) => [e.name, e.region, e.gdpGrowthPrior, e.gdpGrowth, e.inflationPrior, e.inflation, e.policyRate, e.policyRateDate]),
      data.isSample,
    );
    downloadCsv(csv, `Castle_World_Economies${data.isSample ? "_Sample" : ""}.csv`);
    toast(`${rows.length} rows exported.`);
  };

  if (!macro) {
    return (
      <>
        <PageHeading title="World Economies" subtitle="Growth, inflation and interest rates" />
        <section className="panel">
          <div className="empty-small">Macro data hasn&apos;t been collected yet. It&apos;s fetched with the next scheduled data update.</div>
        </section>
      </>
    );
  }

  const byGrowth = [...rows].sort((a, b) => (b.gdpGrowth ?? -99) - (a.gdpGrowth ?? -99));
  const labelOf = (e: Economy) => e.name;

  return (
    <>
      <PageHeading title="World Economies" subtitle={`Growth, inflation and interest rates · ${monthYear(macro.asOf)}`} onExport={exportRows} />

      <Kpis label="U.S. snapshot">
        <Kpi label="U.S. GDP growth" value={pct(us?.gdpGrowth ?? null)} note={`${year} IMF estimate · ${us?.gdpGrowthPrior != null ? `${pct(us.gdpGrowthPrior)} in ${year - 1}` : ""}`} />
        <Kpi label="U.S. policy rate" value={rate(us?.policyRate ?? null)} note={us?.policyRateDate ? `Fed target midpoint · ${formatDate(us.policyRateDate)}` : "Federal Reserve"} />
        <Kpi label="U.S. inflation" value={pct(us?.inflation ?? null)} note={`${year} average, IMF estimate`} />
        <Kpi label="Economies tracked" value={macro.economies.length} note="Major economies · IMF & BIS" />
      </Kpis>

      <div className="section-heading">
        <span className="dim" style={{ fontSize: 10 }}>
          Economic indicators
        </span>
        <Select
          id="economy-region"
          label="Region"
          value={region}
          onChange={setRegion}
          options={[
            { value: "all" as const, label: "All regions" },
            { value: "Americas" as const, label: "Americas" },
            { value: "Europe" as const, label: "Europe" },
            { value: "Asia-Pacific" as const, label: "Asia-Pacific" },
          ]}
        />
      </div>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h2>GDP growth</h2>
            <span className="dim" style={{ fontSize: 10 }}>
              {year} est., real, %
            </span>
          </div>
          <div className="chart-card">
            <BarChart
              labels={byGrowth.map(labelOf)}
              series={[{ label: `GDP growth ${year}`, data: byGrowth.map((e) => e.gdpGrowth), color: byGrowth.map((e) => (e.code === "US" ? "#d2d2d2" : "#747474")) }]}
              ariaLabel={`Real GDP growth ${year} by economy`}
            />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Inflation &amp; policy rates</h2>
            <span className="dim" style={{ fontSize: 10 }}>
              %
            </span>
          </div>
          <div className="chart-card">
            <BarChart
              legend
              labels={rows.map((e) => e.code)}
              series={[
                { label: `Inflation ${year} est.`, data: rows.map((e) => e.inflation), color: "#aeaeae" },
                { label: "Policy rate", data: rows.map((e) => e.policyRate), color: "#617e70" },
              ]}
              ariaLabel="Inflation and central-bank policy rates by economy"
            />
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Economic indicators</h2>
          <span className="dim" style={{ fontSize: 10 }}>
            Change vs. {year - 1} in points
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">ECONOMY</th>
                <th scope="col" className="right">GDP GROWTH {year}E</th>
                <th scope="col" className="right">INFLATION {year}E</th>
                <th scope="col" className="right">POLICY RATE</th>
                <th scope="col" className="right">RATE AS OF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.code}>
                  <td className="company">
                    <span className="country-code">{e.code}</span>
                    {e.name}
                  </td>
                  <td className="right table-value">
                    {pct(e.gdpGrowth)}
                    <Delta now={e.gdpGrowth} prior={e.gdpGrowthPrior} />
                  </td>
                  <td className="right mono">
                    {pct(e.inflation)}
                    <Delta now={e.inflation} prior={e.inflationPrior} />
                  </td>
                  <td className="right mono">{rate(e.policyRate)}</td>
                  <td className="right table-date">{e.policyRateDate ? formatDate(e.policyRateDate) : "—"}</td>
                </tr>
              ))}
              {!rows.length && <EmptyRow colSpan={5}>No economies in this region.</EmptyRow>}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <span>{data.isSample ? "Illustrative figures" : `GDP growth and inflation: IMF World Economic Outlook (${year} = estimate). Policy rates: BIS.`}</span>
          <span>Updated {formatDate(macro.asOf.slice(0, 10))}</span>
        </div>
      </section>
    </>
  );
}
