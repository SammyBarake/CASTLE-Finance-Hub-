/**
 * Feature 1 (+ inputs to 2, 4, 5): discover announced M&A with US-listed targets.
 *
 * 1. Full-text search finds press releases with takeover language.
 * 2. parsePressRelease extracts parties and terms.
 * 3. Parties are resolved to SEC CIKs; the target must be exchange-listed in the US.
 * 4. Documents about the same target merge into one deal.
 * 5. Each deal is enriched from the target's filing history (status, sector)
 *    and XBRL financials (EV multiples).
 */
import {
  archiveUrl,
  fullTextSearch,
  getSubmissions,
  getText,
  getTextHead,
  NotFoundError,
  recentFilings,
  trimCik,
  type FtsHit,
  type ListedCompany,
  type Submissions,
} from "./edgar";
import { computeMultiples, getTargetFinancials } from "./financials";
import { sameCompany, normalizeName } from "./parse/names";
import { displayName, parsePressRelease, type ParsedPress, type PartyMention } from "./parse/press";
import { sectorForSic } from "./sectors";
import type { StoredDeal, State } from "./store";
import { htmlToText } from "./text";
import type { Company, DealStatus, Filing } from "../lib/types";

const QUERIES = [
  '"represents a premium"',
  '"per share in cash"',
  '"exchange ratio" "merger agreement"',
  '"definitive merger agreement"',
  '"to be acquired by"',
  '"all of the outstanding shares" "definitive agreement"',
  '"take private" OR "go private" "definitive agreement"',
];
const FORMS = ["8-K", "DEFA14A", "425", "SC TO-C", "SC14D9C"];

/** Only press-release-like documents: EX-99.x exhibits, or the main document of communication forms. */
function isPressDoc(h: FtsHit): boolean {
  if (/^EX-99/i.test(h.fileType)) return true;
  return h.fileType === h.form && h.form !== "8-K" && h.form !== "8-K/A";
}

export async function discoverDealDocs(from: string, to: string, log: (s: string) => void): Promise<FtsHit[]> {
  const byId = new Map<string, FtsHit>();
  for (const [start, end] of monthWindows(from, to)) {
    for (const q of QUERIES) {
      const hits = await fullTextSearch({ q, forms: FORMS, from: start, to: end });
      for (const h of hits) if (isPressDoc(h)) byId.set(h.id, h);
    }
    log(`  searched ${start} â†’ ${end}: ${byId.size} candidate documents so far`);
  }
  return [...byId.values()].sort((a, b) => a.fileDate.localeCompare(b.fileDate) || a.id.localeCompare(b.id));
}

