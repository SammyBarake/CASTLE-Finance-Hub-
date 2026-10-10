"use client";

import Link from "next/link";
import { useState } from "react";
import { useHubData } from "@/components/data/HubDataProvider";
import { useFullDeal } from "@/components/data/useFullDeal";
import { Icon } from "@/components/ui/Icon";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { buyerType } from "@/lib/buyers";
import { feeLabel, financingLabel, goShopLabel } from "@/lib/terms";
import { DealTimeline } from "./DealTimeline";
import { ValuationTab } from "./Valuation";
import { StatusTag } from "@/components/ui/primitives";
import { DetailGrid, DetailItem, Note, useUi } from "@/components/ui/UiProvider";
import { considerationLabel, formatDateLong, formatMultiple, formatPct, formatPrice, formatRaise, formatUsd, formatUsdB1 } from "@/lib/format";
import type { Deal, Filing, HubData, Ipo, LeagueTableEntry } from "@/lib/types";
import { useRecordActions } from "@/components/workspace/actions";
import { useWorkspace, type RecordKind } from "@/components/workspace/WorkspaceProvider";

const withTicker = (c: { name: string; ticker: string | null }) => (c.ticker ? `${c.name} (${c.ticker})` : c.name);
const feePct = (fee: number | null, value: number | null) => (fee != null && value ? (fee / value) * 100 : null);

function SourceNote({ isSample }: { isSample: boolean }) {
  return (
    <Note>
      {isSample ? "Sample data · No SEC filing linked." : "Extracted automatically from SEC EDGAR filings. Check the source documents before relying on any figure."}
    </Note>
  );
}

/** The page feed carries a deal's first filing; the full list loads when the tab opens. */
function DealFilings({ deal }: { deal: Deal }) {
  const { full, failed } = useFullDeal(deal);
  const more = !full && (deal.filingCount ?? 0) > deal.filings.length;
  return (
    <>
      <Filings filings={full?.filings ?? deal.filings} />
      {more && <p className="dim ff-intro">{failed ? "Couldn't load the other filings. Try again in a moment." : `Loading all ${deal.filingCount} filings…`}</p>}
    </>
  );
}

function Filings({ filings }: { filings: Filing[] }) {
  if (!filings.length) return <p>No linked filings.</p>;
  return (
    <div>
      {[...filings].reverse().map((f) => (
        <a key={f.url} className="filing-link" href={f.url} target="_blank" rel="noreferrer">
          <span>
            {f.form}
            <small className="dim" style={{ marginLeft: 8 }}>
              {formatDateLong(f.filedDate)}
            </small>
          </span>
          <Icon name="external" />
        </a>
      ))}
    </div>
  );
}

type Tab = "overview" | "valuation" | "advisors" | "filings" | "notes";

/** Watch / copy / compare buttons at the top of a drawer. */
function DrawerActions({ kind, record }: { kind: RecordKind; record: Deal | Ipo }) {
  const { isWatched, selected } = useWorkspace();
  const { toggleWatch, copySummary, toggleCompare } = useRecordActions();
  const { closeDialog } = useUi();
  const watched = isWatched(kind, record.id);
  return (
    <div className="drawer-actions">
      <button type="button" className="button" aria-pressed={watched} onClick={() => toggleWatch(kind, record.id)}>
        <Icon name="star" className={watched ? "star-fill" : ""} />
        {watched ? "Watching" : "Watch"}
      </button>
      {kind === "deal" && (
        <a className="button" href={`/tearsheet/deal/${encodeURIComponent(record.id)}`} target="_blank" rel="noopener" title="Printable one-page summary (opens in a new tab)">
          <Icon name="print" />
          Tear sheet
        </a>
      )}
      {kind === "deal" && (
        <Link className="button" href={`/precedents?deal=${encodeURIComponent(record.id)}`} onClick={closeDialog}>
          <Icon name="comps" />
          Precedents
        </Link>
      )}
      <span className="drawer-actions-spacer" />
      <button type="button" className="tool-icon" aria-label="Copy summary" title="Copy summary" onClick={() => copySummary(kind, record)}>
        <Icon name="copy" />
      </button>
      {kind === "deal" && (
        <button
          type="button"
          className={`tool-icon ${selected.has(record.id) ? "on" : ""}`}
          aria-pressed={selected.has(record.id)}
          aria-label={selected.has(record.id) ? "Remove from comparison" : "Add to comparison"}
          title={selected.has(record.id) ? "Selected for comparison" : "Add to comparison"}
          onClick={() => toggleCompare(record.id)}
        >
          <Icon name="compare" />
        </button>
      )}
    </div>
  );
}

