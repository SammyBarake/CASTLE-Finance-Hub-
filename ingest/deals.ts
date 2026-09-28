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
  filingDocuments,
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
import { parseMergerItem } from "./parse/eightk";
import { FAIRNESS_PARSER_VERSION, parseFairness } from "./parse/fairness";
import { isClosingFiling, milestonesFrom } from "./timeline";
import { parseMergerProxy } from "./parse/proxy";
import { sameCompany, normalizeName, isPlaceholderBuyer } from "./parse/names";
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

/**
 * US-listed companies buying private companies (most M&A by count). Buyer-filed 8-K press exhibits;
 * the parser decides whether the target is a private company (see `isPrivateTarget`).
 */
const PRIVATE_QUERIES = ['"has acquired"', '"completed the acquisition of"', '"definitive agreement to acquire"', '"completes acquisition of"', "acquired privately held"];

/**
 * Target-side 8-K language: "Merger Sub will merge with and into the Company" only appears when the
 * filer is the company being acquired. Parsed from the Item 1.01 text, so no press release is needed.
 */
const ITEM_QUERIES = ['"merge with and into the Company"', '"merged with and into the Company"', '"commence a tender offer" "Agreement and Plan of Merger"'];

/** Only press-release-like documents: EX-99.x exhibits, or the main document of communication forms. */
function isPressDoc(h: FtsHit): boolean {
  if (/^EX-99/i.test(h.fileType)) return true;
  return h.fileType === h.form && h.form !== "8-K" && h.form !== "8-K/A";
}

/** A document to read, and which parser applies. */
export type Candidate = FtsHit & { via: "press" | "item101" };

/**
 * EDGAR's full-text search has brief outages (HTTP 500s). Retry with long pauses; if a search still
 * fails, record the gap and carry on rather than losing the whole run.
 */
async function searchOrGap(opts: Parameters<typeof fullTextSearch>[0], gaps: string[], log: (s: string) => void): Promise<FtsHit[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fullTextSearch(opts);
    } catch (err) {
      if (attempt >= 2) {
        gaps.push(`${opts.q} ${opts.from}`);
        log(`  ! search failed, skipped: ${opts.q} ${opts.from}..${opts.to} (${(err as Error).message.slice(0, 80)})`);
        return [];
      }
      await new Promise((r) => setTimeout(r, 30_000 * (attempt + 1)));
    }
  }
}

export async function discoverDealDocs(from: string, to: string, log: (s: string) => void, gaps: string[] = []): Promise<Candidate[]> {
  const byId = new Map<string, Candidate>();
  for (const [start, end] of monthWindows(from, to)) {
    for (const q of QUERIES) {
      const hits = await searchOrGap({ q, forms: FORMS, from: start, to: end }, gaps, log);
      for (const h of hits) if (isPressDoc(h)) byId.set(h.id, { ...h, via: "press" });
    }
    for (const q of PRIVATE_QUERIES) {
      const hits = await searchOrGap({ q, forms: ["8-K"], from: start, to: end }, gaps, log);
      for (const h of hits) if (isPressDoc(h) && !byId.has(h.id)) byId.set(h.id, { ...h, via: "press" });
    }
    for (const q of ITEM_QUERIES) {
      const hits = await searchOrGap({ q, forms: ["8-K"], from: start, to: end }, gaps, log);
      for (const h of hits) {
        const mainDoc = h.fileType === h.form || /^8-K/.test(h.fileType);
        if (mainDoc && h.items.includes("1.01") && !byId.has(h.id)) byId.set(h.id, { ...h, via: "item101" });
      }
    }
    log(`  searched ${start} -> ${end}: ${byId.size} candidate documents so far`);
  }
  return [...byId.values()].sort((a, b) => a.fileDate.localeCompare(b.fileDate) || a.id.localeCompare(b.id));
}

