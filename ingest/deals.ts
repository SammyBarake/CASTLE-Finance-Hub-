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
  lookupCompanies,
  nameOn,
  NotFoundError,
  recentFilings,
  trimCik,
  type FtsHit,
  type ListedCompany,
  type Submissions,
} from "./edgar";
import { computeMultiples, getTargetFinancials } from "./financials";
import { item101, parseMergerItem } from "./parse/eightk";
import { parseDealTerms, saneFee, TERMS_PARSER_VERSION } from "./parse/terms";
import { FAIRNESS_PARSER_VERSION, parseFairness } from "./parse/fairness";
import { isClosingFiling, milestonesFrom } from "./timeline";
import { parseMergerProxy } from "./parse/proxy";
import { cleanPartyName, identicalNames, isMergerVehicle, isPlaceholderBuyer, isPlausibleName, normalizeName, sameCompany, titleCaseCaps } from "./parse/names";
import { displayName, parsePressRelease, type ParsedPress, type PartyMention } from "./parse/press";
import { sectorForSic } from "./sectors";
import type { StoredDeal, State } from "./store";
import { SPAC_NAME, tidyDeals } from "./tidy";
import { htmlToText } from "./text";
import type { Company, DealStatus, DealTerms, Filing } from "../lib/types";

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
    // Guard against ticker collisions: a TSX symbol, or a ticker reused after a delisting on the same exchange
    // (Vonage's "VG" is now Venture Global's, CoreSite's "COR" is Cencora's). The names must agree; otherwise
    // fall through to the filers and the name directory.
    if (listed && sameCompany(listed.name, p.name)) {
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
  // A short name can belong to another company: Emerson's "NI (NASDAQ: NATI)" is National Instruments, not NI Holdings.
  if (byName && (!ticker || !pressUs || byName.ticker.toUpperCase() === ticker))
    return { cik: byName.cik, ticker: ticker ?? byName.ticker, listedInUs: pressUs || US_LISTED.test(byName.exchange ?? "") };
  return { cik: null, ticker, listedInUs: pressUs };
}

const shiftDate = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
const PERIODIC = /^(?:10-K|10-Q|20-F|40-F|10-KT|10-QT)(?:\/A)?$/;

/**
 * Was this registrant an exchange-listed reporting company when the deal was announced? It filed periodic reports
 * in the year before, and is still on a US exchange or was delisted (Form 25) afterwards. An OTC company or one that
 * deregistered long ago (Bremer Financial) is not.
 */
export function listedOn(sub: Pick<Submissions, "exchanges" | "filings">, date: string): boolean {
  const filings = recentFilings(sub as Submissions);
  const reporting = filings.some((f) => PERIODIC.test(f.form) && f.date >= shiftDate(date, -450) && f.date <= shiftDate(date, 30));
  const listed = (sub.exchanges ?? []).some((e) => US_LISTED.test(e ?? "")) || filings.some((f) => /^25(?:-NSE)?$/.test(f.form) && f.date >= shiftDate(date, -30));
  return reporting && listed;
}

