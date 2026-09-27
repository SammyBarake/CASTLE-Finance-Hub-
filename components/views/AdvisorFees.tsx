"use client";

import { useMemo, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { CompanyMark, Kpi, Kpis, PanelHead } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { bankShortName } from "@/lib/banks";
import { feeInsights, feeLeague, feeRecords, feesBySize, formatBps } from "@/lib/fees";
import { formatDate, formatUsd } from "@/lib/format";

const PAGE = 15;

/** "Fees earned" view of the Advisors page: disclosed advisory fees from merger-proxy fairness opinions. */
export function AdvisorFees() {
  const { data } = useHubData();
  const { openDeal, openAdvisorByName } = useDetails();
  const records = useMemo(() => feeRecords(data.deals), [data.deals]);
  const league = useMemo(() => feeLeague(records), [records]);
  const bySize = useMemo(() => feesBySize(records), [records]);
  const notes = useMemo(() => feeInsights(records, league, bySize), [records, league, bySize]);
  const paydays = useMemo(() => [...records].sort((a, b) => b.feeUsd - a.feeUsd), [records]);
  const [shown, setShown] = useState(PAGE);

  if (!records.length) {
    return (
      <section className="panel">
        <div className="empty-small">
          {data.isSample ? "Fees come from real merger proxies, so they appear once the site is showing live data." : "No disclosed fees yet."}
        </div>
      </section>
    );
  }

  const total = records.reduce((s, r) => s + r.feeUsd, 0);
  const allBps = records.map((r) => r.bps).filter((v): v is number => v != null).sort((a, b) => a - b);
  const medianBps = allBps.length ? allBps[Math.floor(allBps.length / 2)] : null;
  const fees = records.map((r) => r.feeUsd).sort((a, b) => a - b);
  const maxBand = Math.max(1, ...bySize.map((b) => b.medianBps ?? 0));
  const isRanked = (name: string) => data.leagueTable.entries.some((e) => e.advisor.name === name);

  return (
    <>
      <Kpis label="Fee summary">
        <Kpi label="Disclosed fees" value={formatUsd(total)} note={`${records.length} fees in merger proxies`} />
        <Kpi label="Top earner" value={league[0].bank} note={`${formatUsd(league[0].totalUsd)} across ${league[0].deals} deals`} text />
        <Kpi label="Median fee" value={formatUsd(fees[Math.floor(fees.length / 2)])} note="Per bank, per deal" />
        <Kpi label="Median fee % of deal" value={formatBps(medianBps)} note="Fee ÷ deal value" />
      </Kpis>

      <section className="panel timeline-notes">
        <PanelHead title="What the data says" subtitle="How investment banks get paid for M&A advice" />
        <ul>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      <div className="two-col timeline-grid">
        <section className="panel">
          <PanelHead title="Fee league table" subtitle="Ranked by total disclosed fees" />
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Banks ranked by disclosed advisory fees</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">BANK</th>
                  <th scope="col" className="right">TOTAL FEES</th>
                  <th scope="col" className="right">DEALS</th>
                  <th scope="col" className="right">MEDIAN % OF DEAL</th>
                </tr>
              </thead>
              <tbody>
                {league.slice(0, 15).map((b, i) => (
                  <RowLink key={b.bank} label={`${b.bank} fees`} onOpen={() => (isRanked(b.bank) ? openAdvisorByName(b.bank) : openDeal(b.largest.deal))}>
                    <td className="table-date">{String(i + 1).padStart(2, "0")}</td>
                    <td className="company">
                      <span className="company-line">
                        <CompanyMark name={b.bank} letters={bankShortName(b.bank)} />
                        {b.bank}
                      </span>
                    </td>
                    <td className="right table-value">{formatUsd(b.totalUsd)}</td>
                    <td className="right mono">{b.deals}</td>
                    <td className="right mono">{formatBps(b.medianBps)}</td>
                  </RowLink>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <PanelHead title="Fee as a share of the deal" subtitle="Median by deal size: bigger deals pay a smaller percentage" />
          <div className="timeline-sectors">
            {bySize.map((b) => (
              <div key={b.label} className="timeline-sector fee-band">
                <span className="timeline-sector-name">{b.label}</span>
                <span className="timeline-sector-bar">
                  <i style={{ width: `${((b.medianBps ?? 0) / maxBand) * 100}%`, background: "#c9c9c9" }} />
                </span>
                <span className="timeline-sector-value">
                  {formatBps(b.medianBps)}
                  <small>
                    ~{formatUsd(b.medianUsd)} · {b.n} fees
                  </small>
                </span>
              </div>
            ))}
          </div>
          <p className="fee-explain">
            A 1% fee on a $300M deal is $3M; on a $30B deal it would be $300M, which no board would pay. Banks charge more in percentage terms on small deals and less on large ones, but
            the dollar amounts still rise with size.
          </p>
        </section>
      </div>

      <section className="panel">
        <PanelHead title="Biggest paydays" subtitle="Largest single fees · click a row for the deal" />
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Largest disclosed fees</caption>
            <thead>
              <tr>
                <th scope="col">BANK</th>
                <th scope="col">DEAL (TARGET)</th>
                <th scope="col">ADVISED</th>
                <th scope="col">ANNOUNCED</th>
                <th scope="col" className="right">DEAL VALUE</th>
                <th scope="col" className="right">FEE</th>
                <th scope="col" className="right">% OF DEAL</th>
              </tr>
            </thead>
            <tbody>
              {paydays.slice(0, shown).map((r) => (
                <RowLink key={`${r.deal.id}-${r.bank}`} label={`${r.bank} fee on ${r.deal.target.name}`} onOpen={() => openDeal(r.deal)}>
                  <td className="company">{r.bank}</td>
                  <td className="company">
                    <CompanyLink company={r.deal.target} />
                  </td>
                  <td className="dim">{r.side === "target" ? "Target's board" : "Buyer"}</td>
                  <td className="table-date">{formatDate(r.deal.announcedDate)}</td>
                  <td className="right table-value">{formatUsd(r.deal.valueUsd)}</td>
                  <td className="right table-value">{formatUsd(r.feeUsd)}</td>
                  <td className="right mono">{formatBps(r.bps)}</td>
                </RowLink>
              ))}
              {!paydays.length && <EmptyRow colSpan={7}>No fees.</EmptyRow>}
            </tbody>
          </table>
        </div>
        {paydays.length > shown && (
          <div className="panel-foot">
            <span>
              Showing {shown} of {paydays.length}
            </span>
            <button type="button" className="small-link" onClick={() => setShown((n) => n + PAGE * 2)}>
              Show more
            </button>
          </div>
        )}
      </section>
      <p className="note">
        Fees as stated in the fairness-opinion section of each merger proxy or Schedule 14D-9, usually the bank&apos;s total expected fee including the part paid only if the deal
        closes. Not every proxy states a fee; fees above 5% of the deal value are left out as likely parsing errors.
      </p>
    </>
  );
}