/** Companies that filed a merger proxy or tender-offer response: the "answer key" for the backstop. */
export async function discoverMergerFilers(from: string, to: string, gaps: string[] = [], log: (s: string) => void = () => {}) {
  const out = new Map<string, { firstDate: string; hit: FtsHit }>();
  for (const [start, end] of monthWindows(from, to)) {
    for (const form of ["PREM14A", "DEFM14A", "SC 14D9", "SC 13E3"]) {
      const hits = await searchOrGap({ q: "", forms: [form], from: start, to: end }, gaps, log);
      for (const h of hits) {
        if (h.form !== form || h.sics.includes("6770")) continue;
        const f = parseDisplayName(h.displayNames[0]);
        if (/\b(?:Fund|Trust|Portfolio|ETF)\b/i.test(f.name)) continue;
        const cik = f.cik ?? trimCik(h.ciks[0]);
        const prev = out.get(cik);
        if (!prev || h.fileDate < prev.firstDate) out.set(cik, { firstDate: h.fileDate, hit: h });
      }
    }
  }
  return out;
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
    // Had a ticker when it filed but is no longer in the listed-company file: delisted after the deal closed.
    const delistedSince = !listed && f.tickers.length > 0;
    return {
      cik: f.cik,
      ticker: ticker ?? listed?.ticker ?? f.tickers[0] ?? null,
      listedInUs: pressUs || US_LISTED.test(listed?.exchange ?? "") || delistedSince,
    };
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

/** A real company name for a private target, not an asset description ("certain assets of …", "12 properties"). */
export function isPrivateTargetName(name: string, acquirerName: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 70 || sameCompany(n, acquirerName)) return false;
  if (!/^[A-Z0-9]/.test(n) || /^\d+\s/.test(n)) return false;
  if (/^(?:the |its |a |an )?(?:certain|substantially all|remaining|global|worldwide|u\.s\.|us|north american|exclusive|ownership|assets?|business(?:es)?|portfolio|operations?|propert(?:y|ies)|division|units?|stake|interests?|shares|equity|company|companies|entity|group of|majority|minority|rights?|license)\b/i.test(n)) return false;
  // Asset and product deals: "… Retail Assets", "… Earth Station", "Global Rights to …", "the Pizza Hut Brand".
  return !/\b(?:assets?|rights?|brand|brands|licen[cs]es?|stations?|portfolio|properties|facility|facilities|plant|mine|fleet|vessels?|patents?|product line|division|business line|stake|interest)\b/i.test(n);
}

