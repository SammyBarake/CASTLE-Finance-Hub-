"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useHubData } from "@/components/data/HubDataProvider";
import { SECTIONS, type SectionId } from "@/components/shell/routes";
import { Kpi, Kpis, PageHeading, PanelHead } from "@/components/ui/primitives";
import { coverageStart } from "@/lib/aggregate";
import { reportIssueUrl } from "@/lib/site";

/** The footer's site pages: About (with live counts from the shared dataset), Terms of Use and Privacy. */

const EFFECTIVE = "October 2026";

const SECTION_BLURBS: Record<SectionId, string> = {
  hub: "The latest deals, IPOs and league table at a glance, and how complete each field is.",
  ma: "Every announced deal with its terms, volume over time, deal protections, time to close and activist campaigns.",
  valuation: "Median EV / EBITDA, EV / Revenue and premiums by sector, and a precedent-transaction screen.",
  advisors: "League tables of the banks on each deal, the fees they earn and their client profiles.",
  ipos: "Companies that filed to go public, from filing to pricing to trading, with their underwriters.",
  macro: "GDP growth, inflation and central-bank policy rates for 11 major economies.",
  whatif: "How a shock to rates, volatility or one sector ripples through deal activity, with its backtested accuracy.",
};

const SOURCES: { name: string; what: string; terms: string }[] = [
  { name: "SEC EDGAR", what: "Filings behind every deal, term, adviser, IPO and activist stake, and company financials (XBRL)", terms: "Public U.S. government data" },
  { name: "IMF World Economic Outlook", what: "GDP growth and inflation (current year is an IMF estimate)", terms: "© International Monetary Fund, used with attribution" },
  { name: "Bank for International Settlements", what: "Central-bank policy rates", terms: "© BIS, used with attribution" },
  { name: "FRED, Federal Reserve Bank of St. Louis", what: "Interest rates, credit spreads, volatility and inflation behind the What-if history", terms: "Source: FRED" },
  { name: "U.S. Bureau of Economic Analysis", what: "Input-output tables behind the What-if sector links", terms: "Public U.S. government data" },
  { name: "Yahoo Finance", what: "Daily share prices behind merger-arb spreads, buyers' share reactions and sector returns", terms: "Third-party market data" },
];

