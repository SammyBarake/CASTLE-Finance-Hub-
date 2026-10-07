"use client";

import { useHubData } from "@/components/data/HubDataProvider";
import { Kpi, Kpis, PageHeading, SectorLabel } from "@/components/ui/primitives";
import { useUi } from "@/components/ui/UiProvider";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDateLong, formatMonth, formatRaise, formatUsd } from "@/lib/format";
import { rangeSummary, sectorBreakdown } from "@/lib/metrics";
import { SECTORS } from "@/lib/sectors";
import { useVolumeState, VolumePanel } from "./sections";

export function DealVolumeView() {
  const { data, matrix } = useHubData();
  const { toast } = useUi();
  const volume = useVolumeState();
  const s = rangeSummary(matrix, volume.range);
  const breakdown = sectorBreakdown(matrix, volume.range);
  const period = s.firstMonth && s.lastMonth ? `${formatMonth(s.firstMonth)} – ${formatMonth(s.lastMonth)}` : "";

  const exportRows = () => {
    const months = matrix.months.slice(-volume.range);
    const key = volume.metric;
    const headers = ["Month", ...SECTORS.map((sec) => `${sec} ${key === "value" ? "(USD)" : "(deals)"}`)];
    const rows = months.map((m, i) => [m, ...SECTORS.map((sec) => matrix.bySector[sec][key].slice(-volume.range)[i])]);
    downloadCsv(toCsv(headers, rows, data.isSample), `Castle_Deal_Volume${data.isSample ? "_Sample" : ""}.csv`);
    toast(`${rows.length} rows exported.`);
  };

  return (
    <>
      <PageHeading title="Deal Volume" subtitle={`Monthly announced U.S. M&A · ${period}`} onExport={exportRows} />

      <Kpis label="Deal volume summary">
        <Kpi label="Announced value" value={formatUsd(s.value)} note={period} />
        <Kpi label="Transactions" value={s.count.toLocaleString("en-US")} note="All five sectors" />
        <Kpi label="Monthly average" value={formatUsd(s.monthlyAverage)} note={s.partialMonth ? "Complete months" : "Announced transaction value"} />
        {s.partialMonth ? (
          <Kpi
            label={`${formatMonth(s.partialMonth).split(" ")[0]} to date`}
            value={formatUsd(s.partialValue)}
            note={`${s.partialCount} deals${data.yearToDate ? ` · through ${formatDateLong(data.yearToDate.through)}` : ""}`}
          />
        ) : (
          <Kpi label="Latest month" value={formatUsd(s.latestMonthValue)} note={s.latestMonth ? formatMonth(s.latestMonth) : ""} />
        )}
      </Kpis>

      <VolumePanel state={volume} large />

      <section className="panel">
        <div className="panel-head">
          <h2>Sector breakdown</h2>
          <span className="dim" style={{ fontSize: 10 }}>
            {volume.range} months
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">SECTOR</th>
                <th scope="col" className="right">DEAL VALUE</th>
                <th scope="col" className="right">TRANSACTIONS</th>
                <th scope="col" className="right">AVG. DEAL SIZE</th>
                <th scope="col" className="right">SHARE OF VALUE</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((b) => (
                <tr key={b.sector}>
                  <td>
                    <SectorLabel sector={b.sector} />
                  </td>
                  <td className="right table-value">{formatUsd(b.value)}</td>
                  <td className="right mono">{b.count.toLocaleString("en-US")}</td>
                  <td className="right table-value">{b.averageSize == null ? "—" : formatRaise(b.averageSize)}</td>
                  <td className="right mono">{b.share.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
