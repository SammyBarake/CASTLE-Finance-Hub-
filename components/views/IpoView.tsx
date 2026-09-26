"use client";

import { useMemo, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyMark, Kpi, Kpis, PageHeading, SectorLabel, Select, StatusTag } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate, formatDateFull, formatRaise } from "@/lib/format";
import { sum } from "@/lib/metrics";
import { IPO_STAGES, SECTORS, type IpoStage, type Sector } from "@/lib/types";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });

export function IpoView() {
  const { data } = useHubData();
  const { openIpo } = useDetails();
  const { toast } = useUi();
  const [stage, setStage] = useState<IpoStage | "all">("all");
  const [sector, setSector] = useState<Sector | "all">("all");

  const rows = useMemo(() => data.ipos.filter((i) => (stage === "all" || i.stage === stage) && (sector === "all" || i.sector === sector)), [data.ipos, stage, sector]);
  const filed = data.ipos.filter((i) => i.stage === "Filed");
  const count = (s: IpoStage) => data.ipos.filter((i) => i.stage === s).length;

  const exportRows = () => {
    if (!rows.length) return toast("No rows to export.");
    const csv = toCsv(
      ["Company", "Ticker", "Sector", "Filing date", "Priced date", "Expected raise (USD)", "Offer price (USD)", "Underwriters", "Stage"],
      rows.map((i) => [i.company.name, i.company.ticker, i.sector, i.filedDate, i.pricedDate, i.expectedRaiseUsd, i.offerPrice, i.underwriters.join("; "), i.stage]),
      data.isSample,
    );
    downloadCsv(csv, `Castle_IPO_Pipeline${data.isSample ? "_Sample" : ""}.csv`);
    toast(`${rows.length} rows exported.`);
  };

  return (
    <>
      <PageHeading title="IPO Pipeline" subtitle={`U.S. public offerings · ${monthYear(data.asOf)}`} date={formatDateFull(data.asOf)} onExport={exportRows} />

      <Kpis label="IPO summary">
        <Kpi label="Filed companies" value={filed.length} note="Awaiting pricing" />
        <Kpi label="Expected raise" value={formatRaise(sum(filed.map((i) => i.expectedRaiseUsd ?? 0)))} note="Filed companies with a disclosed size" />
        <Kpi label="Priced" value={count("Priced")} note="Awaiting first trade" />
        <Kpi label="Trading" value={count("Trading")} note="Recent listings" />
      </Kpis>

      <section className="panel">
        <div className="tabs" role="group" aria-label="IPO stage">
          {(["all", ...IPO_STAGES] as const).map((s) => (
            <button key={s} type="button" className="tab" aria-pressed={stage === s} onClick={() => setStage(s)}>
              {s === "all" ? "All companies" : s}
              <span>{s === "all" ? data.ipos.length : count(s)}</span>
            </button>
          ))}
        </div>
        <div className="table-tools">
          <span className="dim" style={{ fontSize: 10 }}>
            {rows.length} companies
          </span>
          <div className="table-filters">
            <Select id="ipo-sector" label="IPO sector" value={sector} onChange={setSector} options={[{ value: "all" as const, label: "All sectors" }, ...SECTORS.map((s) => ({ value: s, label: s }))]} />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">IPO pipeline</caption>
            <thead>
              <tr>
                <th scope="col">COMPANY</th>
                <th scope="col">SECTOR</th>
                <th scope="col">FILING DATE</th>
                <th scope="col" className="right">EXPECTED RAISE</th>
                <th scope="col">LEAD UNDERWRITERS</th>
                <th scope="col">STAGE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <RowLink key={i.id} label={`${i.company.name} IPO`} onOpen={() => openIpo(i)}>
                  <td className="company">
                    <span className="company-line">
                      <CompanyMark name={i.company.name} />
                      <span>
                        {i.company.name}
                        {i.company.ticker && <small>{i.company.ticker}</small>}
                      </span>
                    </span>
                  </td>
                  <td>
                    <SectorLabel sector={i.sector} />
                  </td>
                  <td className="table-date">{formatDate(i.filedDate)}</td>
                  <td className="right table-value">{formatRaise(i.expectedRaiseUsd)}</td>
                  <td className="table-underwriters">
                    {i.underwriters.length ? i.underwriters.slice(0, 2).join(" · ") + (i.underwriters.length > 2 ? ` +${i.underwriters.length - 2}` : "") : <span className="dim">—</span>}
                  </td>
                  <td>
                    <StatusTag status={i.stage} />
                  </td>
                </RowLink>
              ))}
              {!rows.length && <EmptyRow colSpan={6}>No companies in this selection.</EmptyRow>}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <span>Expected gross proceeds, before fees</span>
          <span>USD</span>
        </div>
      </section>
    </>
  );
}
