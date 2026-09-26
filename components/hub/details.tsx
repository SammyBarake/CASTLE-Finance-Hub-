import { StatusTag } from "@/components/ui/primitives";
import { DetailGrid, DetailHeading, DetailItem, Note, type DialogContent } from "@/components/ui/UiProvider";
import { considerationLabel, formatDateLong, formatMultiple, formatPct, formatPrice, formatRaise, formatUsd, formatUsdB1 } from "@/lib/format";
import type { Deal, Filing, Ipo, LeagueTableEntry } from "@/lib/types";

const SampleNote = () => (
  <Note>
    Sample data. These figures and transactions are fictional and demonstrate the intended Castle experience. No live filings are connected.
  </Note>
);

function Filings({ filings }: { filings: Filing[] }) {
  return (
    <ul className="mb-[15px] list-none p-0 text-[11px]">
      {filings.map((f) => (
        <li key={f.url} className="py-1">
          <a href={f.url} target="_blank" rel="noreferrer" className="text-accent hover:text-[#ddd7ff]">
            {f.form} · {formatDateLong(f.filedDate)}
          </a>
        </li>
      ))}
    </ul>
  );
}

const orDash = (xs: string[]) => (xs.length ? xs.join(", ") : "Not disclosed");

const withTicker = (c: Deal["target"]) => (c.ticker ? `${c.name} (${c.ticker})` : c.name);

export function dealDetail(d: Deal, isSample: boolean): DialogContent {
  const statusLabel = d.statusDate && d.status !== "Announced" ? ` · ${formatDateLong(d.statusDate)}` : "";
  return {
    eyebrow: `Transaction brief · ${d.sector}${d.industry ? ` · ${d.industry}` : ""}`,
    title: `${d.acquirer.name} → ${d.target.name}`,
    body: (
      <>
        <p>
          {withTicker(d.acquirer)} announced an agreement to acquire {withTicker(d.target)}
          {d.valueUsd != null && <> for {formatUsd(d.valueUsd)}</>}
          {d.premiumPct != null && <>, representing a {formatPct(d.premiumPct)} premium to the target&apos;s share price</>}.
        </p>
        <DetailGrid>
          <DetailItem label="Announced">{formatDateLong(d.announcedDate)}</DetailItem>
          <DetailItem label="Status">
            <StatusTag status={d.status} />
            {statusLabel && <span className="ml-2 text-[10px] font-normal text-dim">{statusLabel.slice(3)}</span>}
          </DetailItem>
          <DetailItem label="Transaction value">{formatUsd(d.valueUsd)}</DetailItem>
          <DetailItem label="Offer price per share">{formatPrice(d.pricePerShare)}</DetailItem>
          <DetailItem label="Consideration">{considerationLabel(d.consideration)}</DetailItem>
          <DetailItem label="Premium">{formatPct(d.premiumPct)}</DetailItem>
          <DetailItem label="Enterprise value">{formatUsd(d.enterpriseValueUsd)}</DetailItem>
          <DetailItem label="EV / EBITDA · EV / Revenue (LTM)">
            {formatMultiple(d.evEbitda)} · {formatMultiple(d.evRevenue)}
          </DetailItem>
          <DetailItem label="Acquirer advisor">{orDash(d.acquirerAdvisors)}</DetailItem>
          <DetailItem label="Target advisor">{orDash(d.targetAdvisors)}</DetailItem>
        </DetailGrid>
        <DetailHeading>Public filings</DetailHeading>
        {d.filings.length ? (
          <Filings filings={d.filings} />
        ) : (
          <p>
            Castle connects transaction terms from 8-K filings, merger proxy statements, and S-4 registration statements.
            {isSample && " This preview contains no linked SEC documents."}
          </p>
        )}
        {isSample && <SampleNote />}
      </>
    ),
  };
}

export function ipoDetail(i: Ipo, isSample: boolean): DialogContent {
  return {
    eyebrow: `IPO brief · ${i.sector}`,
    title: i.company.name,
    body: (
      <>
        <p>{i.description}</p>
        <DetailGrid>
          <DetailItem label="Filing date">{formatDateLong(i.filedDate)}</DetailItem>
          <DetailItem label="Stage">
            <StatusTag status={i.stage} />
          </DetailItem>
          <DetailItem label="Expected gross raise">{formatRaise(i.expectedRaiseUsd)}</DetailItem>
          <DetailItem label="Proposed ticker">{i.company.ticker ?? "n/a"}</DetailItem>
          <DetailItem label="Lead underwriter">{i.underwriters[0] ?? "Not identified"}</DetailItem>
          <DetailItem label="Joint bookrunners">{i.underwriters.slice(1).join(", ") || "n/a"}</DetailItem>
          {i.pricedDate && <DetailItem label="Priced">{formatDateLong(i.pricedDate)}</DetailItem>}
          {i.offerPrice != null && <DetailItem label="Offer price">{formatPrice(i.offerPrice)}</DetailItem>}
        </DetailGrid>
        {i.filings.length > 0 && (
          <>
            <DetailHeading>Public filings</DetailHeading>
            <Filings filings={i.filings} />
          </>
        )}
        {isSample && (
          <>
            <p>Expected proceeds and offer prices are illustrative.</p>
            <SampleNote />
          </>
        )}
      </>
    ),
  };
}