export function monthWindows(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  let cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const last = new Date(Math.min(next.getTime() - 86_400_000, end.getTime()));
    out.push([cur.toISOString().slice(0, 10), last.toISOString().slice(0, 10)]);
    cur = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Company resolution
// ---------------------------------------------------------------------------

const US_LISTED = /^(NYSE|NASDAQ|Nasdaq|NYSE American|NYSE Arca|Cboe|CBOE)$/;

/** "COPART INC  (CPRT)  (CIK 0000900075)" -> { name, tickers, cik } */
export function parseDisplayName(s: string) {
  const cik = /\(CIK (\d+)\)/.exec(s)?.[1] ?? null;
  const tickers = /\(([A-Z0-9.\-]+(?:,\s*[A-Z0-9.\-]+)*)\)\s*\(CIK/.exec(s)?.[1].split(/,\s*/) ?? [];
  const name = s.replace(/\s*\([^)]*\)/g, "").trim();
  return { name, tickers, cik: cik ? trimCik(cik) : null };
}

export interface Directory {
  byTicker: Map<string, ListedCompany>;
  byName: Map<string, ListedCompany>;
  byCik: Map<string, ListedCompany>;
}

export function buildDirectory(listed: ListedCompany[]): Directory {
  const byTicker = new Map<string, ListedCompany>();
  const byName = new Map<string, ListedCompany>();
  const byCik = new Map<string, ListedCompany>();
  for (const c of listed) {
    byTicker.set(c.ticker.toUpperCase(), c);
    const n = normalizeName(c.name);
    if (!byName.has(n)) byName.set(n, c);
    if (!byCik.has(c.cik)) byCik.set(c.cik, c);
  }
  return { byTicker, byName, byCik };
}

interface Resolved {
  cik: string | null;
  ticker: string | null;
  listedInUs: boolean;
}

function resolveParty(p: PartyMention, hit: FtsHit, dir: Directory): Resolved {
  const filers = hit.displayNames.map(parseDisplayName);
  const pressUs = !!p.exchange && US_LISTED.test(p.exchange);
  const ticker = p.ticker?.toUpperCase() ?? null;

  if (ticker) {
    const f = filers.find((x) => x.tickers.includes(ticker));
    const listed = dir.byTicker.get(ticker);
    // Guard against ticker collisions across exchanges (e.g. a TSX symbol).
    if (listed && (pressUs || sameCompany(listed.name, p.name))) {
      return { cik: listed.cik, ticker, listedInUs: pressUs || US_LISTED.test(listed.exchange ?? "") };
    }
    if (f?.cik) return { cik: f.cik, ticker, listedInUs: pressUs };
  }
  // Also accept a filer whose registered name appears inside a run-on parsed name
  // ("America's First Transcontinental Railroad Union Pacific" contains "Union Pacific").
  const pn = normalizeName(p.name);
  const f = filers.find((x) => sameCompany(x.name, p.name)) ?? filers.find((x) => normalizeName(x.name).length >= 5 && pn.includes(normalizeName(x.name)));
  if (f?.cik) {
    const listed = dir.byCik.get(f.cik);
    return { cik: f.cik, ticker: ticker ?? listed?.ticker ?? f.tickers[0] ?? null, listedInUs: pressUs || US_LISTED.test(listed?.exchange ?? "") };
  }
  const byName = dir.byName.get(normalizeName(p.name));
  if (byName) return { cik: byName.cik, ticker: ticker ?? byName.ticker, listedInUs: pressUs || US_LISTED.test(byName.exchange ?? "") };
  return { cik: null, ticker, listedInUs: pressUs };
}

// ---------------------------------------------------------------------------
// Merge parsed documents into deals
// ---------------------------------------------------------------------------

const OPEN: DealStatus[] = ["Announced", "Pending"];

function filingFor(hit: FtsHit): Filing {
  const cik = parseDisplayName(hit.displayNames[0]).cik ?? hit.ciks[0];
  const form = /^EX-/.test(hit.fileType) ? `${hit.form} (${hit.fileType})` : hit.form;
  return { form, filedDate: hit.fileDate, url: archiveUrl(cik, hit.adsh, hit.file) };
}

function company(p: PartyMention, r: Resolved): Company {
  return { name: p.name, ticker: r.ticker, cik: r.cik };
}

function applyParsed(state: State, parsed: ParsedPress, hit: FtsHit, target: Resolved, acquirer: Resolved): StoredDeal | null {
  const candidates = state.deals
    .filter((d) => d.target.cik === target.cik)
    .sort((a, b) => b.announcedDate.localeCompare(a.announcedDate));
  let deal =
    candidates.find((d) => sameCompany(d.acquirer.name, parsed.acquirer.name) || (acquirer.cik && d.acquirer.cik === acquirer.cik)) ??
    (parsed.kind !== "announcement" ? candidates.find((d) => OPEN.includes(d.status)) : undefined);

  if (!deal) {
    // Updates about deals announced before our window can't create a deal (we'd get the date wrong).
    if (parsed.kind !== "announcement") return null;
    deal = {
      id: `${target.cik}-${hit.fileDate}`,
      announcedDate: hit.fileDate,
      acquirer: company(parsed.acquirer, acquirer),
      target: company(parsed.target, target),
      valueUsd: null,
      valueKind: null,
      pricePerShare: null,
      premiumPct: null,
      consideration: null,
      sector: "Industrials",
      industry: null,
      status: "Announced",
      statusDate: null,
      enterpriseValueUsd: null,
      evEbitda: null,
      evRevenue: null,
      acquirerAdvisors: [],
      targetAdvisors: [],
      filings: [],
      sources: [],
      statusCheckedAt: null,
      financialsCheckedAt: null,
    };
    state.deals.push(deal);
  }

  // Documents are processed oldest-first, so the first announcement sets the terms;
  // later documents only fill gaps (or replace terms if they predate what we have).
  const prefer = parsed.kind === "announcement" && hit.fileDate < deal.announcedDate;
  const set = <K extends "valueUsd" | "pricePerShare" | "premiumPct" | "consideration">(k: K, v: StoredDeal[K]) => {
    if (v != null && (deal![k] == null || prefer)) deal![k] = v;
  };
  set("pricePerShare", parsed.pricePerShare);
  set("premiumPct", parsed.premiumPct);
  set("consideration", parsed.consideration);
  if (parsed.valueUsd != null && (deal.valueUsd == null || prefer)) {
    deal.valueUsd = parsed.valueUsd;
    deal.valueKind = parsed.valueKind;
  }
  if (prefer && hit.fileDate < deal.announcedDate) deal.announcedDate = hit.fileDate;
  // Longer names are usually the legal names ("ACV" -> "ACV Auctions Inc.").
  if (parsed.target.name.length > deal.target.name.length) deal.target.name = parsed.target.name;
  if (parsed.acquirer.name.length > deal.acquirer.name.length && sameCompany(parsed.acquirer.name, deal.acquirer.name)) deal.acquirer.name = parsed.acquirer.name;
  deal.acquirer.ticker ??= acquirer.ticker;
  deal.acquirer.cik ??= acquirer.cik;
  deal.acquirerAdvisors = [...new Set([...deal.acquirerAdvisors, ...parsed.acquirerAdvisors])];
  deal.targetAdvisors = [...new Set([...deal.targetAdvisors, ...parsed.targetAdvisors])];

  if (parsed.kind === "completion") {
    deal.status = "Closed";
    deal.statusDate = hit.fileDate;
  } else if (parsed.kind === "termination") {
    deal.status = "Terminated";
    deal.statusDate = hit.fileDate;
  }
  if (!deal.filings.some((f) => f.url.includes(hit.adsh.replace(/-/g, "")))) deal.filings.push(filingFor(hit));
  deal.filings.sort((a, b) => a.filedDate.localeCompare(b.filedDate));
  deal.sources.push(hit.id);
  return deal;
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

const CLOSED_FORMS = /^(25-NSE|25|15-12B|15-12G|15-15D)$/;
const PENDING_FORMS = /^(PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC TO-T|SC 13E3|SC14D9|S-4|F-4)(\/A)?$/;

async function isMergerTermination(cik: string, adsh: string, doc: string) {
  try {
    const text = htmlToText(await getTextHead(archiveUrl(cik, adsh, doc), 120_000));
    return /terminat\w*[^.]{0,160}(?:merger|arrangement|combination) agreement|(?:merger|arrangement|combination) agreement[^.]{0,160}terminat/i.test(text);
  } catch {
    return false;
  }
}

export async function enrichDeal(deal: StoredDeal, sub: Submissions | null, today: string, directory?: Directory) {
  // Official SEC registrant names beat names parsed from prose.
  if (deal.acquirer.cik && directory?.byCik.get(deal.acquirer.cik)) deal.acquirer.name = displayName(directory.byCik.get(deal.acquirer.cik)!.name);
  if (sub) {
    deal.target.name = displayName(sub.name);
    deal.target.ticker ??= sub.tickers?.[0] ?? null;
    deal.sector = sectorForSic(sub.sic, sub.name);
    deal.industry = sub.sicDescription || null;
    if (deal.status !== "Terminated" && deal.status !== "Closed") {
      const after = recentFilings(sub)
        .filter((f) => f.date >= deal.announcedDate)
        .sort((a, b) => a.date.localeCompare(b.date));
      const closed = after.find((f) => CLOSED_FORMS.test(f.form) || (/^8-K/.test(f.form) && /\b5\.01\b/.test(f.items)));
      const termination8k = after.find((f) => /^8-K/.test(f.form) && /\b1\.02\b/.test(f.items) && f.date > deal.announcedDate);
      const pending = after.find((f) => PENDING_FORMS.test(f.form));
      if (closed) {
        deal.status = "Closed";
        deal.statusDate = closed.date;
      } else if (termination8k && (await isMergerTermination(sub.cik, termination8k.adsh, termination8k.primaryDocument))) {
        deal.status = "Terminated";
        deal.statusDate = termination8k.date;
      } else if (pending) {
        deal.status = "Pending";
        deal.statusDate = pending.date;
      }
    }
  }
  deal.statusCheckedAt = today;

  if (!deal.financialsCheckedAt && deal.target.cik) {
    const fin = await getTargetFinancials(deal.target.cik, deal.announcedDate);
    const m = computeMultiples(deal, fin);
    deal.enterpriseValueUsd = m.enterpriseValueUsd;
    deal.evEbitda = m.evEbitda;
    deal.evRevenue = m.evRevenue;
    if (deal.valueUsd == null && m.impliedEquityUsd != null) {
      deal.valueUsd = Math.round(m.impliedEquityUsd);
      deal.valueKind = "equity";
    }
    deal.financialsCheckedAt = today;
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface DealRunStats {
  documents: number;
  parsed: number;
  newDeals: number;
  enriched: number;
}

export async function ingestDeals(
  state: State,
  opts: { from: string; to: string; directory: Directory; log: (s: string) => void; today: string; checkpoint?: () => Promise<void> },
): Promise<DealRunStats> {
  const { log, directory } = opts;
  const stats: DealRunStats = { documents: 0, parsed: 0, newDeals: 0, enriched: 0 };
  const before = new Set(state.deals.map((d) => d.id));
  const touched = new Set<StoredDeal>();

  const docs = (await discoverDealDocs(opts.from, opts.to, log)).filter((h) => !state.seen.has(h.id));
  log(`  ${docs.length} new documents to read`);

  for (const hit of docs) {
    // Progress + checkpoint first: the loop body `continue`s on most documents.
    if (stats.documents && stats.documents % 50 === 0) log(`  read ${stats.documents}/${docs.length} documents, ${touched.size} deals touched`);
    if (stats.documents && stats.documents % 250 === 0) await opts.checkpoint?.();
    stats.documents++;
    try {
      const filer = parseDisplayName(hit.displayNames[0]);
      const cik = filer.cik ?? trimCik(hit.ciks[0]);
      const text = htmlToText(await getText(archiveUrl(cik, hit.adsh, hit.file)));
      const parsed = parsePressRelease(text, { filerName: displayName(filer.name), filerTickers: filer.tickers });
      state.seen.add(hit.id);
      if (!parsed) continue;
      const target = resolveParty(parsed.target, hit, directory);
      if (!target.cik || !target.listedInUs) continue;
      const acquirer = resolveParty(parsed.acquirer, hit, directory);
      if (acquirer.cik && acquirer.cik === target.cik) continue;
      // SPAC business combinations aren't the M&A this terminal tracks.
      if (/\bAcquisition Corp/i.test(parsed.acquirer.name + " " + parsed.target.name)) continue;
      stats.parsed++;
      const deal = applyParsed(state, parsed, hit, target, acquirer);
      if (deal) touched.add(deal);
    } catch (err) {
      if (err instanceof NotFoundError) {
        state.seen.add(hit.id);
        continue;
      }
      log(`  ! ${hit.id}: ${(err as Error).message}`);
    }
  }

  // Enrich new/changed deals, plus open deals whose status may have moved.
  const toEnrich = state.deals.filter((d) => touched.has(d) || (OPEN.includes(d.status) && d.statusCheckedAt !== opts.today) || !d.financialsCheckedAt);
  log(`  enriching ${toEnrich.length} deals (status, sector, financials)`);
  const subs = new Map<string, Submissions | null>();
  for (const deal of toEnrich) {
    const cik = deal.target.cik!;
    try {
      if (!subs.has(cik)) {
        subs.set(cik, await getSubmissions(cik).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))));
      }
      const sub = subs.get(cik)!;
      if (sub && sub.sic === "6770") {
        // Blank-check shell as target: drop.
        state.deals = state.deals.filter((d) => d !== deal);
        continue;
      }
      await enrichDeal(deal, sub, opts.today, directory);
      stats.enriched++;
    } catch (err) {
      log(`  ! enrich ${deal.id}: ${(err as Error).message}`);
    }
    if (stats.enriched % 50 === 0 && stats.enriched) {
      log(`  enriched ${stats.enriched}/${toEnrich.length}`);
      await opts.checkpoint?.();
    }
  }

  stats.newDeals = state.deals.filter((d) => !before.has(d.id)).length;
  return stats;
}

