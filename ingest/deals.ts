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
import { computeMultiples, FINANCIALS_VERSION, getTargetFinancials } from "./financials";
import { definedEntities, item101, ownReleaseDay, parseMergerItem, saysMergerTerminated, withItem101Price, withoutSideMatters } from "./parse/eightk";
import { namesTheShell, sponsorFromText } from "./parse/sponsor";
import { combineTerms, parseDealTerms, parseProxyTerms, TERMS_PARSER_VERSION } from "./parse/terms";
import { FAIRNESS_PARSER_VERSION, parseFairness } from "./parse/fairness";
import { closingFiling, closingsToRead, milestonesFrom, ownFilings } from "./timeline";
import { buyerBanksInProxy, meetingDateOf, parseMergerProxy } from "./parse/proxy";
import { proxySections } from "./parse/proxySections";
import { completedPhrases, completedSigningOn, endedPhrases, nameForms, readAnnouncement, readLooseCompletion, readLooseEnd, readPastReference, readStatement, searchName, shortName as firstNameWord, statedClosingDay } from "./parse/completion";
import { cleanPartyName, COLLIDING_SPONSORS, identicalNames, isDescriptionOnly, isMergerVehicle, isPlaceholderBuyer, isPlausibleName, isTickerOf, namesCompany, namesExtend, normalizeName, notTheSponsor, sameCompany, titleCaseCaps, withoutStateTag } from "./parse/names";
import { displayName, extractAdvisors, extractConsideration, extractPremium, extractPrice, extractValue, parsePressRelease, splitHeadline, type ParsedPress, type PartyMention } from "./parse/press";
import { sectorForBuyer, sectorForCompany } from "./sectors";
import type { StoredDeal, State } from "./store";
import { BASIN_NAME, correctKnownClosing, HOTEL_PROPERTY, moveBuyerOffTarget, SPAC_NAME, tidyDeals } from "./tidy";
import { flatten, htmlToText } from "./text";
import type { Company, DealStatus, DealTerms, FairnessOpinion, Filing } from "../lib/types";

export const QUERIES = [
  '"represents a premium"',
  // All-stock deals quote neither a cash price nor "exchange ratio": "Capital One to Acquire Discover … in an all-stock
  // transaction … representing a premium of 26.6%".
  '"representing a premium"',
  '"all-stock transaction" "definitive agreement"',
  '"per share in cash"',
  '"exchange ratio" "merger agreement"',
  '"definitive merger agreement"',
  '"to be acquired by"',
  '"all of the outstanding shares" "definitive agreement"',
  '"take private" OR "go private" "definitive agreement"',
];
export const FORMS = ["8-K", "DEFA14A", "425", "SC TO-C", "SC14D9C"];

/**
 * US-listed companies buying private companies (most M&A by count). Buyer-filed 8-K press exhibits;
 * the parser decides whether the target is a private company (see `isPrivateTarget`).
 */
// (Plural, which the search doesn't count as the singular: Vistra's "has executed definitive agreements to acquire Cogentrix Energy", whose closing release alone made a deal dated October.)
export const PRIVATE_QUERIES = ['"has acquired"', '"completed the acquisition of"', '"definitive agreement to acquire"', '"executed definitive agreements to acquire"', '"completes acquisition of"', "acquired privately held"];

/**
 * Target-side 8-K language: "Merger Sub will merge with and into the Company" only appears when the
 * filer is the company being acquired. Parsed from the Item 1.01 text, so no press release is needed.
 * Not the verb alone: "providing for the merger of Acquisition Sub with and into the Company" (RR Donnelley and Veoneer's
 * winning agreements, whose 8-Ks were never opened: the old phrases hit only their exhibits, which aren't read here).
 */
export const ITEM_QUERIES = ['"with and into the Company"', '"commence a tender offer" "Agreement and Plan of Merger"'];

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
export async function discoverMergerFilers(
  from: string,
  to: string,
  gaps: string[] = [],
  log: (s: string) => void = () => {},
  opts: { allParties?: boolean; byYear?: boolean } = {},
) {
  const out = new Map<string, { firstDate: string; hit: FtsHit }>();
  for (const [start, end] of monthWindows(from, to)) {
    for (const form of ["PREM14A", "DEFM14A", "SC 14D9", "SC 13E3"]) {
      const hits = await searchOrGap({ q: "", forms: [form], from: start, to: end }, gaps, log);
      for (const h of hits) {
        if (h.form !== form || h.sics.includes("6770")) continue;
        // A joint proxy is filed under both companies (AvalonBay and Equity Residential): with `allParties`, each
        // filer counts, not just the first listed (which may be the buyer).
        for (const [i, display] of (opts.allParties ? h.displayNames : h.displayNames.slice(0, 1)).entries()) {
          const f = parseDisplayName(display);
          if (/\b(?:Fund|Trust|Portfolio|ETF)\b/i.test(f.name)) continue;
          const cik = f.cik ?? trimCik(h.ciks[i] ?? h.ciks[0]);
          // `byYear`: one entry per company per year ("cik|2023"), so a later deal's proxy isn't hidden behind an
          // earlier one's (Aerojet: Lockheed's in 2021, L3Harris's in 2023).
          const key = opts.byYear ? `${cik}|${h.fileDate.slice(0, 4)}` : cik;
          const prev = out.get(key);
          if (!prev || h.fileDate < prev.firstDate) out.set(key, { firstDate: h.fileDate, hit: h });
        }
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
  /** Found only by name in today's listed-company file (no listing in the document): listed now, maybe not then. */
  byNameToday?: boolean;
}

function resolveParty(p: PartyMention, hit: FtsHit, dir: Directory): Resolved {
  const filers = hit.displayNames.map(parseDisplayName);
  const listedThen = (cik: string | null) => !!cik && !!hit.listedCiks?.includes(cik);
  const pressUs = !!p.exchange && US_LISTED.test(p.exchange);
  const ticker = p.ticker?.toUpperCase() ?? null;

  if (ticker) {
    const f = filers.find((x) => x.tickers.includes(ticker));
    const listed = dir.byTicker.get(ticker);
    // Guard against ticker collisions: a TSX symbol, or a ticker reused after a delisting on the same exchange
    // (Vonage's "VG" is now Venture Global's, CoreSite's "COR" is Cencora's). The names must agree; otherwise
    // fall through to the filers and the name directory.
    if (listed && sameCompany(listed.name, p.name)) {
      // The same name and ticker reused by a newer registrant (SailPoint, bought in 2022, relisted in 2025 under a new
      // CIK): the document's own filer of that name is the company meant.
      // (The same name: "Merck Sharp & Dohme LLC" filing with Merck's release isn't Merck & Co., Inc.)
      const self = filers.find((x) => x.cik && x.cik !== listed.cik && normalizeName(x.name) === normalizeName(p.name));
      if (self?.cik) return { cik: self.cik, ticker, listedInUs: pressUs || listedThen(self.cik) };
      return { cik: listed.cik, ticker, listedInUs: pressUs || US_LISTED.test(listed.exchange ?? "") };
    }
    if (f?.cik) return { cik: f.cik, ticker, listedInUs: pressUs || listedThen(f.cik) };
  }
  // A party written as its ticker ("Blackstone to acquire PSB") is the filer that trades under it: the release was
  // filed by PS Business Parks (PSB).
  if (!ticker && /^[A-Z]{2,5}$/.test(p.name)) {
    const f = filers.find((x) => x.tickers.includes(p.name));
    if (f?.cik) {
      const listed = dir.byCik.get(f.cik);
      return { cik: f.cik, ticker: p.name, listedInUs: pressUs || US_LISTED.test(listed?.exchange ?? "") || !listed || listedThen(f.cik) };
    }
  }
  // Also accept a filer whose registered name appears inside a run-on parsed name
  // ("America's First Transcontinental Railroad Union Pacific" contains "Union Pacific").
  const pn = normalizeName(p.name);
  // Spacing aside: "MidWest One Financial Group" in Nicolet's 8-K is the filer MIDWESTONE FINANCIAL GROUP.
  const squash = (s: string) => normalizeName(s).replace(/\s+/g, "");
  // Not one of two buyers named together: "CD&R and McKesson Corporation" (a consortium, CD&R the majority owner) is
  // not McKesson alone.
  const sides = p.name.split(/\s+and\s+/i).map((s) => s.trim());
  const joint = sides.length === 2 && sides.every((s) => s.length >= 3 && isPlausibleName(s));
  const f =
    filers.find((x) => sameCompany(x.name, p.name) || (squash(x.name).length >= 8 && squash(x.name) === squash(p.name))) ??
    filers.find((x) => normalizeName(x.name).length >= 5 && pn.includes(normalizeName(x.name)) && !(joint && sides.some((s) => sameCompany(x.name, s))));
  if (f?.cik) {
    const listed = dir.byCik.get(f.cik);
    // Had a ticker when it filed but is no longer in the listed-company file: delisted after the deal closed.
    const delistedSince = !listed && f.tickers.length > 0 && !hit.listedChecked;
    return {
      cik: f.cik,
      ticker: ticker ?? listed?.ticker ?? f.tickers[0] ?? null,
      listedInUs: pressUs || US_LISTED.test(listed?.exchange ?? "") || delistedSince || listedThen(f.cik),
    };
  }
  const byName = dir.byName.get(normalizeName(p.name));
  // Names normalise without "Group", "Holdings" …: "Independent Bank Group" (delisted since) would become today's
  // Independent Bank Corp. A distinguishing word the parsed name has and the listed one lacks means another company.
  // ("Star Holding LLC", Apollo's shell, is not the listed Star Group, L.P.)
  const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => (w === "holding" ? "holdings" : w)));
  const DISTINCT = ["group", "holdings", "bancorp", "bancshares", "financial", "partners", "trust"];
  const differs = (listedName: string) => {
    const [pw, lw] = [words(p.name), words(listedName)];
    return DISTINCT.some((w) => pw.has(w) && !lw.has(w));
  };
  // A short name can belong to another company: Emerson's "NI (NASDAQ: NATI)" is National Instruments, not NI Holdings.
  // Nor is a buyout firm the listed company its name normalises to ("Advent International" → Advent Technologies).
  if (byName && !differs(byName.name) && !notTheSponsor(p.name, byName.name) && (!ticker || !pressUs || byName.ticker.toUpperCase() === ticker))
    return { cik: byName.cik, ticker: ticker ?? byName.ticker, listedInUs: pressUs || US_LISTED.test(byName.exchange ?? ""), byNameToday: !pressUs };
  return { cik: null, ticker, listedInUs: pressUs };
}

/**
 * Bump when the private-target registrant check changes: stored private deals are then checked again.
 * 2: every private target is looked up (not just ones quoting a share price), spacing-insensitive names.
 */
export const REGISTRANT_CHECK_VERSION = 4;

const shiftDate = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/** A blank-check company's name ("Roth CH Acquisition V Co.", "Forum Merger III Corp", "Genesis Unicorn Capital Corp"). */
const SPAC_FILER = /\bAcquisitions?\b|\bMerger\b|\bCapital Corp\b|\s[IVX]+,?\s+(?:Corp(?:oration)?|Inc|Ltd|Co)\.?$|\b(?:Corp(?:oration)?|Inc)\.?\s+[IVX]+$|\bBlank Check\b/i;

/** How far before its merger proxy the backstop looks for a company's signing 8-K. */
const BACKSTOP_DAYS = 400;
/** `seen` key for a backstop lookup (company + proxy year). Bump to look every filer up again after a parser change. */
const BACKSTOP_KEY = "backstop4";
const PERIODIC = /^(?:10-K|10-Q|20-F|40-F|10-KT|10-QT)(?:\/A)?$/;

/**
 * Was this registrant an exchange-listed reporting company when the deal was announced? It filed periodic reports
 * in the year before, and is still on a US exchange or was delisted (Form 25) afterwards. An OTC company or one that
 * deregistered long ago (Bremer Financial) is not.
 */
export function listedOn(sub: Pick<Submissions, "exchanges" | "filings">, date: string): boolean {
  const filings = recentFilings(sub as Submissions);
  const reporting = filings.some((f) => PERIODIC.test(f.form) && f.date >= shiftDate(date, -450) && f.date <= shiftDate(date, 30));
  // (A Form 25 weeks before the deal means off the exchange at signing: Agile 23 days, Apex 14. Ten days covers a record dated at its closing.)
  // (An amended Form 25 is one too: RADA Electronic Industries, on Nasdaq until Leonardo DRS bought it, filed only "25-NSE/A".)
  const listed = (sub.exchanges ?? []).some((e) => US_LISTED.test(e ?? "")) || filings.some((f) => /^25(?:-NSE)?(?:\/A)?$/.test(f.form) && f.date >= shiftDate(date, -10));
  return reporting && listed;
}

/**
 * Provably not a reporting company on `date`: no periodic report in the year before. Only when the filing index
 * reaches back that far (complete, or older than the window): a heavy filer's older pages aren't read, so an unknown
 * stays listed. Figma and BitGo, private when Adobe and Galaxy agreed to buy them, are in today's listed-company file.
 */
export function provablyUnlistedOn(sub: Pick<Submissions, "filings">, date: string): boolean {
  const filings = recentFilings(sub as Submissions);
  const complete = !sub.filings.files?.length;
  const oldest = filings.reduce((m, f) => (f.date < m ? f.date : m), "9999");
  if (!complete && oldest > shiftDate(date, -450)) return false;
  return !filings.some((f) => PERIODIC.test(f.form) && f.date >= shiftDate(date, -450) && f.date <= shiftDate(date, 30));
}

/**
 * `listedOn`, or else delisted by an 8-K Item 3.01 that names a US exchange (Endo left Nasdaq with a Form 15 and its
 * closing 8-K, no Form 25 under its own CIK). OTC companies file the same Items 2.01 / 3.01 / 5.01 at a closing
 * (Kentucky Bancshares, OTCQX), so the notice's text must say Nasdaq, NYSE or Cboe.
 */
export async function listedThen(sub: Submissions, date: string): Promise<boolean> {
  if (listedOn(sub, date)) return true;
  const filings = recentFilings(sub);
  if (!filings.some((f) => PERIODIC.test(f.form) && f.date >= shiftDate(date, -450) && f.date <= shiftDate(date, 30))) return false;
  const notice = filings.find((f) => /^8-K/.test(f.form) && /\b3\.01\b/.test(f.items) && f.date >= shiftDate(date, -30));
  if (!notice) return false;
  try {
    const text = flatten(htmlToText(await getTextHead(archiveUrl(sub.cik, notice.adsh, notice.primaryDocument), 200_000)));
    // The heading, not a cross-reference ("Item 3.01, Item 5.01 … are incorporated herein", whose next 1,500 characters named the buyer's Nasdaq: Heliogen).
    const titled = text.search(/Item\s*3\.01[\s.:\-–—]*Notice/i);
    const at = titled >= 0 ? titled : text.search(/Item\s*3\.01/i);
    return at >= 0 && namesUsExchange(text.slice(at, at + 1500));
  } catch {
    return false;
  }
}

/** A US exchange named in a delisting notice, not an OTC market. */
export const namesUsExchange = (s: string) => /\b(?:Nasdaq|NASDAQ|New York Stock Exchange|NYSE(?! Arca)|Cboe|CBOE)\b/.test(s) && !/\bOTC(?:QX|QB| Markets| Pink)\b/.test(s.slice(0, 600));

/** Forms only a company being bought files (its merger proxy, tender response, deal communications, delisting). */
const TAKEOVER_FORMS = /^(?:PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC14D9|SC14D9C|SC 14D9-C|SC TO-C|SC TO-T|SC 13E3|425|25-NSE|DEFA14A)(?:\/A)?$/;

/**
 * The registrant was being taken over around `date`: it filed takeover forms between ~18 months before (the date
 * may be the closing) and ~13 months after. Guards the name lookup: "API" matched APi Group and "Longboard" matched
 * Longboard Pharmaceuticals, neither of which was being bought then.
 */
export function takenOverAround(sub: Pick<Submissions, "filings">, date: string, today?: string): boolean {
  // Every annual meeting files a DEFA14A too, so alone it proves nothing once a proxy would have followed (Citizens, Inc. for "Citizens"; PSIX for "Power Solutions, LLC"; MIAX for "Miami"). Only for a deal under 120 days old.
  const fresh = !today || Date.parse(today) - Date.parse(date) <= 120 * 86_400_000;
  return recentFilings(sub as Submissions).some((f) => TAKEOVER_FORMS.test(f.form) && (fresh || !/^DEFA14A/.test(f.form)) && f.date >= shiftDate(date, -550) && f.date <= shiftDate(date, 400));
}

/**
 * `date` is the closing, not the announcement: the target delisted or deregistered (Form 25 / 15) within days of
 * it. A record first seen in a completion release ("Capital One completes its acquisition of Discover") carries the
 * closing date; one created from the announcement (Aerie, signed months before its Form 25) does not.
 */
export function completedAround(sub: Pick<Submissions, "filings">, date: string): boolean {
  return recentFilings(sub as Submissions).some((f) => /^(?:25|25-NSE|15-12B|15-12G)(?:\/A)?$/.test(f.form) && f.date >= shiftDate(date, -3) && f.date <= shiftDate(date, 10));
}

/** An 8-K Item 1.01 section that is the merger agreement with this party (not a credit facility or another deal). */
export function isSigningFor(section: string, counterpartyName: string): boolean {
  const who = normalizeName(counterpartyName);
  return who.length >= 3 && /\b(?:merger|acquisition|acquire|amalgamation|arrangement)\b/i.test(section) && normalizeName(section).includes(who);
}

/**
 * The date of the earliest 8-K Item 1.01 in `sub`'s filings, up to ~21 months before `closing` (NYCB / Flagstar
 * took 19), whose agreement names one of `counterparties`: the signing of the deal that closed then.
 */
export async function signingDate(sub: Submissions, closing: string, counterparties: string[]): Promise<string | null> {
  const candidates = recentFilings(sub)
    .filter((f) => /^8-K/.test(f.form) && /\b1\.01\b/.test(f.items) && f.date >= shiftDate(closing, -650) && f.date <= shiftDate(closing, -7))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);
  for (const f of candidates) {
    const section = item101(htmlToText(await getText(archiveUrl(sub.cik, f.adsh, f.primaryDocument))));
    if (section && counterparties.some((n) => isSigningFor(section, n))) return f.date;
  }
  return null;
}