export function advisorDetail(e: LeagueTableEntry, rank: number, period: string, deals: Deal[], isSample: boolean): DialogContent {
  const name = e.advisor.name;
  const associated = deals.filter((d) => d.acquirerAdvisors.includes(name) || d.targetAdvisors.includes(name));
  const change = e.rankChange;
  return {
    eyebrow: `Advisor profile · ${period}`,
    title: name,
    body: (
      <>
        <DetailGrid>
          <DetailItem label="League table rank">#{rank}</DetailItem>
          <DetailItem label="Total deal value">{formatUsdB1(e.dealValueUsd)}</DetailItem>
          <DetailItem label="Deals advised">{e.dealCount}</DetailItem>
          <DetailItem label="Rank change">{change === 0 ? "Unchanged" : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} vs. prior quarter`}</DetailItem>
        </DetailGrid>
        <DetailHeading>Recent transactions</DetailHeading>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>TRANSACTION TARGET</th>
                <th>ROLE</th>
                <th className="text-right">VALUE</th>
              </tr>
            </thead>
            <tbody>
              {associated.map((d) => (
                <tr key={d.id}>
                  <td>{d.target.name}</td>
                  <td>{d.acquirerAdvisors.includes(name) ? "Acquirer" : "Target"}</td>
                  <td className="text-right font-mono">{formatUsd(d.valueUsd)}</td>
                </tr>
              ))}
              {!associated.length && (
                <tr>
                  <td colSpan={3}>No transactions in the current deal feed.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p>League table totals cover the full period; the transactions above are from the latest deal feed. Shared advisory credit may appear for multiple firms.</p>
        {isSample && <SampleNote />}
      </>
    ),
  };
}

export function aboutDetail(isSample: boolean, dealCount: number): DialogContent {
  return {
    eyebrow: isSample ? "About this preview" : "Data & methodology",
    title: "A clearer view of the deal market.",
    body: (
      <>
        <p>
          Castle is an investment banking terminal built around public SEC EDGAR filings.
          {isSample && " This build runs on fictional companies, transactions, and market data until the SEC data engine is connected."}
        </p>
        {!isSample && (
          <>
            <DetailHeading>Where the data comes from</DetailHeading>
            <p>
              Twice a day Castle reads new filings from SEC EDGAR. <strong>Deals</strong> come from merger press releases filed with 8-K, DEFA14A, 425 and tender-offer
              communications, covering acquisitions of U.S.-listed companies. Terms (price, premium, value, advisors) are extracted from the release text; anything
              not clearly stated is left blank. <strong>Status</strong> follows the target&apos;s filings: a merger proxy or tender offer marks a deal pending, a
              delisting or change-of-control 8-K marks it closed. <strong>IPOs</strong> are first-time S-1 / F-1 registrants; a 424B4 prospectus marks pricing.{" "}
              <strong>Multiples</strong> use the target&apos;s last-twelve-months XBRL financials as filed before the announcement. Sectors map from SEC industry codes.
            </p>
            <p>
              Coverage is automated and best-effort. Some deals are missed or have fields left blank. Figures count only the deals Castle has detected, not the whole
              market. Always check the linked filings. Not investment advice.
            </p>
          </>
        )}
        <DetailHeading>What the numbers mean</DetailHeading>
        <p>
          <strong>Deal volume:</strong> monthly announced {isSample ? "U.S." : "Castle-tracked"} M&amp;A by sector. YTD metrics compare the current year through the latest full
          month with the same months of the prior year.
          <br />
          <strong>Sector momentum:</strong> the latest month versus the month before, using the selected chart metric.
          <br />
          <strong>Premium:</strong> offer price versus unaffected share price; the headline is the median across the {dealCount} latest deals.
          <br />
          <strong>Valuations:</strong> median transaction EV/EBITDA, EV/Revenue and premium paid, latest quarter to date versus the prior quarter. Sparklines show the full quarterly history.
          <br />
          <strong>Advisor ranks:</strong> YTD totals by deal value, with movement versus the prior quarter. Shared advisory credit is not deduplicated across banks.
        </p>
        <DetailHeading>Try the terminal</DetailHeading>
        <p>
          Switch chart periods and metrics, select sector labels to show or hide lines, search companies or banks, filter the deal table, and open rows for details. Export deals downloads
          the filtered transaction table as a CSV.
        </p>
        {isSample && <Note>All data is sample data, including bank rankings.</Note>}
      </>
    ),
  };
}