/** Private research notes, saved in this browser as you type. */
function NotesTab({ kind, id }: { kind: RecordKind; id: string }) {
  const { note, setNote, storageOk } = useWorkspace();
  return (
    <>
      <div className="notes-label">
        <label htmlFor="record-notes">Research notes</label>
        <span>{storageOk ? "Saved in this browser" : "Session only"}</span>
      </div>
      <textarea id="record-notes" className="notes-area" placeholder="Add questions, assumptions, or follow-up items…" value={note(kind, id)} onChange={(e) => setNote(kind, id, e.target.value)} />
      <p className="notes-help">Notes are private to this browser. They are not sent anywhere.</p>
    </>
  );
}

function Tabs({ tab, onChange, tabs }: { tab: Tab; onChange: (t: Tab) => void; tabs: Tab[] }) {
  return (
    <div className="detail-tabs" role="group" aria-label="Detail section">
      {tabs.map((t) => (
        <button key={t} type="button" className={tab === t ? "active" : ""} aria-pressed={tab === t} onClick={() => onChange(t)}>
          {t[0].toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DealBody({ deal, data, onOpenDeal, onOpenAdvisor }: { deal: Deal; data: HubData; onOpenDeal: (d: Deal) => void; onOpenAdvisor: (name: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const related = data.deals.filter((d) => d.sector === deal.sector && d.id !== deal.id).slice(0, 5);
  const statusDate = deal.statusDate && deal.status !== "Announced" ? ` · ${formatDateLong(deal.statusDate)}` : "";
  const isRanked = (name: string) => data.leagueTable.entries.some((e) => e.advisor.name === name);

  return (
    <>
      <DrawerActions kind="deal" record={deal} />
      <Tabs tab={tab} onChange={setTab} tabs={deal.hasFairness || deal.fairness?.length ? ["overview", "valuation", "advisors", "filings", "notes"] : ["overview", "advisors", "filings", "notes"]} />
      {tab === "overview" && (
        <>
          <div className="drawer-stats">
            <div>
              <span>Deal value</span>
              <b>{formatUsd(deal.valueUsd)}</b>
            </div>
            <div>
              <span>Premium</span>
              <b>{formatPct(deal.premiumPct)}</b>
            </div>
            <div>
              <span>EV / EBITDA</span>
              <b>{formatMultiple(deal.evEbitda)}</b>
            </div>
            <div>
              <span>Status</span>
              <b>
                <StatusTag status={deal.status} />
              </b>
              {statusDate && <small>{statusDate.slice(3)}</small>}
            </div>
          </div>
          <DealTimeline deal={deal} asOf={data.asOf} />
          <h3 className="detail-section">Terms</h3>
          <DetailGrid>
            <DetailItem label="Offer price per share">{formatPrice(deal.pricePerShare)}</DetailItem>
            <DetailItem label="Consideration">{considerationLabel(deal.consideration)}</DetailItem>
            <DetailItem label="Enterprise value">{formatUsd(deal.enterpriseValueUsd)}</DetailItem>
            <DetailItem label="EV / Revenue">{formatMultiple(deal.evRevenue)}</DetailItem>
          </DetailGrid>
          {deal.terms && (
            <>
              <h3 className="detail-section">Deal protections</h3>
              <DetailGrid>
                <DetailItem label="Break fee (target pays)">{feeLabel(deal.terms.targetFeeUsd, feePct(deal.terms.targetFeeUsd, deal.valueUsd), formatUsd)}</DetailItem>
                <DetailItem label="Reverse fee (buyer pays)">{feeLabel(deal.terms.reverseFeeUsd, feePct(deal.terms.reverseFeeUsd, deal.valueUsd), formatUsd)}</DetailItem>
                <DetailItem label="Go-shop">{goShopLabel(deal.terms)}</DetailItem>
                <DetailItem label="Financing">{financingLabel(deal.terms)}</DetailItem>
              </DetailGrid>
            </>
          )}
          <h3 className="detail-section">Parties</h3>
          <DetailGrid>
            <DetailItem label="Acquirer">
              <CompanyLink company={deal.acquirer}>{withTicker(deal.acquirer)}</CompanyLink>
            </DetailItem>
            <DetailItem label="Target">
              <CompanyLink company={deal.target}>{withTicker(deal.target)}</CompanyLink>
              {deal.privateTarget && <span className="aim-chip private-chip">Private</span>}
            </DetailItem>
            <DetailItem label="Buyer type">{buyerType(deal)}</DetailItem>
            <DetailItem label="Announced">{formatDateLong(deal.announcedDate)}</DetailItem>
            <DetailItem label="Sector">{deal.sector}</DetailItem>
            <DetailItem label="Industry">{deal.industry ?? "—"}</DetailItem>
          </DetailGrid>
          <div className="related-title">Related {deal.sector.toLowerCase()} transactions</div>
          {related.length ? (
            related.map((d) => (
              <button key={d.id} type="button" className="related-deal" onClick={() => onOpenDeal(d)}>
                <span>
                  {d.target.name}
                  <small>
                    {d.acquirer.name} · {formatDateLong(d.announcedDate)}
                  </small>
                </span>
                <span className="mono">{formatUsd(d.valueUsd)}</span>
              </button>
            ))
          ) : (
            <p>No other transactions in this sector.</p>
          )}
        </>
      )}
      {tab === "advisors" && (
        <div>
          {[
            ["Acquirer advisors", deal.acquirerAdvisors],
            ["Target advisors", deal.targetAdvisors],
          ].map(([label, names]) => (
            <div key={label as string} className="detail">
              <div className="detail-label">{label as string}</div>
              {(names as string[]).length ? (
                (names as string[]).map((name) =>
                  isRanked(name) ? (
                    <div key={name}>
                      <button type="button" className="small-link" onClick={() => onOpenAdvisor(name)}>
                        {name}
                        <Icon name="right" />
                      </button>
                    </div>
                  ) : (
                    <div key={name} className="detail-value">
                      {name}
                    </div>
                  ),
                )
              ) : (
                <div className="detail-value dim">Not disclosed</div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "valuation" && <ValuationTab deal={deal} />}
      {tab === "filings" && <DealFilings deal={deal} />}
      {tab === "notes" && <NotesTab kind="deal" id={deal.id} />}
      <SourceNote isSample={data.isSample} />
    </>
  );
}

function IpoBody({ ipo, data, onOpenAdvisor }: { ipo: Ipo; data: HubData; onOpenAdvisor: (name: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const isRanked = (name: string) => data.leagueTable.entries.some((e) => e.advisor.name === name);
  return (
    <>
      <DrawerActions kind="ipo" record={ipo} />
      <Tabs tab={tab} onChange={setTab} tabs={["overview", "advisors", "filings", "notes"]} />
      {tab === "overview" && (
        <>
          <div className="drawer-stats">
            <div>
              <span>Expected raise</span>
              <b>{formatRaise(ipo.expectedRaiseUsd)}</b>
            </div>
            <div>
              <span>Offer price</span>
              <b>{formatPrice(ipo.offerPrice)}</b>
            </div>
            <div>
              <span>Lead bank</span>
              <b className="text">{ipo.underwriters[0] ?? "—"}</b>
            </div>
            <div>
              <span>Stage</span>
              <b>
                <StatusTag status={ipo.stage} />
              </b>
            </div>
          </div>
          {ipo.description && <p className="drawer-description">{ipo.description}</p>}
          <h3 className="detail-section">Offering</h3>
          <DetailGrid>
            <DetailItem label="Company">
              <CompanyLink company={ipo.company}>{withTicker(ipo.company)}</CompanyLink>
            </DetailItem>
            <DetailItem label="Filed">{formatDateLong(ipo.filedDate)}</DetailItem>
            {ipo.pricedDate && <DetailItem label="Priced">{formatDateLong(ipo.pricedDate)}</DetailItem>}
            <DetailItem label="Sector">{ipo.sector}</DetailItem>
            <DetailItem label="Industry">{ipo.industry ?? "—"}</DetailItem>
          </DetailGrid>
        </>
      )}
      {tab === "advisors" && (
        <div>
          {ipo.underwriters.length ? (
            ipo.underwriters.map((name, i) => (
              <div key={name} className="detail">
                <div className="detail-label">{i === 0 ? "Lead underwriter" : "Joint bookrunner"}</div>
                {isRanked(name) ? (
                  <button type="button" className="small-link" onClick={() => onOpenAdvisor(name)}>
                    {name}
                    <Icon name="right" />
                  </button>
                ) : (
                  <div className="detail-value">{name}</div>
                )}
              </div>
            ))
          ) : (
            <p>No recognised bookrunners on the prospectus cover.</p>
          )}
        </div>
      )}
      {tab === "filings" && <Filings filings={ipo.filings} />}
      {tab === "notes" && <NotesTab kind="ipo" id={ipo.id} />}
      <SourceNote isSample={data.isSample} />
    </>
  );
}

function AdvisorBody({ entry, rank, data, onOpenDeal }: { entry: LeagueTableEntry; rank: number; data: HubData; onOpenDeal: (d: Deal) => void }) {
  const name = entry.advisor.name;
  const associated = data.deals.filter((d) => d.acquirerAdvisors.includes(name) || d.targetAdvisors.includes(name)).slice(0, 12);
  const change = entry.rankChange;
  return (
    <>
      <DetailGrid>
        <DetailItem label="Rank by deal value">#{rank}</DetailItem>
        <DetailItem label="Deals advised">{entry.dealCount}</DetailItem>
        <DetailItem label="Total deal value">{formatUsdB1(entry.dealValueUsd)}</DetailItem>
        <DetailItem label="Rank change">{change === 0 ? "Unchanged" : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} vs. prior quarter`}</DetailItem>
      </DetailGrid>
      <div className="related-title">Recent transactions</div>
      {associated.length ? (
        associated.map((d) => (
          <button key={d.id} type="button" className="related-deal" onClick={() => onOpenDeal(d)}>
            <span>
              {d.target.name}
              <small>
                {d.acquirerAdvisors.includes(name) ? "Acquirer side" : "Target side"} · {formatDateLong(d.announcedDate)}
              </small>
            </span>
            <span className="mono">{formatUsd(d.valueUsd)}</span>
          </button>
        ))
      ) : (
        <p>No transactions in the current deal feed.</p>
      )}
      <Note>League table totals cover {data.leagueTable.period}. A transaction may be credited to several advisors.</Note>
    </>
  );
}

function Definitions({ isSample }: { isSample: boolean }) {
  const items: [string, string][] = [
    [
      "Deal flow",
      isSample
        ? "Announced U.S. M&A across five sample sectors."
        : "Acquisitions of U.S.-listed companies, plus private companies bought by U.S.-listed acquirers (marked \"Private\"), found in press releases and merger filings with the SEC (8-K, DEFA14A, 425 and tender-offer communications). Private targets have no share price, so premiums and multiples cover public targets only; their sector is the acquirer's. Terms not clearly stated in the filing are left blank.",
    ],
    ["Status", "Announced: agreement signed. Pending: merger proxy or tender offer on file. Closed: target delisted or change of control reported. Terminated: agreement ended."],
    ["Deal value & premium", "Disclosed transaction value. Premium compares the offer price with the target's unaffected share price, as stated in the announcement."],
    ["Deal volume", "Monthly totals of announced deals by sector, through the last complete month. YTD comparisons use the same months of the prior year."],
    ["IPO pipeline", "Filed: first-time S-1 / F-1 registrant. Priced: priced in the last 7 days (final 424B4 prospectus filed). Trading: priced more than 7 days ago. Expected raise is gross proceeds before fees (price range midpoint × shares, or the fee table)."],
    ["Advisor rankings", "Year to date by deal value. A transaction is credited to every named financial advisor, so totals include shared mandates. Rank change compares with the end of the prior quarter."],
    ["Valuations", "Median transaction EV / EBITDA, EV / Revenue and premium by sector and quarter. EV is the stated enterprise value, or equity value plus debt minus cash. EBITDA and revenue are the target's last twelve months from XBRL filings."],
    [
      "Activist investors",
      "Schedule 13D filings (structured format, since December 2024) where the company is U.S.-listed and the investor is a known activist fund or describes a concrete campaign in Item 4: nominating directors, a letter to the board, a settlement agreement, a special meeting. Founders, insiders, SPAC sponsors, holders above 50% and shares bought from the company are left out. Stake = the largest percentage reported by the related funds.",
    ],
    [
      "Timelines",
      "Milestones come from the target's SEC filings: announcement, first proxy / tender-offer document, definitive proxy, shareholder vote results (8-K Item 5.07), and closing (delisting or change-of-control filing). Time to close is announcement to closing. Deals first seen at completion, or open 18+ months with no closing filing, are left out of the timings.",
    ],
    [
      "Valuation (fairness opinions)",
      "The value ranges each bank's analyses implied for the target's shares (DCF, trading comparables, precedent transactions, premiums paid and others), read from the fairness-opinion summary in the merger proxy or Schedule 14D-9, with the bank's fee and DCF assumptions. The dashed line is the offer price.",
    ],
    [
      "Precedent transactions",
      "Comparable deals picked by sector, industry, size and date. Deal size is enterprise value, or the headline value when EV isn't available. Statistics (high, 75th percentile, mean, median, 25th percentile, low) use only ticked rows and skip undisclosed values; percentiles interpolate like Excel's PERCENTILE.INC.",
    ],
    ["Sectors", "Mapped from SEC industry (SIC) codes into five groups. Consumer companies fall under Industrials, real estate under Financials, and utilities and mining under Energy."],
    [
      "World economies",
      "GDP growth (real, annual %) and inflation (average consumer prices, annual %) come from the IMF World Economic Outlook; the current year is an IMF estimate. Policy rates are the latest central-bank rates published by the BIS (the U.S. figure is the midpoint of the Fed's target range).",
    ],
  ];
  return (
    <>
      {items.map(([title, text]) => (
        <div key={title} className="definition">
          <strong>{title}</strong>
          <p>{text}</p>
        </div>
      ))}
      <p style={{ fontSize: 10, margin: "18px 0 0" }}>
        {isSample
          ? "All figures, transactions and rankings are sample data."
          : "Built on public SEC EDGAR filings and refreshed every few hours. Coverage is automated and best-effort; figures count deals Castle has detected, not the whole market. Not investment advice."}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

/** Open record details from anywhere. */
export function useDetails() {
  const { openDialog } = useUi();
  const { data } = useHubData();

  const openAdvisorByName = (name: string) => {
    const idx = data.leagueTable.entries.findIndex((e) => e.advisor.name === name);
    if (idx >= 0) openAdvisor(data.leagueTable.entries[idx], idx + 1);
  };
  const openDeal = (deal: Deal) =>
    openDialog({
      variant: "drawer",
      eyebrow: `M&A · ${deal.sector}`,
      title: `${deal.acquirer.name} → ${deal.target.name}`,
      body: <DealBody key={deal.id} deal={deal} data={data} onOpenDeal={openDeal} onOpenAdvisor={openAdvisorByName} />,
    });
  const openIpo = (ipo: Ipo) =>
    openDialog({
      variant: "drawer",
      eyebrow: `IPO · ${ipo.sector}`,
      title: ipo.company.name,
      body: <IpoBody key={ipo.id} ipo={ipo} data={data} onOpenAdvisor={openAdvisorByName} />,
    });
  const openAdvisor = (entry: LeagueTableEntry, rank: number) =>
    openDialog({
      variant: "drawer",
      eyebrow: `Advisor · ${data.leagueTable.period}`,
      title: entry.advisor.name,
      body: <AdvisorBody key={entry.advisor.name} entry={entry} rank={rank} data={data} onOpenDeal={openDeal} />,
    });
  const openDefinitions = () => openDialog({ eyebrow: "Reference", title: "Data definitions", body: <Definitions isSample={data.isSample} /> });

  return { openDeal, openIpo, openAdvisor, openAdvisorByName, openDefinitions };
}
