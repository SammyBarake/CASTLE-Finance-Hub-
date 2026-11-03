import Image from "next/image";
import Link from "next/link";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { ROUTES, type RouteId } from "@/components/shell/routes";
import { formatSignedPct } from "@/lib/format";
import type { LandingCounts, LandingDeal, LandingFigures, LandingKpi, LandingRecord, LandingSpecimens } from "@/lib/landing";
import { ADJ_EBITDA_DEFINITION } from "@/lib/metrics";
import { reportIssueUrl } from "@/lib/site";
import { newsreader } from "./fonts";
import { LandingBook } from "./LandingBook";
import { LandingLive } from "./LandingLive";
import { PlateCrop, PlateDial } from "./LandingPlate";
import "./landing.css";

/*
 * The landing page at "/" (server component, outside the terminal shell), set as a bank's annual report that never goes
 * to press for the last time: leaves that lay over each other as you scroll, real deals as tombstones on paper, a
 * contents page whose page numbers are live counts. Figures are computed on the server by lib/landing.ts and passed down
 * as strings; it must not import components/ui/primitives.tsx (AnimatedNumber pulls in HubDataProvider).
 *
 * Only "Open the terminal" on the cover prefetches: dataset pages call preloadHubData(), which a prefetched payload can
 * apply and start the 217 KB download for visitors who never click, and a tear-sheet prefetch costs a server render.
 * /hub is static, carries only the small boot copy and preloads nothing.
 */

const SUB =
  "U.S. M&A, IPOs and the banks behind them, read from SEC filings. A free terminal for deal flow, precedent comps, league tables and the IPO pipeline, updated several times a day, with each deal linked to its source filing. No account needed.";
const ACCOUNT_SUB = " Sign in only to keep your watchlist, notes, saved screens and deal books on every device.";

const hrefOf = (id: RouteId) => ROUTES.find((r) => r.id === id)!.href;
const n = (x: number) => x.toLocaleString("en-US");

type SpecimenId = "deal-flow" | "precedents" | "advisors" | "ipo-pipeline" | "deal-terms";

