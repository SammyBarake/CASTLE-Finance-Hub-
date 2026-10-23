"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useHubData } from "@/components/data/HubDataProvider";
import { useFullDeal } from "@/components/data/useFullDeal";
import { Icon } from "@/components/ui/Icon";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { buyerType } from "@/lib/buyers";
import { bankFingerprint } from "@/lib/fingerprint";
import { similarDeals } from "@/lib/precedents";
import { feeLabel, financingLabel, goShopLabel } from "@/lib/terms";
import { DealTimeline } from "./DealTimeline";
import { ValuationTab } from "./Valuation";
import { StatusTag } from "@/components/ui/primitives";
import { DetailGrid, DetailItem, Note, useUi } from "@/components/ui/UiProvider";
import { considerationLabel, formatDateLong, formatMultiple, formatPct, formatPrice, formatRaise, formatSignedPct, formatUsd, formatUsdB1 } from "@/lib/format";
import type { BuyerReaction, Deal, Filing, HubData, Ipo, LeagueTableEntry } from "@/lib/types";
import { useBookActions } from "@/components/books/AddToBook";
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
      {!!full?.proxySections?.length && (
        <div className="proxy-jump">
          <div className="fp-head">Jump into the merger proxy</div>
          <div className="proxy-chips">
            {full.proxySections.map((s) => (
              <a key={s.url} className="proxy-chip" href={s.url} target="_blank" rel="noreferrer">
                {s.label}
                <Icon name="external" />
              </a>
            ))}
          </div>
        </div>
      )}
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
  const { openBookMenu } = useBookActions();
  const { closeDialog, toast } = useUi();
  const watched = isWatched(kind, record.id);
  // A deal's shareable page is its tear sheet: server-rendered, with a link preview of the parties and figures.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/tearsheet/deal/${encodeURIComponent(record.id)}`);
      toast("Link to this deal copied");
    } catch {
      toast("Couldn't copy the link");
    }
  };
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
      {kind === "deal" && (
        <button type="button" className="button" aria-haspopup="menu" onClick={(e) => openBookMenu(record as Deal, { anchor: e.currentTarget })}>
          <Icon name="book" />
          Add to book
        </button>
      )}
      <span className="drawer-actions-spacer" />
      {kind === "deal" && (
        <button type="button" className="tool-icon" aria-label="Copy a link to this deal" title="Copy a link to this deal" onClick={copyLink}>
          <Icon name="link" />
        </button>
      )}
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

const Move = ({ value }: { value: number | null }) =>
  value == null ? <span className="dim">Not yet</span> : <span className={value >= 0 ? "text-up" : "text-down"}>{formatSignedPct(value)}</span>;

/** "Did it work?": the buyer's shares around the announcement and later, against the S&P 500. */
function BuyerReactionGrid({ reaction }: { reaction: BuyerReaction }) {
  return (
    <>
      <h3 className="detail-section">Buyer&apos;s shares · against the S&amp;P 500</h3>
      <DetailGrid>
        <DetailItem label="Two days after announcing">
          <Move value={reaction.announcementVsMarketPct} />
          <small className="dim"> · shares moved {formatSignedPct(reaction.announcementPct)}</small>
        </DetailItem>
        <DetailItem label="Six months on">
          <Move value={reaction.m6VsMarketPct} />
        </DetailItem>
        <DetailItem label="One year on">
          <Move value={reaction.y1VsMarketPct} />
        </DetailItem>
      </DetailGrid>
    </>
  );
}