function Report({ children = "Report a data issue" }: { children?: ReactNode }) {
  return (
    <a className="small-link" href={reportIssueUrl()} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function AboutView() {
  const { data } = useHubData();
  const stats = useMemo(() => {
    const start = coverageStart(data.deals) ?? data.deals.map((d) => d.announcedDate).sort()[0] ?? null;
    const banks = new Set(data.deals.flatMap((d) => [...d.acquirerAdvisors, ...d.targetAdvisors]));
    const priv = data.deals.filter((d) => d.privateTarget).length;
    return {
      start: start?.slice(0, 4) ?? "—",
      deals: data.deals.length,
      pub: data.deals.length - priv,
      priv,
      ipos: data.ipos.length,
      priced: data.ipos.filter((i) => i.stage !== "Filed").length,
      banks: banks.size,
    };
  }, [data.deals, data.ipos]);
  const n = (v: number) => v.toLocaleString("en-US");

  return (
    <>
      <PageHeading title="About Castle" subtitle="A free terminal for investment banking activity, built on public SEC filings" />
      <Kpis label="What Castle tracks">
        <Kpi label="Deals tracked" value={n(stats.deals)} note={`Announced since ${stats.start}`} />
        <Kpi label="Public-company targets" value={n(stats.pub)} note={`${n(stats.priv)} private-company purchases`} />
        <Kpi label="IPOs tracked" value={n(stats.ipos)} note={`${n(stats.priced)} priced or trading`} />
        <Kpi label="Banks credited" value={n(stats.banks)} note="Advisers on either side" />
      </Kpis>

      <div className="info-grid">
        <section className="panel">
          <PanelHead title="What Castle covers" subtitle="Seven sections, one dataset" />
          <ul className="info-sections">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <div className="info-section-head">
                  <strong>{s.title}</strong>
                  <span>
                    {s.routes.map((r) => (
                      <Link key={r.id} href={r.href}>
                        {r.tab}
                      </Link>
                    ))}
                  </span>
                </div>
                <p>{SECTION_BLURBS[s.id]}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <PanelHead title="How the data is made" subtitle="Read, extract, check" />
          <ol className="info-steps">
            <li>
              <strong>Read</strong>
              <p>
                Every hour on weekdays, and every six hours otherwise, Castle searches SEC EDGAR for new filings: deal press releases, merger 8-Ks, merger proxies and
                tender offers, IPO registrations and prospectuses, and Schedule 13Ds.
              </p>
            </li>
            <li>
              <strong>Extract</strong>
              <p>
                Rule-based parsers read each document for the parties, price, premium, value, advisers and deal terms. No AI model writes the numbers: a figure that
                isn&apos;t clearly stated is left blank, never estimated.
              </p>
            </li>
            <li>
              <strong>Check</strong>
              <p>
                Every update ends with a data-quality audit, and records are re-checked as new filings arrive: a deal&apos;s status follows the target&apos;s own
                filings. <Link href="/coverage">Data Coverage</Link> shows how complete each field is.
              </p>
            </li>
          </ol>
        </section>
      </div>

      <section className="panel">
        <PanelHead title="Sources" subtitle="All free and public" />
        <div className="table-scroll">
          <table className="info-sources">
            <thead>
              <tr>
                <th scope="col">SOURCE</th>
                <th scope="col">USED FOR</th>
                <th scope="col">TERMS</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s) => (
                <tr key={s.name}>
                  <th scope="row">{s.name}</th>
                  <td>{s.what}</td>
                  <td className="dim">{s.terms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="info-grid">
        <section className="panel">
          <PanelHead title="Accuracy and limits" />
          <div className="info-body">
            <p>
              Castle reads filings automatically, so it will sometimes miss a deal or read a figure wrong, and it covers the deals it can find in SEC filings, not the
              whole market. Every deal links to the filing it came from: check a figure there before relying on it.
            </p>
            <p>Spotted something wrong? Reports go straight into fixing the parsers, so the same mistake doesn&apos;t happen again.</p>
            <Report />
          </div>
        </section>

        <section className="panel">
          <PanelHead title="Who builds it" />
          <div className="info-body">
            <p>
              Castle is built and maintained independently by a finance student, as a free resource for students and analysts learning the deal market. It costs nothing
              to use and needs no account.
            </p>
            <p>
              Castle isn&apos;t affiliated with the SEC or with any company or bank it covers, and nothing on it is investment advice. See the{" "}
              <Link href="/terms">Terms of Use</Link> and <Link href="/privacy">Privacy</Link> pages.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="info-clause">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function TermsView() {
  return (
    <>
      <PageHeading title="Terms of Use" subtitle={`Effective ${EFFECTIVE} · Plain English, short on purpose`} />
      <section className="panel info-doc">
        <Clause title="What Castle is">
          <p>
            Castle is a free, informational website about mergers, acquisitions, IPOs and the banks that advise on them. Its figures are extracted automatically from
            public SEC EDGAR filings and other public data sources listed on the <Link href="/about">About</Link> page.
          </p>
        </Clause>
        <Clause title="Not investment advice">
          <p>
            Nothing on Castle is investment, legal, tax or accounting advice, or a recommendation to buy, sell or hold any security. Castle is not a broker-dealer or an
            investment adviser. Do your own research and consult a qualified professional before making any financial decision.
          </p>
        </Clause>
        <Clause title="No guarantee of accuracy">
          <p>
            Castle is provided &ldquo;as is&rdquo;, without warranties of any kind. Because its data is read automatically from filings, it may be incomplete, out of
            date or wrong. Check figures against the source filing, which every deal links to, before relying on them.
          </p>
        </Clause>
        <Clause title="Limitation of liability">
          <p>To the fullest extent the law allows, Castle and its maintainer are not liable for any loss or damage arising from your use of the site or its data.</p>
        </Clause>
        <Clause title="Fair use of the site">
          <ul>
            <li>Use Castle for your own research, study and work.</li>
            <li>Don&apos;t use automated tools to download its data in bulk or put unusual load on the site.</li>
            <li>When you share Castle&apos;s figures, say where they came from, and don&apos;t present them as your own verified data.</li>
          </ul>
        </Clause>
        <Clause title="Names and trademarks">
          <p>
            Company, bank and fund names are used only to identify them; they belong to their owners. Castle isn&apos;t affiliated with, or endorsed by, the SEC or any
            company, bank or data provider it mentions. Third-party data remains subject to its providers&apos; terms.
          </p>
        </Clause>
        <Clause title="Changes">
          <p>These terms may change as the site does. The date at the top shows the current version, and using the site means accepting the version in effect.</p>
        </Clause>
        <Clause title="Contact">
          <p>Questions, corrections or concerns:</p>
          <Report>Get in touch</Report>
        </Clause>
      </section>
    </>
  );
}

export function PrivacyView() {
  return (
    <>
      <PageHeading title="Privacy" subtitle={`Effective ${EFFECTIVE} · No accounts, no cookies, no tracking`} />
      <section className="panel info-doc">
        <Clause title="The short version">
          <p>Castle has no accounts, sets no cookies, runs no ads and no third-party trackers, and doesn&apos;t sell or share personal data.</p>
        </Clause>
        <Clause title="Your workspace stays in your browser">
          <p>
            Your watchlist, notes, saved views, columns and display settings are stored only in your browser&apos;s local storage. They are never sent to Castle&apos;s
            servers, so they don&apos;t follow you to another device, and clearing this site&apos;s data in your browser deletes them.
          </p>
        </Clause>
        <Clause title="Search happens on your device">
          <p>Searching for companies, deals and banks runs in your browser over data it has already loaded; your searches aren&apos;t sent anywhere.</p>
        </Clause>
        <Clause title="What the hosting provider sees">
          <p>
            Castle is hosted on Vercel. Like any website host, Vercel processes standard request information (such as IP address, browser type and the pages
            requested) to deliver the site and protect it from abuse, under its own privacy policy. Castle doesn&apos;t use this information to identify visitors.
          </p>
        </Clause>
        <Clause title="Links to other sites">
          <p>Links to SEC filings and other sources open those sites, which have their own privacy policies.</p>
        </Clause>
        <Clause title="Changes and contact">
          <p>If this policy changes, the date at the top changes with it. Questions about privacy:</p>
          <Report>Get in touch</Report>
        </Clause>
      </section>
    </>
  );
}