const FEATURES: { id: SpecimenId; name: string; line: string; count: (c: LandingCounts) => string | null }[] = [
  {
    id: "deal-flow",
    name: "Deal Flow",
    line: "Screen announced deals involving U.S.-listed companies by sector, size, premium, payment and status. Share a screen as a link or a live Excel feed.",
    count: (c) => `${n(c.deals)} deals`,
  },
  {
    id: "precedents",
    name: "Precedents",
    line: "Build a comps set with EV / Adj. EBITDA, EV / Revenue and premium quartiles and the banks' DCF ranges, then take it to Excel with live formulas.",
    count: (c) => (c.multiples == null ? null : `${n(c.multiples)} in the past 24 months`),
  },
  {
    id: "advisors",
    name: "Advisors",
    line: "League tables by deals and value, the fees banks earn from fairness opinions, and each bank's client profile.",
    count: (c) => (c.banks ? `${n(c.banks)} banks this year` : null),
  },
  {
    id: "ipo-pipeline",
    name: "IPO Pipeline",
    line: "Companies that filed to list on a U.S. exchange, from filing to pricing to trading, with their bookrunners.",
    count: (c) => `${n(c.ipos)} filed`,
  },
  {
    id: "deal-terms",
    name: "Deal Terms",
    line: "Break and reverse break fees, go-shops, financing conditions and committed lenders.",
    count: (c) => (c.terms == null ? null : `${n(c.terms)} with terms read`),
  },
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

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** A word that rises out of its own mask, so any line wrap works and the text stays one sentence for screen readers. */
function Words({ text, from = 0, italic }: { text: string; from?: number; italic?: boolean }) {
  return text.split(" ").map((w, i) => (
    <Fragment key={i}>
      <span className={`w${italic ? " it" : ""}`}>
        <span style={stagger(from + i)}>{w}</span>
      </span>{" "}
    </Fragment>
  ));
}

/** Each leaf's heading line: kicker on the left, a roman folio on the right. */
function Head({ id, kicker, folio }: { id: string; kicker: ReactNode; folio: string }) {
  return (
    <header className="lx-head">
      <h2 className="lx-kicker" id={id}>
        {kicker}
      </h2>
      <span className="lx-folio" aria-hidden="true">
        {folio}
      </span>
    </header>
  );
}

function Highlights({ kpis }: { kpis: LandingKpi[] }) {
  const [tracked, value, advisor, ipos] = kpis;
  return (
    <div className="landing-kpis" data-r="">
      <div className="kpi lx-fig-value" title={value.title}>
        <div className="lx-figure" style={{ "--len": value.figure.length } as CSSProperties}>
          <span className="lx-sr">{value.value}</span>
          {[...value.figure].map((g, i) => (
            <span className="g" key={i} aria-hidden="true">
              <span style={stagger(i)}>{g}</span>
            </span>
          ))}
        </div>
        <div className="lx-fig-side r" style={stagger(4)}>
          <h3 className="lx-fig-label">{value.label}</h3>
          <p className="lx-fig-note">
            {value.note}
            {value.changePct != null && <span className="lx-change"> {formatSignedPct(value.changePct)}</span>}
          </p>
          <p className="lx-fig-claim">
            What Castle has read in SEC filings, not a market total: announced deals involving U.S.-listed companies, where a filing states the value or
            the price and shares to calculate it.
          </p>
        </div>
      </div>
      <i className="lx-rule" />
      <div className="lx-fig-row">
        {[tracked, advisor, ipos].map((k, i) => (
          <div className={`kpi lx-fig r${k.text ? " text" : ""}`} key={k.label} title={k.title} style={stagger(6 + i * 2)}>
            <div className="lx-fig-label">{k.label}</div>
            <div className="lx-fig-num">{k.figure}</div>
            <div className="lx-fig-note">{k === advisor ? creditNote(k.note) : k.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "45 deals · $276.0B" reads low to anyone at that bank: it says whose count it is. */
const creditNote = (note: string) => note.replace(/^([\d,]+) deals/, "$1 deals credited in filings Castle has read");

function Tombstone({ d, i }: { d: LandingDeal; i: number }) {
  return (
    <article className="lx-tomb r" style={stagger(i)}>
      <Link
        className="lx-tomb-link"
        href={`/tearsheet/deal/${encodeURIComponent(d.id)}`}
        prefetch={false}
        title={[d.value, d.advisorsTitle].filter(Boolean).join(" · ")}
        aria-label={`${d.acquirer} ${d.verb} ${d.target}, ${d.value}: open the tear sheet${d.advisorsTitle ? `. ${d.advisorsTitle}` : ""}`}
      />
      <i className="lx-tomb-frame" aria-hidden="true" />
      <h3 className="lx-tomb-names">
        <strong>{d.acquirer}</strong> <em>{d.verb}</em> <strong>{d.target}</strong>
      </h3>
      <div className="lx-tomb-value">{d.figure}</div>
      <div className="lx-tomb-foot">
        <span>{d.dateFull}</span>
        <span className="lx-tomb-adv">
          {d.advisors.length > 0 && (
            <>
              Advised by {d.advisors.join(" and ")}
              {d.moreAdvisors > 0 && ` +${d.moreAdvisors}`}
            </>
          )}
        </span>
        {d.filing && (
          <a href={d.filing.url} target="_blank" rel="noopener noreferrer" title="Open the filing on SEC.gov">
            {d.filing.form} filed {d.filing.filed} <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </article>
  );
}

const LEFT_COLUMNS = new Set(["Target", "Acquirer", "Advisor", "Company", "Lead bookrunner", "Stage", "Date"]);
/** Columns that go first where a table has no room (phones). */
const OPTIONAL_COLUMNS = new Set(["EV / Revenue", "Date", "Stage"]);
/** The longest head may take two lines, only where the table has no room for it on one (a phone: "Premium" went off the edge). */
const WRAPPING_COLUMNS = new Set(["EV / Adj. EBITDA"]);

function ExhibitTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="lx-table-wrap">
      <table className="lx-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className={`${LEFT_COLUMNS.has(h) ? "l" : ""}${OPTIONAL_COLUMNS.has(h) ? " opt" : ""}`.trim() || undefined} style={WRAPPING_COLUMNS.has(h) ? { whiteSpace: "normal" } : undefined}>
                {h || <span className="lx-sr">Rank</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Exhibit({ id, title, href, cta, active, children }: { id: SpecimenId; title: string; href: string; cta: string; active: boolean; children: ReactNode }) {
  return (
    <figure className={`lx-exhibit${active ? " default" : ""}`} data-s={id}>
      <figcaption>
        <span>{title}</span>
        <Link href={href} prefetch={false}>
          {cta} <span aria-hidden="true">→</span>
        </Link>
      </figcaption>
      {children}
    </figure>
  );
}

function Exhibits({ s }: { s: LandingSpecimens }) {
  return (
    <div className="lx-exhibits">
      {s.dealFlow.rows.length > 0 && (
        <Exhibit id="deal-flow" title="Newest deals with a stated value" href={hrefOf("deal-flow")} cta="Deal Flow" active={!s.precedents}>
          <ExhibitTable head={["Date", "Acquirer", "Target", "Deal value", "Premium"]}>
            {s.dealFlow.rows.map((r) => (
              <tr key={r.id}>
                <td className="opt">{r.date}</td>
                <td className="name" title={r.acquirer}>
                  {r.acquirer}
                </td>
                <td className="name" title={r.target}>
                  {r.target}
                </td>
                <td className="num">{r.value}</td>
                <td className="num">{r.premium}</td>
              </tr>
            ))}
          </ExhibitTable>
        </Exhibit>
      )}
      {s.precedents && (
        <Exhibit id="precedents" title={`Comps · ${s.precedents.screen} · ${n(s.precedents.n)} deals`} href={s.precedents.href} cta="Open this screen" active>
          <ExhibitTable head={["Target", "Deal value", "EV / Adj. EBITDA", "EV / Revenue", "Premium"]}>
            {s.precedents.rows.map((r) => (
              <tr key={r.id}>
                <td className="name" title={r.target}>
                  {r.target}
                </td>
                <td className="num">{r.value}</td>
                <td className="num">{r.evEbitda}</td>
                <td className="num opt">{r.evRevenue}</td>
                <td className="num">{r.premium}</td>
              </tr>
            ))}
            {s.precedents.summary.map((r) => (
              <tr key={r.label} className="sum">
                <th scope="row">{r.label}</th>
                <td className="num">{r.value}</td>
                <td className="num">{r.evEbitda}</td>
                <td className="num opt">{r.evRevenue}</td>
                <td className="num">{r.premium}</td>
              </tr>
            ))}
          </ExhibitTable>
          <p className="lx-exhibit-note">As on Precedents: deal value is the enterprise value where it&apos;s known, else the headline value, and each statistic counts the deals that state it. {ADJ_EBITDA_DEFINITION}</p>
        </Exhibit>
      )}
      {s.advisors.rows.length > 0 && (
        <Exhibit id="advisors" title={`League table · ${s.advisors.period}, by value`} href={hrefOf("advisors")} cta="Advisors" active={false}>
          <ExhibitTable head={["", "Advisor", "Deals advised", "Deal value"]}>
            {s.advisors.rows.map((r) => (
              <tr key={r.name}>
                <td className="num rank">{r.rank}</td>
                <td className="name" title={r.name}>
                  {r.name}
                  <i className="lx-bar" style={{ "--share": r.share } as CSSProperties} aria-hidden="true" />
                </td>
                <td className="num">{r.deals}</td>
                <td className="num">{r.value}</td>
              </tr>
            ))}
          </ExhibitTable>
        </Exhibit>
      )}
      <Exhibit id="ipo-pipeline" title={`Pipeline · ${n(s.ipos.filed)} filed · ${n(s.ipos.priced)} priced · ${n(s.ipos.trading)} trading`} href={hrefOf("ipo-pipeline")} cta="IPO Pipeline" active={false}>
        <ExhibitTable head={["Company", "Stage", "Date", "Expected raise", "Lead bookrunner"]}>
          {s.ipos.rows.map((r) => (
            <tr key={r.company + r.date}>
              <td className="name" title={r.company}>
                {r.company}
              </td>
              <td className="opt">{r.stage}</td>
              <td className="opt">{r.date}</td>
              <td className="num">{r.raise}</td>
              <td className="name" title={r.bank}>
                {r.bank}
              </td>
            </tr>
          ))}
        </ExhibitTable>
      </Exhibit>
      {s.terms && (
        <Exhibit id="deal-terms" title={`What's market · ${n(s.terms.n)} deals with terms read`} href={hrefOf("deal-terms")} cta="Deal Terms" active={false}>
          <dl className="lx-terms">
            <div>
              <dt>Median break fee</dt>
              <dd>{s.terms.medianBreak}</dd>
            </div>
            <div>
              <dt>Median reverse fee</dt>
              <dd>{s.terms.medianReverse}</dd>
            </div>
            <div>
              <dt>With a go-shop</dt>
              <dd>{s.terms.goShop}</dd>
            </div>
            <div>
              <dt>No financing condition</dt>
              <dd>{s.terms.noFinancing}</dd>
            </div>
          </dl>
          <ExhibitTable head={["Deal value", "Deals", "Break fee", "Reverse fee"]}>
            {s.terms.bands.map((b) => (
              <tr key={b.label}>
                <td className="name">{b.label}</td>
                <td className="num">{b.n}</td>
                <td className="num">{b.targetFee}</td>
                <td className="num">{b.reverseFee}</td>
              </tr>
            ))}
          </ExhibitTable>
          <p className="lx-exhibit-note">Each figure counts the deals where it&apos;s stated.</p>
        </Exhibit>
      )}
    </div>
  );
}

function RecordCard({ r }: { r: LandingRecord }) {
  const rows: [string, string][] = [
    ["Deal value", r.value],
    ["Offer price", r.price],
    ["Premium", r.premium],
    ["Payment", r.payment],
    ["EV / Adj. EBITDA", r.evEbitda],
    ["EV / Revenue", r.evRevenue],
    [r.targetAdvisors.includes(",") ? "Target's advisors" : "Target's advisor", r.targetAdvisors],
    [r.acquirerAdvisors.includes(",") ? "Acquirer's advisors" : "Acquirer's advisor", r.acquirerAdvisors],
  ];
  return (
    <figure className="lx-record">
      <figcaption>One record, as Castle holds it</figcaption>
      <div className="lx-record-names">
        <Link href={`/tearsheet/deal/${encodeURIComponent(r.id)}`} prefetch={false} title="Open the tear sheet" aria-label={`${r.acquirer} ${r.verb} ${r.target}: open the tear sheet`}>
          {r.acquirer} <em>{r.verb}</em> {r.target}
        </Link>
        <small>Announced {r.date}</small>
      </div>
      <dl>
        {rows.map(([label, value], i) => (
          <div className="r" key={label} style={stagger(i + 3)}>
            <dt>{label}</dt>
            <dd className={value === "—" ? "blank" : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <a className="lx-record-source r" style={stagger(12)} href={r.filing.url} target="_blank" rel="noopener noreferrer">
        {r.isRelease ? `Check it against the source: the press release, filed ${r.filing.filed} on SEC.gov` : `The filing that announced it: ${r.filing.form}, ${r.filing.filed}, on SEC.gov`} <span aria-hidden="true">↗</span>
      </a>
    </figure>
  );
}

const LEAVES: { id: string; name: string }[] = [
  { id: "cover", name: "Cover" },
  { id: "highlights", name: "Highlights" },
  { id: "plate", name: "The plate" },
  { id: "transactions", name: "Recent transactions" },
  { id: "terminal", name: "In the terminal" },
  { id: "notes", name: "Notes on the data" },
  { id: "close", name: "Back cover" },
];

export function LandingView({ figures, authEnabled }: { figures: LandingFigures; authEnabled: boolean }) {
  const { kpis, deals, dealsNote, plate, counts, specimens, record } = figures;
  const isSample = figures.state === "sample";
  const live = figures.state === "live" && figures.asOf && figures.asOfLabel;
  const present = LEAVES.filter((l) => (l.id === "highlights" ? kpis.length > 0 : l.id === "plate" ? !!plate : l.id === "transactions" ? deals.length > 0 : true));
  const folio = (id: string) => ["I", "II", "III", "IV", "V", "VI", "VII"][present.findIndex((l) => l.id === id)];
  const z = (id: string) => ({ "--z": present.findIndex((l) => l.id === id) + 1 }) as CSSProperties;

  return (
    <div className={`landing ${newsreader.variable}`}>
      <LandingBook />
      {plate && (
        <>
          <link rel="preload" as="image" href={`/api/landing/plate.svg?v=${encodeURIComponent(plate.version)}&d=full`} media="(min-width: 1021px)" fetchPriority="high" />
          <link rel="preload" as="image" href={`/api/landing/plate.svg?v=${encodeURIComponent(plate.version)}&d=phone`} media="(max-width: 1020px)" />
        </>
      )}
      <Link className="lx-float" href="/hub" prefetch={false} tabIndex={-1} aria-hidden="true">
        Open the terminal <span className="arrow" aria-hidden="true">→</span>
      </Link>

      <main className="lx-book">
        {/* I. Cover */}
        <i className="lx-sentinel" id="cover" />
        <section className="lx-leaf lx-cover" style={z("cover")}>
          <div className="lx-sheet">
            {plate && <PlateCrop plate={plate} />}
            <div className="lx-cover-scrim" aria-hidden="true" />
            <div className="lx-cover-logo">
              <Image src="/castle-logo.png" alt="Castle" width={94} height={72} loading="eager" />
            </div>
            <div className="lx-cover-body">
              <h1 className="lx-title">
                <span className="ln">
                  <Words text="Who bought whom," />
                </span>{" "}
                <span className="ln">
                  <Words text="at what price," from={3} />
                </span>{" "}
                <span className="ln">
                  <Words text="on whose advice." from={7} italic />
                </span>
              </h1>
              <p className="lx-sub">
                {SUB}
                {authEnabled && ACCOUNT_SUB}
              </p>
              <div className="lx-actions">
                <Link className="lx-button" href="/hub">
                  <span>Open the terminal</span> <span className="arrow" aria-hidden="true">→</span>
                </Link>
                {authEnabled && (
                  <Link className="lx-button quiet" href="/hub?signin=1" prefetch={false}>
                    Sign in to save
                  </Link>
                )}
              </div>
              {live ? (
                <LandingLive asOf={figures.asOf!} asOfLabel={figures.asOfLabel!} />
              ) : (
                <p className="lx-live off">
                  <i aria-hidden="true" />
                  {isSample ? "Sample data · local development" : "Live figures are unavailable right now. The terminal shows why and retries on its own."}
                </p>
              )}
            </div>
            <i className="lx-cue" aria-hidden="true" />
          </div>
        </section>

        {/* II. Highlights */}
        {kpis.length > 0 && (
          <>
            <i className="lx-sentinel" id="highlights" />
            <section className="lx-leaf lx-highlights" style={z("highlights")} aria-labelledby="lx-h-highlights">
              <div className="lx-sheet">
                <Head id="lx-h-highlights" kicker="Highlights" folio={folio("highlights")} />
                <Highlights kpis={kpis} />
              </div>
            </section>
          </>
        )}

        {/* III. The plate */}
        {plate && (
          <>
            <i className="lx-sentinel" id="plate" />
            <section className="lx-leaf lx-plate-leaf" style={z("plate")} aria-labelledby="lx-h-plate">
              <div className="lx-sheet">
                <Head id="lx-h-plate" kicker="The plate" folio={folio("plate")} />
                <div className="lx-plate-grid">
                  <div className="lx-plate-copy" data-r="">
                    <h3 className="lx-h2">
                      <span className="w">
                        <span>{n(plate.months.length)}</span>
                      </span>{" "}
                      <Words text="months of" from={1} />
                      <span className="lx-nowrap">
                        <Words text="announced M&A" from={3} />
                      </span>
                    </h3>
                    <p className="r" style={stagger(6)}>
                      One turn runs clockwise from {plate.from} at the top to {plate.to}. Each spoke is a month: its length is the value announced, on a root scale,
                      and its bands are the sectors, from Tech at the core to Industrials at the tip.
                    </p>
                    <p className="lx-note r" style={stagger(8)}>
                      The largest month: {plate.peak.label}. {plate.league.length > 0 && <span className="lx-hint-league">The outer ring is the {plate.leaguePeriod} league table, by value. </span>}
                      <span className="lx-hint-pointer">Move across the plate to read a month.</span>
                      <span className="lx-hint-touch">Tap the plate to read a month.</span>
                    </p>
                    <Link className="lx-link r" style={stagger(10)} href={hrefOf("deal-volume")} prefetch={false}>
                      Volume <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                  {/* A new month after a refresh starts the dial over, since its needle is held in state. */}
                  <PlateDial key={plate.months.length} plate={plate} />
                </div>
              </div>
            </section>
          </>
        )}

        {/* IV. Recent transactions */}
        {deals.length > 0 && (
          <>
            <i className="lx-sentinel" id="transactions" />
            <section className="lx-leaf paper lx-transactions" style={z("transactions")} aria-labelledby="lx-h-transactions">
              <div className="lx-sheet">
                <Head id="lx-h-transactions" kicker={<>Recent transactions · read from SEC filings · {dealsNote}</>} folio={folio("transactions")} />
                <div className={`lx-tombs n${deals.length}`} data-r="">
                  {deals.map((d, i) => (
                    <Tombstone key={d.id} d={d} i={i} />
                  ))}
                </div>
                <footer className="lx-tomb-note">
                  <p>These announcements appear as a matter of record only. Castle read them from SEC filings and advised on none of them.</p>
                  <Link className="lx-link" href={hrefOf("deal-flow")} prefetch={false}>
                    Deal Flow <span aria-hidden="true">→</span>
                  </Link>
                </footer>
              </div>
            </section>
          </>
        )}

        {/* V. In the terminal */}
        <i className="lx-sentinel" id="terminal" />
        <section className="lx-leaf lx-terminal" style={z("terminal")} aria-labelledby="lx-h-terminal">
          <div className="lx-sheet">
            <Head id="lx-h-terminal" kicker="In the terminal" folio={folio("terminal")} />
            <div className="lx-contents" data-active={specimens?.precedents ? "precedents" : "deal-flow"} data-r="">
              <nav className="lx-rows" aria-labelledby="lx-h-terminal">
                {FEATURES.map((f, i) => {
                  const count = counts ? f.count(counts) : null;
                  return (
                    <Link key={f.id} className="lx-row" data-s={f.id} href={hrefOf(f.id)} prefetch={false} style={stagger(i)}>
                      <span className="lx-row-name">
                        <span>{f.name}</span>
                      </span>
                      <span className="lx-row-line">{f.line}</span>
                      <span className="lx-row-count">{count}</span>
                    </Link>
                  );
                })}
              </nav>
              {specimens && <Exhibits s={specimens} />}
            </div>
            <p className="lx-more">
              <span>Also in the terminal:</span>{" "}
              {MORE.map((m, i) => (
                <Fragment key={m.id}>
                  <span className="lx-more-item">
                    <Link href={hrefOf(m.id)} prefetch={false}>
                      {m.name}
                    </Link>
                    {i < MORE.length - 1 && <span aria-hidden="true"> ·</span>}
                  </span>{" "}
                </Fragment>
              ))}
            </p>
          </div>
        </section>

        {/* VI. Notes on the data */}
        <i className="lx-sentinel" id="notes" />
        <section className="lx-leaf paper lx-notes" style={z("notes")} aria-labelledby="lx-h-notes">
          <div className="lx-sheet">
            <Head id="lx-h-notes" kicker="Notes on the data" folio={folio("notes")} />
            <div className={`lx-notes-grid${record ? "" : " single"}`} data-r="">
              <div>
                <h3 className="lx-h2">
                  <Words text="Blank is better than wrong." />
                </h3>
                <ol className="lx-steps">
                  <li className="r" style={stagger(5)}>
                    <strong>Read.</strong> Several times a day, Castle searches SEC EDGAR for new deal press releases, merger 8-Ks, merger proxies, tender offers and IPO prospectuses.
                  </li>
                  <li className="r" style={stagger(7)}>
                    <strong>Extract.</strong> Rule-based parsers read the parties, price, premium, value, advisors and deal terms. No AI model writes the numbers: a term that isn&apos;t clearly stated
                    is left blank, and values and multiples are calculated only from stated figures (offer price × shares, reported financials).
                  </li>
                  <li className="r" style={stagger(9)}>
                    <strong>Check.</strong> Every update ends with a data-quality audit, and each deal links to its source filing.{" "}
                    <Link href={hrefOf("coverage")} prefetch={false}>
                      Data Coverage
                    </Link>{" "}
                    shows how complete each field is.
                  </li>
                </ol>
                <p className="lx-limits r" style={stagger(11)}>
                  Coverage is partial: Castle tracks announced deals involving U.S.-listed companies, and SPACs, OTC shells and resales are out of scope. Sources: SEC EDGAR, plus IMF, BIS, FRED, BEA
                  and Yahoo Finance for macro and market data, all free and public.{" "}
                  <Link href="/about" prefetch={false}>
                    About the data
                  </Link>
                </p>
              </div>
              {record && <RecordCard r={record} />}
            </div>
          </div>
        </section>

        {/* VII. Back cover */}
        <i className="lx-sentinel" id="close" />
        <section className="lx-leaf lx-close" style={z("close")} aria-label="Open the terminal">
          <div className="lx-sheet">
            <div className="lx-close-body" data-r="">
              <Link className="lx-close-link" href="/hub" prefetch={false}>
                <span className="lx-close-line">
                  <Words text="Open the" />
                </span>{" "}
                <span className="lx-close-line">
                  <Words text="terminal" from={2} italic />
                  <span className="arrow" aria-hidden="true">→</span>
                </span>
              </Link>
              <p className="r" style={stagger(5)}>
                Free. No account needed.
                {authEnabled && (
                  <>
                    {" "}
                    <Link href="/hub?signin=1" prefetch={false}>
                      Sign in to save
                    </Link>
                  </>
                )}
              </p>
            </div>
            <footer className="lx-footer">
              <span>{isSample ? "Sample data (local development) · Fictional transactions and rankings" : "SEC EDGAR · Updated several times a day · Not investment advice"}</span>
              <nav aria-label="About Castle">
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
        </section>
      </main>
      <nav className="lx-fore" aria-label="Pages of this page">
        {present.map((l) => (
          <a key={l.id} href={`#${l.id}`} aria-label={l.name}>
            <span>{l.name}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
