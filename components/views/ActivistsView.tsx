"use client";

import { useMemo, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { Icon } from "@/components/ui/Icon";
import { Kpi, Kpis, PageHeading, PanelHead } from "@/components/ui/primitives";
import { EmptyRow, RowLink } from "@/components/ui/table";
import { DetailGrid, DetailItem, Note, useUi } from "@/components/ui/UiProvider";
import { activistInsights, activistStats, laterDeal } from "@/lib/activists";
import { formatDate, formatDateFull, formatDateLong, formatUsd } from "@/lib/format";
import type { ActivistStake, Deal } from "@/lib/types";

const PAGE = 25;
const pct = (v: number | null) => (v == null ? "n/a" : `${v.toFixed(1)}%`);

function StakeBody({ stake, deal, onOpenDeal }: { stake: ActivistStake; deal: Deal | null; onOpenDeal: (d: Deal) => void }) {
  return (
    <>
      <DetailGrid>
        <DetailItem label="Investor">{stake.investor.name}</DetailItem>
        <DetailItem label="Company">
          <CompanyLink company={stake.company}>{stake.company.ticker ? `${stake.company.name} (${stake.company.ticker})` : stake.company.name}</CompanyLink>
        </DetailItem>
        <DetailItem label="Stake">{pct(stake.percent)}</DetailItem>
        <DetailItem label="Shares">{stake.shares != null ? stake.shares.toLocaleString("en-US") : "n/a"}</DetailItem>
        <DetailItem label="Crossed 5%">{stake.eventDate ? formatDateLong(stake.eventDate) : "n/a"}</DetailItem>
        <DetailItem label="Filed">{formatDateLong(stake.filedDate)}</DetailItem>
        <DetailItem label="Amendments since">{stake.amendments ? `${stake.amendments} (latest ${formatDateLong(stake.lastAmended!)})` : "None"}</DetailItem>
        <DetailItem label="What they want">{stake.aims.length ? stake.aims.join(", ") : "Not specific"}</DetailItem>
      </DetailGrid>
      <div className="related-title">In their own words (Item 4, “Purpose of Transaction”)</div>
      <blockquote className="stake-purpose">{stake.purpose || "No purpose text."}</blockquote>
      {deal && (
        <>
          <div className="related-title">What happened next</div>
          <button type="button" className="related-deal" onClick={() => onOpenDeal(deal)}>
            <span>
              {deal.acquirer.name} agreed to buy {deal.target.name}
              <small>{formatDateLong(deal.announcedDate)}</small>
            </span>
            <span className="mono">{formatUsd(deal.valueUsd)}</span>
          </button>
        </>
      )}
      <a className="filing-link" href={stake.url} target="_blank" rel="noreferrer">
        <span>Schedule 13D on SEC EDGAR</span>
        <Icon name="external" />
      </a>
      <Note>Read automatically from the structured Schedule 13D. Stakes of related funds overlap, so the largest reported percentage is shown.</Note>
    </>
  );
}

export function ActivistsView() {
  const { data } = useHubData();
  const { openDeal } = useDetails();
  const { openDialog } = useUi();
  const stakes = useMemo(() => data.activists ?? [], [data.activists]);
  const stats = useMemo(() => activistStats(stakes, data.deals), [stakes, data.deals]);
  const notes = useMemo(() => activistInsights(stats), [stats]);
  const [aim, setAim] = useState<string | null>(null);
  const [investor, setInvestor] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const soldIds = useMemo(() => new Set(stats.sold.map((x) => x.stake.id)), [stats.sold]);

  const rows = stakes.filter((s) => (!aim || s.aims.includes(aim)) && (!investor || s.investor.name === investor));
  const maxAim = Math.max(1, ...stats.aims.map((a) => a.count));

  const openStake = (s: ActivistStake) =>
    openDialog({
      variant: "drawer",
      eyebrow: `Schedule 13D · ${formatDate(s.filedDate)}`,
      title: `${s.investor.name} → ${s.company.name}`,
      body: <StakeBody stake={s} deal={laterDeal(s, data.deals)} onOpenDeal={openDeal} />,
    });

  if (!stakes.length) {
    return (
      <>
        <PageHeading title="Activist Investors" subtitle="5%+ stakes by investors who want change" date={formatDateFull(data.asOf)} />
        <section className="panel">
          <div className="empty-small">{data.isSample ? "Activist stakes come from real SEC filings, so they appear once the site is showing live data." : "No activist filings yet. They appear after the next data refresh."}</div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeading title="Activist Investors" subtitle="5%+ stakes by investors who want change · Schedule 13D" date={formatDateFull(data.asOf)} />

      <Kpis label="Activist summary">
        <Kpi label="Activist stakes" value={stats.count} note={stats.since ? `Since ${formatDate(stats.since)}` : ""} />
        <Kpi label="Companies targeted" value={stats.companies} note="U.S.-listed" />
        <Kpi label="Median stake" value={pct(stats.medianPercent)} note="Of the company's shares" />
        <Kpi label="Later agreed to a sale" value={stats.sold.length} note="Deal announced after the stake" />
      </Kpis>

      <section className="panel timeline-notes">
        <PanelHead title="What is an activist?" subtitle="How the 13D works, and what the filings show" />
        <ul>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>

      <div className="two-col timeline-grid">
        <section className="panel">
          <PanelHead title="What they want" subtitle="Click a demand to see those stakes" />
          <div className="timeline-sectors">
            {stats.aims.map((a) => (
              <button key={a.aim} type="button" className={`timeline-sector aim-row ${aim === a.aim ? "on" : ""}`} aria-pressed={aim === a.aim} onClick={() => (setAim(aim === a.aim ? null : a.aim), setShown(PAGE))}>
                <span className="timeline-sector-name">{a.aim}</span>
                <span className="timeline-sector-bar">
                  <i style={{ width: `${(a.count / maxAim) * 100}%`, background: "#cfcfcf" }} />
                </span>
                <span className="timeline-sector-value">{a.count}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelHead title="Most active" subtitle="Click an investor to see its stakes" />
          {stats.investors.map((i) => (
            <button
              key={i.name}
              type="button"
              className={`preview-row ${investor === i.name ? "active-row" : ""}`}
              aria-pressed={investor === i.name}
              onClick={() => (setInvestor(investor === i.name ? null : i.name), setShown(PAGE))}
            >
              <span className="preview-company">
                <span>
                  <strong>{i.name}</strong>
                  <small>{i.companies.slice(0, 3).join(", ") + (i.companies.length > 3 ? ` +${i.companies.length - 3} more` : "")}</small>
                </span>
              </span>
              <span className="preview-value">
                {i.count} stake{i.count === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </section>
      </div>

      <section className="panel">
        <PanelHead
          title={`${rows.length} stake${rows.length === 1 ? "" : "s"}${aim ? ` · ${aim}` : ""}${investor ? ` · ${investor}` : ""}`}
          subtitle="Newest first · click a row for what the investor wrote"
        >
          {(aim || investor) && (
            <button type="button" className="explorer-clear" onClick={() => (setAim(null), setInvestor(null))}>
              Show all
            </button>
          )}
        </PanelHead>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Activist stakes</caption>
            <thead>
              <tr>
                <th scope="col">FILED</th>
                <th scope="col">INVESTOR</th>
                <th scope="col">COMPANY</th>
                <th scope="col" className="right">STAKE</th>
                <th scope="col">WHAT THEY WANT</th>
                <th scope="col" className="right">AMENDMENTS</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((s) => (
                <RowLink key={s.id} label={`${s.investor.name} stake in ${s.company.name}`} onOpen={() => openStake(s)}>
                  <td className="table-date">{formatDate(s.filedDate)}</td>
                  <td className="company">{s.investor.name}</td>
                  <td className="company">
                    <CompanyLink company={s.company} />
                    {s.company.ticker && <small className="dim"> {s.company.ticker}</small>}
                    {soldIds.has(s.id) && <span className="aim-chip sold">Later sold</span>}
                  </td>
                  <td className="right mono">{pct(s.percent)}</td>
                  <td>
                    {s.aims.length ? (
                      s.aims.slice(0, 3).map((a) => (
                        <span key={a} className="aim-chip">
                          {a}
                        </span>
                      ))
                    ) : (
                      <span className="dim">Not specific</span>
                    )}
                  </td>
                  <td className="right mono">{s.amendments || "—"}</td>
                </RowLink>
              ))}
              {!rows.length && <EmptyRow colSpan={6}>No stakes match.</EmptyRow>}
            </tbody>
          </table>
        </div>
        {rows.length > shown && (
          <div className="panel-foot">
            <span>
              Showing {shown} of {rows.length}
            </span>
            <button type="button" className="small-link" onClick={() => setShown((n) => n + PAGE * 2)}>
              Show more
            </button>
          </div>
        )}
      </section>
      <p className="note">
        From Schedule 13D filings (the structured format the SEC introduced in December 2024) where the company is U.S.-listed and the investor is a known activist fund or states
        a campaign in Item 4 (board seats, a sale, capital return, governance changes or a break-up). Founders and holders who received shares in a merger are left out.
      </p>
    </>
  );
}