function applyParsed(state: State, parsed: ParsedPress, hit: FtsHit, target: Resolved, acquirer: Resolved, isPrivate: boolean): StoredDeal | null {
  // Private targets have no CIK: they are matched by name (and buyer below).
  const candidates = state.deals
    .filter((d) => (isPrivate ? d.privateTarget && sameCompany(d.target.name, parsed.target.name) : d.target.cik === target.cik))
    .sort((a, b) => b.announcedDate.localeCompare(a.announcedDate));
  const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  let deal =
    candidates.find((d) => sameCompany(d.acquirer.name, parsed.acquirer.name) || (acquirer.cik && d.acquirer.cik === acquirer.cik)) ??
    // The same signing often reaches us as an 8-K naming a shell buyer and a press release naming the sponsor.
    (parsed.kind === "announcement" ? candidates.find((d) => daysApart(d.announcedDate, hit.fileDate) <= 14) : undefined) ??
    // A later filing naming only the acquisition vehicle belongs to the live deal it implements.
    (parsed.kind === "announcement" && isPlaceholderBuyer(parsed.acquirer.name)
      ? candidates.find((d) => d.status !== "Terminated" && daysApart(d.announcedDate, hit.fileDate) <= 365)
      : undefined) ??
    (parsed.kind !== "announcement" ? candidates.find((d) => OPEN.includes(d.status)) : undefined);

  if (!deal) {
    // Updates about deals announced before our window can't create a deal (we'd get the date wrong).
    // Private deals are often signed and closed at once ("Acme has acquired Widget"): a completion creates them.
    if (parsed.kind !== "announcement" && !(isPrivate && parsed.kind === "completion")) return null;
    deal = {
      id: isPrivate ? `p-${normalizeName(parsed.target.name).replace(/\s+/g, "-")}-${hit.fileDate}` : `${target.cik}-${hit.fileDate}`,
      ...(isPrivate ? { privateTarget: true } : {}),
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
  if (isPlaceholderBuyer(deal.acquirer.name) && !isPlaceholderBuyer(parsed.acquirer.name)) {
    // Replace a shell / defined-term buyer ("Anchor Parent, LLC", "Parent") with the real name.
    deal.acquirer = company(parsed.acquirer, acquirer);
  } else if (parsed.acquirer.name.length > deal.acquirer.name.length && sameCompany(parsed.acquirer.name, deal.acquirer.name)) {
    deal.acquirer.name = parsed.acquirer.name;
  }
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

const PROXY_ORDER = ["DEFM14A", "SC 14D9", "SC14D9", "PREM14A", "DEFM14C", "PREM14C"];
/** Best source of fairness opinions first. */
const FAIRNESS_FORMS = ["DEFM14A", "SC 14D9", "SC14D9", "DEFM14C", "PREM14A"];
const PROXY_FORMS =/^(DEFM14A|SC 14D9|SC14D9|PREM14A|DEFM14C|PREM14C)$/;
const PENDING_FORMS =/^(PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC TO-T|SC 13E3|SC14D9|S-4|F-4)(\/A)?$/;

async function isMergerTermination(cik: string, adsh: string, doc: string) {
  try {
    const text = htmlToText(await getTextHead(archiveUrl(cik, adsh, doc), 120_000));
    return /terminat\w*[^.]{0,160}(?:merger|arrangement|combination) agreement|(?:merger|arrangement|combination) agreement[^.]{0,160}terminat/i.test(text);
  } catch {
    return false;
  }
}

/**
 * Private targets have no filings of their own. Sector and industry come from the acquirer, and an
 * announced deal closes when the acquirer files an 8-K Item 2.01 ("Completion of Acquisition").
 */
export function enrichPrivateDeal(deal: StoredDeal, acquirerSub: Submissions | null, today: string, directory?: Directory) {
  if (deal.acquirer.cik && directory?.byCik.get(deal.acquirer.cik)) deal.acquirer.name = displayName(directory.byCik.get(deal.acquirer.cik)!.name);
  if (acquirerSub) {
    deal.acquirer.ticker ??= acquirerSub.tickers?.[0] ?? null;
    deal.sector = sectorForSic(acquirerSub.sic, acquirerSub.name);
    deal.industry = acquirerSub.sicDescription || null;
    if (deal.status === "Announced") {
      const limit = new Date(Date.parse(deal.announcedDate) + 400 * 86_400_000).toISOString().slice(0, 10);
      const done = recentFilings(acquirerSub)
        .filter((f) => /^8-K/.test(f.form) && /\b2\.01\b/.test(f.items) && f.date > deal.announcedDate && f.date <= limit)
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      if (done) {
        deal.status = "Closed";
        deal.statusDate = done.date;
      }
    }
  }
  deal.statusCheckedAt = today;
  // Nothing else to look up for a private company.
  deal.financialsCheckedAt = today;
  deal.proxyCheckedAt = today;
  deal.fairnessCheckedAt = today;
  deal.fairnessParser = FAIRNESS_PARSER_VERSION;
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
      const closed = after.find((f) => isClosingFiling(after, f));
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
    // Milestones come from the same filing index (no extra requests).
    deal.milestones = milestonesFrom(recentFilings(sub), deal.announcedDate, deal.status === "Terminated" ? deal.statusDate : null);
  }
  deal.statusCheckedAt = today;

  // Deals first seen in an 8-K lack the premium and advisors; the target's proxy states both.
  if (sub && !deal.proxyCheckedAt && (deal.premiumPct == null || !deal.targetAdvisors.length)) {
    const proxy = recentFilings(sub)
      .filter((f) => f.date >= deal.announcedDate && PROXY_FORMS.test(f.form))
      .sort((a, b) => PROXY_ORDER.indexOf(a.form) - PROXY_ORDER.indexOf(b.form) || a.date.localeCompare(b.date))[0];
    if (proxy) {
      try {
        const text = htmlToText(await getTextHead(archiveUrl(sub.cik, proxy.adsh, proxy.primaryDocument), 900_000));
        const p = parseMergerProxy(text, deal.target.name);
        deal.premiumPct ??= p.premiumPct;
        if (!deal.targetAdvisors.length) deal.targetAdvisors = p.targetAdvisors;
        const src = `${proxy.adsh}:${proxy.primaryDocument}`;
        if (!deal.sources.includes(src)) deal.sources.push(src);
        deal.proxyCheckedAt = today;
      } catch {
        // Try again on the next run.
      }
    } else if (deal.status === "Closed" || deal.status === "Terminated") {
      deal.proxyCheckedAt = today; // No proxy will come now.
    }
  }

  // Fairness opinions (valuation ranges, DCF inputs, fees) from the full proxy. A preliminary proxy is
  // re-read once the definitive one is filed; the search ends with a definitive proxy or when the deal is over.
  if (sub && deal.fairnessParser !== FAIRNESS_PARSER_VERSION) {
    // A newer parser re-reads the proxy even if the search had finished.
    deal.fairnessCheckedAt = null;
    deal.fairnessAdsh = null;
    deal.fairness = undefined;
    deal.fairnessParser = FAIRNESS_PARSER_VERSION;
  }
  if (sub && !deal.fairnessCheckedAt) {
    const proxy = recentFilings(sub)
      .filter((f) => f.date >= deal.announcedDate && FAIRNESS_FORMS.includes(f.form))
      .sort((a, b) => FAIRNESS_FORMS.indexOf(a.form) - FAIRNESS_FORMS.indexOf(b.form) || b.date.localeCompare(a.date))[0];
    if (proxy && proxy.adsh !== deal.fairnessAdsh) {
      try {
        const text = htmlToText(await getText(archiveUrl(sub.cik, proxy.adsh, proxy.primaryDocument)));
        const opinions = parseFairness(text, { acquirerName: deal.acquirer.name, offerPrice: deal.pricePerShare });
        if (opinions.length) deal.fairness = opinions;
        deal.fairnessAdsh = proxy.adsh;
      } catch {
        // Try again on the next run.
      }
    }
    const final = proxy && proxy.form !== "PREM14A" && proxy.adsh === deal.fairnessAdsh;
    if (final || deal.status === "Closed" || deal.status === "Terminated") deal.fairnessCheckedAt = today;
  }

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
  /** Documents accepted as private-target deals (announcements, completions). */
  privateDeals: number;
  /** Searches that still failed after retries; a rebuild must not prune when any occurred. */
  searchGaps: string[];
}

export async function ingestDeals(
  state: State,
  opts: { from: string; to: string; directory: Directory; log: (s: string) => void; today: string; checkpoint?: () => Promise<void> },
): Promise<DealRunStats> {
  const { log, directory } = opts;
  const stats: DealRunStats = { documents: 0, parsed: 0, newDeals: 0, enriched: 0, privateDeals: 0, searchGaps: [] };
  const before = new Set(state.deals.map((d) => d.id));
  const touched = new Set<StoredDeal>();

  /** Resolve parties and merge into a deal; null if the document isn't an in-scope deal. */
  const accept = (parsed: ParsedPress, hit: FtsHit): StoredDeal | null => {
    // SPAC business combinations aren't the M&A this terminal tracks.
    if (/\bAcquisition Corp/i.test(parsed.acquirer.name + " " + parsed.target.name)) return null;
    const target = resolveParty(parsed.target, hit, directory);
    const acquirer = resolveParty(parsed.acquirer, hit, directory);
    if (target.cik && target.listedInUs) {
      if (acquirer.cik && acquirer.cik === target.cik) return null;
      stats.parsed++;
      return applyParsed(state, parsed, hit, target, acquirer, false);
    }
    // A private company bought by a US-listed acquirer: the target resolves to no SEC registrant and has no
    // ticker, and isn't the target of a public deal we already track (a delisted public company, e.g. after closing).
    const knownPublic = () => state.deals.some((d) => !d.privateTarget && sameCompany(d.target.name, parsed.target.name));
    if (!target.cik && !target.ticker && acquirer.cik && acquirer.listedInUs && isPrivateTargetName(parsed.target.name, parsed.acquirer.name) && !knownPublic()) {
      stats.parsed++;
      stats.privateDeals++;
      return applyParsed(state, parsed, hit, target, acquirer, true);
    }
    return null;
  };

  const docs = (await discoverDealDocs(opts.from, opts.to, log, stats.searchGaps)).filter((h) => !state.seen.has(h.id));
  log(`  ${docs.length} new documents to read (${docs.filter((d) => d.via === "item101").length} merger 8-Ks)`);

  for (const hit of docs) {
    // Progress + checkpoint first: the loop body `continue`s on most documents.
    if (stats.documents && stats.documents % 50 === 0) log(`  read ${stats.documents}/${docs.length} documents, ${touched.size} deals touched`);
    if (stats.documents && stats.documents % 250 === 0) await opts.checkpoint?.();
    stats.documents++;
    try {
      const filer = parseDisplayName(hit.displayNames[0]);
      const cik = filer.cik ?? trimCik(hit.ciks[0]);
      const text = htmlToText(await getText(archiveUrl(cik, hit.adsh, hit.file)));
      const ctx = { filerName: displayName(filer.name), filerTickers: filer.tickers };
      const parsed = hit.via === "item101" ? parseMergerItem(text, ctx) : parsePressRelease(text, ctx);
      state.seen.add(hit.id);
      if (!parsed) continue;
      const deal = accept(parsed, hit);
      if (deal) touched.add(deal);
    } catch (err) {
      if (err instanceof NotFoundError) {
        state.seen.add(hit.id);
        continue;
      }
      log(`  ! ${hit.id}: ${(err as Error).message}`);
    }
  }

  // Backstop: companies that filed a merger proxy / tender response but have no deal yet.
  // Find their announcement 8-K (Item 1.01, within ~7 months before) and parse it.
  const subs = new Map<string, Submissions | null>();
  const submissions = async (cik: string) => {
    if (!subs.has(cik)) subs.set(cik, await getSubmissions(cik).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))));
    return subs.get(cik)!;
  };
  const filers = await discoverMergerFilers(opts.from, opts.to, stats.searchGaps, log);
  const knownTargets = new Set(state.deals.map((d) => d.target.cik));
  const todo = [...filers].filter(([cik]) => !knownTargets.has(cik) && !state.seen.has(`backstop:${cik}`));
  log(`  backstop: ${filers.size} merger-proxy filers, ${todo.length} without a deal to look up`);
  let recovered = 0;
  for (const [cik, { firstDate, hit: proxyHit }] of todo) {
    try {
      state.seen.add(`backstop:${cik}`);
      const sub = await submissions(cik);
      if (!sub || sub.sic === "6770") continue;
      const lo = new Date(Date.parse(firstDate) - 210 * 86_400_000).toISOString().slice(0, 10);
      const announcements = recentFilings(sub)
        .filter((f) => /^8-K/.test(f.form) && /\b1\.01\b/.test(f.items) && f.date >= lo && f.date <= firstDate)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3);
      const displayNames = [`${sub.name}${sub.tickers?.length ? `  (${sub.tickers.join(", ")})` : ""}  (CIK ${cik.padStart(10, "0")})`];
      const ctx = { filerName: displayName(sub.name), filerTickers: sub.tickers ?? [] };
      for (const f of announcements) {
        const docsIn = await filingDocuments(sub.cik, f.adsh);
        const exhibits = docsIn.filter((d) => /ex-?99|dex99/i.test(d) && /\.htm/i.test(d));
        // Press-release exhibits first (they carry premiums and advisors), then the 8-K's own Item 1.01.
        const attempts: { file: string; parse: () => Promise<ParsedPress | null> }[] = [
          ...exhibits.map((ex) => ({
            file: ex,
            parse: async () => {
              const p = parsePressRelease(htmlToText(await getText(archiveUrl(sub.cik, f.adsh, ex))), ctx);
              return p && p.kind === "announcement" && sameCompany(p.target.name, sub.name) ? p : null;
            },
          })),
          {
            file: f.primaryDocument,
            parse: async () => parseMergerItem(htmlToText(await getText(archiveUrl(sub.cik, f.adsh, f.primaryDocument))), ctx),
          },
        ];
        let deal: StoredDeal | null = null;
        for (const { file, parse } of attempts) {
          const parsed = await parse();
          if (!parsed) continue;
          const synthetic: FtsHit = {
            id: `${f.adsh}:${file}`,
            adsh: f.adsh,
            file,
            form: f.form,
            rootForm: "8-K",
            fileType: file === f.primaryDocument ? f.form : "EX-99.1",
            fileDate: f.date,
            ciks: [cik],
            displayNames,
            sics: proxyHit.sics,
            items: f.items.split(","),
          };
          deal = accept(parsed, synthetic);
          if (deal) break;
        }
        if (deal) {
          touched.add(deal);
          recovered++;
          break;
        }
      }
    } catch (err) {
      log(`  ! backstop ${cik}: ${(err as Error).message}`);
    }
  }
  log(`  backstop recovered ${recovered} deals`);

  // Enrich new/changed deals, plus open deals whose status may have moved.
  const toEnrich = state.deals.filter((d) =>
    d.privateTarget
      ? touched.has(d) || (d.status === "Announced" && d.statusCheckedAt !== opts.today) || !d.statusCheckedAt
      : touched.has(d) ||
      (OPEN.includes(d.status) && d.statusCheckedAt !== opts.today) ||
      !d.financialsCheckedAt ||
      (!d.proxyCheckedAt && (d.premiumPct == null || !d.targetAdvisors.length)) ||
      !d.fairnessCheckedAt ||
      d.fairnessParser !== FAIRNESS_PARSER_VERSION ||
      !d.milestones ||
      d.milestones.voteHeld === undefined,
  );
  log(`  enriching ${toEnrich.length} deals (status, sector, financials)`);
  for (const deal of toEnrich) {
    try {
      if (deal.privateTarget) {
        enrichPrivateDeal(deal, deal.acquirer.cik ? await submissions(deal.acquirer.cik) : null, opts.today, directory);
        stats.enriched++;
        continue;
      }
      const sub = await submissions(deal.target.cik!);
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