function DealBody({ deal, data, onOpenDeal, onOpenAdvisor }: { deal: Deal; data: HubData; onOpenDeal: (d: Deal) => void; onOpenAdvisor: (name: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const related = useMemo(() => similarDeals(deal, data.deals, buyerType), [deal, data.deals]);
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
            {deal.arb && (
              <DetailItem label="Merger-arb spread">
                {formatPct(deal.arb.spreadPct)}
                <small className="dim">
                  {" "}
                  · target&apos;s close against the offer, {formatDateLong(deal.arb.asOf)}
                </small>
              </DetailItem>
            )}
          </DetailGrid>
          {deal.reaction && <BuyerReactionGrid reaction={deal.reaction} />}
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
          <div className="related-title">Most similar deals · same sector, nearest size, same buyer type</div>
          {related.length ? (
            related.map((d) => (
              <button key={d.id} type="button" className="related-deal" onClick={() => onOpenDeal(d)}>
                <span>
                  {d.target.name}
                  <small>
                    {d.acquirer.name} · {formatDateLong(d.announcedDate)}
                  </small>
                </span>
                <span className="related-figures">
                  <span className="mono">{formatUsd(d.enterpriseValueUsd ?? d.valueUsd)}</span>
                  {(d.evEbitda != null || d.premiumPct != null) && (
                    <small className="mono">
                      {[d.evEbitda != null ? `${formatMultiple(d.evEbitda)} EBITDA` : null, d.premiumPct != null ? `${formatPct(d.premiumPct)} premium` : null].filter(Boolean).join(" · ")}
                    </small>
                  )}
                </span>
              </button>
            ))
          ) : (
            <p>No comparable transactions in this sector.</p>
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

/** Who the bank works for, in which sectors, at what size, and whom it faces: from every deal in the feed. */
function Fingerprint({ name, data, onOpenAdvisor }: { name: string; data: HubData; onOpenAdvisor: (bank: string) => void }) {
  const f = useMemo(() => bankFingerprint(name, data.deals), [name, data.deals]);
  if (!f.deals) return null;
  const since = data.deals.reduce((m, d) => (d.announcedDate < m ? d.announcedDate : m), data.asOf).slice(0, 4);
  const inLeague = new Set(data.leagueTable.entries.map((e) => e.advisor.name));
  return (
    <>
      <div className="related-title">Fingerprint · every deal since {since}</div>
      <DetailGrid>
        <DetailItem label="Deals">{f.deals}</DetailItem>
        <DetailItem label="Side">
          {Math.round((f.buySide / f.deals) * 100)}% buyer · {Math.round((f.sellSide / f.deals) * 100)}% target
        </DetailItem>
        <DetailItem label="Typical deal">{f.medianValueUsd != null ? `${formatUsd(f.medianValueUsd)} median` : "—"}</DetailItem>
        <DetailItem label="Premium on its sales">{f.medianPremiumPct != null ? `${formatPct(f.medianPremiumPct)} median` : "—"}</DetailItem>
      </DetailGrid>
      <div className="fp-block">
        <div className="fp-head">Sectors</div>
        {f.sectors.map((s) => (
          <div className="fp-row" key={s.sector}>
            <span>{s.sector}</span>
            <span className="fp-bar" aria-hidden="true">
              <span style={{ width: `${s.share}%` }} />
            </span>
            <span className="mono">{s.count}</span>
          </div>
        ))}
      </div>
      {!!f.repeatClients.length && (
        <div className="fp-block">
          <div className="fp-head">Repeat clients</div>
          {f.repeatClients.slice(0, 5).map((c) => (
            <div className="fp-row fp-list" key={c.company.cik ?? c.company.name}>
              <span>
                <CompanyLink company={c.company} />
              </span>
              <span className="mono">{c.count} deals</span>
            </div>
          ))}
        </div>
      )}
      {!!f.counterparts.length && (
        <div className="fp-block">
          <div className="fp-head">Most often across the table</div>
          {f.counterparts.slice(0, 5).map((c) => (
            <div className="fp-row fp-list" key={c.bank}>
              <span>
                {inLeague.has(c.bank) ? (
                  <button type="button" className="small-link" onClick={() => onOpenAdvisor(c.bank)}>
                    {c.bank}
                  </button>
                ) : (
                  c.bank
                )}
              </span>
              <span className="mono">{c.count}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AdvisorBody({ entry, rank, data, onOpenDeal, onOpenAdvisor }: { entry: LeagueTableEntry; rank: number; data: HubData; onOpenDeal: (d: Deal) => void; onOpenAdvisor: (bank: string) => void }) {
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
      <Fingerprint name={name} data={data} onOpenAdvisor={onOpenAdvisor} />
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

/**
 * Drawer bodies read the dataset as it is now, not as it was when the drawer opened: some pages show before the
 * full dataset arrives (BOOT_READY), and a deal opened then must still get its similar deals and context.
 */
function WithData({ render }: { render: (data: HubData) => ReactNode }) {
  const { data } = useHubData();
  return <>{render(data)}</>;
}

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
      body: <WithData key={deal.id} render={(live) => <DealBody deal={deal} data={live} onOpenDeal={openDeal} onOpenAdvisor={openAdvisorByName} />} />,
    });
  const openIpo = (ipo: Ipo) =>
    openDialog({
      variant: "drawer",
      eyebrow: `IPO · ${ipo.sector}`,
      title: ipo.company.name,
      body: <WithData key={ipo.id} render={(live) => <IpoBody ipo={ipo} data={live} onOpenAdvisor={openAdvisorByName} />} />,
    });
  const openAdvisor = (entry: LeagueTableEntry, rank: number) =>
    openDialog({
      variant: "drawer",
      eyebrow: `Advisor · ${data.leagueTable.period}`,
      title: entry.advisor.name,
      body: <WithData key={entry.advisor.name} render={(live) => <AdvisorBody entry={entry} rank={rank} data={live} onOpenDeal={openDeal} onOpenAdvisor={openAdvisorByName} />} />,
    });
  const openDefinitions = () => openDialog({ eyebrow: "Reference", title: "Data definitions", body: <Definitions isSample={data.isSample} /> });

  return { openDeal, openIpo, openAdvisor, openAdvisorByName, openDefinitions };
}
