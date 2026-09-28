/**
 * Extract M&A deal terms from a press release (8-K EX-99, DEFA14A, 425, SC TO-C).
 *
 * Pure function over plain text. Returns null when the document isn't a
 * recognisable public-company acquisition. Every field is best-effort:
 * anything not stated clearly is left null rather than guessed.
 */
import { findBanks } from "../../lib/banks";
import { flatten } from "../text";
import type { Consideration } from "../../lib/types";
import { cleanPartyName, isPlausibleName, normalizeName, sameCompany } from "./names";

export type PressKind = "announcement" | "update" | "completion" | "termination";

export interface PartyMention {
  name: string;
  ticker: string | null;
  exchange: string | null;
}

export interface ParsedPress {
  kind: PressKind;
  headline: string;
  acquirer: PartyMention;
  target: PartyMention;
  pricePerShare: number | null;
  premiumPct: number | null;
  valueUsd: number | null;
  valueKind: "enterprise" | "equity" | "transaction" | null;
  consideration: Consideration | null;
  acquirerAdvisors: string[];
  targetAdvisors: string[];
  /** The release calls the target privately held (only then may an unlisted target become a deal). */
  privateTarget?: boolean;
}

// ---------------------------------------------------------------------------
// Headline & body
// ---------------------------------------------------------------------------

