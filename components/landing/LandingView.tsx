import Image from "next/image";
import Link from "next/link";
import { Fragment } from "react";
import { ROUTES, type RouteId } from "@/components/shell/routes";
import { Icon } from "@/components/ui/Icon";
import { formatSignedPct } from "@/lib/format";
import type { LandingFigures, LandingKpi } from "@/lib/landing";
import { reportIssueUrl } from "@/lib/site";
import { LandingLive } from "./LandingLive";

/*
 * The landing page at "/" (server component, outside the terminal shell). It says what Castle is, shows live proof
 * from the real data (figures computed on the server by lib/landing.ts, passed down as strings), what you can do in
 * the terminal and how the data is made. It must not import components/ui/primitives.tsx (AnimatedNumber pulls in
 * HubDataProvider, ExportButton pulls in more), so the markup below is the terminal's classes written by hand.
 *
 * Only "Open the terminal" prefetches: dataset pages call preloadHubData(), which a prefetched payload can apply and
 * start the 217 KB download for visitors who never click, and a tear-sheet prefetch costs a server render. /hub is
 * static, carries only the small boot copy and preloads nothing.
 */

const SUB =
  "A free terminal for deal flow, precedent comps, league tables and the IPO pipeline. Updated several times a day, with every deal linked to its source filing. No account needed.";
const ACCOUNT_SUB = " Sign in only to keep your watchlist, notes, saved screens and deal books on every device.";

const hrefOf = (id: RouteId) => ROUTES.find((r) => r.id === id)!.href;

const FEATURES: { id: RouteId; name: string; line: string }[] = [
  {
    id: "deal-flow",
    name: "Deal Flow",
    line: "Screen announced deals involving U.S.-listed companies by sector, size, premium, payment and status. Share a screen as a link or a live Excel feed.",
  },
  {
    id: "precedents",
    name: "Precedents",
    line: "Build a comps set with EV / EBITDA, EV / Revenue and premium quartiles and the banks' DCF ranges, then take it to Excel with live formulas.",
  },
  { id: "advisors", name: "Advisors", line: "League tables by deals and value, the fees banks earn from fairness opinions, and each bank's client profile." },
  { id: "ipo-pipeline", name: "IPO Pipeline", line: "Companies that filed to list on a U.S. exchange, from filing to pricing to trading, with their bookrunners." },
  { id: "deal-terms", name: "Deal Terms", line: "Break and reverse break fees, go-shops, financing conditions and committed lenders." },
];

const MORE: { id: RouteId; name: string }[] = [
  { id: "deal-volume", name: "Volume" },
  { id: "timelines", name: "Timelines" },
  { id: "activists", name: "Activism" },
  { id: "valuations", name: "Multiples" },
  { id: "books", name: "Deal Books" },
  { id: "world-economies", name: "World Economies" },
  { id: "what-if", name: "What-if" },
  { id: "coverage", name: "Data Coverage" },
];

function LandingKpiCell({ k }: { k: LandingKpi }) {
  return (
    <div className="kpi" title={k.title}>
      <div className="kpi-label">{k.label}</div>
      <div className="kpi-line">
        <span className={`kpi-value num${k.text ? " text" : ""}`}>{k.value}</span>
        {k.changePct != null && (
          <span className={`kpi-change ${k.changePct >= 0 ? "up" : "down"}`}>
            <Icon name={k.changePct >= 0 ? "up-right" : "trend-down"} />
            {formatSignedPct(k.changePct)}
          </span>
        )}
      </div>
      <div className="kpi-note">{k.note}</div>
    </div>
  );
}