/** Words a registrant's name may add to a one-word target name: "Aerie" is "Aerie Pharmaceuticals", not "Aeries Technology". */
const DESCRIPTOR = /^(?:pharmaceuticals?|pharma|therapeutics|biosciences?|biotherapeutics|biopharma(?:ceuticals)?|bio|oncology|medical|medtech|lithium|energy|resources|minerals|mining|realty|properties|software|networks|communications)$/;
const nameKey = (s: string) => normalizeName(s.replace(/['’]/g, "")); // "Ruth's" = "Ruths"

/**
 * Is `registrant` (its name on the deal date) the company a release called `target`? The same name, or the target's
 * name plus more words; a one-word target only gains descriptors, so "Fortune" (a bank) is not "Fortune Brands" and
 * "Beacon" is not "Beacon Financial".
 */
export function registrantMatches(registrant: string, target: string): boolean {
  const r = nameKey(registrant);
  const t = nameKey(target);
  if (r.length < 3 || t.length < 3) return false;
  if (r === t) return true;
  if (!r.startsWith(t + " ")) return false;
  return t.includes(" ") || r.slice(t.length + 1).split(" ").every((w) => DESCRIPTOR.test(w));
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
  if (/\b(?:assets?|rights?|brand|brands|licen[cs]es?|stations?|portfolio|propert(?:y|ies)|facility|facilities|plant|mine|refinery|project|fleet|vessels?|patents?|product line|division|business line|stake|interest|ownership)\b/i.test(n)) return false;
  // A drug or programme, not a company: "ST-920 Fabry Disease Gene Therapy", "ABC-123".
  if (/^[A-Z]{1,5}-?\d{2,}\b/.test(n) || /\b(?:therapy|therapies|program|programme|candidate|vaccine|compound|molecule|antibody|asset|operations)$/i.test(n)) return false;
  // A description, not a name: "Next-Gen AI Drug Discovery Company", "a Leading Software Provider". A plain name
  // ending in "Company" ("Madison National Life Insurance Company") is fine; marketing adjectives give it away.
  if (
    /\b(?:company|business|provider|platform|firm|developer|manufacturer|operator|distributor|maker|producer|leader|specialist)$/i.test(n) &&
    !/\b(?:Inc|LLC|Ltd|Corp|L\.?P)\.?$/i.test(n) &&
    (/\b\w+-\w+\b/.test(n) || /\b(?:leading|innovative|premier|global|independent|specialty|next|emerging|fast-growing|privately)\b/i.test(n))
  )
    return false;
  // A count of things, not a company: "Two Toyota and Two Lexus Dealerships", "FOUR DOMINANT ENCLOSED REGIONAL MALLS",
  // "A GEORGIA COMMUNITY", "Sixth Real Estate Brokerage" ("First …" and "Second Street" are real names).
  if (/^(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|dozen|several)\s/i.test(n)) return false;
  if (/^(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:real estate|franchise|location|store|acquisition|brokerage|office|branch|practice|clinic|restaurant)/i.test(n)) return false;
  // Real estate and sites: "MONTICELLO LAND", "Inchcape U.K. Dealerships", "ITS FUTURE HEADQUARTERS".
  if (/\b(?:land|parcels?|acres?|malls?|dealerships?|apartment (?:complex|communit\w*)|headquarters|manufactured home)\b/i.test(n)) return false;
  // A division of a named company: "RF Business of Wolfspeed", "Microlab RF Business Unit of …", "Alliance Healthcare Businesses".
  if (/\b(?:business(?:es)?|business unit|division|unit|segment|operations|portfolio)\s+of\b/i.test(n) || /\bbusinesses$/i.test(n)) return false;
  // A region or division of a named company: "LEHIGH HANSON'S WEST REGION BUSINESS …".
  if (/['’]s\b.*\b(?:business|businesses|division|unit|segment|operations|region|assets|portfolio)\b/i.test(n)) return false;
  // A single generic word ("Land", "Software", "Operating") or a job title ("CFO").
  return !/^(?:land|software|technology|data|energy|media|health|capital|properties|solutions|services|products|systems|brands?|manufacturing|logistics|construction|consulting|insurance|operating|operations|ceo|cfo|coo|president)$/i.test(n);
}

/**
 * Tidy a private target's name: drop a glued-on dateline, cut the acquirer's brand when the headline ran into it
 * ("Ginop Sales Alta CE" bought by Alta Equipment -> "Ginop Sales"), and title-case an all-capitals name.
 */
export function tidyTargetName(name: string, acquirerName: string): string {
  let n = stripDateline(name);
  // Nothing follows a legal suffix: "Murray Wise Associates LLC Iconic Farmland Investor …" -> "… LLC".
  n = n.replace(/^(.+?\b(?:Inc\.?|LLC|L\.L\.C\.|Ltd\.?|Limited|Corp\.|Corporation|plc|GmbH|S\.A\.|B\.V\.|N\.V\.))\s+(?!Partnership|Liability|Company|Group|Holdings)[A-Z].*$/, "$1");
  // "Second Street January 20" -> "Second Street"
  n = n.replace(/\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s*\d{4})?$/, "");
  const brand = normalizeName(acquirerName).split(" ")[0];
  const generic = /^(?:energy|health|healthcare|capital|global|american|america|national|first|united|general|financial|pacific|southern|northern|western|eastern|community|industrial|digital|medical|power|water|advanced|applied|premier|summit|pioneer|liberty|eagle)$/;
  if (brand && brand.length >= 4 && !generic.test(brand)) {
    const at = n.toLowerCase().search(new RegExp(`\\s${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
    if (at > 2) n = n.slice(0, at);
  }
  return titleCaseCaps(n.trim());
}

const NAME_SUFFIX = /^(?:INC|CORP|LLC|LTD|LP|LLP|PLC|CO|USA|US|AG|SA|NV|SE|GMBH|BV|AB|AS|ASA|OY|SPA|SRL|AI|IT|HR|II|III|IV)[.,]?$/;

/** "Sirius Computer Solutions LINCOLNSHIRE" -> "Sirius Computer Solutions": drop a dateline glued onto a mixed-case name. */
export function stripDateline(name: string): string {
  if (!/[a-z]/.test(name)) return name;
  const words = name.trim().split(/\s+/);
  let cut = words.length;
  while (cut > 1 && /^[A-Z]{2,}[,.]?$/.test(words[cut - 1]) && !NAME_SUFFIX.test(words[cut - 1])) cut--;
  const tail = words.slice(cut);
  if (!tail.some((w) => w.replace(/[,.]/g, "").length >= 4)) return name;
  const rest = words.slice(0, cut).join(" ");
  return /[a-z]/.test(rest) ? rest.replace(/[,\s]+$/, "") : name;
}

/**
 * A "private" deal whose target is a tracked public company (documents are read in search order, so the private
 * one can arrive first) is a duplicate: drop it, keeping its buyer name when the public deal's is unresolved junk
 * ("SoundHound Closing Stock Price" vs "SoundHound AI, Inc.").
 */
export function dropPrivateDuplicates(deals: StoredDeal[]): void {
  const DAY = 86_400_000;
  const pub = deals.filter((d) => !d.privateTarget);
  // Stricter than sameCompany (no shared-first-word match): "Providence" is not "Providence Service Corp".
  const same = (a: string, b: string) => normalizeName(a).length >= 3 && normalizeName(a) === normalizeName(b);
  for (let i = deals.length - 1; i >= 0; i--) {
    const d = deals[i];
    if (!d.privateTarget) continue;
    const twin = pub.find(
      (p) => same(p.target.name, d.target.name) && Math.abs(Date.parse(p.announcedDate) - Date.parse(d.announcedDate)) < 400 * DAY,
    );
    if (!twin) continue;
    if (!twin.acquirer.cik && d.acquirer.cik && sameCompany(twin.acquirer.name, d.acquirer.name)) twin.acquirer = { ...d.acquirer };
    deals.splice(i, 1);
  }
}

/** The full name a document gives an abbreviation: `Medical Manufacturing Technologies, LLC ("MMT")` -> that name. */
export function expandAbbreviation(abbr: string, text: string): string | null {
  const m = new RegExp(`([A-Z][A-Za-z0-9&.,'’\\- ]{3,90}?)\\s*\\(\\s*(?:the\\s+|together,?\\s+)?["“]${abbr}["”]\\s*\\)`).exec(text);
  if (!m) return null;
  // Keep the trailing capitalised run: "to acquire Medical Manufacturing Technologies, LLC" -> "Medical Manufacturing Technologies, LLC".
  const run = /((?:[A-Z][\w&.'’\-]*,?\s+)*(?:[A-Z][\w&.'’\-]*|LLC|Inc\.?|Corp\.?|Ltd\.?))\s*$/.exec(m[1].trim());
  const name = run ? cleanPartyName(run[1].replace(/,$/, "")) : null;
  return name && isPlausibleName(name) && name.length >= abbr.length + 3 ? name : null;
}

/** Investment funds (closed-end funds, ETFs, municipal funds) are out of scope as targets; REITs ("… Trust") are in. */
export const FUND_TARGET = /\b(?:Fund|Funds|ETF|Municipal)\b/i;

/** Largest value believable for a private company: anything above is almost certainly a misread number. */
export const MAX_PRIVATE_DEAL_VALUE = 40e9;

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

/**
 * Deal protections from the target's merger 8-K (Item 1.01 summary of the merger agreement), with gaps filled
 * from its merger proxy: fees from the proxy's summary only (its background section quotes rejected proposals),
 * financing banks from anywhere in it ("Financing of the Merger"). `settled` once both documents have been read.
 */
export async function readDealTerms(deal: StoredDeal, sub: Submissions): Promise<{ terms: DealTerms | null; settled: boolean }> {
  const DAY = 86_400_000;
  const lo = new Date(Date.parse(deal.announcedDate) - 7 * DAY).toISOString().slice(0, 10);
  const hi = new Date(Date.parse(deal.announcedDate) + 20 * DAY).toISOString().slice(0, 10);
  const names = { target: deal.target.name, acquirer: deal.acquirer.name };
  const filings = recentFilings(sub);

  let fromEightK: DealTerms | null = null;
  const eightKs = filings.filter((f) => /^8-K/.test(f.form) && /\b1\.01\b/.test(f.items) && f.date >= lo && f.date <= hi).sort((a, b) => a.date.localeCompare(b.date));
  for (const f of eightKs.slice(0, 3)) {
    const section = item101(htmlToText(await getText(archiveUrl(sub.cik, f.adsh, f.primaryDocument))));
    if (!section) continue; // an unrelated agreement (a credit facility, an employment contract)
    fromEightK = parseDealTerms(section, names);
    break;
  }

  let fromProxy: DealTerms | null = null;
  const proxy = filings
    .filter((f) => f.date >= deal.announcedDate && PROXY_FORMS.test(f.form))
    .sort((a, b) => PROXY_ORDER.indexOf(a.form) - PROXY_ORDER.indexOf(b.form) || a.date.localeCompare(b.date))[0];
  if (proxy) {
    const text = htmlToText(await getTextHead(archiveUrl(sub.cik, proxy.adsh, proxy.primaryDocument), 1_200_000));
    const summary = parseDealTerms(text.slice(0, 150_000), names);
    const whole = parseDealTerms(text, names);
    fromProxy = { ...summary, financingBanks: whole.financingBanks, financingCondition: summary.financingCondition ?? whole.financingCondition };
  }

  if (!fromEightK && !fromProxy) return { terms: null, settled: false };
  const a = fromEightK ?? fromProxy!;
  const b = fromProxy ?? fromEightK!;
  const terms: DealTerms = {
    targetFeeUsd: saneFee(a.targetFeeUsd ?? b.targetFeeUsd, deal.valueUsd, "target"),
    reverseFeeUsd: saneFee(a.reverseFeeUsd ?? b.reverseFeeUsd, deal.valueUsd, "reverse"),
    goShop: a.goShop ?? b.goShop,
    goShopDays: a.goShopDays ?? b.goShopDays,
    financingCondition: a.financingCondition ?? b.financingCondition,
    financingBanks: [...new Set([...a.financingBanks, ...b.financingBanks])].slice(0, 8),
  };
  const empty = terms.targetFeeUsd == null && terms.reverseFeeUsd == null && terms.goShop == null && terms.financingCondition == null && !terms.financingBanks.length;
  return { terms: empty ? null : terms, settled: !!fromEightK && !!fromProxy };
}

export async function enrichDeal(deal: StoredDeal, sub: Submissions | null, today: string, directory?: Directory) {
  // Official SEC registrant names beat names parsed from prose.
  if (deal.acquirer.cik && directory?.byCik.get(deal.acquirer.cik)) deal.acquirer.name = displayName(directory.byCik.get(deal.acquirer.cik)!.name);
  if (sub) {
    // The name it had when the deal was announced, not the one it took after being bought.
    deal.target.name = displayName(nameOn(sub, deal.announcedDate));
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

  // Deal protections (break fees, go-shop, financing). Re-read when the parser changes.
  if (sub && deal.termsParser !== TERMS_PARSER_VERSION) {
    deal.termsCheckedAt = null;
    deal.termsParser = TERMS_PARSER_VERSION;
  }
  if (sub && !deal.termsCheckedAt) {
    try {
      const { terms, settled } = await readDealTerms(deal, sub);
      if (terms) deal.terms = terms;
      if (settled || deal.status === "Closed" || deal.status === "Terminated") deal.termsCheckedAt = today;
    } catch {
      // Try again on the next run.
    }
  }

  if (!deal.financialsCheckedAt && deal.target.cik) {
    const fin = await getTargetFinancials(deal.target.cik, deal.announcedDate);
    const m = computeMultiples(deal, fin, { sic: sub?.sic, name: deal.target.name });
    deal.enterpriseValueUsd = m.enterpriseValueUsd;
    deal.evEbitda = m.evEbitda;
    deal.evRevenue = m.evRevenue;
    if (deal.valueUsd == null && m.impliedEquityUsd != null && m.impliedEquityUsd >= 1e6) {
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
  // Removed records are deleted from the store on save (an upsert alone would keep them).
  const dropped = (state.dropped ??= new Set());
  const drop = (deal: StoredDeal) => {
    state.deals = state.deals.filter((d) => d !== deal);
    dropped.add(deal.id);
  };

  const subs = new Map<string, Submissions | null>();
  const submissions = async (cik: string) => {
    if (!subs.has(cik)) subs.set(cik, await getSubmissions(cik).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e))));
    return subs.get(cik)!;
  };

  /**
   * A target the listed-company file doesn't know (delisted since the deal closed: Abiomed, Ruth's, Weingarten),
   * found by EDGAR's company-name lookup and accepted only if it was an exchange-listed reporting company then.
   */
  const lookups = new Map<string, Resolved | null>();
  const resolveRegistrant = async (name: string, date: string): Promise<Resolved | null> => {
    const key = `${normalizeName(name)}|${date}`;
    if (lookups.has(key)) return lookups.get(key)!;
    const q = name.replace(/['’.,]/g, "").replace(/\s+/g, " ").trim();
    const words = q.split(" ");
    let found: Resolved | null = null;
    try {
      search: for (const query of words.length > 2 ? [q, words.slice(0, 2).join(" ")] : [q]) {
        const candidates = (await lookupCompanies(query))
          .filter((c) => registrantMatches(c.name, name) || sameCompany(c.name, name))
          .sort((a, b) => Number(registrantMatches(b.name, name)) - Number(registrantMatches(a.name, name)))
          .slice(0, 3);
        for (const c of candidates) {
          const sub = await submissions(c.cik);
          // Checked against the name it had then: "Beacon" in 2025 was not Berkshire Hills Bancorp.
          if (sub && sub.sic !== "6770" && registrantMatches(nameOn(sub, date), name) && listedOn(sub, date)) {
            found = { cik: c.cik, ticker: sub.tickers?.[0] ?? null, listedInUs: true };
            break search;
          }
        }
      }
    } catch (err) {
      log(`  ! company lookup "${name}": ${(err as Error).message}`);
      return null; // not cached: try again next time
    }
    lookups.set(key, found);
    return found;
  };

  /** Resolve parties and merge into a deal; null if the document isn't an in-scope deal. */
  const accept = async (parsed: ParsedPress, hit: FtsHit, text = ""): Promise<StoredDeal | null> => {
    // SPAC business combinations aren't the M&A this terminal tracks; nor are fund mergers (closed-end funds, ETFs).
    if (/\bAcquisition Corp/i.test(parsed.acquirer.name + " " + parsed.target.name)) return null;
    if (FUND_TARGET.test(parsed.target.name)) return null;
    // A target written as its ticker ("Paramount … to acquire WBD") is that public company, but only when the document
    // lists that ticker on an exchange ("(NASDAQ: WBD)"). Abbreviations aren't tickers: "Medical Manufacturing
    // Technologies ("MMT")" is not the Aberdeen fund trading as MMT, and "acquire AI … IP" is not C3.ai.
    const tn = parsed.target.name;
    const listedInText = (t: string) => new RegExp(`\\b(?:NYSE(?: American)?|Nasdaq|NASDAQ|Cboe|CBOE)(?:\\s?[A-Z]{1,3})?\\s?:\\s?${t}\\b`).test(text);
    const asTicker =
      /^[A-Z]{2,5}$/.test(tn) &&
      (!parsed.target.ticker || parsed.target.ticker.toUpperCase() === tn) &&
      !directory.byName.has(normalizeName(tn)) &&
      listedInText(tn) &&
      !FUND_TARGET.test(directory.byTicker.get(tn)?.name ?? "")
        ? directory.byTicker.get(tn)
        : undefined;
    if (asTicker) parsed = { ...parsed, target: { ...parsed.target, name: asTicker.name, ticker: asTicker.ticker } };
    // An abbreviation the release defines: "Medical Manufacturing Technologies, LLC ("MMT")" -> the full name.
    else if (/^[A-Z]{2,6}$/.test(tn) && text) {
      const full = expandAbbreviation(tn, text);
      if (full) parsed = { ...parsed, target: { ...parsed.target, name: full } };
    }
    // "Elon Musk SAN FRANCISCO" -> "Elon Musk"; "CANADIAN PACIFIC" -> "Canadian Pacific"
    const rawTarget = parsed.target.name;
    parsed = {
      ...parsed,
      acquirer: { ...parsed.acquirer, name: titleCaseCaps(stripDateline(parsed.acquirer.name)) },
      target: { ...parsed.target, name: titleCaseCaps(rawTarget) },
    };
    // Headline fragments and deal paperwork are not parties ("Entry into a Material Definitive Agreement").
    if (!isPlausibleName(parsed.target.name) || !isPlausibleName(parsed.acquirer.name)) return null;
    const target = resolveParty(parsed.target, hit, directory);
    const acquirer = resolveParty(parsed.acquirer, hit, directory);
    if (target.cik && target.listedInUs) {
      if (acquirer.cik && acquirer.cik === target.cik) return null;
      stats.parsed++;
      return applyParsed(state, parsed, hit, target, acquirer, false);
    }
    // A private company bought by a US-listed acquirer: the target resolves to no SEC registrant and has no
    // ticker, and isn't the target of a public deal we already track (a delisted public company, e.g. after closing).
    // Checked before and after tidying: "TWO … COMMUNITIES FREEHOLD" must fail on its raw form.
    const name = tidyTargetName(rawTarget, parsed.acquirer.name);
    const knownPublic = () => state.deals.some((d) => !d.privateTarget && sameCompany(d.target.name, name));
    if (
      !target.cik &&
      !target.ticker &&
      acquirer.cik &&
      acquirer.listedInUs &&
      isPrivateTargetName(stripDateline(rawTarget), parsed.acquirer.name) &&
      isPrivateTargetName(name, parsed.acquirer.name) &&
      // A merger vehicle is never the target: "Zamboni MergerCo" means the roles were read backwards.
      !isMergerVehicle(name) &&
      !knownPublic()
    ) {
      // A share price or a premium hints at a listed company the directory no longer has (delisted since).
      if (parsed.premiumPct != null || parsed.pricePerShare != null) {
        const listed = await resolveRegistrant(name, hit.fileDate);
        if (listed) {
          if (listed.cik === acquirer.cik) return null;
          stats.parsed++;
          return applyParsed(state, { ...parsed, target: { ...parsed.target, name } }, hit, listed, acquirer, false);
        }
        // A premium means a traded stock: an OTC or foreign-listed company, out of scope. (A per-share price
        // alone is common for private banks and stays.)
        // This also catches releases read backwards ("GenMark acquires Roche": the premium is GenMark's).
        if (parsed.premiumPct != null) return null;
      }
      stats.parsed++;
      stats.privateDeals++;
      const valueUsd = parsed.valueUsd != null && parsed.valueUsd > MAX_PRIVATE_DEAL_VALUE ? null : parsed.valueUsd;
      const deal = applyParsed(state, { ...parsed, target: { ...parsed.target, name }, valueUsd }, hit, target, acquirer, true);
      if (deal) deal.registrantCheckedAt ??= opts.today;
      return deal;
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
      const deal = await accept(parsed, hit, text);
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
          deal = await accept(parsed, synthetic);
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
      ? touched.has(d) ||
        (d.status === "Announced" && d.statusCheckedAt !== opts.today) ||
        !d.statusCheckedAt ||
        !d.registrantCheckedAt ||
        (identicalNames(d.acquirer.name, d.target.name) && d.statusCheckedAt !== opts.today)
      : touched.has(d) ||
      (OPEN.includes(d.status) && d.statusCheckedAt !== opts.today) ||
      !d.financialsCheckedAt ||
      (!d.proxyCheckedAt && (d.premiumPct == null || !d.targetAdvisors.length)) ||
      !d.fairnessCheckedAt ||
      d.fairnessParser !== FAIRNESS_PARSER_VERSION ||
      d.termsParser !== TERMS_PARSER_VERSION ||
      // Unsettled terms (no proxy yet) are looked for once a day, not every run.
      (!d.termsCheckedAt && d.statusCheckedAt !== opts.today) ||
      !d.milestones ||
      d.milestones.voteHeld === undefined ||
      // Looks like a company buying itself: a target renamed after its buyer (re-read the name it had then).
      (identicalNames(d.acquirer.name, d.target.name) && d.statusCheckedAt !== opts.today),
  );
  log(`  enriching ${toEnrich.length} deals (status, sector, financials)`);
  for (const deal of toEnrich) {
    try {
      // Private records stored before this check: the target may be a delisted listed company.
      if (deal.privateTarget && !deal.registrantCheckedAt) {
        if (deal.premiumPct != null || deal.pricePerShare != null) {
          // With today's name rules ("Sculptor Capital Management Together" -> "Sculptor Capital Management").
          const listed = await resolveRegistrant(cleanPartyName(deal.target.name), deal.announcedDate);
          if (listed && listed.cik !== deal.acquirer.cik) {
            const near = (d: StoredDeal) => Math.abs(Date.parse(d.announcedDate) - Date.parse(deal.announcedDate)) < 400 * 86_400_000;
            if (state.deals.some((d) => d !== deal && d.target.cik === listed.cik && near(d))) {
              drop(deal); // the public record of the same deal already exists
              continue;
            }
            // Becomes a public-target deal, enriched from the target's own filings below.
            dropped.add(deal.id);
            deal.id = `${listed.cik}-${deal.announcedDate}`;
            delete deal.privateTarget;
            deal.target = { ...deal.target, cik: listed.cik, ticker: deal.target.ticker ?? listed.ticker };
            deal.statusCheckedAt = deal.financialsCheckedAt = deal.proxyCheckedAt = deal.fairnessCheckedAt = deal.termsCheckedAt = null;
            deal.fairnessParser = undefined;
            deal.termsParser = undefined;
          } else if (deal.premiumPct != null) {
            drop(deal); // traded but not on a US exchange (out of scope), or read backwards
            continue;
          }
        }
        deal.registrantCheckedAt = opts.today;
      }
      if (deal.privateTarget) {
        enrichPrivateDeal(deal, deal.acquirer.cik ? await submissions(deal.acquirer.cik) : null, opts.today, directory);
      } else {
        const sub = await submissions(deal.target.cik!);
        if (sub && sub.sic === "6770") {
          // Blank-check shell as target: drop.
          drop(deal);
          continue;
        }
        await enrichDeal(deal, sub, opts.today, directory);
      }
      // Acquirer and target still look identical: the buyer took the target's name afterwards (a reverse merger,
      // a de-SPAC, "California BanCorp" for Southern California Bancorp). Use the buyer's name at announcement.
      if (identicalNames(deal.acquirer.name, deal.target.name) && deal.acquirer.cik) {
        const acq = await submissions(deal.acquirer.cik);
        const then = acq ? displayName(nameOn(acq, deal.announcedDate)) : deal.acquirer.name;
        // The buyer was a blank-check company then ("Churchill Capital Corp IV" for Lucid): a de-SPAC, out of scope.
        if (SPAC_NAME.test(then) || acq?.sic === "6770") {
          drop(deal);
          continue;
        }
        deal.acquirer.name = then;
      }
      // The very same name on both sides is no deal. (A parent buying in its listed subsidiary, "Brookfield" /
      // "Brookfield Property REIT", only shares a prefix and stays.) A target that was a SPAC when the deal was
      // announced ("Dragoneer Growth Opportunities Corp." for CCC) is a de-SPAC, out of scope.
      if (normalizeName(deal.acquirer.name) === normalizeName(deal.target.name) || SPAC_NAME.test(deal.target.name)) {
        drop(deal);
        continue;
      }
      stats.enriched++;
    } catch (err) {
      log(`  ! enrich ${deal.id}: ${(err as Error).message}`);
    }
    if (stats.enriched % 50 === 0 && stats.enriched) {
      log(`  enriched ${stats.enriched}/${toEnrich.length}`);
      await opts.checkpoint?.();
    }
  }

  const beforeDedupe = state.deals.map((d) => d.id);
  dropPrivateDuplicates(state.deals);
  const kept = new Set(state.deals.map((d) => d.id));
  for (const id of beforeDedupe) if (!kept.has(id)) dropped.add(id);
  const tidy = tidyDeals(state.deals);
  for (const d of tidy.dropped) dropped.add(d.id);
  log(
    `  tidy: ${tidy.dropped.length} junk / duplicate records removed, ${tidy.merged} merged, ${tidy.topped} topped bids marked terminated, ${tidy.sanitized} values corrected`,
  );
  for (const d of tidy.dropped.slice(0, 20)) log(`    - ${d.id}: ${d.reason}`);
  stats.newDeals = state.deals.filter((d) => !before.has(d.id)).length;
  return stats;
}

