/**
 * Live data links: CSV that Excel (Data → From Web) and Google Sheets (=IMPORTDATA) refresh straight from Castle. A
 * link carries the page's own filters, the same URL state as the page, so the sheet shows exactly what the screen
 * shows, with Castle's latest data on every refresh. Pure and tested; the route handlers in app/api/live/ pass in the
 * cached dataset (no database read per request) and the CDN keeps each link for a few minutes.
 */
import type { BookRow } from "./books";
import { dealSize, DEFAULT_PRECEDENTS, PRECEDENT_SPEC, screenForDeal, screenPrecedents } from "./precedents";
import { DEAL_SCREEN_SPEC, DEFAULT_SCREEN, screenDeals } from "./screen";
import { IPO_STAGES, SECTORS, type Deal, type HubData, type Ipo, type LeagueTableEntry } from "./types";
import { decodeState } from "./urlState";

type Cell = string | number | null | undefined;

/** A table for a sheet: one header row, then the rows. */
export interface LiveTable {
  headers: string[];
  rows: Cell[][];
}

/** UTF-8 byte-order mark: Excel needs it to read accented names ("Nestlé") from a web CSV. */
const BOM = String.fromCharCode(0xfeff);

/**
 * RFC 4180 text with numbers left bare (so both apps read them as numbers) and dates as ISO. A text cell starting
 * with = + - @ (or a tab or return) gets a leading apostrophe: book comments are user-written, and a spreadsheet must
 * never run them as formulas. Sample data (local development and CI only) says so on every row.
 */