export function LandingView({ figures, authEnabled }: { figures: LandingFigures; authEnabled: boolean }) {
  const { kpis, deals, dealsNote } = figures;
  const isSample = figures.state === "sample";
  return (
    <div className="landing">
      <main className="landing-main page-enter">
        <div className="landing-logo">
          <Image src="/castle-logo.png" alt="Castle" width={112} height={86} loading="eager" />
        </div>
        <h1 className="landing-title">U.S. M&amp;A, IPOs and the banks behind them, read from SEC filings.</h1>
        <p className="landing-sub">
          {SUB}
          {authEnabled && ACCOUNT_SUB}
        </p>
        <div className="landing-actions">
          <Link className="button primary landing-cta" href="/hub">
            Open the terminal <Icon name="right" />
          </Link>
          {authEnabled && (
            <Link className="button landing-cta" href="/hub?signin=1" prefetch={false}>
              Sign in to save
            </Link>
          )}
        </div>
        {figures.state === "live" && figures.asOf && figures.asOfLabel ? (
          <LandingLive asOf={figures.asOf} asOfLabel={figures.asOfLabel} />
        ) : (
          <p className="landing-live off">
            <span className="whatif-meta-dot" aria-hidden="true" />
            {isSample ? "Sample data · local development" : "Live figures are unavailable right now. The terminal shows why and retries on its own."}
          </p>
        )}
        {kpis.length > 0 && (
          <section className="kpis landing-kpis" aria-label="Live figures from the terminal">
            {kpis.map((k) => (
              <LandingKpiCell key={k.label} k={k} />
            ))}
          </section>
        )}
        <div className={`landing-grid${deals.length ? "" : " single"}`}>
          {deals.length > 0 && (
            <section className="panel" aria-labelledby="landing-latest-title">
              <div className="panel-head">
                <div className="panel-heading">
                  <h2 id="landing-latest-title">Latest deals</h2>
                  <small>{dealsNote}</small>
                </div>
                <Link className="small-link" href={hrefOf("deal-flow")} prefetch={false}>
                  Deal Flow <Icon name="right" />
                </Link>
              </div>
              {deals.map((d) => (
                <Link key={d.id} className="preview-row" href={`/tearsheet/deal/${encodeURIComponent(d.id)}`} prefetch={false} title="Open the tear sheet">
                  <span className="preview-company">
                    <span className="company-mark" aria-hidden="true">
                      {d.mark}
                    </span>
                    <span>
                      <strong>{d.target}</strong>
                      <small>
                        {d.acquirer} · {d.date}
                      </small>
                    </span>
                  </span>
                  <span className="preview-value">
                    {d.value}
                    <small>{d.sector}</small>
                  </span>
                </Link>
              ))}
            </section>
          )}
          <section className="panel" aria-labelledby="landing-how-title">
            <div className="panel-head">
              <div className="panel-heading">
                <h2 id="landing-how-title">How the data is made</h2>
                <small>Read, extract, check</small>
              </div>
            </div>
            <ol className="info-steps">
              <li>
                <strong>Read</strong>
                <p>Several times a day, Castle searches SEC EDGAR for new deal press releases, merger 8-Ks, merger proxies, tender offers and IPO prospectuses.</p>
              </li>
              <li>
                <strong>Extract</strong>
                <p>
                  Rule-based parsers read the parties, price, premium, value, advisors and deal terms. No AI model writes the numbers: a term that isn&apos;t clearly
                  stated is left blank, and values and multiples are calculated only from stated figures (offer price × shares, reported financials).
                </p>
              </li>
              <li>
                <strong>Check</strong>
                <p>
                  Every update ends with a data-quality audit, and each deal links to its source filing.{" "}
                  <Link href={hrefOf("coverage")} prefetch={false}>
                    Data Coverage
                  </Link>{" "}
                  shows how complete each field is.
                </p>
              </li>
            </ol>
            <p className="landing-sources">
              Sources: SEC EDGAR, plus IMF, BIS, FRED, BEA and Yahoo Finance for macro and market data. All free and public.{" "}
              <Link href="/about" prefetch={false}>
                About the data
              </Link>
            </p>
          </section>
        </div>
        <nav className="landing-features" aria-labelledby="landing-features-title">
          <h2 id="landing-features-title">In the terminal</h2>
          {FEATURES.map((f) => (
            <Link key={f.id} className="landing-feature" href={hrefOf(f.id)} prefetch={false}>
              <strong>{f.name}</strong>
              <span>{f.line}</span>
              <Icon name="right" />
            </Link>
          ))}
          <p className="landing-more">
            Also in the terminal:{" "}
            {/* The separator follows its link and each item stays whole, so a wrapped line never starts with a dot. */}
            {MORE.map((m, i) => (
              <Fragment key={m.id}>
                <span className="landing-more-item">
                  <Link href={hrefOf(m.id)} prefetch={false}>
                    {m.name}
                  </Link>
                  {i < MORE.length - 1 && <span aria-hidden="true">·</span>}
                </span>{" "}
              </Fragment>
            ))}
          </p>
        </nav>
      </main>
      <footer className="footer landing-footer">
        <span className="sample-tag">{isSample ? "Sample data (local development) · Fictional transactions and rankings" : "SEC EDGAR · Updated several times a day · Not investment advice"}</span>
        <nav className="footer-links" aria-label="About Castle">
          <Link href="/about" prefetch={false}>
            About
          </Link>
          <a href={reportIssueUrl()} target="_blank" rel="noopener noreferrer">
            Report a data issue
          </a>
          <Link href="/terms" prefetch={false}>
            Terms
          </Link>
          <Link href="/privacy" prefetch={false}>
            Privacy
          </Link>
        </nav>
      </footer>
    </div>
  );
}