/** Words a registrant's name may add to the name a release used: "Aerie" is "Aerie Pharmaceuticals", not "Aeries Technology". */
const DESCRIPTOR = /^(?:pharmaceuticals?|pharma|therapeutics|biosciences?|biotherapeutics|biopharma(?:ceuticals)?|bio|oncology|medical|medtech|lithium|energy|resources|minerals|mining|realty|properties|software|networks|communications|partners|pipeline|systems)$/;
// "Ruth's" = "Ruths"; without EDGAR's state tag ("ENTERPRISE BANCORP INC /MA/" normalised to just "ma", and left Independent's
// purchase of a Nasdaq bank private; "HEALTH NET INC /DE/" to "health net de").
const nameKey = (s: string) => normalizeName(withoutStateTag(s).replace(/['’]/g, ""));

/**
 * Is `registrant` (its name on the deal date) the company a release called `target`? The same name (suffixes such as
 * Inc / Holdings / Group aside), or that name plus descriptors only: so "Fortune" (a bank) is not "Fortune Brands",
 * "Beacon" is not "Beacon Financial" and a private "First American" bank is not First American Financial.
 */
export function registrantMatches(registrant: string, target: string): boolean {
  const r = nameKey(registrant);
  const t = nameKey(target);
  if (r.length < 3 || t.length < 3) return false;
  if (r === t || r.replace(/ /g, "") === t.replace(/ /g, "")) return true; // "Hill Rom" = "Hillrom"
  if (!r.startsWith(t + " ")) return false;
  // A short form of three letters is too common a start: Pulmatrix's "Eos" (Eos SENOLYTIX) is not Eos Energy Enterprises.
  if (!t.includes(" ") && t.length <= 3) return false;
  // "Interpublic" = "Interpublic Group of Companies"
  return r.slice(t.length + 1).split(" ").every((w) => DESCRIPTOR.test(w) || /^(?:group|companies|of|the)$/.test(w));
}

/** The name minus trailing descriptors, so "Enable Midstream Energy" can be looked up as "Enable Midstream". */
export function coreName(name: string): string {
  const words = name.replace(/['’.,]/g, "").replace(/\s+/g, " ").trim().split(" ");
  while (words.length > 2 && DESCRIPTOR.test(words.at(-1)!.toLowerCase())) words.pop();
  return words.join(" ");
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

/** First words many unrelated companies share, so they prove nothing. */
const GENERIC_FIRST_WORD = /^(?:energy|health|healthcare|capital|global|american|america|national|first|united|general|financial|pacific|southern|northern|western|eastern|community|industrial|digital|medical|power|water|advanced|applied|premier|summit|pioneer|liberty|eagle)$/;

/** A real company name for a private target, not an asset description ("certain assets of …", "12 properties"). */
export function isPrivateTargetName(name: string, acquirerName: string): boolean {
  const n = name.trim();
  // The same company, by more than an ordinary first word: First Internet Bancorp bought First Century Bancorp.
  const sharedWordOnly = GENERIC_FIRST_WORD.test(normalizeName(n).split(" ")[0]) && !identicalNames(n, acquirerName);
  if (n.length < 3 || n.length > 70 || (sameCompany(n, acquirerName) && !sharedWordOnly)) return false;
  if (!/^(?:[a-z]{1,3}(?=[A-Z]))?[A-Z0-9]/.test(n) || /^\d+\s/.test(n) || /^(?:eCommerce|eBook|eLearning|eHealth|mRNA|iPhone|iPad|iOS|tRx)\b/.test(n)) return false;
  // A basin is an asset purchase: "Eagle Ford" (Crescent Energy buying Devon's Eagle Ford assets). A run of hyphenated
  // words is a description: "Cash-Flow-Positive" (production).
  if (BASIN_NAME.test(n) || HOTEL_PROPERTY.test(n) || /^[A-Za-z]+(?:-[A-Za-z]+){2,}$/.test(n) || isDescriptionOnly(n)) return false;
  // A headline cut at its adjective: "Completes Acquisition of Multiple Leading Nuclear Brands", "Acquisition of Integrated LNG and Power Platform".
  if (/^(?:Multiple|Integrated|Various|Several|Numerous|Leading|Strategic|Select|Diversified|Regional|National|Premier)$/i.test(n)) return false;
  // A class of shares: "High-Vote Series B Common" (Liberty Media).
  if (/\bSeries [A-Z]\b.*\b(?:Common|Preferred)\b|\b(?:Common|Preferred) (?:Stock|Shares?|Units?)$|^High-Vote\b/i.test(n)) return false;
  if (/^(?:the |its |a |an )?(?:certain|substantially all|remaining|additional|another|control of|global|worldwide|u\.s\.|us|north american|exclusive|ownership|assets?|business(?:es)?|portfolio|operations?|propert(?:y|ies)|division|units?|stake|interests?|shares|equity|company|companies|entity|group of|majority|minority|rights?|license)\b/i.test(n)) return false;
  // A headline run on into its verb, a place or a property: "Kellstrom Aerospace Provides Preliminary …", "Mobility & Materials Business Establishes", "San Diego-Based", "East Texas Bolt-On", "DreamWorks Animation Campus".
  if (/\b(?:Provides|Establishes|Reports|Announces)\b|-Based$|\bBolt-On\b|\bCampus$|\bSites?$/.test(n)) return false;
  // Asset and product deals: "… Retail Assets", "… Earth Station", "Global Rights to …", "the Pizza Hut Brand".
  if (/\b(?:assets?|rights?|brand|brands|licen[cs]es?|stations?|portfolio|propert(?:y|ies)|facility|facilities|plant|mine|refinery|project|fleet|vessels?|patents?|product line|division|business line|stake|interest|ownership)\b/i.test(n)) return false;
  // A drug or programme, not a company: "ST-920 Fabry Disease Gene Therapy", "ABC-123".
  if (/^[A-Z]{1,5}-?\d{2,}\b/.test(n) || /\b(?:therapy|therapies|program|programme|candidate|vaccine|compound|molecule|antibody|asset|operations)$/i.test(n)) return false;
  // A description, not a name: "Next-Gen AI Drug Discovery Company", "a Leading Software Provider". A plain name
  // ending in "Company" ("Madison National Life Insurance Company") is fine; marketing adjectives give it away.
  if (
    /\b(?:company|business|provider|platform|firm|developer|manufacturer|operator|distributor|maker|producer|leader|specialist)$/i.test(n) &&
    !/\b(?:Inc|LLC|Ltd|Corp|L\.?P)\.?$/i.test(n) &&
    (/\b\w+-\w+\b/.test(n) || /\b(?:leading|innovative|premier|global|independent|specialty|next|emerging|fast-growing|privately|enabled|focused|driven)\b/i.test(n))
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
  if (brand && brand.length >= 4 && !GENERIC_FIRST_WORD.test(brand)) {
    const at = n.toLowerCase().search(new RegExp(`\\s${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
    // (Two words must be left: European Drilling Projects bought by Drilling Tools, Helix eSports bought by Esports Entertainment.)
    if (at > 2 && n.slice(0, at).trim().split(/\s+/).length >= 2) n = n.slice(0, at);
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
  const apart = (a: StoredDeal, b: StoredDeal) => Math.abs(Date.parse(a.announcedDate) - Date.parse(b.announcedDate)) / DAY;
  const sameBuyer = (a: StoredDeal, b: StoredDeal) => (!!a.acquirer.cik && a.acquirer.cik === b.acquirer.cik) || sameCompany(a.acquirer.name, b.acquirer.name);
  // Looser, but only for the same buyer within weeks: "HILLROM" is Hill-Rom Holdings, "ENABLE MIDSTREAM Energy" is
  // Enable Midstream Partners, and "PSB" is the ticker of PS Business Parks.
  const alike = (pubName: string, pubTicker: string | null, privName: string) => {
    const a = normalizeName(pubName).replace(/ /g, "");
    const b = normalizeName(privName).replace(/ /g, "");
    return (b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) || privName === pubTicker || sameCompany(pubName, privName);
  };
  for (let i = deals.length - 1; i >= 0; i--) {
    const d = deals[i];
    if (!d.privateTarget) continue;
    const twin =
      pub.find((p) => same(p.target.name, d.target.name) && apart(p, d) < 400) ??
      pub.find((p) => sameBuyer(p, d) && apart(p, d) <= 45 && alike(p.target.name, p.target.ticker, d.target.name));
    if (!twin) continue;
    if (!twin.acquirer.cik && d.acquirer.cik && sameCompany(twin.acquirer.name, d.acquirer.name)) twin.acquirer = { ...d.acquirer };
    deals.splice(i, 1);
  }
}

/** The full name a document gives an abbreviation: `Medical Manufacturing Technologies, LLC ("MMT")` -> that name. */
export function expandAbbreviation(abbr: string, text: string): string | null {
  const m = new RegExp(`([A-Z][A-Za-z0-9&.,'’\\- ]{3,90}?)\\s*\\(\\s*(?:the\\s+|together,?\\s+)?["“]\\s?${abbr}\\s?["”](?:\\s+or\\s+(?:the\\s+)?["“][^"”]{1,30}["”])?\\s*\\)`).exec(text);
  if (!m) return null;
  // Keep the trailing capitalised run: "to acquire Medical Manufacturing Technologies, LLC" -> "Medical Manufacturing Technologies, LLC".
  const run = /((?:(?:[A-Z][\w&.'’\-]*|&),?\s+)*(?:[A-Z][\w&.'’\-]*|LLC|Inc\.?|Corp\.?|Ltd\.?))\s*$/.exec(m[1].trim());
  const name = run ? cleanPartyName(run[1].replace(/,$/, "")) : null;
  return name && isPlausibleName(name) && name.length >= abbr.length + 3 ? name : null;
}

/** Investment funds (closed-end funds, ETFs, municipal funds) are out of scope as targets; REITs ("… Trust") are in. */
export const FUND_TARGET = /\b(?:Fund|Funds|ETF|Municipal)\b/i;

/** Largest value believable for a private company: anything above is almost certainly a misread number. */
export const MAX_PRIVATE_DEAL_VALUE = 40e9;

const weekday = (ms: number) => ![0, 6].includes(new Date(ms).getUTCDay());
/** Weekdays after `from`, up to and including `to`: Friday to Monday is 1. */
function businessDaysBetween(from: string, to: string): number {
  let n = 0;
  for (let t = Date.parse(from) + 86_400_000; t <= Date.parse(to); t += 86_400_000) if (weekday(t)) n++;
  return n;
}
function offWeekend(day: string): string {
  let t = Date.parse(day);
  while (!weekday(t)) t += 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function applyParsed(state: State, parsed: ParsedPress, hit: FtsHit, target: Resolved, acquirer: Resolved, isPrivate: boolean): StoredDeal | null {
  const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  // Private targets have no CIK: they are matched by name (and buyer below), within two years. A looser name match
  // ("Rotron Aero" / "Rotron Aerospace Ltd.", a shared first word) needs the same buyer: on its own it joined Live
  // Ventures' 2024 purchase of Central Steel Fabricators to Switch's 2021 one of Data Foundry.
  const sameBuyerAs = (d: StoredDeal) => sameCompany(d.acquirer.name, parsed.acquirer.name) || (!!acquirer.cik && d.acquirer.cik === acquirer.cik);
  const privateMatch = (d: StoredDeal) =>
    identicalNames(d.target.name, parsed.target.name) || namesExtend(d.target.name, parsed.target.name) || (sameCompany(d.target.name, parsed.target.name) && sameBuyerAs(d));
  const candidates = state.deals
    .filter((d) => (isPrivate ? d.privateTarget && privateMatch(d) && daysApart(d.announcedDate, hit.fileDate) <= 730 : d.target.cik === target.cik))
    .sort((a, b) => b.announcedDate.localeCompare(a.announcedDate));
  // A merger 8-K restating an older signing (an extension, a vote, financing) only updates that deal: Genworth's
  // 2017–2020 extension 8-Ks each open "As previously reported, on October 21, 2016, … entered into …". The signing 8-K
  // itself is due within four business days (ZeroFox's note-repurchase 8-K, 29 days after, created a deal for its lender).
  if (parsed.kind === "announcement" && parsed.signedOn && daysApart(parsed.signedOn, hit.fileDate) > 10) parsed = { ...parsed, kind: "update" };
  // A results report beside an open deal isn't announcing another, and its amounts aren't that deal's: Veoneer's Q3 report
  // made a third record, "SSW and Qualcomm", at the $31.25 it quotes as Magna's offer, which then read as topping the real one.
  // (Not one filed with the deal's first documents: IEC's results release is its announcement, read just after the 8-K.)
  if (parsed.kind === "announcement" && parsed.resultsReport && candidates.some((d) => OPEN.includes(d.status) && daysApart(d.filings[0]?.filedDate ?? d.announcedDate, hit.fileDate) > 3))
    parsed = { ...parsed, kind: "update", pricePerShare: null, premiumPct: null, valueUsd: null, valueKind: null, consideration: null };
  // A signing whose 8-K reports the earlier agreement ended is a new deal, whatever its shell is called: it joins only
  // the same buyer's record, or the release of this same signing. RR Donnelley's winning agreement with "Chatham Delta
  // Parent, Inc." was folded into Atlas's, which then read "Closed" at Atlas's lower price.
  const tops = parsed.kind === "announcement" && !!parsed.endsEarlierAgreement;
  const thisSigning = (d: StoredDeal) => daysApart(d.announcedDate, parsed.announcedOn ?? parsed.signedOn ?? hit.fileDate) <= 3;
  let deal =
    // The same buyer, also when written as its ticker (Two Harbors' earnings release: "UWMC", for UWM Holdings).
    candidates.find((d) => sameCompany(d.acquirer.name, parsed.acquirer.name) || (acquirer.cik && d.acquirer.cik === acquirer.cik) || isTickerOf(parsed.acquirer.name, d.acquirer)) ??
    // The same signing often reaches us as an 8-K naming a shell buyer and a press release naming the sponsor.
    // Never two different listed buyers, though: a rival bid comes within days (MKS on February 8, II-VI days later, both
    // for Coherent).
    (parsed.kind === "announcement"
      ? candidates.find((d) => daysApart(d.announcedDate, hit.fileDate) <= 14 && !(acquirer.cik && d.acquirer.cik && acquirer.cik !== d.acquirer.cik) && (!tops || thisSigning(d)))
      : undefined) ??
    // A later filing naming only the acquisition vehicle belongs to the live deal it implements.
    (parsed.kind === "announcement" && !tops && isPlaceholderBuyer(parsed.acquirer.name)
      ? candidates.find((d) => d.status !== "Terminated" && daysApart(d.announcedDate, hit.fileDate) <= 365)
      : undefined) ??
    // An update or completion joins the open deal it's about. One naming another real buyer is about another agreement:
    // II-VI's filings for its winning bid for Coherent used to fold into MKS's open, losing bid (then marked Closed).
    (parsed.kind !== "announcement"
      ? candidates.find(
          (d) =>
            OPEN.includes(d.status) &&
            (isPlaceholderBuyer(d.acquirer.name) || isPlaceholderBuyer(parsed.acquirer.name) || !isPlausibleName(parsed.acquirer.name) || candidates.filter((c) => OPEN.includes(c.status)).length === 1) &&
            // Another listed company's closing of a private company with a like name is another deal (PGT's Martin Door, PubMatic's Martin).
            !(isPrivate && !!acquirer.cik && !!d.acquirer.cik && acquirer.cik !== d.acquirer.cik),
        )
      : undefined);

  // The date the document gives, when it is the announcement's and comes before the filing: a release's dateline (an
  // exhibit filed six days later: Cardinal / Hughes Brothers), the release an 8-K says went out, or for a private deal
  // first seen at its completion, the announcement it refers back to (Cronos / CanAdelaar).
  const releaseOn = parsed.announcedOn && parsed.announcedOn <= hit.fileDate ? parsed.announcedOn : null;
  const gap = releaseOn ? daysApart(releaseOn, hit.fileDate) : null;
  const stated = releaseOn && gap != null && ((parsed.kind === "announcement" && gap <= 10) || (parsed.kind === "completion" && isPrivate && gap <= 730)) ? releaseOn : null;
  // An Item 1.01 saying only when it was signed: the signing usually comes a day or a weekend before the release, so an
  // 8-K filed the next business day is the better date, and one filed later the signing itself, off a weekend (Santander
  // / Webster: signed February 3, filed February 6). Of 86 such 8-Ks whose release is known this is right 54 times and a
  // day off 29; the signing alone is right 26 times, and put 162 deals on a weekend.
  const signedDay = !releaseOn && parsed.kind === "announcement" && parsed.signedOn && parsed.signedOn < hit.fileDate ? (businessDaysBetween(parsed.signedOn, hit.fileDate) <= 1 ? hit.fileDate : offWeekend(parsed.signedOn)) : null;
  const fromSigning = !!signedDay && signedDay !== hit.fileDate;
  const announced = stated ?? signedDay ?? hit.fileDate;

  if (!deal) {
    // Updates about deals announced before our window can't create a deal (we'd get the date wrong).
    // Private deals are often signed and closed at once ("Acme has acquired Widget"): a completion creates them.
    if (parsed.kind !== "announcement" && !(isPrivate && parsed.kind === "completion")) return null;
    // Ids are unique: two rival buyers for one target can announce the same day (they stay separate deals), and a
    // repeated id made a Supabase save fail mid-rebuild ("ON CONFLICT DO UPDATE command cannot affect row a second time").
    const baseId = isPrivate ? `p-${normalizeName(parsed.target.name).replace(/\s+/g, "-")}-${hit.fileDate}` : `${target.cik}-${hit.fileDate}`;
    let id = baseId;
    for (let n = 2; state.deals.some((d) => d.id === id); n++) id = `${baseId}-${n}`;
    deal = {
      id,
      ...(isPrivate ? { privateTarget: true } : {}),
      announcedDate: announced,
      ...(fromSigning ? { dateIsSigning: true } : {}),
      ...(parsed.kind === "completion" && isPrivate && parsed.announcedEarlier && !stated ? { dateIsClosing: true } : {}),
      acquirer: company(parsed.acquirer, acquirer),
      ...(parsed.item101 ? { buyerFromItem101: true } : {}),
      ...(parsed.amended ? { termsAmended: true, termsAmendedOn: hit.fileDate } : {}),
      ...(parsed.partOfTarget ? { partOfTarget: true } : {}),
      ...(parsed.buyIn != null ? { buyIn: parsed.buyIn } : {}),
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

  // Documents are processed oldest-first, so the first announcement sets the terms; later documents only fill gaps, or
  // replace terms if they predate what we have: a release dated earlier (CAI's, June 17, over an 8-K read first), or an
  // Item 1.01 really filed before the deal's first document (Denbury, EnVen). Not an Item 1.01 that only states an earlier
  // signing: it reads a mixed deal's cash leg, and overwrote the release's total (Triton $85 to $68.50, UniFirst, NV5).
  const earlier = parsed.kind === "announcement" && announced < deal.announcedDate;
  const filedFirst = deal.filings[0]?.filedDate;
  const reallyFirst = !!filedFirst && hit.fileDate < filedFirst;
  // (Not over a raised offer: Pluralsight's December signing, read after its March revision, stays history at $20.26.)
  const prefer = earlier && (!parsed.item101 || reallyFirst) && !deal.termsAmended;
  const signingRelease = !parsed.item101 && parsed.kind === "announcement" && !!deal.buyerFromItem101 && thisSigning(deal);
  if (parsed.buyIn != null && (deal.buyIn == null || deal.buyIn === true)) deal.buyIn = parsed.buyIn;
  const set = <K extends "valueUsd" | "pricePerShare" | "premiumPct" | "consideration">(k: K, v: StoredDeal[K]) => {
    if (v != null && (deal![k] == null || prefer || (signingRelease && k === "consideration"))) deal![k] = v;
  };
  // A closing release's price in a stock or mixed deal is what it came to on the day, not the offer (AZEK's $54.18).
  if (parsed.kind !== "completion" || parsed.consideration === "Cash") set("pricePerShare", parsed.pricePerShare);
  if (prefer || parsed.pricePerShare == null || deal.pricePerShare == null || Math.abs(parsed.pricePerShare - deal.pricePerShare) < 0.005) set("premiumPct", parsed.premiumPct);
  set("consideration", parsed.consideration);
  if (parsed.valueUsd != null && (deal.valueUsd == null || prefer || deal.valueImplied || signingRelease)) {
    deal.valueUsd = parsed.valueUsd;
    deal.valueKind = parsed.valueKind;
    if (deal.valueImplied) {
      delete deal.valueImplied;
      deal.financialsCheckedAt = null;
    }
  }
  // A raised offer from this buyer: the final signed price is the deal's, as a banker quotes it, not the first (Gray / Meredith
  // $14.51 to $16.99, GSE $4.10 to $4.60, At Home $36 to $37). Its value goes with it: stated here, or worked out from the
  // new price, never the first price's.
  if (
    parsed.amended &&
    parsed.pricePerShare != null &&
    deal.pricePerShare != null &&
    ((parsed.pricePerShare > deal.pricePerShare * 1.001 && parsed.pricePerShare <= deal.pricePerShare * 1.6) || (parsed.priceCut && parsed.pricePerShare < deal.pricePerShare && parsed.pricePerShare >= deal.pricePerShare * 0.4)) &&
    (sameBuyerAs(deal) || isPlaceholderBuyer(parsed.acquirer.name))
  ) {
    deal.pricePerShare = parsed.pricePerShare;
    deal.premiumPct = parsed.premiumPct ?? null;
    deal.valueUsd = parsed.valueUsd ?? null;
    deal.valueKind = parsed.valueUsd != null ? parsed.valueKind : null;
    delete deal.valueImplied;
    if (deal.valueUsd == null) deal.valueCheck = VALUE_CHECK_VERSION;
    deal.financialsCheckedAt = null;
    deal.termsAmended = true;
    deal.termsAmendedOn = hit.fileDate;
  }
  // A signing doesn't move a date a release gave (Friday's signing, Monday's release, Wednesday's 8-K), and a release's
  // date replaces a signing's.
  if (earlier && (!fromSigning || reallyFirst || deal.dateIsSigning)) {
    deal.announcedDate = announced;
    delete deal.dateIsClosing;
    if (fromSigning) deal.dateIsSigning = true;
    else delete deal.dateIsSigning;
  } else if (stated && deal.dateIsSigning && !earlier && daysApart(stated, deal.announcedDate) <= 5) {
    deal.announcedDate = stated;
    delete deal.dateIsSigning;
  }
  // Longer names are usually the legal names ("ACV" -> "ACV Auctions Inc.").
  if (parsed.target.name.length > deal.target.name.length) deal.target.name = parsed.target.name;
  if ((isPlaceholderBuyer(deal.acquirer.name) || !isPlausibleName(deal.acquirer.name)) && !isPlaceholderBuyer(parsed.acquirer.name)) {
    // Replace a shell / defined-term buyer ("Anchor Parent, LLC", "Parent"), or a junk one ("Netherlands"), with the real name.
    deal.acquirer = company(parsed.acquirer, acquirer);
  } else if (
    !parsed.item101 &&
    parsed.kind === "announcement" &&
    deal.buyerFromItem101 &&
    !deal.acquirer.cik &&
    thisSigning(deal) &&
    !sameCompany(parsed.acquirer.name, deal.acquirer.name) &&
    !isPlaceholderBuyer(parsed.acquirer.name) &&
    isPlausibleName(parsed.acquirer.name) &&
    !isDescriptionOnly(parsed.acquirer.name) &&
    !/\b(?:Investors?|Consortium|Portfolio Company|Partnership|Founder|Group Led|Led by)\b/i.test(parsed.acquirer.name)
  ) {
    deal.acquirer = company(parsed.acquirer, acquirer);
    delete deal.buyerFromItem101;
  } else if (
    parsed.acquirer.name.length > deal.acquirer.name.length &&
    sameCompany(parsed.acquirer.name, deal.acquirer.name) &&
    // Joint buyers keep their short names: "Trian and General Catalyst", not "Trian Fund Management and General Catalyst" (Janus Henderson).
    !/\sand\s/.test(deal.acquirer.name) &&
    // Not the shell it signed through: "Atlas River Parent Inc." doesn't rename Atlas Holdings LLC.
    !isPlaceholderBuyer(parsed.acquirer.name) &&
    // Not a subsidiary sharing the listed buyer's first word: Cidara's merger 8-K named "Merck Sharp & Dohme LLC", which
    // renamed Merck & Co., Inc. (NYSE: MRK) from the press release.
    (!deal.acquirer.cik || acquirer.cik === deal.acquirer.cik || normalizeName(parsed.acquirer.name) === normalizeName(deal.acquirer.name))
  ) {
    deal.acquirer.name = parsed.acquirer.name;
  }
  // One release replaces the bare 8-K's value, not each document after it: AES's DEFA14A, the same 8-K wrapped, put $10.7B back
  // over its release's $33.4B.
  if (signingRelease && parsed.valueUsd != null) delete deal.buyerFromItem101;
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
/** The buyer's first word is in a proxy's opening, as a word: "Aya" is in "payable", "AG" in "mortgage", "Option" in "adoption". */
export function opensNamingBuyer(opening: string, buyerName: string): boolean {
  const word = buyerName.replace(/^the\s+/i, "").split(/[\s,]+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${word}(?![a-z0-9])`, "i").test(opening);
}

/**
 * A bank whose fairness opinion the target's proxy prints advised the target, whatever the release named (US Steel / Goldman
 * Sachs, ImmunoGen / Lazard). Each opinion for itself: the buyer's bank on the same proxy doesn't stop it (Bowhead's Ardea). Not on
 * a joint proxy, where the side can read wrong (Duke's Goldman is the buyer's), nor a bank already on the buyer's list, nor a losing
 * bid sharing the winner's proxy.
 */
export function banksOfTheTarget(opinions: Pick<FairnessOpinion, "bank" | "side">[], deal: Pick<StoredDeal, "status" | "acquirer" | "acquirerAdvisors" | "targetAdvisors">, opening: string): string[] {
  if (deal.status === "Terminated" || /joint proxy statement/i.test(opening) || !opensNamingBuyer(opening, deal.acquirer.name)) return [];
  const banks = opinions.filter((o) => o.side === "target" && o.bank && !deal.acquirerAdvisors.includes(o.bank) && !deal.targetAdvisors.includes(o.bank)).map((o) => o.bank!);
  return [...new Set(banks)];
}

/** The deal's own merger proxy or tender response, by form, then the earliest: never one filed after the deal ended (`ownFilings`). */
const dealProxy = <T extends { form: string; date: string }>(filings: T[], deal: StoredDeal): T | undefined =>
  ownFilings(filings, deal)
    .filter((f) => PROXY_FORMS.test(f.form))
    .sort((a, b) => PROXY_ORDER.indexOf(a.form) - PROXY_ORDER.indexOf(b.form) || a.date.localeCompare(b.date))[0];

const NOT_A_NAME_WORD = /^(?:Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|LLC|LP|PLC|Holdings?|Group|&|and)\.?$/i;
/** As `opensNamingBuyer`, by the first two words of the name where the second is part of it: "Canadian" is in CN's proxy too, "Canadian Pacific" isn't. */
export function opensNamingBuyerInFull(opening: string, buyerName: string): boolean {
  const [first, second] = buyerName.replace(/^the\s+/i, "").split(/[\s,]+/);
  if (!second || !/^[A-Z]/.test(second) || NOT_A_NAME_WORD.test(second)) return opensNamingBuyer(opening, buyerName);
  const word = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${word(first)}[\\s-]+${word(second)}(?![a-z0-9])`, "i").test(opening);
}

/**
 * This buyer's proxy, where the filing index can't tell. Two of one form: the one whose opening names the buyer (Kansas City Southern filed CN's
 * on July 7 2021 and CP's on November 3, and CP's record read CN's lenders), else the earliest (Black Knight's two are both ICE's). A topped
 * deal with no end date (Lockheed / Aerojet): only one that names it, or the winner's would be read as its own. Most deals need no extra reading.
 */
export async function proxyOfThisBuyer(sub: Submissions, deal: StoredDeal) {
  const filings = recentFilings(sub);
  const first = dealProxy(filings, deal);
  if (!first) return undefined;
  const noEnd = deal.status === "Terminated" && !deal.statusDate;
  const own = ownFilings(filings, deal).filter((f) => PROXY_FORMS.test(f.form));
  const candidates = own.filter((f) => noEnd || f.form === first.form).sort((a, b) => PROXY_ORDER.indexOf(a.form) - PROXY_ORDER.indexOf(b.form) || a.date.localeCompare(b.date));
  if (candidates.length < 2 && !noEnd) return first;
  const openings = new Map<string, string>();
  for (const f of candidates) openings.set(f.adsh, htmlToText(await getTextHead(archiveUrl(sub.cik, f.adsh, f.primaryDocument), 120_000)).slice(0, 25_000));
  return candidates.find((f) => opensNamingBuyerInFull(openings.get(f.adsh)!, deal.acquirer.name)) ?? (noEnd ? candidates.find((f) => opensNamingBuyer(openings.get(f.adsh)!, deal.acquirer.name)) : first);
}
const PENDING_FORMS =/^(PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC TO-T|SC 13E3|SC14D9|S-4|F-4)(\/A)?$/;
/**
 * Bump when the merger-proxy reader (`parse/proxy.ts`) changes: deals still missing what it reads are read again.
 * 2: "47 percent", "premium of: • …", "compared / relative to", and a stock deal's implied value per share.
 * 3: the buyer's banks from a joint proxy's "Opinion of <buyer>'s Financial Advisor".
 */
export const PROXY_PARSER_VERSION = 3;
/** The target's merger proxy is (re-)read: never read, or read with an older reader and still missing what it gives. */
const proxyWanted = (d: StoredDeal) =>
  (d.premiumPct == null || !d.targetAdvisors.length || !d.acquirerAdvisors.length || (d.pricePerShare == null && d.consideration !== "Cash")) &&
  (!d.proxyCheckedAt || d.proxyParser !== PROXY_PARSER_VERSION);
/** A terminated deal that came back files a new merger proxy or tender document (originals only). */
const REVIVAL_FORMS = /^(PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC14D9|SC TO-T|SC 13E3)$/;

/**
 * Bump to look again for the sponsor behind deals whose buyer is still an acquisition vehicle.
 * 2: "Acquirer Sub" counts as a vehicle (Amgen / Horizon).
 * 3: deals linked to a registrant a buyout firm's name collides with are re-read (Advent → Advent Technologies).
 * 4: management buyouts ("a consortium of investors led by Max Wygod, Chairman and Chief Executive Officer"), headlines
 *    in capitals, "entities controlled by …", and a name that only starts like the vehicle's ("Ithaca Holdings" behind
 *    "Ithaca Holdco, Inc.").
 * 5: "… Acquisition Company, LLC" is a vehicle (Forian), and management buyouts are named "Management Group led by …",
 *    which tidy keeps ("Management group led by …" read as prose and dropped FONAR's deal).
 */
export const SPONSOR_CHECK_VERSION = 5;

/**
 * A proxy's premium belongs to the price it states. A raise or a cut clears the old premium, and a proxy filed before the
 * amending document would put it back beside the new price: Anaplan's 30% at $66 beside $63.75, Squarespace's 15% at $44 beside
 * $46.50, Janus's 6.5% at $49 beside $52. By date, not by looking for the new price in the proxy: Janus's background mentions
 * $52.00. A proxy filed on or after it is right (Circor's 77%, Hill's 92.1%, Battalion's 32.6%).
 */
export const proxyStatesCurrentPrice = (deal: Pick<StoredDeal, "termsAmended" | "termsAmendedOn">, proxyDate: string) => !deal.termsAmended || !deal.termsAmendedOn || proxyDate >= deal.termsAmendedOn;

/**
 * The real buyer behind an acquisition vehicle ("Spaceship Purchaser, Inc." → Permira): the target's announcement
 * releases (8-K exhibits, DEFA14A) from five days before to five after the announcement, read by the press parser
 * (its headline buyer) or by `sponsorFromText`, then the target's merger proxy or 14D-9.
 */
export async function findSponsor(deal: StoredDeal, sub: Submissions): Promise<string | null> {
  const ctx = { filerName: displayName(nameOn(sub, deal.announcedDate)), filerTickers: sub.tickers ?? [] };
  const lo = shiftDate(deal.announcedDate, -5);
  const hi = shiftDate(deal.announcedDate, 5);
  const releases = recentFilings(sub)
    .filter((f) => f.date >= lo && f.date <= hi && /^(?:8-K|DEFA14A|SC14D9C|SC 14D9-C)$/.test(f.form))
    .sort((a, b) => Number(a.date < deal.announcedDate) - Number(b.date < deal.announcedDate) || Math.abs(Date.parse(a.date) - Date.parse(deal.announcedDate)) - Math.abs(Date.parse(b.date) - Date.parse(deal.announcedDate)))
    .slice(0, 6);
  for (const f of releases) {
    const docs = f.form === "8-K" ? releaseExhibits(await filingDocuments(sub.cik, f.adsh), f.primaryDocument, 2) : [f.primaryDocument];
    for (const doc of docs) {
      const text = htmlToText(await getTextHead(archiveUrl(sub.cik, f.adsh, doc), 300_000));
      if (isContractExhibit(text)) continue;
      const p = parsePressRelease(text, ctx);
      const headlineBuyer = p && p.kind === "announcement" && (namesCompany(p.target.name, deal.target.name) || sameCompany(p.target.name, deal.target.name)) ? cleanPartyName(p.acquirer.name) : null;
      if (headlineBuyer && isPlausibleName(headlineBuyer) && !isPlaceholderBuyer(headlineBuyer) && !sameCompany(headlineBuyer, deal.target.name) && !namesTheShell(headlineBuyer, deal.acquirer.name)) return headlineBuyer;
      const named = sponsorFromText(text, deal.target.name, deal.acquirer.name);
      if (named) return named;
    }
  }
  const proxy = dealProxy(recentFilings(sub), deal);
  if (proxy) return sponsorFromText(htmlToText(await getTextHead(archiveUrl(sub.cik, proxy.adsh, proxy.primaryDocument), 400_000)), deal.target.name, deal.acquirer.name);
  return null;
}

/** Bump to re-check stored Closed deals for a termination filed before the delisting. */
export const STATUS_RULE_VERSION = 2;
/**
 * Bump to look again for a headline value in the announcement releases of deals that have none.
 */
export const VALUE_CHECK_VERSION = 1;

/**
 * A deal rebuilt from a merger 8-K often has no value: an all-stock agreement states an exchange ratio, not a dollar
 * figure. The announcement release does ("valued at approximately $59.5 billion"), but it can sit in another filing
 * (Pioneer filed its press release under a separate Item 7.01 8-K, Exxon its own). Read the target's and the
 * buyer's 8-K exhibits and 425 / DEFA14A communications from five days before to three after the announcement, and
 * take the first release that announces this deal with a value. Fills blanks only.
 */
export async function announcementTerms(deal: StoredDeal, subs: Submissions[]): Promise<AnnouncedTerms | null> {
  for await (const text of announcementReleases(deal, subs)) {
    const terms = releaseTerms(text, deal.target.name, deal.acquirer.name);
    if (terms) return terms;
  }
  return null;
}

/**
 * The target's and the buyer's documents around the announcement that announce this deal: 8-K exhibits and 425 /
 * DEFA14A filings from five days before to three after (the stored date is often the 8-K's, filed up to four business
 * days after the signing and its release).
 */
async function* announcementReleases(deal: StoredDeal, subs: Submissions[]): AsyncGenerator<string> {
  const lo = shiftDate(deal.announcedDate, -5);
  // To three days after the announcement, or after the deal's first filing when a date moved back from it (Sykes: signed
  // June 17, its 8-K and release filed June 21).
  const first = deal.filings[0]?.filedDate;
  const hi = shiftDate(first && first > deal.announcedDate && Date.parse(first) - Date.parse(deal.announcedDate) <= 10 * 86_400_000 ? first : deal.announcedDate, 3);
  for (const sub of subs) {
    const filings = recentFilings(sub)
      .filter((f) => f.date >= lo && f.date <= hi && /^(?:8-K|425|DEFA14A)$/.test(f.form))
      .sort((a, b) => a.date.localeCompare(b.date) || Number(b.form === "8-K") - Number(a.form === "8-K"))
      .slice(0, 10);
    for (const f of filings) {
      const docs = f.form === "8-K" ? releaseExhibits(await filingDocuments(sub.cik, f.adsh), f.primaryDocument, 3) : [f.primaryDocument];
      for (const doc of docs) {
        const text = htmlToText(await getTextHead(archiveUrl(sub.cik, f.adsh, doc), 400_000));
        if (isContractExhibit(text)) continue;
        // Press releases only: 425s also carry slide decks ("Merger Creates … >$35 B Enterprise Value ~$23 B Equity
        // Value", the combined company), call transcripts and reprinted news articles.
        // An 8-K filed again as a DEFA14A or 425 without its side agreements: MIC's "$4.475 billion" was KKR's price for another business. (Not skipped: BankFinancial's $142M is only there.)
        const wrapped8k = /\bFORM\s+8-K\b/.test(flatten(text).slice(0, 1500)) && /\bItem\s*1\.01\b/i.test(text);
        const read = wrapped8k ? withoutSideMatters(text) : text;
        if (looksLikePressRelease(read) && announcesDeal(read, deal.target.name, deal.acquirer.name)) yield read;
      }
    }
  }
}

/**
 * Bump to look again for the banks of deals whose buyer's adviser is unknown. Deals with one side empty, or no release among their
 * documents, are read too, and the banks are added to what's there (AvalonBay's proxy named two of the release's six).
 */
export const ADVISOR_CHECK_VERSION = 1;
/** A deal whose release may name banks it lacks: either side empty, or no release among its documents. */
export const advisorCheckDue = (d: Pick<StoredDeal, "advisorCheck" | "acquirerAdvisors" | "targetAdvisors" | "sources">) => d.advisorCheck !== ADVISOR_CHECK_VERSION && (!d.acquirerAdvisors.length || !d.targetAdvisors.length || !d.sources.some((s) => /ex-?99|dex99/i.test(s)));
/** A stated value to look for: none yet, or only price × shares (not after a raised or cut price, whose first release states the old one). */
export const valueCheckDue = (d: Pick<StoredDeal, "valueUsd" | "valueImplied" | "termsAmended" | "valueCheck" | "status">) => (d.valueUsd == null || (!!d.valueImplied && !d.termsAmended)) && d.valueCheck !== VALUE_CHECK_VERSION && d.status !== "Terminated";
/** Over price × shares, a release at the deal's own price only. */
export const takesStatedValue = (d: Pick<StoredDeal, "valueUsd" | "pricePerShare">, release: Pick<AnnouncedTerms, "pricePerShare">) =>
  d.valueUsd == null || release.pricePerShare == null || d.pricePerShare == null || Math.abs(release.pricePerShare - d.pricePerShare) <= d.pricePerShare * 0.005;
/** Bump to look again for the SEC registrant behind buyers stored without a CIK. */
export const BUYER_LINK_VERSION = 1;

/**
 * Both sides' financial advisers from the announcement releases ("Goldman Sachs is serving as financial advisor to
 * Microsoft"). A deal rebuilt from its merger 8-K and proxy has the target's bank only: the proxy names no other.
 */
export async function announcementAdvisors(deal: StoredDeal, subs: Submissions[]): Promise<{ acquirerAdvisors: string[]; targetAdvisors: string[] }> {
  const acquirerAdvisors = new Set<string>();
  const targetAdvisors = new Set<string>();
  for await (const text of announcementReleases(deal, subs)) {
    const a = extractAdvisors(flatten(text).slice(0, 20_000), deal.acquirer.name, deal.target.name, null, deal.target.ticker, deal.acquirer.ticker);
    a.acquirerAdvisors.forEach((b) => acquirerAdvisors.add(b));
    // The release's own name for the buyer, when the record has another: "TD", "HealthSpan Partners".
    if (!a.acquirerAdvisors.length) {
      const own = parsePressRelease(text, { filerName: "", filerTickers: [] })?.acquirer.name;
      if (own && !sameCompany(own, deal.target.name)) extractAdvisors(flatten(text).slice(0, 20_000), own, deal.target.name, null, deal.target.ticker).acquirerAdvisors.forEach((b) => acquirerAdvisors.add(b));
    }
    a.targetAdvisors.forEach((b) => targetAdvisors.add(b));
    if (acquirerAdvisors.size && targetAdvisors.size) break;
  }
  // A bank advises one side.
  for (const b of targetAdvisors) acquirerAdvisors.delete(b);
  return { acquirerAdvisors: [...acquirerAdvisors], targetAdvisors: [...targetAdvisors] };
}

/**
 * What the release says is added to what's stored (AvalonBay's release names J.P. Morgan and Wells Fargo beside the opinion's
 * Goldman Sachs). A bank advises one side: on the target's list it leaves the buyer's. True when the buyer gained a bank.
 */
export function mergeReleaseAdvisors(deal: Pick<StoredDeal, "acquirerAdvisors" | "targetAdvisors">, banks: { acquirerAdvisors: string[]; targetAdvisors: string[] }): boolean {
  const before = new Set(deal.acquirerAdvisors);
  deal.targetAdvisors = [...new Set([...deal.targetAdvisors, ...banks.targetAdvisors])];
  deal.acquirerAdvisors = [...new Set([...deal.acquirerAdvisors, ...banks.acquirerAdvisors])].filter((b) => !deal.targetAdvisors.includes(b));
  return deal.acquirerAdvisors.some((b) => !before.has(b));
}

/**
 * The target's earlier 8-K Item 1.01 (up to 60 days before the stored date) that signs this deal with the same buyer,
 * or null. Corrects dates taken from an amendment 8-K.
 */
async function earlierSigning(deal: StoredDeal, sub: Submissions): Promise<string | null> {
  const lo = shiftDate(deal.announcedDate, -60);
  const candidates = recentFilings(sub)
    .filter((f) => /^8-K/.test(f.form) && /\b1\.01\b/.test(f.items) && f.date >= lo && f.date < deal.announcedDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  for (const f of candidates) {
    const section = item101(htmlToText(await getText(archiveUrl(sub.cik, f.adsh, f.primaryDocument))));
    if (section && isSigningFor(section, deal.acquirer.name)) return f.date;
  }
  return null;
}

export interface AnnouncedTerms {
  valueUsd: number;
  valueKind: StoredDeal["valueKind"];
  pricePerShare: number | null;
  premiumPct: number | null;
  consideration: StoredDeal["consideration"];
}

/**
 * Not a slide deck, call transcript, FAQ, employee memo or reprinted article (425s carry all of these): those quote
 * the combined company's size ("Merger Creates … >$35 B Enterprise Value ~$23 B Equity Value"). A document that names
 * itself one of them near the top, with no newswire tag or "For Immediate Release", is skipped.
 */
export function looksLikePressRelease(text: string): boolean {
  const flat = flatten(text);
  const top = flat.slice(0, 1500);
  const release = /\b(?:PR\s?Newswire|Business\s?Wire|GLOBE\s?NEWSWIRE|ACCESSWIRE|Newsfile|for immediate release|news release|press release)\b/i.test(top);
  // "The following is an article that was published in the Pittsburgh Business Times …" (an EQT 425 on Range, whose
  // reporter wrote "the $13 billion acquisition, which has an enterprise value of $50 billion": the combined company's).
  const other = /\b(?:transcript|frequently asked questions|FAQs?|the following (?:is (?:an? |the )?)?(?:email|e-mail|memo|letter|article|message|interview|post)|employees? (?:email|e-mail|memo|letter)|(?:article|story|interview|op-ed|column) (?:that )?(?:was )?(?:first )?(?:published|appeared|ran) (?:in|on|by)|reprinted|confidential\s*[-–—]\s*do not distribute)\b/i.test(top);
  // These may only be the release's call details: argenx's release on Forte ("Conference Call … webcast") gave "$2.2 billion"
  // and was refused, leaving $1.07B of price × shares. 107 of 1,036 announcing exhibits fell here. A deck doesn't say it "today announced".
  const maybe = /\b(?:presentation|slides?|webcast|conference call|investor call|town hall|Wall Street Journal|Reuters|Bloomberg)\b/i.test(top);
  const announces = /\b(?:today\s+(?:jointly\s+)?announced|announced\s+today)\b/i.test(flat.slice(0, 2500));
  return release || (!other && (!maybe || announces));
}

/** Exhibit names a release goes by besides "ex99": "pressrelease-111020251.htm" (TreeHouse), "exhibit991.htm", "ex_12345.htm". 542 of 2,963 names on record missed the old filter. */
const RELEASE_FILE = /ex[-_]?\d*99|exh(?:ibit)?[-_]?\d*9|[-_]99[-_.]?\d|press|release|\bpr\b|news|announc|acqui|merger|^ex_\d+/i;
/** A merger agreement, a charter, an indenture or a material contract: "ex2-1_mergeragreement.htm", "d123dex21.htm". */
const NOT_RELEASE_FILE = /(?:^|[-_\d])(?:d?ex(?:h(?:ibit)?)?[-_]?(?:2|3|4|10)(?:[-_.]\d|\d?\.htm))|agreement/i;
/** An 8-K's documents to read for a release, 99-named first, up to `cap`: each can be a long read. */
export function releaseExhibits(docs: string[], primary: string | undefined, cap: number): string[] {
  const html = docs.filter((d) => /\.html?$/i.test(d) && d !== primary);
  const named = html.filter((d) => /ex-?99|dex99/i.test(d));
  const others = html.filter((d) => !named.includes(d) && RELEASE_FILE.test(d) && !NOT_RELEASE_FILE.test(d));
  return [...named, ...others].slice(0, cap);
}
/** A contract filed under a neutral name ("ex_912345.htm"), which reads like a release to the checks above. */
export const isContractExhibit = (text: string) => /^\W*(?:EX-(?:2|3|4|10)\b|Exhibit\s+(?:2|3|4|10)\.\d)|^[^.]{0,200}\bAGREEMENT AND PLAN OF MERGER\b/.test(flatten(text).slice(0, 400));

/**
 * A release announcing the deal between `target` and `acquirer`: both are named near the top (the buyer may be a shell
 * no release names), it reads as a signed agreement, and it is not a completion or termination notice.
 */
export function announcesDeal(text: string, target: string, acquirer: string): boolean {
  const top = flatten(text).slice(0, 2500);
  const named = (name: string) => {
    const s = shortName(name);
    // ("United States Steel" is "U. S. Steel" in its own release.)
    if (s === "United States" && /\bU\.\s?S\.\s+[A-Z]/.test(top)) return true;
    return !!s && new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(top);
  };
  if (!named(target) || (!isPlaceholderBuyer(acquirer) && !named(acquirer))) return false;
  // ("AvalonBay Communities and Equity Residential Announce Merger of Equals": the release that names all six banks.)
  if (!/definitive (?:merger |arrangement )?agreement|agreement and plan of merger|merger agreement|merger of equals|(?:will|to) acquire\b|to be acquired|to combine|to merge/i.test(top)) return false;
  const headline = splitHeadline(text).headline.slice(0, 200);
  // Not the target's earnings release, which mentions the pending merger near the top and states other amounts: MGM
  // Growth Properties' Q2 2021 results gave VICI's $17.2B purchase the "$400 million" of MGP's own MGM Springfield deal.
  if (/\b(?:results|earnings|quarter|fiscal (?:year|20\d\d))\b/i.test(headline) && !/\bacqui|\bmerg|\bcombin/i.test(headline)) return false;
  return !/\b(?:complet(?:es|ed|ion)|closes|closed|closing of|terminat)/i.test(headline);
}

/** The distinctive start of a name, as a release would write it: "Pioneer", "Mr. Cooper", "First Bancshares". */
function shortName(name: string): string | null {
  const words = displayName(name).replace(/^the\s+/i, "").split(/[\s,]+/).filter(Boolean);
  if (!words.length || words[0].length < 2) return null;
  // "Amazon.com, Inc." is "Amazon" in its releases.
  words[0] = words[0].replace(/\.(?:com|ai|io|net)$/i, "");
  // "The Toronto-Dominion Bank" is "TD" or "Toronto" in its releases.
  const stem = words[0].split("-")[0];
  if (stem.length >= 4) words[0] = stem;
  return /^(?:First|United|American|National|Global|General|International|New|Southern|Northern|Western|Eastern|Central|Community|Mr\.|St\.)$/i.test(words[0]) && words[1]
    ? `${words[0]} ${words[1]}`
    : words[0];
}

/**
 * The headline terms of a release announcing the deal between `target` and `acquirer`: both are named near the top
 * (the buyer may be a shell no release names), it reads as a signed agreement, not a completion or termination,
 * and it states a value. Party extraction is not needed (the deal already has them), so releases the full parser
 * can't read still count ("ExxonMobil Announces Merger with Pioneer").
 */
export function releaseTerms(text: string, target: string, acquirer: string): AnnouncedTerms | null {
  if (!announcesDeal(text, target, acquirer)) return null;
  const flat = flatten(text);
  const top = flat.slice(0, 2500);
  // Not another deal between the two: VICI buying real estate from Golden Entertainment in a sale-leaseback.
  if (/\bsale[- ]leaseback\b/i.test(splitHeadline(text).headline)) return null;
  const value = extractValue(flat.slice(0, 6000));
  if (!value) return null;
  return { valueUsd: value.usd, valueKind: value.kind, pricePerShare: extractPrice(top), premiumPct: extractPremium(flat.slice(0, 6000)), consideration: extractConsideration(flat.slice(0, 6000)) };
}

export { saysMergerTerminated };

export async function isMergerTermination(cik: string, adsh: string, doc: string) {
  try {
    // The whole 8-K: Item 1.02 often just points to Item 1.01, where the termination agreement is described.
    return saysMergerTerminated(flatten(htmlToText(await getTextHead(archiveUrl(cik, adsh, doc), 120_000))));
  } catch {
    return false;
  }
}

/**
 * Private targets have no filings of their own. Sector and industry come from the acquirer, and an
 * announced deal closes when the acquirer files an 8-K Item 2.01 ("Completion of Acquisition").
 */
export function enrichPrivateDeal(deal: StoredDeal, acquirerSub: Submissions | null, today: string, directory?: Directory, opts: { verifyClosing?: boolean } = {}) {
  // The name it had on the deal's date (Chesapeake, not today's Expand Energy), not prose such as "Merger As previously
  // reported, Ideanomics, Inc."; today's listed name only without its filing history.
  if (acquirerSub) deal.acquirer.name = displayName(provablyUnlistedOn(acquirerSub, deal.announcedDate) ? acquirerSub.name : nameOn(acquirerSub, deal.announcedDate));
  else if (deal.acquirer.cik && directory?.byCik.get(deal.acquirer.cik)) deal.acquirer.name = displayName(directory.byCik.get(deal.acquirer.cik)!.name);
  if (acquirerSub) {
    deal.acquirer.ticker ??= acquirerSub.tickers?.[0] ?? null;
    deal.sector = sectorForBuyer(acquirerSub.cik, acquirerSub.sic, acquirerSub.name);
    deal.industry = acquirerSub.sicDescription || null;
    // Without verification (the history's light runs) the buyer's first 8-K Item 2.01 closes it; otherwise
    // privateClosing reads the 8-Ks and takes the one naming the target.
    if (deal.status === "Announced" && !opts.verifyClosing) {
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
 * A private purchase closes on the buyer's 8-K Item 2.01 that names it: a serial buyer files one for each deal, and the
 * first one after the announcement may be another (Rocket Lab's Planetary Systems took SolAero's closing date). Each
 * 8-K is read once per deal (`seen`: "close:<deal>:<accession>"); with none naming it, the later-filings search
 * (`settleFromBuyerFilings`) has its turn.
 */
/**
 * The 8-K reports this purchase, not another that mentions it: Inpixon's Item 2.01 on the Grafiti spin-off names XTI only
 * as a condition of the merger, ten weeks before it closed. The name in Item 2.01 or the Introductory Note, or (an Item
 * 2.01 pointing back to its merger text) in a past-tense sentence of Item 1.01. Whole text if it has no such headings.
 */
export function closingNames(text: string, namedIn: RegExp): boolean {
  // The term the 8-K defines for it: "Nomad Transportable Power Systems, Inc ("NOMAD")", "Stock Acquisition" by way of Item 2.01's pointer.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const term = new RegExp(`${namedIn.source}["”]?[^()"“”]{0,160}\\(\\s*(?:the\\s+)?["“]\\s*([^"”]{2,40}?)\\s*["”]\\s*\\)`, "i").exec(text)?.[1];
  const termRe = term ? new RegExp(`\\b${esc(term)}\\b`) : null;
  const named = { test: (s: string) => namedIn.test(s) || !!termRe?.test(s) };
  const part = (head: RegExp, heading?: RegExp) => {
    const titled = heading ? text.search(heading) : -1;
    const at = titled >= 0 ? titled : text.search(head);
    if (at < 0) return "";
    const rest = text.slice(at + 10);
    const end = rest.search(/\bItem\s*\d\.\d\d\b\s+[A-Z]/);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const item201 = part(/\bItem\s*2\.01\b/i, /\bItem\s*2\.01\b[\s.:\-–—]*Completion\b/i);
  const intro = part(/\bIntroductory Note\b/i);
  if (!item201 && !intro) return named.test(text);
  if (named.test(item201) || named.test(intro)) return true;
  // Dril-Quip's closing 8-K opens "Introduction", names Innovex Downhole Solutions there, and its Item 2.01 says "Pre-Merger Innovex".
  const first = text.search(/\bItem\s*\d\.\d\d\b[\s.:\-–—]+[A-Z]/);
  const lead = first > 0 ? text.slice(0, first) : "";
  if (named.test(lead) && /\b(?:mergers?|acquisition|business combination|transactions?)\b[^.]{0,80}\b(?:completed|consummated|closed)\b|\b(?:completed|consummated|closed)\b[^.]{0,80}\b(?:mergers?|acquisition|business combination|transactions?)\b/i.test(lead)) return true;
  if (
    part(/\bItem\s*1\.01\b/i)
      .split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])/)
      .some((s) => named.test(s) && /\b(?:completed|closed|consummated)\b/i.test(s))
  )
    return true;
  // An Item 2.01 that only points to Item 1.01, whose closing sentence uses another term (BurgerFi's "Stock Acquisition").
  const cut = (s: string) => {
    const at = s.search(/\bItem\s*\d\.\d\d\b[\s.:\-–—]+[A-Z]/);
    return at < 0 ? s : s.slice(0, at);
  };
  const body201 = cut(item201);
  const pointer = body201.length < 400 && /\bItem\s*1\.01\b/i.test(body201) && /\bincorporated\b/i.test(body201);
  const body101 = cut(part(/\bItem\s*1\.01\b/i));
  return pointer && named.test(body101) && /\bOn\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4},[^.]{0,120}\b(?:completed|consummated|closed)\b/.test(body101);
}

/**
 * The buyer took the target's name after the deal and had it by this 8-K: there the name is a subsidiary's, about something else. Peck Company bought iSun
 * Energy in January 2021 with no Item 2.01 and became iSun, Inc.; its October 8-K on SunCommon lists "iSun Energy LLC" as a loan guarantor, which closed
 * the deal nine months late. Its 10-K then dates it. Not an 8-K from before the new name (RumbleOn's on RideNow, whose name it took in 2025).
 */
export function buyerNowNamedForTarget(buyer: Pick<Submissions, "name" | "formerNames">, targetName: string, announcedDate: string, filedDate: string): boolean {
  const first = (s: string) => s.trim().split(/[\s,]+/)[0].toLowerCase();
  const word = first(targetName);
  return first(nameOn(buyer, filedDate)) === word && first(nameOn(buyer, announcedDate)) !== word;
}

async function privateClosing(deal: StoredDeal, acquirerSub: Submissions, seen: Set<string>) {
  const name = searchName(cleanPartyName(deal.target.name));
  if (!name) return;
  const named = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const done = recentFilings(acquirerSub)
    .filter((f) => /^8-K/.test(f.form) && /\b2\.01\b/.test(f.items) && f.date > deal.announcedDate && f.date <= shiftDate(deal.announcedDate, 400))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const f of done.slice(0, 4)) {
    const key = `close2:${deal.id}:${f.adsh}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (buyerNowNamedForTarget(acquirerSub, name, deal.announcedDate, f.date)) continue;
    try {
      const text = flatten(htmlToText(await getTextHead(archiveUrl(acquirerSub.cik, f.adsh, f.primaryDocument), 150_000)));
      if (closingNames(text, named)) {
        deal.status = "Closed";
        deal.statusDate = statedClosingDay(text, named, deal.announcedDate, f.date) ?? f.date;
        return;
      }
    } catch {
      // Unreadable: the later-filings search may still settle it.
    }
  }
}

/**
 * A private purchase the buyer walked away from: its 8-K Item 1.02 says the merger agreement was terminated and names
 * the target (Adobe / Figma, December 2023). Each 8-K is read once per deal (`seen`: "term:<deal>:<accession>").
 */
async function privateTermination(deal: StoredDeal, acquirerSub: Submissions, seen: Set<string>) {
  const core = cleanPartyName(deal.target.name).replace(/,?\s+(?:Inc|LLC|Ltd|Limited|Corp|Corporation|Co|L\.?P|plc|S\.A|N\.V|GmbH|AG)\.?$/i, "");
  if (core.length < 4) return;
  const named = new RegExp(`\\b${core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const ends = recentFilings(acquirerSub)
    .filter((f) => /^8-K/.test(f.form) && /\b1\.02\b/.test(f.items) && f.date > deal.announcedDate && f.date <= shiftDate(deal.announcedDate, 730))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const f of ends.slice(0, 4)) {
    const key = `term:${deal.id}:${f.adsh}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const text = flatten(htmlToText(await getTextHead(archiveUrl(acquirerSub.cik, f.adsh, f.primaryDocument), 120_000)));
      if (saysMergerTerminated(text) && named.test(text)) {
        deal.status = "Terminated";
        deal.statusDate = f.date;
        return;
      }
    } catch {
      // Unreadable: looked at again on a rebuild.
    }
  }
}

/** Bump to look again for the announcement of every private deal dated at its closing (`announceCheck`). */
export const ANNOUNCE_CHECK_VERSION = 1;

/**
 * A private purchase first seen at its closing, whose release says "previously announced" and gives no date (128 of them in November 2026: Planet
 * Fitness / Sunshine, CURO / First Heritage, Deluxe / First American). The date is the closing, and any share-price figure was measured around it.
 * The announcement is in the buyer's earlier 8-Ks: the oldest within two years that says it will buy this company. Its own date when it gives one within
 * ten days before the filing (`ownReleaseDay`: the release or the 8-K beside it, a hit of the same filing), else the filing date, as for a signing 8-K.
 */
export async function findAnnouncement(deal: StoredDeal, acquirerCik: string) {
  const name = searchName(cleanPartyName(deal.target.name));
  if (!name) {
    deal.announceCheck = ANNOUNCE_CHECK_VERSION;
    return;
  }
  let hits: FtsHit[];
  try {
    hits = await fullTextSearch({ q: nameForms(name).map((n) => `"${n}"`).join(" OR "), forms: ["8-K"], from: shiftDate(deal.announcedDate, -730), to: shiftDate(deal.announcedDate, -1), ciks: [acquirerCik] });
  } catch {
    return; // tried again next run
  }
  deal.announceCheck = ANNOUNCE_CHECK_VERSION;
  for (const h of hits.sort((a, b) => a.fileDate.localeCompare(b.fileDate)).slice(0, 6)) {
    let text: string;
    try {
      text = htmlToText(await getText(archiveUrl(acquirerCik, h.adsh, h.file)));
    } catch {
      delete deal.announceCheck; // a download failed: look again next run
      continue;
    }
    if (!readAnnouncement(text, name)) continue;
    let day = ownReleaseDay(text, h.fileDate);
    for (const other of hits.filter((o) => o.adsh === h.adsh && o.file !== h.file).slice(0, 2)) {
      if (day) break;
      day = await getText(archiveUrl(acquirerCik, other.adsh, other.file)).then((t) => ownReleaseDay(htmlToText(t), h.fileDate)).catch(() => undefined);
    }
    deal.announcedDate = day ?? h.fileDate;
    delete deal.dateIsClosing;
    return;
  }
}

/**
 * Bump to look every open private deal up again in its buyer's filings (`closeCheck`).
 * 2: six documents instead of three, "our May 2022 acquisition of X", three-letter acronyms ("NFP").
 */
export const CLOSE_CHECK_VERSION = 2;
const SETTLE_FORMS = ["8-K", "10-Q", "10-K", "10-KT", "20-F", "40-F", "6-K"];
const PERIODIC_FORMS = ["10-Q", "10-K", "10-KT", "20-F", "40-F"];

/** Open and 60+ days old: looked up once (per version), then every 90 days while under three years old. */
function settleDue(deal: StoredDeal, today: string) {
  const age = (Date.parse(today) - Date.parse(deal.announcedDate)) / 86_400_000;
  if (!OPEN.includes(deal.status) || age < 60) return false;
  if (deal.closeCheck !== CLOSE_CHECK_VERSION || !deal.closeCheckedAt) return true;
  return age <= 3 * 365 && (Date.parse(today) - Date.parse(deal.closeCheckedAt)) / 86_400_000 >= 90;
}

/**
 * Most buyers never report a private purchase on an 8-K Item 2.01, so it stayed "Announced" for years (DoorDash /
 * Wolt, Aon / NFP). Their later filings say it closed ("On March 21, 2022, we completed the acquisition of Linode")
 * or ended ("terminated its agreement to acquire Tower Semiconductor"): full-text search of the buyer's own filings,
 * then the sentence is read (`readStatement`: plain past tense, not "if", "may" or "expected"). The date only when
 * that sentence states one, or says "today" in an 8-K / 6-K release (its filing date); otherwise it stays blank.
 */
export async function settleFromBuyerFilings(deal: StoredDeal, acquirerCik: string, today: string, kinds: readonly ("closed" | "ended")[] = ["closed", "ended"]) {
  deal.closeCheck = CLOSE_CHECK_VERSION;
  deal.closeCheckedAt = today;
  const name = searchName(cleanPartyName(deal.target.name));
  if (!name) return;
  // The short form ("acquire Tower") counts only in a document that also gives the full name.
  const short = firstNameWord(name);
  for (const kind of kinds) {
    const phrasesFor = kind === "closed" ? completedPhrases : endedPhrases;
    const phrases = phrasesFor(name);
    const shortPhrases = short ? phrasesFor(short) : [];
    let hits: FtsHit[];
    try {
      hits = await fullTextSearch({ q: [...phrases, ...shortPhrases].map((p) => `"${p}"`).join(" OR "), forms: SETTLE_FORMS, from: deal.announcedDate, to: today, ciks: [acquirerCik] });
    } catch {
      deal.closeCheckedAt = null; // try again next run
      return;
    }
    // Full-text search matches loosely (DoorDash's closing 8-K never says "completed the acquisition of Wolt"), so up
    // to six of its hits are read, oldest first; a dated statement wins over an undated one ("our May 2022 acquisition
    // of Wolt" in a 10-Q, "On May 31, 2022, we completed …" in the 10-K).
    let undated: string | null | undefined;
    for (const h of hits.sort((a, b) => a.fileDate.localeCompare(b.fileDate)).slice(0, 6)) {
      let text: string;
      try {
        text = htmlToText(await getText(archiveUrl(acquirerCik, h.adsh, h.file)));
      } catch {
        deal.closeCheckedAt = null; // a download failed: look again next run
        continue;
      }
      let r = readStatement(text, phrases);
      if (!r.found && shortPhrases.length && text.toLowerCase().includes(name.toLowerCase())) r = readStatement(text, shortPhrases);
      if (!r.found && kind === "closed") r = readPastReference(text, name);
      if (!r.found) continue;
      // (After the announcement: "the agreement dated as of June 17, 2021 … completed" is the signing, read again. Freehold Bank, Planetary Systems.)
      const stated = r.date && r.date > deal.announcedDate && r.date <= h.fileDate ? r.date : null;
      const date = stated ?? (r.today && /^(?:8-K|6-K)/.test(h.form) ? h.fileDate : null);
      if (date) {
        deal.status = kind === "closed" ? "Closed" : "Terminated";
        deal.statusDate = date;
        return;
      }
      if (undated === undefined) undated = null;
    }
    if (undated === null) {
      deal.status = kind === "closed" ? "Closed" : "Terminated";
      deal.statusDate = null;
      return;
    }
  }
  // Nothing in those exact words. The buyer's next reports, by the target's name alone, read more loosely. The reports themselves, not their exhibits:
  // a merger agreement filed with a 10-Q says a great deal about closing.
  if (!kinds.includes("closed")) return;
  let reports: FtsHit[];
  try {
    reports = await fullTextSearch({ q: nameForms(name).map((n) => `"${n}"`).join(" OR "), forms: PERIODIC_FORMS, from: shiftDate(deal.announcedDate, 1), to: today, ciks: [acquirerCik] });
  } catch {
    deal.closeCheckedAt = null;
    return;
  }
  let found = false;
  for (const h of reports.filter((h) => !/^EX-/i.test(h.fileType)).sort((a, b) => a.fileDate.localeCompare(b.fileDate)).slice(0, 6)) {
    let text: string;
    try {
      text = htmlToText(await getText(archiveUrl(acquirerCik, h.adsh, h.file)));
    } catch {
      deal.closeCheckedAt = null;
      continue;
    }
    const r = readLooseCompletion(text, name);
    if (!r.found) {
      const off = readLooseEnd(text, name);
      if (off.found) {
        deal.status = "Terminated";
        deal.statusDate = off.date && off.date > deal.announcedDate && off.date <= h.fileDate ? off.date : null;
        return;
      }
      continue;
    }
    found = true;
    // (The same day counts here: bought and closed at once, "On April 1, 2024, the Company acquired …".)
    const stated = r.date && r.date >= deal.announcedDate && r.date <= h.fileDate ? r.date : null;
    if (stated) {
      deal.status = "Closed";
      deal.statusDate = stated;
      return;
    }
  }
  if (found) {
    deal.status = "Closed";
    deal.statusDate = null;
  }
}

/**
 * Deal protections from the target's merger 8-K (Item 1.01 summary of the merger agreement), with gaps filled
 * from its merger proxy (parseProxyTerms: fees from its summary, lenders from anywhere in it, never the negotiation's
 * story). `settled` once both documents have been read.
 */
export async function readDealTerms(deal: StoredDeal, sub: Submissions): Promise<{ terms: DealTerms | null; settled: boolean }> {
  const DAY = 86_400_000;
  const lo = new Date(Date.parse(deal.announcedDate) - 7 * DAY).toISOString().slice(0, 10);
  const hi = new Date(Date.parse(deal.announcedDate) + 20 * DAY).toISOString().slice(0, 10);
  const names = { target: deal.target.name, acquirer: deal.acquirer.name };
  const filings = recentFilings(sub);
  // An agreement signs before it ends: an 8-K filed from its end date on is the winner's (Enodia's end date is Aurinia's signing, Kezar).
  const ended = deal.status === "Terminated" ? deal.statusDate : null;

  let fromEightK: DealTerms | null = null;
  const eightKs = filings.filter((f) => /^8-K/.test(f.form) && /\b1\.01\b/.test(f.items) && f.date >= lo && f.date <= hi && (!ended || f.date < ended)).sort((a, b) => a.date.localeCompare(b.date));
  for (const f of eightKs.slice(0, 3)) {
    const section = item101(htmlToText(await getText(archiveUrl(sub.cik, f.adsh, f.primaryDocument))));
    if (!section) continue; // an unrelated agreement (a credit facility, an employment contract)
    fromEightK = parseDealTerms(section, names);
    break;
  }

  let fromProxy: DealTerms | null = null;
  const proxy = await proxyOfThisBuyer(sub, deal);
  if (proxy) {
    const text = htmlToText(await getTextHead(archiveUrl(sub.cik, proxy.adsh, proxy.primaryDocument), 1_200_000));
    fromProxy = parseProxyTerms(text, names);
  }

  if (!fromEightK && !fromProxy) return { terms: null, settled: false };
  // A raised offer's proxy has the fees of the signed terms; the first signing's 8-K had an earlier deal's (Circor: $42.75M, not $28M).
  const terms = deal.termsAmended && fromProxy ? combineTerms(fromProxy, fromEightK ?? fromProxy, deal.valueUsd) : combineTerms(fromEightK ?? fromProxy!, fromProxy ?? fromEightK!, deal.valueUsd);
  const empty = terms.targetFeeUsd == null && terms.reverseFeeUsd == null && terms.goShop == null && terms.financingCondition == null && !terms.financingBanks.length;
  return { terms: empty ? null : terms, settled: !!fromEightK && !!fromProxy };
}

/**
 * `light` (the 2015–2020 history backfill): skip the two heaviest reads, fairness opinions (the full merger proxy)
 * and deal protections (8-K + proxy), which would be gigabytes over six years. Status, sector, names, premium,
 * advisers, milestones and multiples are still filled.
 */
export async function enrichDeal(deal: StoredDeal, sub: Submissions | null, today: string, directory?: Directory, opts: { light?: boolean; buyerSub?: Submissions | null } = {}) {
  correctKnownClosing(deal);
  // Official SEC registrant names beat names parsed from prose: the name it had on the deal's date, as for the target.
  if (opts.buyerSub) deal.acquirer.name = displayName(provablyUnlistedOn(opts.buyerSub, deal.announcedDate) ? opts.buyerSub.name : nameOn(opts.buyerSub, deal.announcedDate));
  else if (deal.acquirer.cik && directory?.byCik.get(deal.acquirer.cik)) deal.acquirer.name = displayName(directory.byCik.get(deal.acquirer.cik)!.name);
  if (sub) {
    // The name it had when the deal was announced, not the one it took after being bought.
    deal.target.name = displayName(nameOn(sub, deal.announcedDate));
    deal.target.ticker ??= sub.tickers?.[0] ?? null;
    deal.sector = sectorForCompany(sub.cik, sub.sic, sub.name);
    deal.industry = sub.sicDescription || null;
    // A Closed status set before STATUS_RULE_VERSION is checked once more for an earlier termination.
    const recheck = deal.status === "Closed" && deal.statusRule !== STATUS_RULE_VERSION;
    if ((deal.status !== "Terminated" && deal.status !== "Closed") || recheck) {
      const after = recentFilings(sub)
        .filter((f) => f.date >= deal.announcedDate)
        .sort((a, b) => a.date.localeCompare(b.date));
      const closed = closingFiling(after, deal.announcedDate);
      // No such filing: an 8-K's own words, for a company that sold out and stays listed (Senti, Sonim). The day it states.
      let statedClosing: string | null = null;
      if (!closed && !recheck) {
        for (const f of closingsToRead(after, deal.announcedDate)) {
          try {
            statedClosing = completedSigningOn(htmlToText(await getTextHead(archiveUrl(sub.cik, f.adsh, f.primaryDocument), 150_000)), deal.announcedDate, f.date);
          } catch {
            // Unreadable: read again next run.
          }
          if (statedClosing) break;
        }
      }
      const closedOn = closed?.date ?? statedClosing;
      // Whichever came first: a merger termination before the delisting ends the deal (JetBlue / Spirit was
      // terminated in March 2024; Spirit's Form 25 in 2026, after its bankruptcy, closed nothing).
      // Not one filed around the closing (credit agreements are terminated "in connection with the Merger"), and not
      // one the deal recovered from: a merger proxy or tender filed afterwards means it went on (CP's first agreement
      // for Kansas City Southern ended in May 2021, was signed again in September and closed in 2023). Only a new
      // target-side document: an amendment reports the end (Battalion's last SC 13E3/A), and an S-4 registers another
      // buyer's shares or the company's own for a new deal (HomeStreet's with Mechanics Bank, after FirstSun walked away).
      let terminated: (typeof after)[number] | undefined;
      const ends = after.filter((f) => /^8-K/.test(f.form) && /\b1\.02\b/.test(f.items) && f.date > deal.announcedDate && (!closedOn || f.date < shiftDate(closedOn, -30)));
      // A revival comes within a year (CP and KCS signed again four months on); a proxy years later is another deal
      // (Sphere 3D's 2026 merger proxy kept its 2022 termination with Gryphon "Pending").
      for (const f of ends.slice(0, 3)) {
        if (after.some((g) => REVIVAL_FORMS.test(g.form) && g.date > f.date && g.date <= shiftDate(f.date, 365) && (!closedOn || g.date < closedOn))) continue;
        if (await isMergerTermination(sub.cik, f.adsh, f.primaryDocument)) {
          terminated = f;
          break;
        }
      }
      const pending = after.find((f) => PENDING_FORMS.test(f.form));
      if (terminated) {
        deal.status = "Terminated";
        deal.statusDate = terminated.date;
      } else if (recheck) {
        // Stays Closed.
      } else if (closedOn) {
        deal.status = "Closed";
        deal.statusDate = closedOn;
      } else if (pending) {
        deal.status = "Pending";
        deal.statusDate = pending.date;
      }
    }
    if (deal.status === "Closed") deal.statusRule = STATUS_RULE_VERSION;
  }
  deal.statusCheckedAt = today;

  // Deals first seen in an 8-K lack the premium and advisors; the target's proxy states both, and a stock deal's value per
  // share at announcement. A newer reader (PROXY_PARSER_VERSION) looks again at deals still missing one of them.
  if (sub && proxyWanted(deal)) {
    // (Null: an opening couldn't be read. Tried again on the next run.)
    const proxy = await proxyOfThisBuyer(sub, deal).catch(() => null);
    if (proxy) {
      try {
        const text = htmlToText(await getTextHead(archiveUrl(sub.cik, proxy.adsh, proxy.primaryDocument), 900_000));
        const p = parseMergerProxy(text, deal.target.name, deal.acquirer);
        if (proxyStatesCurrentPrice(deal, proxy.date)) deal.premiumPct ??= p.premiumPct;
        moveBuyerOffTarget(deal);
        // (Not a bank the release gave the buyer: "Parent engaged XMS Capital Partners" in Ultralife's 14D-9. Then "a bank advises one side" took it off the buyer.)
        if (!deal.targetAdvisors.length) deal.targetAdvisors = p.targetAdvisors.filter((b) => !deal.acquirerAdvisors.includes(b));
        // A joint proxy also has the buyer's opinion ("Opinion of Nicolet's Financial Advisor"). Where the target's own heading
        // names its banks, they join the target's list whatever a release put there ("Opinion of TriState Capital's Financial Advisor": Stephens),
        // and one named only under the buyer's leaves it (Morgan Stanley and Wells Fargo advised
        // Union Pacific, not Norfolk Southern). Otherwise a bank stays on the target's side.
        if (p.targetHeadingAdvisors.length) {
          deal.targetAdvisors = [...new Set([...deal.targetAdvisors, ...p.targetHeadingAdvisors.filter((b) => !deal.acquirerAdvisors.includes(b))])];
          const moved = p.acquirerAdvisors.filter((b) => deal.targetAdvisors.includes(b) && !p.targetHeadingAdvisors.includes(b));
          deal.targetAdvisors = deal.targetAdvisors.filter((b) => !moved.includes(b));
          deal.acquirerAdvisors = [...new Set([...deal.acquirerAdvisors, ...moved])];
        }
        if (!deal.acquirerAdvisors.length) deal.acquirerAdvisors = p.acquirerAdvisors.filter((b) => !deal.targetAdvisors.includes(b));
        // The value then follows from the target's share count (financials, below): NextEra / Dominion, II-VI / Coherent.
        if (deal.pricePerShare == null && deal.consideration !== "Cash" && p.impliedPerShare != null) {
          deal.pricePerShare = p.impliedPerShare;
          if (deal.valueUsd == null) deal.financialsCheckedAt = null;
        }
        deal.proxyParser = PROXY_PARSER_VERSION;
        const src = `${proxy.adsh}:${proxy.primaryDocument}`;
        if (!deal.sources.includes(src)) deal.sources.push(src);
        deal.proxyCheckedAt = today;
      } catch {
        // Try again on the next run.
      }
    } else if (proxy === undefined && (deal.status === "Closed" || deal.status === "Terminated")) {
      deal.proxyCheckedAt = today; // No proxy will come now.
      deal.proxyParser = PROXY_PARSER_VERSION;
    }
  }

  // Fairness opinions (valuation ranges, DCF inputs, fees) from the full proxy. A preliminary proxy is
  // re-read once the definitive one is filed; the search ends with a definitive proxy or when the deal is over.
  if (sub && !opts.light && deal.fairnessParser !== FAIRNESS_PARSER_VERSION) {
    // A newer parser re-reads the proxy even if the search had finished.
    deal.fairnessCheckedAt = null;
    deal.fairnessAdsh = null;
    deal.fairness = undefined;
    deal.proxySections = undefined;
    deal.meetingDate = null;
    deal.fairnessParser = FAIRNESS_PARSER_VERSION;
  }
  if (sub && !opts.light && !deal.fairnessCheckedAt) {
    const proxy = ownFilings(recentFilings(sub), deal)
      .filter((f) => FAIRNESS_FORMS.includes(f.form))
      .sort((a, b) => FAIRNESS_FORMS.indexOf(a.form) - FAIRNESS_FORMS.indexOf(b.form) || b.date.localeCompare(a.date))[0];
    if (proxy && proxy.adsh !== deal.fairnessAdsh) {
      try {
        const url = archiveUrl(sub.cik, proxy.adsh, proxy.primaryDocument);
        const html = await getText(url);
        // Jump links from its table of contents (Background, the banks' opinions, projections …), at no extra cost.
        const sections = proxySections(html, url);
        if (sections.length) deal.proxySections = sections;
        const text = htmlToText(html);
        // A vote's 8-K comes on or after the meeting the definitive proxy calls (milestones, below).
        if (proxy.form === "DEFM14A") deal.meetingDate = meetingDateOf(text, proxy.date);
        const opinions = parseFairness(text, { acquirerName: deal.acquirer.name, offerPrice: deal.pricePerShare, targetName: deal.target.name, consideration: deal.consideration });
        if (opinions.length) deal.fairness = opinions;
        deal.targetAdvisors.push(...banksOfTheTarget(opinions, deal, text.slice(0, 25000)));
        if (!deal.acquirerAdvisors.length) deal.acquirerAdvisors = buyerBanksInProxy(text, deal.acquirer.name).filter((b) => !deal.targetAdvisors.includes(b));
        deal.fairnessAdsh = proxy.adsh;
      } catch {
        // Try again on the next run.
      }
    }
    const final = proxy && proxy.form !== "PREM14A" && proxy.adsh === deal.fairnessAdsh;
    if (final || deal.status === "Closed" || deal.status === "Terminated") deal.fairnessCheckedAt = today;
  }

  // Milestones come from the same filing index (no extra requests), after the fairness step because of its meeting date.
  if (sub) {
    const ended = deal.status === "Terminated";
    deal.milestones = milestonesFrom(recentFilings(sub), deal.announcedDate, ended ? (deal.statusDate ?? null) : null, {
      ended,
      closedOn: deal.status === "Closed" ? deal.statusDate : null,
      meetingDate: deal.meetingDate,
    });
  }

  // Deal protections (break fees, go-shop, financing). Re-read when the parser changes.
  if (sub && !opts.light && deal.termsParser !== TERMS_PARSER_VERSION) {
    deal.termsCheckedAt = null;
    deal.termsParser = TERMS_PARSER_VERSION;
  }
  if (sub && !opts.light && !deal.termsCheckedAt) {
    try {
      const { terms, settled } = await readDealTerms(deal, sub);
      if (terms) deal.terms = terms;
      if (settled || deal.status === "Closed" || deal.status === "Terminated") deal.termsCheckedAt = today;
    } catch {
      // Try again on the next run.
    }
  }

  if ((!deal.financialsCheckedAt || deal.financialsVersion !== FINANCIALS_VERSION) && deal.target.cik) {
    // As of the deal's first filing, when that's within days of a date moved back to its signing or release: a 10-Q filed
    // with the announcement counts, as it did for the banks (SJI, Perficient, Cornerstone OnDemand).
    const first = deal.filings[0]?.filedDate;
    const asOf = first && first > deal.announcedDate && Date.parse(first) - Date.parse(deal.announcedDate) <= 10 * 86_400_000 ? first : deal.announcedDate;
    const fin = await getTargetFinancials(deal.target.cik, asOf);
    const m = computeMultiples(deal, fin, { sic: sub?.sic, name: deal.target.name });
    deal.enterpriseValueUsd = m.enterpriseValueUsd;
    deal.evEbitda = m.evEbitda;
    deal.evEbitdaReported = m.evEbitdaReported;
    deal.evRevenue = m.evRevenue;
    // Not price × all the shares when the buyer already holds part of them: its share if stated, else blank (Avangrid, Continental, Tribune).
    if (deal.valueUsd == null && m.impliedEquityUsd != null && m.impliedEquityUsd >= 1e6 && deal.buyIn !== true) {
      deal.valueUsd = Math.round(m.impliedEquityUsd * (typeof deal.buyIn === "number" ? deal.buyIn / 100 : 1));
      deal.valueKind = "equity";
      deal.valueImplied = true;
    }
    deal.financialsCheckedAt = today;
    deal.financialsVersion = FINANCIALS_VERSION;
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
  /** Deals that got a headline value from their announcement releases. */
  valuesFound: number;
  /** Deals whose acquisition-vehicle buyer was replaced by the sponsor behind it. */
  sponsorsFound: number;
  /** Deals that got their buyer's financial adviser from the announcement releases. */
  advisorsFound: number;
  /** Buyers stored by name only that were linked to their SEC registrant. */
  buyersLinked: number;
}

export async function ingestDeals(
  state: State,
  opts: {
    from: string;
    to: string;
    directory: Directory;
    log: (s: string) => void;
    today: string;
    checkpoint?: () => Promise<void>;
    light?: boolean;
    /** Skip the document search: only look up merger-proxy filers that have no deal (after a backstop change). */
    backstopOnly?: boolean;
  },
): Promise<DealRunStats> {
  const { log, directory } = opts;
  const stats: DealRunStats = { documents: 0, parsed: 0, newDeals: 0, enriched: 0, privateDeals: 0, searchGaps: [], valuesFound: 0, sponsorsFound: 0, advisorsFound: 0, buyersLinked: 0 };
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
   * A record read backwards: its "target" filed no target's document (merger proxy, 14D-9, 13E-3) in the 18 months after,
   * but registered shares or launched a tender (S-4, F-4, SC TO-T), and the "buyer" filed the target's documents
   * (MorphoSys's 14D-9 for Novartis's tender, DISH's information statement for EchoStar). The roles are swapped, or the
   * record dropped when the deal is already tracked the right way round.
   */
  const reverseRoles = async (deal: StoredDeal, sub: Submissions): Promise<"swapped" | "dropped" | "private" | null> => {
    const TARGET_SIDE = /^(?:PREM14A|DEFM14A|PREM14C|DEFM14C|SC 14D9|SC14D9|SC 13E3)(?:\/A)?$/;
    const BUYER_SIDE = /^(?:S-4|F-4|SC TO-T)(?:\/A)?$/;
    const within = (f: { date: string }) => f.date >= deal.announcedDate && f.date <= shiftDate(deal.announcedDate, 550);
    const own = recentFilings(sub).filter(within);
    if (own.some((f) => TARGET_SIDE.test(f.form)) || !own.some((f) => BUYER_SIDE.test(f.form))) return null;
    const otherCik = deal.acquirer.cik ?? (await resolveRegistrant(cleanPartyName(deal.acquirer.name), deal.announcedDate))?.cik ?? null;
    if (!otherCik && isPrivateTargetName(cleanPartyName(deal.acquirer.name), "")) {
      // The other party has no SEC filer at all: a private company the registrant is buying with its own shares (Sphere 3D
      // registered them on an F-4 to buy Gryphon). It becomes a private target, which the private checks then settle.
      dropped.add(deal.id);
      const base = `p-${normalizeName(deal.acquirer.name).replace(/\s+/g, "-")}-${deal.announcedDate}`;
      let id = base;
      for (let n = 2; state.deals.some((d) => d.id === id); n++) id = `${base}-${n}`;
      const seller = deal.acquirer;
      Object.assign(deal, { id, privateTarget: true, premiumPct: null, pricePerShare: null, enterpriseValueUsd: null, evEbitda: null, evEbitdaReported: null, evRevenue: null, status: "Announced", statusDate: null });
      // Not the new buyer's shares: back to the run's parked list (ingest/reactions.ts).
      delete deal.reaction;
      deal.reactionCheckedAt = undefined;
      deal.acquirer = { name: displayName(nameOn(sub, deal.announcedDate)), cik: deal.target.cik, ticker: deal.target.ticker };
      deal.target = { name: seller.name, cik: null, ticker: null };
      [deal.acquirerAdvisors, deal.targetAdvisors] = [deal.targetAdvisors, deal.acquirerAdvisors];
      deal.milestones = deal.terms = deal.fairness = undefined;
      deal.statusCheckedAt = null;
      deal.registrantCheck = REGISTRANT_CHECK_VERSION;
      return "private";
    }
    if (!otherCik || otherCik === deal.target.cik) return null;
    const other = await submissions(otherCik);
    if (!other || !recentFilings(other).some((f) => within(f) && TARGET_SIDE.test(f.form))) return null;
    const near = (d: StoredDeal) => Math.abs(Date.parse(d.announcedDate) - Date.parse(deal.announcedDate)) < 60 * 86_400_000;
    if (state.deals.some((d) => d !== deal && d.target.cik === otherCik && near(d))) {
      drop(deal);
      return "dropped";
    }
    dropped.add(deal.id);
    const base = `${otherCik}-${deal.announcedDate}`;
    let id = base;
    for (let n = 2; state.deals.some((d) => d.id === id); n++) id = `${base}-${n}`;
    const [buyer, seller] = [deal.target, deal.acquirer];
    deal.id = id;
    // The reaction was the old "buyer's" shares: it goes back to the run's parked list (ingest/reactions.ts).
    delete deal.reaction;
    deal.reactionCheckedAt = undefined;
    deal.acquirer = { name: buyer.name, cik: buyer.cik, ticker: buyer.ticker };
    deal.target = { name: displayName(nameOn(other, deal.announcedDate)), cik: otherCik, ticker: other.tickers?.[0] ?? seller.ticker ?? null };
    [deal.acquirerAdvisors, deal.targetAdvisors] = [deal.targetAdvisors, deal.acquirerAdvisors];
    deal.status = "Announced";
    deal.statusDate = null;
    deal.premiumPct = null;
    deal.milestones = deal.terms = deal.fairness = deal.proxySections = undefined;
    deal.fairnessAdsh = deal.meetingDate = null;
    deal.statusCheckedAt = deal.financialsCheckedAt = deal.proxyCheckedAt = deal.fairnessCheckedAt = deal.termsCheckedAt = null;
    return "swapped";
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
    // EDGAR's lookup wants the start of the registered name: "ENABLE MIDSTREAM Energy" finds nothing,
    // "Enable Midstream" finds Enable Midstream Partners. The match is then checked against that core name.
    const core = coreName(name);
    // …and without the legal suffix: "Equitrans Midstream Corporation" finds nothing, "Equitrans Midstream" finds
    // EQUITRANS MIDSTREAM CORP.
    const bare = q.replace(/\s+(?:Corporation|Corp|Incorporated|Inc|Company|Co|Limited|Ltd|plc|LLC|LP|L P|NV|SA|AG)$/i, "");
    // "MidWest One Financial Group" is registered as MIDWESTONE: join a camel-case first word to the next.
    const joined = bare.replace(/^(\w*[a-z][A-Z]\w*) (\w+)/, "$1$2");
    let found: Resolved | null = null;
    // Checked against the name it had then ("Beacon" in 2025 was not Berkshire Hills Bancorp), or a week before for a
    // record dated at the closing (Equitrans was renamed the day it closed), and it must have been listed and in the
    // middle of being bought.
    const accepts = async (cik: string, query: string) => {
      const sub = await submissions(cik);
      const named = !!sub && (registrantMatches(nameOn(sub, date), query) || registrantMatches(nameOn(sub, shiftDate(date, -7)), query));
      return sub && sub.sic !== "6770" && named && takenOverAround(sub, date, opts.today) && (await listedThen(sub, date)) ? sub : null;
    };
    try {
      search: for (const query of [...new Set([q, core, bare, joined])]) {
        // The exact name first: "Independent Bank Group" is INDEPENDENT BANK GROUP (Texas), which "Independent Bank" plus
        // the descriptor "Group" would also let INDEPENDENT BANK CORP (Massachusetts) match.
        const rank = (name: string) => {
          const bareName = withoutStateTag(name);
          return identicalNames(bareName, query) ? 3 : sameCompany(bareName, query) ? 2 : registrantMatches(bareName, query) ? 1 : 0;
        };
        const candidates = (await lookupCompanies(query))
          .filter((c) => rank(c.name) > 0)
          .sort((a, b) => rank(b.name) - rank(a.name))
          .slice(0, 3);
        for (const c of candidates) {
          const sub = await accepts(c.cik, query);
          if (sub) {
            found = { cik: c.cik, ticker: sub.tickers?.[0] ?? null, listedInUs: true };
            break search;
          }
        }
      }
      // EDGAR's name lookup knows only today's names ("Equitrans Midstream Corp" is now "Midstream Co LLC"): search the
      // merger proxies and delisting forms that quote the name, around the deal.
      if (!found && bare.split(" ").length >= 2) {
        const hits = await fullTextSearch({ q: `"${bare}"`, forms: ["DEFM14A", "PREM14A", "SC 14D9", "25-NSE"], from: shiftDate(date, -550), to: shiftDate(date, 120) });
        for (const cik of [...new Set(hits.flatMap((h) => h.ciks.map(trimCik)))].slice(0, 4)) {
          const sub = await accepts(cik, bare);
          if (sub) {
            found = { cik, ticker: sub.tickers?.[0] ?? null, listedInUs: true };
            break;
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

  /**
   * The registrant behind a buyer stored by name only. Today's listed-company file misses buyers renamed since ("Exxon
   * Mobil Corporation" is now ExxonMobil Holdings Corp) or listed under another ticker (Nicolet: NCBS on Nasdaq in
   * 2021, NIC on the NYSE now), so EDGAR's name lookup is asked, and a registrant counts only if it had that name and
   * was exchange-listed on the deal date. Today's ticker comes from the listed-company file, by CIK or, after a
   * holding-company reorganization, by the same name without spaces (XOM). Network errors propagate (checked again).
   */
  const resolveBuyer = async (name: string, date: string): Promise<{ cik: string; ticker: string | null } | null> => {
    const q = name.replace(/['’.,]/g, "").replace(/\s+/g, " ").trim();
    const bare = q.replace(/\s+(?:Corporation|Corp|Incorporated|Inc|Company|Co|Limited|Ltd|plc|LLC|LP|L P|NV|SA|AG)$/i, "");
    const squash = (s: string) => normalizeName(s).replace(/\s+/g, "");
    const tried = new Set<string>();
    for (const query of [...new Set([q, bare, coreName(name)])]) {
      if (squash(query).length < 4) continue;
      for (const c of (await lookupCompanies(query)).slice(0, 3)) {
        if (tried.has(c.cik)) continue;
        tried.add(c.cik);
        const sub = await submissions(c.cik);
        if (!sub || sub.sic === "6770") continue;
        // (Without EDGAR's state tag: "QUALCOMM INC/DE", "ONEOK INC /NEW/".)
        const then = withoutStateTag(nameOn(sub, date));
        if (!registrantMatches(then, name) && !registrantMatches(then, bare) && squash(then) !== squash(name)) continue;
        if (notTheSponsor(name, then)) continue; // "Advent" is not Advent Technologies Holdings

        if (!(await listedThen(sub, date))) continue;
        const cik = trimCik(sub.cik);
        const successor = [...directory.byCik.values()].find((x) => US_LISTED.test(x.exchange ?? "") && squash(x.name) === squash(then));
        return { cik, ticker: directory.byCik.get(cik)?.ticker ?? sub.tickers?.[0] ?? successor?.ticker ?? null };
      }
    }
    return null;
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
    // The buyer too: `Francisco Partners ("FP")` … "FP has entered into a definitive agreement to acquire Weave". Not a
    // ticker the text lists or a name of its own ("IBM (NYSE: IBM)").
    const an = parsed.acquirer.name;
    if (/^[A-Z]{2,6}$/.test(an) && text && !listedInText(an) && !directory.byName.has(normalizeName(an))) {
      const full = expandAbbreviation(an, text);
      if (full && !sameCompany(full, parsed.target.name)) parsed = { ...parsed, acquirer: { ...parsed.acquirer, name: full, ticker: null } };
    }
    // "Elon Musk SAN FRANCISCO" -> "Elon Musk"; "CANADIAN PACIFIC" -> "Canadian Pacific"
    const rawTarget = parsed.target.name;
    parsed = {
      ...parsed,
      acquirer: { ...parsed.acquirer, name: titleCaseCaps(cleanPartyName(stripDateline(parsed.acquirer.name))) },
      target: { ...parsed.target, name: titleCaseCaps(rawTarget) },
    };
    // A party described in prose but listed in the text ("Berry is a publicly traded … (NASDAQ: BRY)", "Rumble, the
    // popular video-sharing platform") is that listed company, when the prose starts with its name (a reused ticker
    // won't: Vonage's old "VG" is Venture Global's now).
    // The document's own filer counts too, under its name then ("Rumble Inc.", since renamed RUM Group; Berry Corp,
    // since delisted).
    const listedName = (p: ParsedPress["acquirer"]) => {
      const listed = p.ticker ? directory.byTicker.get(p.ticker.toUpperCase()) : undefined;
      const names = [...(listed ? [listed.name] : []), ...hit.displayNames.map((n) => parseDisplayName(n).name)];
      const pn = normalizeName(p.name);
      const match = names.find((n) => {
        const first = normalizeName(n).split(" ")[0];
        return first.length >= 3 && pn.startsWith(`${first} `);
      });
      return match ? displayName(match) : null;
    };
    for (const side of ["acquirer", "target"] as const) {
      const name = !isPlausibleName(parsed[side].name) ? listedName(parsed[side]) : null;
      if (name) parsed = { ...parsed, [side]: { ...parsed[side], name } };
    }
    // Headline fragments and deal paperwork are not parties ("Entry into a Material Definitive Agreement").
    if (!isPlausibleName(parsed.target.name) || !isPlausibleName(parsed.acquirer.name)) return null;
    let target = resolveParty(parsed.target, hit, directory);
    const acquirer = resolveParty(parsed.acquirer, hit, directory);
    // Listed today is not listed then: found only by today's name, it must have been reporting around the date.
    if (target.cik && target.listedInUs && target.byNameToday) {
      const sub = await submissions(target.cik);
      if (sub && (provablyUnlistedOn(sub, hit.fileDate) || !takenOverAround(sub, hit.fileDate, opts.today))) target = { cik: null, ticker: null, listedInUs: false };
    }
    if (target.cik && target.listedInUs) {
      if (acquirer.cik && acquirer.cik === target.cik) return null;
      stats.parsed++;
      return applyParsed(state, parsed, hit, target, acquirer, false);
    }
    // A private company bought by a US-listed acquirer: the target resolves to no SEC registrant and has no
    // ticker, and isn't the target of a public deal we already track (a delisted public company, e.g. after closing).
    // Checked before and after tidying: "TWO … COMMUNITIES FREEHOLD" must fail on its raw form.
    const name = tidyTargetName(rawTarget, parsed.acquirer.name);
    // A public deal that closed or ended over a month earlier isn't this one: the same name can be bought again
    // (Hampton Roads bought Xenith in 2016 and took its name; Union Bankshares bought that Xenith in 2017).
    const over = (d: StoredDeal) => ((d.status === "Closed" || d.status === "Terminated") && !!d.statusDate && (Date.parse(hit.fileDate) - Date.parse(d.statusDate)) / 86_400_000 > 30) || (Date.parse(hit.fileDate) - Date.parse(d.announcedDate)) / 86_400_000 > 540;
    // The same name, not a loose match: "Apex Crypto" is not Apex Global Brands, "Bank Leumi USA" not Bank of Commerce Holdings.
    const knownPublic = () => state.deals.some((d) => !d.privateTarget && identicalNames(d.target.name, name) && !over(d));
    // A target the release lists abroad or over the counter is out of scope, and its closing release, which states neither,
    // may not bring it back. So its key is set here too, for a target with a ticker, which the gate below turns away: Zeo /
    // Heliogen ("Heliogen, Inc. (OTCQX: HLGN)"), MICT / Tingo ("OTC Markets: TMNA"). Not a bank: OTC banks stay in.
    const offshoreKey = acquirer.cik ? `offshore:${acquirer.cik}:${normalizeName(name)}` : null;
    // (The name too: the search doesn't give every hit a SIC. Plumas / Cornerstone Community Bancorp, on OTCPK.)
    const bankFiler = hit.sics.some((s) => s.startsWith("60")) || /\b(?:Banc(?:orp|shares)?|Bankshares|Bank)\b/i.test(name);
    const markOffshore = () => {
      if (!offshoreKey || parsed.kind !== "announcement") return;
      state.seen.add(offshoreKey);
      // The Item 1.01 of this same filing, read first ("…_8k.htm" sorts before "…_ex99-1.htm"), made a record: Newmont / Newcrest.
      if (!bankFiler) {
        const n = normalizeName(name);
        const twin = state.deals.find((d) => d.privateTarget && d.acquirer.cik === acquirer.cik && d.sources.some((s) => s.startsWith(`${hit.adsh}:`)) && (normalizeName(d.target.name) === n || normalizeName(d.target.name).startsWith(`${n} `)));
        if (twin) drop(twin);
      }
    };
    if (parsed.targetListedAbroad || (parsed.targetOnOtc && !bankFiler)) markOffshore();
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
      // A listed company the directory no longer has (delisted since the deal closed: Abiomed, Hillrom).
      const listed = await resolveRegistrant(name, hit.fileDate);
      if (listed) {
        if (listed.cik === acquirer.cik) return null;
        stats.parsed++;
        return applyParsed(state, { ...parsed, target: { ...parsed.target, name } }, hit, listed, acquirer, false);
      }
      // A premium means a traded stock: an OTC or foreign-listed company, out of scope. (A per-share price
      // alone is common for private banks and stays.) This also catches releases read backwards
      // ("GenMark acquires Roche": the premium is GenMark's). So is a target the release lists abroad only
      // ("Logan Energy Corp. (TSXV: LGN)", bought by Ovintiv).
      // Its closing release states neither, and may not bring it back under a new id (Newmont / Newcrest).
      if (parsed.premiumPct != null || parsed.targetListedAbroad || (parsed.targetOnOtc && !bankFiler)) {
        markOffshore();
        return null;
      }
      if ((parsed.kind === "completion" || (parsed.item101 && !bankFiler)) && acquirer.cik) {
        const prefix = `offshore:${acquirer.cik}:`;
        const n = normalizeName(name);
        for (const k of state.seen) {
          if (!k.startsWith(prefix)) continue;
          const held = k.slice(prefix.length);
          // (An Item 1.01 only one way: a short name it wrote isn't the key's longer one. "Vantage" is not the key "vantage a".)
          if (held === n || n.startsWith(`${held} `) || (parsed.kind === "completion" && held.startsWith(`${n} `))) return null;
        }
      }
      stats.parsed++;
      stats.privateDeals++;
      const valueUsd = parsed.valueUsd != null && parsed.valueUsd > MAX_PRIVATE_DEAL_VALUE ? null : parsed.valueUsd;
      const deal = applyParsed(state, { ...parsed, target: { ...parsed.target, name }, valueUsd }, hit, target, acquirer, true);
      if (deal) deal.registrantCheck = REGISTRANT_CHECK_VERSION;
      return deal;
    }
    return null;
  };

  const docs = opts.backstopOnly ? [] : (await discoverDealDocs(opts.from, opts.to, log, stats.searchGaps)).filter((h) => !state.seen.has(h.id));
  log(`  ${docs.length} new documents to read (${docs.filter((d) => d.via === "item101").length} merger 8-Ks)`);

  for (const hit of docs) {
    // Progress + checkpoint first: the loop body `continue`s on most documents.
    if (stats.documents && stats.documents % 50 === 0) log(`  read ${stats.documents}/${docs.length} documents, ${touched.size} deals touched`);
    if (stats.documents && stats.documents % 250 === 0) await opts.checkpoint?.();
    stats.documents++;
    try {
      // A blank-check company's own filing is a SPAC combination, out of scope: their signing 8-Ks ("As previously
      // announced, on …, Roth CH Acquisition V Co. entered into an Agreement and Plan of Merger …") read like deals.
      // The name must look like a SPAC too: a de-SPACed operating company can keep SIC 6770 for years (Infrastructure and
      // Energy Alternatives, bought by MasTec in 2022).
      const filer = parseDisplayName(hit.displayNames[0]);
      if (hit.sics.includes("6770") && SPAC_FILER.test(filer.name)) {
        state.seen.add(hit.id);
        continue;
      }
      const cik = filer.cik ?? trimCik(hit.ciks[0]);
      const text = htmlToText(await getText(archiveUrl(cik, hit.adsh, hit.file)));
      // …or the filing talks like one (Aimei Health Technology Co., Ltd.): the trust account, the initial business combination.
      if (hit.sics.includes("6770") && /\btrust account\b|\binitial business combination\b/i.test(text)) {
        state.seen.add(hit.id);
        continue;
      }
      const ctx = { filerName: displayName(filer.name), filerTickers: filer.tickers };
      const parsed = hit.via === "item101" ? parseMergerItem(text, ctx) : withItem101Price(parsePressRelease(text, ctx), text);
      state.seen.add(hit.id);
      if (!parsed) continue;
      // A filer delisted since (bought: Chase Corp, Cowen, MidWestOne) isn't in today's directory: as in the backstop,
      // it counts as listed if it was on an exchange then. Otherwise its own release reads as a private target, and a
      // quoted premium then drops it as OTC.
      let docHit: FtsHit = hit;
      if (!directory.byCik.has(cik)) {
        const sub = await submissions(cik);
        if (sub) docHit = { ...hit, listedChecked: true, ...((await listedThen(sub, hit.fileDate)) ? { listedCiks: [cik] } : {}) };
      }
      const deal = await accept(parsed, docHit, text);
      if (deal) touched.add(deal);
    } catch (err) {
      if (err instanceof NotFoundError) {
        state.seen.add(hit.id);
        continue;
      }
      log(`  ! ${hit.id}: ${(err as Error).message}`);
    }
  }

  // Backstop: companies that filed a merger proxy / tender response but have no deal for it yet.
  // Find their announcement 8-K (within ~13 months before: Terminix's proxy came 9 months after signing) and parse it.
  const filers = await discoverMergerFilers(opts.from, opts.to, stats.searchGaps, log, { allParties: true, byYear: true });
  // A deal for the same company announced before this proxy covers it; an older one doesn't (Aerojet's 2020 deal with
  // Lockheed, which fell through, used to hide its 2022 deal with L3Harris).
  const hasDealFor = (cik: string, proxyDate: string) =>
    state.deals.some(
      (d) =>
        // As the buyer only in a public-target deal (both sides file a joint proxy): a company's own purchase of a private
        // business needs no vote, and hid Cowen's and Star Equity's sales (Portico; Alliance Drilling Tools).
        (d.target.cik === cik || (d.acquirer.cik === cik && !d.privateTarget)) &&
        d.announcedDate <= proxyDate &&
        d.announcedDate >= shiftDate(proxyDate, -BACKSTOP_DAYS) &&
        // A record with a junk party ("Pennsylvania corporation" as TriState's buyer) is dropped by tidy: look again.
        isPlausibleName(d.acquirer.name) &&
        isPlausibleName(d.target.name),
    );
  const todo = [...filers]
    .map(([key, f]) => [key.split("|")[0], f] as const)
    .filter(([cik, f]) => !hasDealFor(cik, f.firstDate) && !state.seen.has(`${BACKSTOP_KEY}:${cik}:${f.firstDate.slice(0, 4)}`));
  log(`  backstop: ${filers.size} merger-proxy filers, ${todo.length} without a deal to look up`);
  let recovered = 0;
  for (const [cik, { firstDate, hit: proxyHit }] of todo) {
    try {
      state.seen.add(`${BACKSTOP_KEY}:${cik}:${firstDate.slice(0, 4)}`);
      const sub = await submissions(cik);
      if (!sub || sub.sic === "6770") continue;
      const lo = shiftDate(firstDate, -BACKSTOP_DAYS);
      const filings = recentFilings(sub).filter((f) => f.date >= lo && f.date <= firstDate);
      // The signing 8-K normally carries Item 1.01. Some announce under Item 8.01 or 7.01 only (GW Pharmaceuticals):
      // those are 8-Ks filed on a day a deal communication (DEFA14A / 425 / 14D-9C) went out. Any such day, not just
      // the first: GW's first DEFA14A in the window was a 2020 annual-meeting supplement.
      const communicationDays = new Set(filings.filter((f) => /^(?:DEFA14A|425|SC14D9C|SC 14D9-C|SC TO-C)$/.test(f.form)).map((f) => f.date));
      // Item 1.01 8-Ks first, then the communication-day ones: Piedmont filed six 8-Ks of deal news after its signing, which
      // pushed the signing 8-K itself out of a newest-first list of six.
      const eightKs = filings.filter((f) => /^8-K/.test(f.form)).sort((a, b) => b.date.localeCompare(a.date));
      // A foreign issuer files 6-Ks, never 8-Ks (Yatra Online, ReNew Energy Global, Cadeler): its 6-Ks, communication
      // days first, read as press releases.
      const sixKs = eightKs.length ? [] : filings.filter((f) => /^6-K/.test(f.form)).sort((a, b) => b.date.localeCompare(a.date));
      const announcements = [
        ...eightKs.filter((f) => /\b1\.01\b/.test(f.items)),
        ...eightKs.filter((f) => !/\b1\.01\b/.test(f.items) && communicationDays.has(f.date)),
        ...sixKs.filter((f) => communicationDays.has(f.date)),
        ...sixKs.filter((f) => !communicationDays.has(f.date)),
      ].slice(0, 8);
      for (const f of announcements) {
        // The filer as it was then: its name at the time (Resolute Energy, not today's Cimarex Resolute), and listed
        // then if it filed periodic reports and was on an exchange or delisted afterwards (today it has no ticker).
        const nameThen = nameOn(sub, f.date);
        const displayNames = [`${nameThen}${sub.tickers?.length ? `  (${sub.tickers.join(", ")})` : ""}  (CIK ${cik.padStart(10, "0")})`];
        const ctx = { filerName: displayName(nameThen), filerTickers: sub.tickers ?? [] };
        const isFiler = (name: string) => namesCompany(name, nameThen) || namesCompany(name, sub.name);
        const listedCiks = (await listedThen(sub, f.date)) ? [cik] : [];
        const docsIn = await filingDocuments(sub.cik, f.adsh);
        const exhibits = docsIn.filter((d) => /ex-?99|dex99/i.test(d) && /\.htm/i.test(d));
        const asPress = (file: string) => async () => {
          const text = htmlToText(await getText(archiveUrl(sub.cik, f.adsh, file)));
          const p = parsePressRelease(text, ctx);
          // The filer is the company being bought: its release names it as the target ("Newfield", "EFI"), or by
          // a name the release defines for it ("BTRS Holdings Inc. ("Billtrust")"), never as the buyer (that
          // would be an acquirer's own vote). Use its registered name so it resolves to it.
          const aliases = new Set(definedEntities(text.slice(0, 8000)).filter((e) => isFiler(e.name)).flatMap((e) => [e.nick, e.alias ?? ""]));
          const namesFiler = (name: string) => isFiler(name) || aliases.has(name);
          if (!p || p.kind !== "announcement" || !namesFiler(p.target.name) || namesFiler(p.acquirer.name)) return null;
          return { ...p, target: { ...p.target, name: displayName(nameThen) } };
        };
        // Press-release exhibits first (they carry premiums and advisors), then the 8-K's own Item 1.01; a 6-K's own
        // document is often the release itself.
        const attempts: { file: string; parse: () => Promise<ParsedPress | null> }[] = [
          ...exhibits.map((ex) => ({ file: ex, parse: asPress(ex) })),
          /^6-K/.test(f.form)
            ? { file: f.primaryDocument, parse: asPress(f.primaryDocument) }
            : { file: f.primaryDocument, parse: async () => parseMergerItem(htmlToText(await getText(archiveUrl(sub.cik, f.adsh, f.primaryDocument))), ctx) },
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
            listedCiks,
            // listedThen has decided for this filer: a filer gone from today's file with tickers isn't "delisted since" unless it says so (LogicMark, on OTC).
            listedChecked: true,
          };
          deal = await accept(parsed, synthetic);
          if (deal) break;
        }
        // Keep reading the older candidates: the same deal's earlier 8-K moves its date back to the signing (Denbury's
        // agreement was filed July 14; an amendment 8-K on July 31 came first in this newest-first list).
        if (deal && !touched.has(deal)) recovered++;
        if (deal) touched.add(deal);
      }
    } catch (err) {
      log(`  ! backstop ${cik}: ${(err as Error).message}`);
    }
  }
  log(`  backstop recovered ${recovered} deals`);

  // Enrich new/changed deals, plus open deals whose status may have moved.
  // Registrants a colliding buyout firm's name normalises to but which aren't the firm (Advent Technologies for "Advent"):
  // deals linked to one re-read their source document's buyer once (SPONSOR_CHECK_VERSION 3).
  const sponsorKeys = new Map(COLLIDING_SPONSORS.map((s) => [normalizeName(s), s]));
  const collidingCiks = new Set(
    [...directory.byCik.values()].filter((c) => sponsorKeys.has(normalizeName(c.name)) && notTheSponsor(sponsorKeys.get(normalizeName(c.name))!, c.name)).map((c) => c.cik),
  );
  const collisionDue = (d: StoredDeal) => !!d.acquirer.cik && collidingCiks.has(d.acquirer.cik) && d.sponsorCheck !== SPONSOR_CHECK_VERSION;
  // Buyers stored by name only, once per version; consortiums, funds and acquisition vehicles have no registrant to find.
  const buyerLinkDue = (d: StoredDeal) =>
    !d.acquirer.cik &&
    d.buyerLinkCheck !== BUYER_LINK_VERSION &&
    isPlausibleName(d.acquirer.name) &&
    !isPlaceholderBuyer(d.acquirer.name) &&
    !/\b(?:consortium|investor group|led by|affiliates?|funds?)\b/i.test(d.acquirer.name);
  const toEnrich = state.deals.filter((d) =>
    buyerLinkDue(d) ||
    collisionDue(d) ||
    (d.privateTarget
      ? touched.has(d) ||
        (d.status === "Announced" && d.statusCheckedAt !== opts.today) ||
        !d.statusCheckedAt ||
        d.registrantCheck !== REGISTRANT_CHECK_VERSION ||
        (identicalNames(d.acquirer.name, d.target.name) && d.statusCheckedAt !== opts.today)
      : touched.has(d) ||
      (OPEN.includes(d.status) && d.statusCheckedAt !== opts.today) ||
      (d.status === "Closed" && d.statusRule !== STATUS_RULE_VERSION) ||
      valueCheckDue(d) ||
      (isPlaceholderBuyer(d.acquirer.name) && d.sponsorCheck !== SPONSOR_CHECK_VERSION) ||
      advisorCheckDue(d) ||
      !d.financialsCheckedAt ||
      d.financialsVersion !== FINANCIALS_VERSION ||
      proxyWanted(d) ||
      (!opts.light && (!d.fairnessCheckedAt || d.fairnessParser !== FAIRNESS_PARSER_VERSION || d.termsParser !== TERMS_PARSER_VERSION)) ||
      // Unsettled terms (no proxy yet) are looked for once a day, not every run.
      (!opts.light && !d.termsCheckedAt && d.statusCheckedAt !== opts.today) ||
      !d.milestones ||
      d.milestones.voteHeld === undefined ||
      // Looks like a company buying itself: a target renamed after its buyer (re-read the name it had then).
      (identicalNames(d.acquirer.name, d.target.name) && d.statusCheckedAt !== opts.today)),
  );
  log(`  enriching ${toEnrich.length} deals (status, sector, financials)`);
  for (const deal of toEnrich) {
    try {
      // Private records stored before this check: the target may be a delisted listed company.
      if (deal.privateTarget && deal.registrantCheck !== REGISTRANT_CHECK_VERSION) {
        // With today's name rules ("Sculptor Capital Management Together" -> "Sculptor Capital Management").
        const listed = await resolveRegistrant(cleanPartyName(deal.target.name), deal.announcedDate);
        if (listed && listed.cik !== deal.acquirer.cik) {
          const near = (d: StoredDeal) => Math.abs(Date.parse(d.announcedDate) - Date.parse(deal.announcedDate)) < 400 * 86_400_000;
          if (state.deals.some((d) => d !== deal && d.target.cik === listed.cik && near(d))) {
            drop(deal); // the public record of the same deal already exists
            continue;
          }
          // Becomes a public-target deal, enriched from the target's own filings below. A record created from a
          // completion release carries the closing date: the announcement is the signing 8-K (Item 1.01) naming the
          // other party, the target's or else the buyer's (a foreign target files 6-Ks: CyberArk). Without one the
          // date stays.
          const targetSub = await submissions(listed.cik!);
          if (targetSub && completedAround(targetSub, deal.announcedDate)) {
            const closing = deal.announcedDate;
            const acquirerSub = deal.acquirer.cik ? await submissions(deal.acquirer.cik) : null;
            const targetNames = [deal.target.name, displayName(nameOn(targetSub, closing))];
            const signed = await signingDate(targetSub, closing, [deal.acquirer.name, ...(acquirerSub ? [displayName(nameOn(acquirerSub, closing))] : [])]) ??
              (acquirerSub ? await signingDate(acquirerSub, closing, targetNames) : null);
            if (signed) deal.announcedDate = signed;
          }
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
        deal.registrantCheck = REGISTRANT_CHECK_VERSION;
      }
      if (!deal.privateTarget && OPEN.includes(deal.status)) {
        // Listed today but not when the deal was announced: a private target then (Adobe / Figma, Galaxy / BitGo, both
        // listed in 2025). Open records only: they stay "Announced" for ever, as the target files nothing about them.
        const sub = await submissions(deal.target.cik!);
        // Or the registrant then was the buyer, which took the target's name later: RumbleOn bought the private RideNow in
        // 2021 and renamed itself RideNow Group in 2025, so today's name list matched RideNow to RumbleOn's own filer.
        const then = sub ? nameOn(sub, deal.announcedDate) : "";
        const wasBuyer =
          !!sub && !registrantMatches(then, deal.target.name) && !sameCompany(then, deal.target.name) && (sameCompany(then, deal.acquirer.name) || registrantMatches(then, deal.acquirer.name));
        if (sub && wasBuyer && !deal.acquirer.cik) deal.acquirer = { name: displayName(then), cik: trimCik(sub.cik), ticker: sub.tickers?.[0] ?? null };
        if (sub && (wasBuyer || provablyUnlistedOn(sub, deal.announcedDate))) {
          // A private target needs a listed buyer ("Dermira" buying Journey Medical was a licence, read as a deal).
          if (!deal.acquirer.cik) {
            drop(deal);
            continue;
          }
          dropped.add(deal.id);
          const base = `p-${normalizeName(deal.target.name).replace(/\s+/g, "-")}-${deal.announcedDate}`;
          let id = base;
          for (let n = 2; state.deals.some((d) => d.id === id); n++) id = `${base}-${n}`;
          // "Pending" came from the registrant's own proxy: a private deal starts again from "Announced", and the private
          // checks below (the buyer's 8-K Item 2.01, its later filings) settle it.
          Object.assign(deal, { id, privateTarget: true, premiumPct: null, pricePerShare: null, enterpriseValueUsd: null, evEbitda: null, evEbitdaReported: null, evRevenue: null, status: "Announced", statusDate: null });
          deal.target = { ...deal.target, cik: null, ticker: null };
          deal.milestones = deal.terms = deal.fairness = undefined;
          deal.registrantCheck = REGISTRANT_CHECK_VERSION;
        }
      }
      // Linked to a registrant a buyout firm's name collides with: the buyer the source document named (through its
      // vehicle's sponsor: McAfee's "Condor BidCo" is Advent); a firm that isn't the registrant is unlinked.
      if (collisionDue(deal) && deal.filings[0]) {
        const text = htmlToText(await getTextHead(deal.filings[0].url, 400_000));
        const ctx = { filerName: deal.target.name, filerTickers: [] as string[] };
        let named = (parsePressRelease(text, ctx) ?? parseMergerItem(text, ctx))?.acquirer.name ?? null;
        const targetSub = deal.target.cik ? await submissions(deal.target.cik) : null;
        if (named && isPlaceholderBuyer(named) && targetSub) named = await findSponsor({ ...deal, acquirer: { ...deal.acquirer, name: named } }, targetSub);
        if (named && notTheSponsor(cleanPartyName(named), deal.acquirer.name)) {
          deal.acquirer = { name: cleanPartyName(named), cik: null, ticker: null };
          delete deal.reaction;
          deal.reactionCheckedAt = undefined;
          stats.sponsorsFound++;
        }
        deal.sponsorCheck = SPONSOR_CHECK_VERSION;
      }
      // A buyer stored by name only: the registrant it was then (renamed since, or listed under another ticker).
      if (buyerLinkDue(deal)) {
        const buyer = await resolveBuyer(deal.acquirer.name, deal.announcedDate);
        if (buyer && buyer.cik !== deal.target.cik) {
          deal.acquirer = { ...deal.acquirer, cik: buyer.cik, ticker: deal.acquirer.ticker ?? buyer.ticker };
          stats.buyersLinked++;
        }
        deal.buyerLinkCheck = BUYER_LINK_VERSION;
      }
      const settlePrivate = async () => {
        const acquirerSub = deal.acquirer.cik ? await submissions(deal.acquirer.cik) : null;
        enrichPrivateDeal(deal, acquirerSub, opts.today, directory, { verifyClosing: !opts.light });
        if (deal.dateIsClosing && acquirerSub && !opts.light && deal.announceCheck !== ANNOUNCE_CHECK_VERSION) await findAnnouncement(deal, acquirerSub.cik);
        if (deal.status === "Announced" && acquirerSub && !opts.light) await privateClosing(deal, acquirerSub, state.seen);
        if (deal.status === "Announced" && acquirerSub) await privateTermination(deal, acquirerSub, state.seen);
        // Still open: the buyer's later filings usually say it closed (or ended).
        if (acquirerSub && !opts.light && settleDue(deal, opts.today)) await settleFromBuyerFilings(deal, acquirerSub.cik, opts.today);
      };
      if (deal.privateTarget) {
        await settlePrivate();
      } else {
        let sub = await submissions(deal.target.cik!);
        // Blank-check shell as target: drop. The name must look like one too, as in discovery: a de-SPACed operating company
        // can keep SIC 6770 for years (Infrastructure and Energy Alternatives, formerly M III Acquisition, sold to MasTec for $1.1B).
        if (sub && sub.sic === "6770" && (SPAC_FILER.test(sub.name) || SPAC_NAME.test(sub.name))) {
          drop(deal);
          continue;
        }
        // Still open months on: read backwards, or a foreign target whose end only the buyer reports.
        if (sub && OPEN.includes(deal.status) && Date.parse(opts.today) - Date.parse(deal.announcedDate) > 120 * 86_400_000) {
          const turned = await reverseRoles(deal, sub);
          if (turned === "dropped") continue;
          // A private target now: settled in this pass, or a rebuild shows it Announced, in the default sector, until the next run.
          if (turned === "private") {
            await settlePrivate();
            stats.enriched++;
            continue;
          }
          if (turned === "swapped") sub = await submissions(deal.target.cik!);
          // A foreign private issuer files 6-Ks, never an 8-K Item 1.02: the buyer's 8-K says the agreement ended (Intel / Tower).
          const acquirerSub = deal.acquirer.cik && sub && recentFilings(sub).some((f) => /^6-K/.test(f.form)) ? await submissions(deal.acquirer.cik) : null;
          if (acquirerSub) await privateTermination(deal, acquirerSub, state.seen);
          // Or its release only (Intel announced the end of its Tower deal under Item 7.01).
          // Ends only: a listed target's closing comes from its own Form 25 / 15, with the real date (an undated "completed"
          // from the buyer had closed Merck / Verona without one).
          if (acquirerSub && !opts.light && settleDue(deal, opts.today)) await settleFromBuyerFilings(deal, acquirerSub.cik, opts.today, ["ended"]);
          if (deal.status === "Terminated") deal.milestones = undefined;
        }
        // No value yet: the announcement releases of the target and the buyer usually state one.
        if (sub && valueCheckDue(deal)) {
          // A date taken from a later 8-K (an amendment) moves back to the signing first, so the releases are found.
          const signed = await earlierSigning(deal, sub);
          if (signed) deal.announcedDate = signed;
          const acquirerSub = deal.acquirer.cik ? await submissions(deal.acquirer.cik) : null;
          const p = await announcementTerms(deal, [sub, ...(acquirerSub ? [acquirerSub] : [])]);
          if (p && takesStatedValue(deal, p)) {
            deal.valueUsd = p.valueUsd;
            deal.valueKind = p.valueKind;
            delete deal.valueImplied;
            // (Not a premium at an older price beside an amended one.)
            if (!deal.termsAmended || (p.pricePerShare != null && deal.pricePerShare != null && Math.abs(p.pricePerShare - deal.pricePerShare) <= deal.pricePerShare * 0.005)) deal.premiumPct ??= p.premiumPct;
            deal.consideration ??= p.consideration;
            deal.financialsCheckedAt = null; // EV and multiples from the new value
            stats.valuesFound++;
          }
          deal.valueCheck = VALUE_CHECK_VERSION;
        }
        // Still an acquisition vehicle as the buyer: name the sponsor behind it, once.
        if (sub && isPlaceholderBuyer(deal.acquirer.name) && deal.sponsorCheck !== SPONSOR_CHECK_VERSION) {
          const sponsor = await findSponsor(deal, sub);
          if (sponsor) {
            // Linked to a listed company only if it trades on a US exchange ("Authentic Holdings, Inc." on OTC is not
            // Authentic Brands Group).
            const match = directory.byName.get(normalizeName(sponsor));
            const listed = match && US_LISTED.test(match.exchange ?? "") && !notTheSponsor(sponsor, match.name) ? match : undefined;
            deal.acquirer = { name: sponsor, ticker: listed?.ticker ?? null, cik: listed?.cik ?? null };
            stats.sponsorsFound++;
          }
          deal.sponsorCheck = SPONSOR_CHECK_VERSION;
        }
        // The buyer's bank: the proxy names only the target's, the announcement release usually both.
        if (sub && advisorCheckDue(deal)) {
          const acquirerSub = deal.acquirer.cik ? await submissions(deal.acquirer.cik) : null;
          const banks = await announcementAdvisors(deal, [sub, ...(acquirerSub ? [acquirerSub] : [])]);
          if (mergeReleaseAdvisors(deal, banks)) stats.advisorsFound++;
          deal.advisorCheck = ADVISOR_CHECK_VERSION;
        }
        // (One request per buyer, cached for the run; the light history runs keep today's name.)
        const buyerSub = !opts.light && deal.acquirer.cik ? await submissions(deal.acquirer.cik).catch(() => null) : null;
        await enrichDeal(deal, sub, opts.today, directory, { light: opts.light, buyerSub });
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
    `  tidy: ${tidy.dropped.length} junk / duplicate records removed, ${tidy.merged} merged, ${tidy.topped} topped bids marked terminated, ${tidy.sanitized} records cleaned`,
  );
  for (const d of tidy.dropped.slice(0, 20)) log(`    - ${d.id}: ${d.reason}`);
  stats.newDeals = state.deals.filter((d) => !before.has(d.id)).length;
  return stats;
}