export function toLiveCsv({ headers, rows }: LiveTable, opts: { sample?: boolean } = {}): string {
  const text = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const cell = (v: Cell) => (v == null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : text(v));
  const all = opts.sample ? [["Data", ...headers], ...rows.map((r) => ["SAMPLE (FICTIONAL)", ...r])] : [headers, ...rows];
  return BOM + all.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const usdM = (usd: number | null | undefined) => (usd == null ? null : Math.round(usd / 1e5) / 10);
const one = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
const tearSheet = (d: Deal, site: string) => `${site}/tearsheet/deal/${encodeURIComponent(d.id)}`;

// ---------------------------------------------------------------------------
// Deal Flow: the screener's filters (?sector=Tech&min=1&sort=value …)
// ---------------------------------------------------------------------------

export const DEAL_HEADERS = [
  "Announced",
  "Acquirer",
  "Acquirer ticker",
  "Target",
  "Target ticker",
  "Target type",
  "Sector",
  "Industry",
  "Status",
  "Consideration",
  "Deal value ($M)",
  "Enterprise value ($M)",
  "Offer price ($)",
  "Premium (%)",
  "EV / Revenue",
  "EV / EBITDA",
  "Acquirer advisors",
  "Target advisors",
  "Source filing",
  "Castle tear sheet",
];

const dealCells = (d: Deal, site: string): Cell[] => [
  d.announcedDate,
  d.acquirer.name,
  d.acquirer.ticker,
  d.target.name,
  d.target.ticker,
  d.privateTarget ? "Private" : "Public",
  d.sector,
  d.industry,
  d.status,
  d.consideration,
  usdM(d.valueUsd),
  usdM(d.enterpriseValueUsd),
  d.pricePerShare,
  one(d.premiumPct),
  d.evRevenue,
  d.evEbitda,
  d.acquirerAdvisors.join("; "),
  d.targetAdvisors.join("; "),
  d.filings[0]?.url,
  tearSheet(d, site),
];

/** The Deal Flow screen a link describes (the watchlist filter is the viewer's own, so never part of one). */
export const dealsForQuery = (deals: Deal[], params: URLSearchParams, asOf: string) =>
  screenDeals(deals, { ...decodeState(params, DEFAULT_SCREEN, DEAL_SCREEN_SPEC), watchOnly: false }, { asOf, isWatched: () => false });

export const dealsTable = (deals: Deal[], site: string): LiveTable => ({ headers: DEAL_HEADERS, rows: deals.map((d) => dealCells(d, site)) });

// ---------------------------------------------------------------------------
// Precedents: the comps screen (?sector=…&deal=<subject>&x=<unticked ids>)
// ---------------------------------------------------------------------------

const COMPS_HEADERS = ["Announced", "Target", "Acquirer", "Sector", "Industry", "Status", "Consideration", "Deal size ($M)", "EV / Revenue", "EV / EBITDA", "Premium (%)", "Offer price ($)", "Source filing", "Castle tear sheet"];

const compsCells = (d: Deal, site: string): Cell[] => [
  d.announcedDate,
  d.target.name,
  d.acquirer.name,
  d.sector,
  d.industry,
  d.status,
  d.consideration,
  usdM(dealSize(d)),
  d.evRevenue,
  d.evEbitda,
  one(d.premiumPct),
  d.pricePerShare,
  d.filings[0]?.url,
  tearSheet(d, site),
];

/** The precedents a link describes, as the page reads it: seeded from ?deal=, minus the unticked outliers (?x=). */
export function precedentsForQuery(deals: Deal[], params: URLSearchParams, asOf: string): Deal[] {
  const subject = deals.find((d) => d.id === params.get("deal")) ?? null;
  const screen = decodeState(params, subject ? screenForDeal(subject) : DEFAULT_PRECEDENTS, PRECEDENT_SPEC);
  const excluded = new Set((params.get("x") ?? "").split(",").filter((id) => /^[\w.-]{3,80}$/.test(id)));
  return screenPrecedents(deals, screen, asOf).filter((d) => d.id !== subject?.id && !excluded.has(d.id));
}

export const precedentsTable = (deals: Deal[], site: string): LiveTable => ({ headers: COMPS_HEADERS, rows: deals.map((d) => compsCells(d, site)) });

// ---------------------------------------------------------------------------
// Advisors: the league table (?sort=deals ranks by deal count)
// ---------------------------------------------------------------------------

/** Ranked as the Advisors page ranks: by deal value (the stored order) or by deal count. */
export function leagueForQuery(entries: LeagueTableEntry[], params: URLSearchParams): { e: LeagueTableEntry; rank: number; change: number }[] {
  const byCount = params.get("sort") === "deals";
  const sorted = byCount ? [...entries].sort((a, b) => b.dealCount - a.dealCount || b.dealValueUsd - a.dealValueUsd || a.advisor.name.localeCompare(b.advisor.name)) : entries;
  return sorted.map((e, i) => ({ e, rank: i + 1, change: byCount ? (e.dealCountRankChange ?? 0) : e.rankChange }));
}

export const leagueTable = (rows: { e: LeagueTableEntry; rank: number; change: number }[]): LiveTable => ({
  headers: ["Rank", "Advisor", "Deals advised", "Deal value ($M)", "Average deal size ($M)", "Rank change vs prior quarter"],
  rows: rows.map(({ e, rank, change }) => [rank, e.advisor.name, e.dealCount, usdM(e.dealValueUsd), e.dealCount ? usdM(e.dealValueUsd / e.dealCount) : null, change]),
});

// ---------------------------------------------------------------------------
// IPO pipeline (?stage=Filed&sector=Tech&bank=Goldman+Sachs&min=250&sort=raise)
// ---------------------------------------------------------------------------

export function iposForQuery(ipos: Ipo[], params: URLSearchParams): Ipo[] {
  const stage = params.get("stage");
  const sector = params.get("sector");
  const bank = params.get("bank");
  const min = Number(params.get("min"));
  return ipos
    .filter(
      (i) =>
        (!stage || !(IPO_STAGES as readonly string[]).includes(stage) || i.stage === stage) &&
        (!sector || !(SECTORS as readonly string[]).includes(sector) || i.sector === sector) &&
        (!bank || i.underwriters.includes(bank)) &&
        (!(min > 0) || (i.expectedRaiseUsd ?? 0) >= min * 1e6),
    )
    .sort((a, b) => (params.get("sort") === "raise" ? (b.expectedRaiseUsd ?? -1) - (a.expectedRaiseUsd ?? -1) : b.filedDate.localeCompare(a.filedDate)));
}

export const iposTable = (ipos: Ipo[]): LiveTable => ({
  headers: ["Company", "Ticker", "Sector", "Stage", "Filed", "Priced", "Expected raise ($M)", "Offer price ($)", "Underwriters", "Source filing"],
  rows: ipos.map((i) => [i.company.name, i.company.ticker, i.sector, i.stage, i.filedDate, i.pricedDate, usdM(i.expectedRaiseUsd), i.offerPrice, i.underwriters.join("; "), i.filings[0]?.url]),
});

// ---------------------------------------------------------------------------
// A shared deal book (/api/live/book/<link id>), with the author's comments
// ---------------------------------------------------------------------------

export const bookTable = (rows: BookRow[], site: string): LiveTable => ({
  headers: [...COMPS_HEADERS.slice(0, 12), "Comment", ...COMPS_HEADERS.slice(12)],
  rows: rows.map(({ item, deal: d }) => {
    if (!d) return [item.date || null, item.label || item.dealId, null, null, null, "Not in Castle's data", null, null, null, null, null, null, item.note || null, null, null];
    const c = compsCells(d, site);
    return [...c.slice(0, 12), item.note || null, ...c.slice(12)];
  }),
});

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** A CSV response the CDN keeps 5 minutes: fresh within minutes of an ingest, never a database read per request. */
export function csvResponse(table: LiveTable, file: string, data: Pick<HubData, "asOf" | "isSample">): Response {
  return new Response(toLiveCsv(table, { sample: data.isSample }), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `inline; filename="${file}"`,
      "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      // Data for spreadsheets, not pages for search results.
      "X-Robots-Tag": "noindex",
      "X-Castle-Data-As-Of": data.asOf,
    },
  });
}

/** When the database can't be reached: an error, never an empty table that would wipe the user's sheet on refresh. */
export const unavailableResponse = (why: string) =>
  new Response(`Castle's data is unavailable right now (${why}). Your sheet keeps its last refresh; try again in a few minutes.\n`, {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300" },
  });