const SKIP_LINE =
  /^(?:ex-?\d|exhibit\b|\d+$|[\w-]+\.html?$|press release|news release|for immediate release|contacts?:|media contact|investor contact|tsxv?:|nyse|nasdaq|otc|\(?nyse|\(?nasdaq|[a-z]+ \d{1,2},? \d{4}$|\d{4}$|page \d)/i;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept?\\.?|Oct\\.?|Nov\\.?|Dec\\.?";
const DATELINE = new RegExp(`(?:^|\\n)[^\\n]{0,160}?(?:${MONTHS})\\s*,?\\s*\\d{1,2}\\s*,\\s*(?:19|20)\\d{2}\\s*[-–—/]+\\s*`, "i");

// SEC cover-page and filing-wrapper lines that precede the actual release in 425 / DEFA14A documents.
const COVER_LINE =
  /securities and exchange commission|washington,? d\.?\s?c\.?|pursuant to rule|filed by|subject company|commission file|schedule 14a|form 8-k|form 425|current report|check the appropriate box|registrant|soliciting material|securities exchange act of 1934|^(?:DEFA14A|425|8-K|SC TO-C|SC14D9C|EX-99[.\d]*)\s+\d+\s+\S+\.html?/i;
/** "(mark one)"-style fragments: all lower-case. */
const LOWERCASE_FRAGMENT = /^\(?[a-z ]+\)?$/;
/** Bullet glyphs, including Symbol-font private-use characters common in EDGAR HTML. */
const BULLET = /^[•●▪■‣⁃·◦*]|^[-–]\s/;

/**
 * Headline = the lines just above the dateline ("CITY, State - Month D, YYYY -"),
 * skipping bullet points and filing boilerplate. Reading backwards from the dateline
 * copes with cover pages, logos and exhibit labels above the release.
 */
export function splitHeadline(text: string): { headline: string; body: string } {
  const dl = DATELINE.exec(text);
  const head = dl ? text.slice(0, dl.index + (dl[0].startsWith("\n") ? 1 : 0)) : text.slice(0, 800);
  const body = dl ? text.slice(dl.index + dl[0].length) : text;
  const lines = head
    .split(/\n/)
    .map((l) => l.replace(/&middot;|·/g, "•").trim())
    .filter(Boolean);

  const picked: string[] = [];
  const walk = dl ? [...lines].reverse() : lines;
  let seenBullets = false;
  for (const line of walk) {
    if (BULLET.test(line)) {
      seenBullets = true;
      if (!dl && picked.length) break;
      continue;
    }
    const boiler = SKIP_LINE.test(line) || COVER_LINE.test(line) || LOWERCASE_FRAGMENT.test(line) || line.length < 6;
    if (boiler) {
      if (picked.length) break;
      continue;
    }
    // Reading backwards: a long paragraph right above the dateline is body copy, not a headline.
    if (dl && !picked.length && !seenBullets && line.length > 400) continue;
    picked.push(line);
    if (picked.join(" ").length > 260 || picked.length >= 3) break;
  }
  if (dl) picked.reverse();
  return { headline: flatten(picked.join(" ")), body: flatten(body) };
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

// Company names are matched case-sensitively (capitalised words plus a few connectors);
// the surrounding keywords are case-insensitive via (?i:...) groups.
const SUFFIX = String.raw`,\s(?:Inc|Corp|Ltd|LLC|L\.P|LP|Co|N\.V|S\.A|plc|PLC|Limited|Incorporated)\.?`;
const NAME = String.raw`([A-Z0-9][\w&.'’\-]*(?:${SUFFIX}|\s(?:[A-Z0-9&][\w&.'’\-]*|of|and|de|du|la|for|the|by))*?)`;
const LEAD_QUAL = String.raw`(?i:(?:certain )?affiliates? of |entities (?:affiliated with|managed by) |funds? (?:managed|advised) by |an? (?:newly formed )?entity (?:to be )?(?:formed|owned|controlled) by |an investor group led by |investment funds? (?:managed|advised) by |the )?`;
const STOP = String.raw`(?=['’]s\b|\s*(?:[,;:(]|$)|\.(?:\s|$)|\s(?i:for|in|at|to|from|with|via|and (?:expand|create|strength|accelerat|add|form)|creating|expanding|adding|strengthening|accelerating|valued|forming|through|—|-|–)(?:\b|\s))`;

/** A capitalized word followed by a lowercase one (not a name connector): the start of a sub-headline. */
const SUBHEAD_STOP = String.raw`(?=\s[A-Z][a-z]+\s(?!(?:of|and|de|du|la|for|the|by)\b)[a-z])`;
/** Headline words that follow the target, never part of its name ("… BankWyse Subject to …", "… DBM Global Transaction …"). */
const TAIL_STOP = String.raw`(?=\s(?:Subject|Transaction|Deal|Acquisition|Agreement|Following|Pending|Upon|After|Expanding|Adding|Creating|Strengthening|Establishing|Accelerating|Enhancing|Broadening|Extending)\b)`;

const rx = (src: string) => new RegExp(src);

const HEADLINE_PATTERNS: { re: RegExp; roles: ["acq" | "tgt", "acq" | "tgt"] }[] = [
  {
    re: rx(
      String.raw`^${NAME}\s+(?i:to|will|agrees to|has agreed to|signs (?:a )?definitive (?:merger )?agreement to|enters into (?:a )?definitive (?:merger )?agreement to|announces (?:a )?(?:definitive )?(?:merger )?agreement to|announces (?:plans? )?to)\s+(?i:acquire)\s+${LEAD_QUAL}${NAME}(?:${STOP}|${SUBHEAD_STOP}|${TAIL_STOP})`,
    ),
    roles: ["acq", "tgt"],
  },
  {
    re: rx(
      String.raw`^${NAME}\s+(?i:to be|agrees to be|enters into (?:a )?definitive (?:merger )?agreement to be|announces (?:a )?(?:definitive )?(?:merger )?agreement to be|signs (?:a )?definitive (?:merger )?agreement to be)\s+(?i:acquired by)\s+${LEAD_QUAL}${NAME}${STOP}`,
    ),
    roles: ["tgt", "acq"],
  },
  {
    re: rx(String.raw`^${NAME}\s+(?i:to go private|to be taken private|agrees to go private)\s+(?i:through|via|in)\s+[^.]{0,80}?\s(?i:by|with)\s+${LEAD_QUAL}${NAME}${STOP}`),
    roles: ["tgt", "acq"],
  },
  { re: rx(String.raw`^${NAME}\s+(?i:completes?|closes|finalizes)\s+(?i:its\s+|the\s+)?(?i:acquisition of)\s+${NAME}(?:${STOP}|${SUBHEAD_STOP}|${TAIL_STOP})`), roles: ["acq", "tgt"] },
  // Private-company deals: "Acme Acquires Widget Co.", "Acme Has Acquired …", "Acme Announces (the) Acquisition of …".
  // (SUBHEAD_STOP also ends the target where a glued-on sub-headline starts: "… Valve Systems Expands flow-control portfolio".)
  {
    re: rx(String.raw`^${NAME}\s+(?i:acquires|has acquired|announces (?:the |its )?acquisition of|announces (?:it has|that it has) acquired)\s+${LEAD_QUAL}${NAME}(?:${STOP}|${SUBHEAD_STOP}|${TAIL_STOP})`),
    roles: ["acq", "tgt"],
  },
  {
    re: rx(String.raw`^${NAME}\s+(?i:completes?|closes)\s+(?i:its\s+)?(?i:sale|merger)\s+(?i:to|with)\s+${LEAD_QUAL}${NAME}${STOP}`),
    roles: ["tgt", "acq"],
  },
  {
    re: rx(String.raw`^${NAME}\s+(?i:stockholders|shareholders)\s+(?i:approve)\s+(?i:the\s+)?(?i:proposed\s+)?(?i:acquisition|merger)\s+(?i:by|with)\s+${NAME}${STOP}`),
    roles: ["tgt", "acq"],
  },
  {
    re: rx(String.raw`^${NAME}\s+(?i:announces|enters into|signs)\s+(?i:a\s+)?(?i:definitive (?:merger )?agreement with)\s+${LEAD_QUAL}${NAME}${STOP}`),
    roles: ["tgt", "acq"],
  },
];

const SYMMETRIC_HEADLINE = rx(String.raw`^${NAME}\s+(?i:and)\s+${NAME}\s+(?i:to combine|to merge|announce|agree to|enter into|sign)\b`);

const ALL_SHARES = String.raw`(?i:a majority (?:interest|stake) in\s+|all\s+(?:of\s+)?(?:the\s+)?(?:issued\s+and\s+)?(?:outstanding\s+)?(?:shares\s+(?:of\s+(?:common\s+stock\s+of\s+)?)?)?)?`;

const BODY_PATTERNS: { re: RegExp; roles: ["acq" | "tgt", "acq" | "tgt"] }[] = [
  {
    re: rx(String.raw`(?i:under which|pursuant to which|whereby)\s+${LEAD_QUAL}${NAME}\s+(?:\([^)]{0,80}\)\s+)?(?i:will acquire)\s+${ALL_SHARES}${LEAD_QUAL}${NAME}${STOP}`),
    roles: ["acq", "tgt"],
  },
  {
    re: rx(String.raw`${NAME}\s+(?:\([^)]{0,80}\)\s+)?(?i:has agreed to|will) (?i:acquire)\s+${ALL_SHARES}${LEAD_QUAL}${NAME}${STOP}`),
    roles: ["acq", "tgt"],
  },
  {
    re: rx(String.raw`${NAME}\s+\([^)]{0,120}\)[^.]{0,260}?\b(?i:to be acquired by)\s+${LEAD_QUAL}${NAME}${STOP}`),
    roles: ["tgt", "acq"],
  },
  // "...announced today that it has completed the acquisition of Widget Co., a privately held ..."
  {
    re: rx(
      String.raw`${NAME}\s+(?:\([^)]{0,80}\)\s+)?(?i:today\s+)?(?i:announced\s+(?:today\s+)?(?:that\s+)?(?:it\s+|the company\s+)?)?(?i:has|have|today)\s+(?i:completed (?:its |the )?acquisition of|closed (?:its |the )?acquisition of|acquired)\s+${LEAD_QUAL}${NAME}${STOP}`,
    ),
    roles: ["acq", "tgt"],
  },
  // "...announced today that BioMarin has entered into a definitive agreement to acquire Amicus for $14.50"
  {
    re: rx(
      String.raw`${NAME}\s+(?:\([^)]{0,80}\)\s+)?(?i:has|have)\s+(?i:entered into|signed)\s+(?i:a\s+|an\s+)?(?i:definitive\s+)?(?i:merger\s+)?(?i:agreement)\s+(?i:to acquire|under which it will acquire|for the acquisition of)\s+${ALL_SHARES}${LEAD_QUAL}${NAME}${STOP}`,
    ),
    roles: ["acq", "tgt"],
  },
];

const TICKER_RE =
  /([A-Z][A-Za-z0-9&.,'’\- ]{1,70}?)\s*\((?:"[^"]*"\)?\s*\()?(?:the\s+)?(NYSE American|NYSE Arca|NYSE|NASDAQ|Nasdaq|Cboe|OTCQX|OTCQB|OTC|TSXV|TSX|LSE|ASX)(?:\s+and\s+[A-Za-z]+)?\s*:\s*([A-Z][A-Z0-9.\-]{0,6})\s*\)/g;

function tickerMentions(text: string): PartyMention[] {
  const out: PartyMention[] = [];
  for (const m of text.matchAll(TICKER_RE)) {
    // Keep only the capitalised run right before the ticker:
    // "Secureworks shareholders, including Dell Technologies" -> "Dell Technologies".
    const run = /((?:[A-Z0-9&][\w&.'’\-]*)(?:(?:,\s(?:Inc|Corp|Ltd|LLC|L\.P|Co|N\.V|S\.A|plc)\.?)|\s(?:[A-Z0-9&][\w&.'’\-]*|of|and|&|de))*)\s*$/.exec(m[1].trim());
    const name = cleanPartyName((run?.[1] ?? m[1]).replace(/^(?:and|The)\s+(?=[A-Z])/, (s) => (s.startsWith("The") ? s : "")));
    const exchange = m[2].toUpperCase() === "NASDAQ" ? "NASDAQ" : m[2];
    out.push({ name, ticker: m[3].replace(/\.$/, ""), exchange });
  }
  return out;
}

const US_EXCHANGES = new Set(["NYSE", "NASDAQ", "NYSE American", "NYSE Arca", "Cboe", "OTCQX", "OTCQB", "OTC"]);

function withTicker(name: string, mentions: PartyMention[]): PartyMention {
  const matches = mentions.filter((m) => sameCompany(m.name, name));
  // Prefer a US listing when a company is dual-listed.
  const best = matches.find((m) => m.exchange && US_EXCHANGES.has(m.exchange)) ?? matches[0];
  if (!best) return { name, ticker: null, exchange: null };
  // The ticker mention carries the legal name ("Rocket Lab Corporation"); the headline
  // may carry a short form ("Rocket Lab") or trailing noise ("Rocket Lab Stockholder").
  const n = normalizeName(name);
  const b = normalizeName(best.name);
  const useMention = best.name.length > 1 && (n.startsWith(b) || b.startsWith(n));
  return { name: useMention ? best.name : name, ticker: best.ticker, exchange: best.exchange };
}

function matchParties(src: string, patterns: typeof HEADLINE_PATTERNS) {
  for (const { re, roles } of patterns) {
    const m = re.exec(src);
    if (!m) continue;
    const a = cleanPartyName(m[1]);
    const b = cleanPartyName(m[2]);
    if (!isPlausibleName(a) || !isPlausibleName(b) || sameCompany(a, b)) continue;
    return roles[0] === "acq" ? { acq: a, tgt: b } : { acq: b, tgt: a };
  }
  return null;
}

/** In a merger-of-equals style headline, the issuer whose shares are handed out is the acquirer. */
function resolveSymmetric(a: string, b: string, body: string) {
  const recv = rx(String.raw`${NAME}\s+(?:shareholders|stockholders)\s+will\s+receive[^.]{0,140}?\bshares?\s+of\s+(?:common stock of\s+)?${NAME}`).exec(body);
  if (recv) {
    const tgt = cleanPartyName(recv[1]);
    const acq = cleanPartyName(recv[2]);
    if (sameCompany(tgt, b) || sameCompany(acq, a)) return { acq: a, tgt: b };
    if (sameCompany(tgt, a) || sameCompany(acq, b)) return { acq: b, tgt: a };
  }
  return { acq: a, tgt: b };
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

function termsSection(body: string): string {
  // Stop at the legal boilerplate and at the "About <Company>" profiles, which quote AUM, market sizes
  // and lifetime deal totals ("aggregate transaction value of more than $175 billion").
  const cut = body.search(
    /\b(?:Forward[- ]Looking Statements|Cautionary (?:Note|Statement)|Important Information (?:for|About)|Additional Information and Where|No Offer or Solicitation|Participants in the Solicitation)\b|(?:^|\n|\.\s{1,3})About (?:the )?[A-Z][\w&.'’\- ]{1,60}\n/i,
  );
  return cut > 400 ? body.slice(0, cut) : body;
}

/** Numbers that describe a market, a combined company or a firm's history, not this deal's price. */
const NOT_DEAL_VALUE =
  /\b(?:market|markets|TAM|industry|opportunit\w*|combined (?:company|enterprise|business|entity)|pro forma|since (?:its )?inception|has (?:managed|invested|completed|deployed)|assets under management|AUM|portfolio compan\w*|projected to|expected to reach|forecast|CAGR|annual(?:ized)? revenue|revenues? of|sales of|backlog|in \d{4})\b/i;
const valueContext = (t: string, index: number, length: number) => t.slice(Math.max(0, index - 90), index + length + 50);

/** No announced deal has been valued above this (the largest ever were ~$200B). */
export const MAX_DEAL_VALUE = 300e9;

const num = (s: string) => Number(s.replace(/,/g, ""));
const unitMult = (u: string) => (/^b/i.test(u) ? 1e9 : /^t/i.test(u) ? 1e12 : 1e6);

/** Offer price per share. Needs buyout context; ignores par values, dividends, EPS and note prices. */
export function extractPrice(t: string): number | null {
  const re =
    /(?:(?:US|U\.S\.)?\$|\bUSD\s?)\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,4})?)\s*(?:per|a|\/)\s*(?:(?:[A-Z][\w&.'’\-]*\s){0,4})?(?:outstanding\s|issued\s)?(?:common\s|ordinary\s)?share\b/gi;
  let best: { v: number; score: number } | null = null;
  for (const m of t.matchAll(re)) {
    const v = num(m[1]);
    if (!(v >= 0.05 && v < 10_000)) continue;
    const before = t.slice(Math.max(0, m.index! - 140), m.index!);
    const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
    // Exclusions only look within the same clause as the amount.
    const clause = before.split(/[.;]\s+(?=[A-Z])/).pop() ?? before;
    if (/par value|dividend|distribution|exercise price|conversion price|strike|warrants?|earnings|EPS|FFO|AFFO|net (?:income|loss)|book value|NAV\b|per share data|guidance|outlook/i.test(clause.slice(-70) + after.slice(0, 20))) continue;
    let score = 0;
    if (/receive|for each|in exchange for|purchase price|offer price|offer of|consideration|acquire[^.]{0,80}\bfor\b|valued at|implies|implied|equal to|equivalent to|price of|at a price/i.test(before)) score += 2;
    if (/^\s*(?:,\s*)?(?:in cash|net to the seller|payable in cash)/i.test(after)) score += 2;
    if (/premium/i.test(after)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { v, score };
  }
  return best?.v ?? null;
}

export function extractPremium(t: string): number | null {
  const found: { v: number; score: number; i: number }[] = [];
  const re = /(?:premium of (?:approximately |about |roughly |nearly |over |more than )?(\d{1,3}(?:\.\d{1,2})?)\s?%|(\d{1,3}(?:\.\d{1,2})?)\s?% premium)/gi;
  for (const m of t.matchAll(re)) {
    const v = Number(m[1] ?? m[2]);
    if (!(v > 0 && v < 500)) continue;
    // Only this premium's own clause: stop at the next "premium" or the end of the sentence.
    const raw = t.slice(m.index!, m.index! + 220);
    const stop = /\bpremium\b|\.\s+(?=[A-Z])/gi;
    stop.lastIndex = m[0].length;
    const ctx = raw.slice(0, stop.exec(raw)?.index ?? raw.length);
    const before = t.slice(Math.max(0, m.index! - 120), m.index!);
    if (/conversion|convertible|notes?\b|exchangeable|warrant/i.test(before + ctx.slice(0, 80))) continue;
    let score = 0;
    if (/unaffected/i.test(ctx)) score += 3;
    if (/closing (?:share |stock )?price|last (?:full )?trading day|close\b/i.test(ctx)) score += 2;
    if (/volume[- ]weighted|VWAP|\d{1,3}[- ](?:trading[- ]|calendar[- ])?day|52[- ]week|average|month/i.test(ctx)) score -= 3;
    found.push({ v, score, i: m.index! });
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score || a.i - b.i);
  // Only averages (VWAP, 30-day) were stated: that isn't the premium over the unaffected price.
  return found[0].score >= 0 ? found[0].v : null;
}

export function extractValue(t: string): { usd: number; kind: ParsedPress["valueKind"] } | null {
  const re =
    /((?:enterprise|equity|transaction|deal|aggregate|total|purchase|implied)(?:\s+(?:equity|enterprise|transaction|deal|purchase))?\s+(?:value|price|consideration)|valued at|valuing\b[\w\s,]{0,40}?\bat|value of|values? [\w\s']{0,40}? at)[^$.;]{0,70}?(?:(?:US|U\.S\.|C|CAD|A)?\$|\bUSD\s?)\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,3})?)\s*(trillion|billion|million|bn|mm|mn|B|M)\b/gi;
  for (const m of t.matchAll(re)) {
    const lead = m[1].toLowerCase();
    if (/per share/i.test(t.slice(m.index!, m.index! + m[0].length + 12))) continue;
    // Skip non-USD currencies (e.g. C$) — we only report USD.
    if (/(?:^|\s)(?:C|CAD|A)\$/.test(m[0])) continue;
    if (NOT_DEAL_VALUE.test(valueContext(t, m.index!, m[0].length))) continue;
    const usd = num(m[2]) * unitMult(m[3]);
    if (usd < 1e6 || usd > MAX_DEAL_VALUE) continue;
    const kind = lead.includes("enterprise") ? "enterprise" : lead.includes("equity") ? "equity" : "transaction";
    return { usd, kind };
  }
  // Private-company deals usually just say "acquired Widget Co. … for $185 million" (or "for USD 6.2 billion").
  const priceFor =
    /\b(?:acquir\w*|acquisition of|purchase of)\b(?:[^.;]|\.(?=,|\s+[a-z])){0,220}?\bfor\s+(?:a\s+(?:total|aggregate)\s+(?:purchase price|consideration)\s+of\s+)?(?:approximately\s+|about\s+|up to\s+)?(?:US\$|\$|USD\s?)\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,3})?)\s*(billion|million|bn|mm|mn|B|M)\b(?!\s*(?:per share|a share))/gi;
  for (const m of t.matchAll(priceFor)) {
    if (NOT_DEAL_VALUE.test(t.slice(m.index! + m[0].length - 40, m.index! + m[0].length + 50))) continue;
    const usd = num(m[1]) * unitMult(m[2]);
    if (usd >= 1e6 && usd <= MAX_DEAL_VALUE) return { usd, kind: "transaction" };
  }
  return null;
}

export function extractConsideration(raw: string): Consideration | null {
  const t = raw.replace(/no cash consideration[^.]*|without (?:any )?cash[^.]*|cash and cash equivalents|no (?:new )?(?:shares|stock) (?:will be|is being) issued[^.]*/gi, " ");
  const cash = /all[- ]cash|per share in cash|\$\s?\d[\d.,]*\s*(?:per share\s*)?in cash|cash consideration|in cash for each/i.test(t);
  const stock =
    /all[- ]stock|stock[- ]for[- ]stock|exchange ratio|shares? of [\w&.'’ ]{1,60}?(?:common stock|common shares|ordinary shares)? for each|\b\d+(?:\.\d+)? (?:shares|ordinary shares|common shares) of\b|in (?:\w+ )?(?:common )?stock of|per share in stock/i.test(t);
  const mixed = /cash and (?:[\d.]+ )?(?:\w+ )?(?:common )?(?:stock|shares)|stock and cash|combination of cash and|cash-and-stock|cash and stock/i.test(t);
  if (mixed || (cash && stock)) return "Mixed";
  if (stock) return "Stock";
  if (cash) return "Cash";
  return null;
}

// ---------------------------------------------------------------------------
// Advisors
// ---------------------------------------------------------------------------

export function extractAdvisors(t: string, acq: string, tgt: string, issuerRole: "acquirer" | "target" | null, tgtTicker: string | null) {
  const acquirerAdvisors: string[] = [];
  const targetAdvisors: string[] = [];
  const re = /financial advis[oe]rs?\b/gi;
  let prevEnd = 0;
  for (const m of t.matchAll(re)) {
    const i = m.index!;
    const pre = t.slice(Math.max(prevEnd, i - 260), i);
    const post = t.slice(i + m[0].length, i + m[0].length + 220);
    prevEnd = i + m[0].length;

    // "<Bank> is serving as financial advisor to X" — banks precede the phrase.
    // Only the clause right before the phrase counts (after the last sentence break).
    const clause = pre.split(/(?<![A-Z]\.[A-Z]|\b(?:Co|Inc|Corp|Ltd|L\.P|LLC|No|Mr|Ms|Dr|U\.S))[.;]\s+(?=[A-Z])/).pop() ?? pre;
    let banks = findBanks(clause);
    // Recipient: "... to Copart", "... and provided a fairness opinion to ACV", "... to H.I.G., and ..."
    const RECIPIENT = String.raw`(?:to|for)\s+(?:the\s+)?((?:[A-Z]\.)+[A-Z]?\.?[^,;]{0,60}?|[^,;.]{1,90}?)(?=[,;]|\.\s|\.$|\s+(?:and|in connection|on|with|in)\s|$)`;
    let recipientText = new RegExp(String.raw`^\s*(?:and [^,;]{0,90}?\s)?,?\s*(?:respectively\s*,?\s*)?${RECIPIENT}`).exec(post)?.[1] ?? "";
    // Otherwise, the recipient named at the end of the same sentence:
    // "Ardea is serving as lead financial advisor, Davis Polk ... and MarshBerry ... to The Baldwin Group."
    if (!recipientText) {
      const sentence = post.split(/(?<![A-Z]\.[A-Z]|\b(?:Co|Inc|Corp|Ltd|L\.P|LLC|U\.S))\.\s+(?=[A-Z])/)[0];
      const all = [...sentence.matchAll(new RegExp(String.raw`\s${RECIPIENT}`, "g"))];
      recipientText = all.at(-1)?.[1] ?? "";
    }

    // "the Company and its financial advisor, BofA Securities, ..."
    if (!banks.length) {
      const after = /^\s*,?\s*([^,.;]{2,60})/.exec(post)?.[1] ?? "";
      banks = findBanks(after);
      if (banks.length) recipientText = /\bits\s*$/i.test(pre) ? "the Company" : recipientText;
    }
    if (!banks.length) continue;

    let role: "acquirer" | "target" | null = null;
    const r = recipientText.trim();
    if (!r) role = /\bits\s*$/i.test(pre) ? issuerRole : null;
    else if (sameCompany(r, tgt) || (tgtTicker && r.includes(tgtTicker)) || /special committee|transaction committee|independent directors/i.test(r)) role = "target";
    else if (sameCompany(r, acq) || /investor group|buyer|purchaser|parent\b/i.test(r)) role = "acquirer";
    else if (/^(?:the )?company\b|board of directors|^us\b|^we\b/i.test(r)) role = issuerRole;
    if (!role) continue;
    (role === "acquirer" ? acquirerAdvisors : targetAdvisors).push(...banks);
  }
  const uniq = (xs: string[]) => [...new Set(xs)];
  return { acquirerAdvisors: uniq(acquirerAdvisors), targetAdvisors: uniq(targetAdvisors) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * "BOWMAN CONSULTING GROUP LTD." -> "Bowman Consulting Group Ltd." (EDGAR names are often upper-case),
 * without EDGAR's state-of-incorporation tags ("DIODES INC /DEL/", "AMETEK INC/", "SEALED AIR CORP/DE").
 */
export function displayName(raw: string): string {
  const name = raw.replace(/\s*\/[A-Za-z]{2,4}\/?\s*$/, "").replace(/\s*\/\s*$/, "").trim();
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Inc|Corp|Co|Ltd|Llc|Lp|Plc|Nv|Sa)\b/g, (s) => (s.length <= 3 && /Llc|Plc/.test(s) ? s.toUpperCase() : s))
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bPlc\b/g, "plc");
}

export interface PressContext {
  /** Name of the company that filed the document. */
  filerName: string;
  filerTickers: string[];
}

/**
 * The target looks like a private company: no ticker, and the release either calls it privately held
 * or names it with a company suffix ("Widget Co., LLC", "DataLoom, Inc."). Whether it is really
 * unlisted is checked later against the SEC's listed-company file.
 */
export function isPrivateTarget(targetName: string, intro: string, targetTicker: string | null): boolean {
  if (targetTicker) return false;
  const first = targetName.split(/[\s,]+/)[0];
  const at = first.length >= 3 ? intro.indexOf(first) : -1;
  if (at < 0) return false;
  const near = intro.slice(at, at + 260);
  if (/\bprivately[- ]held\b|\bprivately[- ]owned\b|\ba private (?:company|firm)\b|\bfounder[- ]led\b|\bbacked by\b[^.]{0,60}\b(?:private equity|capital|partners)\b/i.test(near)) return true;
  const escaped = targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped},?\\s+(?:Inc|LLC|L\\.L\\.C|Ltd|Limited|Corp|Corporation|GmbH|AG|S\\.A|B\\.V|N\\.V|plc|Co|L\\.P|LP|Pty|SAS|S\\.r\\.l)\\b`).test(intro);
}

/** "Acme Acquires Honeywell's Aerospace Unit": a carve-out, not a purchase of the named company. */
export function isCarveOut(headline: string, intro: string, targetName: string): boolean {
  if (/['’]s\s+[A-Za-z]|s['’]\s+[A-Za-z]/.test(targetName)) return true;
  const escaped = targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const possessive = new RegExp(`${escaped}['’]s\\s+[A-Za-z]`);
  return possessive.test(headline) || new RegExp(`(?:business|division|unit|assets|operations|segment|portfolio)\\s+of\\s+${escaped}`, "i").test(intro.slice(0, 1200));
}

export function parsePressRelease(text: string, ctx: PressContext): ParsedPress | null {
  const { headline, body } = splitHeadline(text);
  const filerDisplay = displayName(ctx.filerName);
  // "Bernhard will acquire the Company" -> name the filer explicitly so the patterns can see it.
  const intro = body.slice(0, 3000).replace(/\bthe Company\b(?!['’]s)/g, filerDisplay);
  // Terms can sit in headline bullets as well as the body.
  const terms = termsSection(flatten(text));

  const hl = headline.toLowerCase();
  const dealWords = /\b(acquir|acquisition|merger|merge|combin|go private|take (?:the )?company private|going private|to be acquired|sale to)\w*/i;
  if (!dealWords.test(headline) && !/definitive (?:merger |arrangement )?agreement|agreement and plan of merger|merger agreement|arrangement agreement/i.test(intro)) return null;
  // Unsolicited proposals and non-binding bids aren't signed deals.
  if (/\b(?:propos(?:es|ed|al)|non-binding|unsolicited|indication of interest|letter to (?:the )?board|rejects?|bid for)\b/i.test(headline) && !/definitive (?:merger )?agreement|agreement and plan of merger/i.test(headline + " " + intro.slice(0, 600))) {
    return null;
  }
  // Financing / capital markets releases that happen to mention "premium" — unless the body clearly
  // describes an acquisition (deal sub-headlines often say "accretive to earnings").
  const dealIntro = /definitive (?:merger |arrangement )?agreement|agreement and plan of merger|(?:will|to) acquire\b|to be acquired/i.test(intro.slice(0, 1500));
  if (/\b(?:notes?|offering|debentures|credit facility|dividend|earnings|results|guidance|tender offer for .*notes)\b/i.test(headline) && !dealWords.test(headline) && !dealIntro) return null;

  let kind: PressKind = "announcement";
  if (/\bterminat/.test(hl.slice(0, 160))) kind = "termination";
  // Completion only when the headline's main verb says so ("X Completes Acquisition of Y"),
  // not when a sub-clause mentions closing or completion.
  else if (
    /^.{0,90}?\b(?:completes?|completed|closes|closed|finalizes|finalized)\b\s+(?:its\s+|the\s+)?(?:previously announced\s+)?(?:\$[\d.,]+\s*(?:billion|million)\s+)?(?:acquisition|merger|sale|combination|business combination|tender offer|transaction|take[- ]private)/i.test(
      headline,
    ) ||
    /^(?:completion|closing) of (?:the )?(?:acquisition|merger)/i.test(headline) ||
    // "Acme Acquires Widget" / "Acme Has Acquired Widget": signed and closed at once (typical for private targets).
    /^.{0,90}?\b(?:acquires|has acquired)\b/i.test(headline) ||
    (/^.{0,90}?\bannounces (?:the |its )?acquisition of\b/i.test(headline) && /\b(?:has|have) (?:completed|closed|acquired)\b|\b(?:completed|closed) (?:its|the) acquisition\b/i.test(intro.slice(0, 900)))
  ) {
    kind = "completion";
  }
  else if (
    /previously announced|previously disclosed/i.test(intro.slice(0, 600)) ||
    /\b(?:(?:stockholders?|shareholders?|regulators?|court|members) (?:approve|approval)|receives? (?:\w+ )?approval|go-shop|expiration|expires|record date|special meeting|clearance|\bhsr\b|extends?|update|adjourn|early termination of waiting)/i.test(hl)
  ) {
    kind = "update";
  }

  const mentions = tickerMentions(body.slice(0, 5000));

  let parties = matchParties(headline, HEADLINE_PATTERNS);
  if (!parties) {
    const sym = SYMMETRIC_HEADLINE.exec(headline);
    if (sym) {
      const a = cleanPartyName(sym[1]);
      const b = cleanPartyName(sym[2]);
      if (isPlausibleName(a) && isPlausibleName(b) && !sameCompany(a, b)) parties = resolveSymmetric(a, b, intro);
    }
  }
  const bodyParties = matchParties(intro, BODY_PATTERNS);
  if (!parties) parties = bodyParties;
  // Headline "go private" / "announces agreement" with the issuer as target.
  if (!parties && /go(?:ing)? private|take (?:the )?company private|to be acquired/i.test(headline) && bodyParties) parties = bodyParties;
  // The buyer filed this 8-K: "RBC bearings Incorporated Acquires …", "The Arena Group d/b/a Paradium.AI Acquires …"
  // have buyer names the patterns can't read, so take the filer as the buyer when it's named in the headline.
  if (!parties) {
    const buy = new RegExp(String.raw`^(.{2,90}?)\s+(?i:acquires|has acquired|completes (?:the |its )?acquisition of|announces (?:the |its )?acquisition of|to acquire|agrees to acquire|announces (?:a )?(?:definitive )?agreement to acquire)\s+${LEAD_QUAL}${NAME}(?:${STOP}|${SUBHEAD_STOP}|${TAIL_STOP})`).exec(headline);
    const filerWord = filerDisplay.split(/[\s,.]+/).find((w) => w.length >= 3)?.toLowerCase();
    const namesFiler = buy && ((filerWord && buy[1].toLowerCase().includes(filerWord)) || ctx.filerTickers.some((t) => new RegExp(`\\b${t}\\b`).test(buy[1])));
    if (buy && namesFiler) {
      const tgt = cleanPartyName(buy[2]);
      if (isPlausibleName(tgt) && !sameCompany(tgt, filerDisplay)) parties = { acq: filerDisplay, tgt };
    }
  }
  if (!parties) return null;

  // Prefer the fuller body names when they clearly extend the same name (e.g. "ACV" -> "ACV Auctions Inc."),
  // but never adopt run-on captures that cross a sentence ("CD&R. About Sealed Air ...").
  const extends_ = (longer: string, shorter: string) =>
    longer.length > shorter.length && longer.length <= 70 && longer.toLowerCase().startsWith(shorter.toLowerCase()) && !/\.\s+[A-Z]/.test(longer.slice(shorter.length));
  if (bodyParties) {
    if (extends_(bodyParties.acq, parties.acq)) parties.acq = bodyParties.acq;
    if (extends_(bodyParties.tgt, parties.tgt)) parties.tgt = bodyParties.tgt;
  }

  // "Thoma Bravo PROS Shareholders" -> "Thoma Bravo": cut the acquirer where the target's name starts.
  const tgtFirst = parties.tgt.replace(/^The\s+/, "").split(/[\s,]+/)[0];
  if (tgtFirst.length >= 3) {
    const at = parties.acq.indexOf(` ${tgtFirst}`);
    if (at > 0) parties.acq = parties.acq.slice(0, at);
  }
  parties.acq = parties.acq.replace(/\s+(?:Shareholders|Stockholders)$/, "");

  const acquirer = withTicker(parties.acq, mentions);
  const target = withTicker(parties.tgt, mentions);
  // Buying a division or assets of a named company is not buying that company.
  if (isCarveOut(headline, intro, target.name)) return null;

  const issuerRole: "acquirer" | "target" | null =
    sameCompany(ctx.filerName, target.name) || (target.ticker && ctx.filerTickers.includes(target.ticker))
      ? "target"
      : sameCompany(ctx.filerName, acquirer.name) || (acquirer.ticker && ctx.filerTickers.includes(acquirer.ticker))
        ? "acquirer"
        : null;

  const value = extractValue(terms);
  const advisors = extractAdvisors(flatten(text), acquirer.name, target.name, issuerRole, target.ticker);

  return {
    kind,
    headline,
    acquirer,
    target,
    privateTarget: isPrivateTarget(target.name, intro, target.ticker),
    pricePerShare: extractPrice(terms),
    premiumPct: extractPremium(terms),
    valueUsd: value?.usd ?? null,
    valueKind: value?.kind ?? null,
    consideration: extractConsideration(terms),
    ...advisors,
  };
}
