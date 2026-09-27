"use client";

import { useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { Change, CompanyMark, Kpi, Kpis, PageHeading, PageLink } from "@/components/ui/primitives";
import { useUi } from "@/components/ui/UiProvider";
import { useRecordActions } from "@/components/workspace/actions";
import { dealsToCsv, downloadCsv } from "@/lib/csv";
import { formatDate, formatDateFull, formatMonth, formatPct, formatRaise, formatUsd, formatUsdB1 } from "@/lib/format";
import type { ValuationMetric } from "@/lib/metrics";
import { useVolumeState, ValuationCards, ValuationMetricToggle, VALUATION_METRICS, VolumePanel } from "./sections";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });

export function HubView() {
  const { data, ytd, medianPremiumPct, ipoSummary } = useHubData();
  const { openDeal, openIpo, openAdvisor } = useDetails();
  const { toast } = useUi();
  const { openRowMenu } = useRecordActions();
  const volume = useVolumeState();
  const [metric, setMetric] = useState<ValuationMetric>("evEbitda");

  const ytdNote = ytd ? `Jan–${formatMonth(ytd.throughMonth).split(" ")[0]} ${ytd.year} · YoY` : "No data";
  const exportDeals = () => {
    downloadCsv(dealsToCsv(data.deals, data.isSample), data.isSample ? "Castle_Deals_Sample.csv" : "Castle_Deals.csv");
    toast(`${data.deals.length} rows exported.`);
  };

  return (
    <>
      <PageHeading title="Hub" subtitle={`U.S. investment banking · ${monthYear(data.asOf)}`} date={formatDateFull(data.asOf)} onExport={exportDeals} exportLabel="Export deals as CSV" />

      <Kpis label="Market snapshot">
        <Kpi label="Announced M&A value" value={ytd ? formatUsd(ytd.value) : "—"} note={ytdNote} change={ytd && <Change value={ytd.valueChangePct} />} />
        <Kpi label="M&A transactions" value={ytd ? ytd.count.toLocaleString("en-US") : "—"} note={ytdNote} change={ytd && <Change value={ytd.countChangePct} />} />
        <Kpi label="Median premium" value={formatPct(medianPremiumPct)} note={`Latest ${Math.min(25, data.deals.filter((d) => d.premiumPct != null).length)} public-target deals`} />
        <Kpi label="IPO pipeline" value={formatRaise(ipoSummary.expectedRaiseUsd)} note={`${ipoSummary.filedCount} filed companies · expected raise`} />
      </Kpis>

      <VolumePanel state={volume} />

      <section aria-label="Valuation moves">
        <div className="section-heading">
          <h2>
            Valuations <small>{VALUATION_METRICS[metric].title}</small>
          </h2>
          <div className="panel-controls">
            <ValuationMetricToggle value={metric} onChange={setMetric} />
            <PageLink href="/valuations">Compare sectors</PageLink>
          </div>
        </div>
        <ValuationCards metric={metric} />
      </section>

      <div className="hub-grid">
        <section className="panel" aria-label="Recent deal flow">
          <div className="panel-head">
            <h2>Recent deals</h2>
            <PageLink href="/deal-flow" />
          </div>
          {data.deals.slice(0, 4).map((d) => (
            <button
              key={d.id}
              type="button"
              className="preview-row"
              onClick={() => openDeal(d)}
              title="Open details"
              onContextMenu={(e) => {
                e.preventDefault();
                openRowMenu("deal", d, { x: e.clientX, y: e.clientY });
              }}
            >
              <span className="preview-company">
                <CompanyMark name={d.target.name} />
                <span>
                  <strong>{d.target.name}</strong>
                  <small>
                    {d.acquirer.name} · {formatDate(d.announcedDate).slice(0, 6)}
                  </small>
                </span>
              </span>
              <span className="preview-value">
                {formatUsd(d.valueUsd)}
                <small>{d.sector}</small>
              </span>
            </button>
          ))}
          {!data.deals.length && <div className="empty-small">No deals yet.</div>}
        </section>

        <section className="panel" aria-label="IPO pipeline">
          <div className="panel-head">
            <h2>IPO pipeline</h2>
            <PageLink href="/ipo-pipeline" />
          </div>
          {data.ipos.slice(0, 4).map((i) => (
            <button
              key={i.id}
              type="button"
              className="preview-row"
              onClick={() => openIpo(i)}
              title="Open details"
              onContextMenu={(e) => {
                e.preventDefault();
                openRowMenu("ipo", i, { x: e.clientX, y: e.clientY });
              }}
            >
              <span className="preview-company">
                <span>
                  <strong>{i.company.name}</strong>
                  <small>
                    {i.sector} · {i.stage}
                  </small>
                </span>
              </span>
              <span className="preview-value">{formatRaise(i.expectedRaiseUsd)}</span>
            </button>
          ))}
          {!data.ipos.length && <div className="empty-small">No companies in the pipeline.</div>}
        </section>

        <section className="panel" aria-label="Advisors">
          <div className="panel-head">
            <h2>Leading advisors</h2>
            <PageLink href="/advisors" />
          </div>
          {data.leagueTable.entries.slice(0, 4).map((e, i) => (
            <button key={e.advisor.name} type="button" className="preview-row" onClick={() => openAdvisor(e, i + 1)}>
              <span className="preview-company">
                <span className="preview-rank">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <strong>{e.advisor.name}</strong>
                  <small>{e.dealCount} deals</small>
                </span>
              </span>
              <span className="preview-value">{formatUsdB1(e.dealValueUsd)}</span>
            </button>
          ))}
          {!data.leagueTable.entries.length && <div className="empty-small">No advisor data yet.</div>}
        </section>
      </div>
    </>
  );
}
