import { StatusTag } from "@/components/ui/primitives";
import { DetailGrid, DetailHeading, DetailItem, Note, type DialogContent } from "@/components/ui/UiProvider";
import {
  CONSIDERATION_LABEL,
  formatDateLong,
  formatPct,
  formatPrice,
  formatRaise,
  formatUsd,
  formatUsdB1,
} from "@/lib/format";
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

export function dealDetail(d: Deal, isSample: boolean): DialogContent {
  return {
    eyebrow: `Transaction brief · ${d.sector}`,
    title: `${d.acquirer.name} → ${d.target.name}`,
    body: (
      <>
        <p>
          {d.acquirer.name} announced an agreement to acquire {d.target.name}
          {d.valueUsd != null && <> for {formatUsd(d.valueUsd)}</>}
          {d.premiumPct != null && <>, representing a {formatPct(d.premiumPct)} premium to the unaffected share price</>}.
        </p>
        <DetailGrid>
          <DetailItem label="Announced">{formatDateLong(d.announcedDate)}</DetailItem>
          <DetailItem label="Status">
            <StatusTag status={d.status} />
          </DetailItem>
          <DetailItem label="Transaction value">{formatUsd(d.valueUsd)}</DetailItem>
          <DetailItem label="Offer price per share">{formatPrice(d.pricePerShare)}</DetailItem>
          <DetailItem label="Consideration">{CONSIDERATION_LABEL[d.consideration]}</DetailItem>
          <DetailItem label="Premium">{formatPct(d.premiumPct)}</DetailItem>
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
          <DetailItem label="Lead underwriter">{i.underwriters[0] ?? "n/a"}</DetailItem>
          <DetailItem label="Joint bookrunner">{i.underwriters.slice(1).join(", ") || "n/a"}</DetailItem>
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
        <DetailHeading>What the numbers mean</DetailHeading>
        <p>
          <strong>Deal volume:</strong> monthly announced U.S. M&amp;A by sector. YTD metrics compare the current year through the latest full month with the same months of the prior year.
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
