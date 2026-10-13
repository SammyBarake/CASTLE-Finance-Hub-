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
import { cleanPartyName, isPlausibleName, normalizeName, sameCompany, titleCaseCaps } from "./names";

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
  /** Merger 8-K: the signing date it restates ("As previously announced, on April 26, 2021, … entered into …"). */
  signedOn?: string;
}

// ---------------------------------------------------------------------------
// Headline & body
// ---------------------------------------------------------------------------

const SKIP_LINE =
  /^(?:ex-?\d|exhibit\b|\d+$|[\w-]+\.html?$|press release|news release|(?:for )?immediate (?:release|distribution)|contacts?:|media contact|investor contact|tsxv?:|nyse|nasdaq|otc|\(?nyse|\(?nasdaq|[a-z]+ \d{1,2},? \d{4}$|\d{4}$|page \d)/i;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept?\\.?|Oct\\.?|Nov\\.?|Dec\\.?";
const DATELINE = new RegExp(`(?:^|\\n)[^\\n]{0,160}?(?:${MONTHS})\\s*,?\\s*\\d{1,2}\\s*,\\s*(?:19|20)\\d{2}\\s*[-–—/]+\\s*`, "i");

// SEC cover-page and filing-wrapper lines that precede the actual release in 425 / DEFA14A documents.
const COVER_LINE =
  /securities and exchange commission|washington,? d\.?\s?c\.?|pursuant to rule|filed by|subject company|commission file|schedule 14a|form 8-k|form 425|current report|check the appropriate box|registrant|soliciting material|securities exchange act of 1934|^(?:DEFA14A|425|8-K|SC TO-C|SC14D9C|EX-99[.\d]*)\s+\d+\s+\S+\.html?/i;
/** "(mark one)"-style fragments: all lower-case. */
const LOWERCASE_FRAGMENT = /^\(?[a-z ]+\)?$/;
/** Media / investor contact lines: a phone number or e-mail address, a PR firm or proxy solicitor, "N E W S". */
const CONTACT_LINE =
  /\(?\b\d{3}\)?[\s.-]\d{3}[-.]\d{4}\b|\b[\w.-]+@[\w-]+\.(?:com|net|org)\b|^(?:Sard Verbinnen|Joele Frank|Brunswick Group|Kekst|Abernathy MacGregor|MacKenzie Partners|Innisfree|D\.\s?F\. King|Georgeson|Okapi Partners|FTI Consulting|Finsbury|Gasthalter|Prosek)\b|^(?:[A-Z] ){3,}[A-Z]$|\bcontacts?:?$|^release$/i;
/** Words that make a headline about a deal. */
const DEAL_WORDS = /\b(acquir|acquisition|merger|merge|combin|go private|take (?:the )?company private|going private|to be acquired|sale to)\w*/i;
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
  const body = flatten(dl ? text.slice(dl.index + dl[0].length) : text);
  const lines = head
    .split(/\n/)
    // A label on the headline's line: "RELEASE Banner Corporation to Acquire …" ("NEWS" as a logo), "Immediate Release …".
    .map((l) => l.replace(/&middot;|·/g, "•").replace(HEADLINE_LABEL, "").trim())
    .filter(Boolean);
  const block = dl ? collectHeadline(lines, lines.length - 1, -1) : collectHeadline(lines, 0, 1);

  // Reading back from the dateline stops at sub-headlines ("Merger Delivers Significant Value …", "Highlights:") when
  // the headline sits further up, and skips across bullets; reading forward without one runs into them. So the first
  // line naming the deal wins: above the block read back, or inside the block read forward. It takes the line above
  // when it can't start a headline itself ("… Enters into a Definitive" / "Agreement to be Acquired by …"), and the
  // lines below only where the headline wraps onto them, never a sub-headline ("… to Acquire Tableau" / "World's #1 CRM").
  const usable = (i: number) => i >= 0 && i < lines.length && !BULLET.test(lines[i]) && !isBoiler(lines[i]) && lines[i].length <= 300;
  const top = lines.findIndex((l, i) => (dl ? i <= block.start : i >= block.start && i <= block.end) && usable(i) && (DEAL_WORDS.test(l) || DEAL_TERMS.test(l)));
  if (top < 0) return { headline: block.text, body };

  const picked = [lines[top]];
  // A deal announced with results: "RealD Inc. Reports Second Quarter … Results" / "Announces agreement to be acquired
  // by Rizvi Traverse" reads as "RealD Inc. Announces agreement to be acquired by Rizvi Traverse".
  const results = /^(?:Announces|Signs|Agrees|Enters|Completes|Reaches)\b/.test(lines[top]) ? RESULTS_LINE.exec([top - 2, top - 1].filter(usable).map((i) => lines[i]).join(" ")) : null;
  if (results) picked.unshift(results[1]);
  else for (let i = top - 1; i >= 0 && top - i <= 2 && usable(i) && (CONTINUES_ABOVE.test(lines[i + 1]) || wraps(lines[i], lines[i + 1])); i--) picked.unshift(lines[i]);
  for (let i = top + 1; picked.length < 3 && usable(i) && wraps(lines[i - 1], lines[i]) && picked.join(" ").length + lines[i].length <= 300; i++) picked.push(lines[i]);
  return { headline: flatten(picked.join(" ")), body };
}

const HEADLINE_LABEL = /^(?:(?:For |FOR )?(?:Immediate|IMMEDIATE) (?:Release|RELEASE|Distribution|DISTRIBUTION)|(?:NEWS |PRESS )?RELEASE):?\s+(?=[A-Z])/;
/** Deal wording that locates a headline without making it one ("Instructure and Thoma Bravo Revise Definitive Agreement"). */
const DEAL_TERMS = /\bdefinitive (?:merger )?agreement|\bmerger agreement|\btender offer\b/i;
/** Lines that can't start a headline: they continue the line above. */
const CONTINUES_ABOVE = /^(?:and|or|of|for|to|with|by|in|at|agreement|definitive|merger|acquisition|combination|transaction|signs|agrees?|enters|announces?|completes?)\b/i;
/** Words that can't start a sub-headline: the headline goes on ("… Enters into Definitive Merger" / "Agreement to be …"). */
const CONTINUES_HEADLINE = /^(?:and|or|of|for|to|by|in|at|agreement|acquired|definitive)\b/i;
/** One adjective before "acquisition of": "EQT Announces Transformative Acquisition of Equitrans Midstream". Not "proposed" (often a hostile bid). */
const DEAL_ADJ = String.raw`(?:(?:transformative|transformational|strategic|accretive|landmark|compelling|all-stock|all-cash)\s+)?`;
/** A headline that announces a new deal. */
const ANNOUNCES_DEAL = new RegExp(
  String.raw`\b(?:to acquire|to be acquired|agree(?:s|ment)? to (?:acquire|merge|combine|be acquired)|announces? (?:the )?${DEAL_ADJ}(?:acquisition|agreement|merger|definitive)|definitive (?:merger )?agreement|to merge|to combine)\b`,
  "i",
);
/** "<Company> Reports / Announces … Results / Earnings". */
const RESULTS_LINE = /^(.{2,80}?)\s+(?:Reports|Announces|Posts|Releases|Delivers)\b.*\b(?:Results|Earnings)\b/i;
const allCaps = (l: string) => /[A-Z]/.test(l) && !/[a-z]/.test(l);
/** Line `b` carries on the headline of line `a` (one headline wrapped over two lines), not a new sub-headline. */
const wraps = (a: string, b: string) =>
  /^[a-z]/.test(b) || CONTINUES_HEADLINE.test(b) || /\b(?:for|to|of|by|with|and|the|a|an|in|on|into|be|acquire|merge|combine|definitive)$/i.test(a) || (allCaps(a) && allCaps(b));

const isBoiler = (line: string) =>
  SKIP_LINE.test(line) || COVER_LINE.test(line) || LOWERCASE_FRAGMENT.test(line) || line.length < 6 || (line.length < 120 && CONTACT_LINE.test(line));

/** Up to three headline lines from `lines[from]`, read forward or backward, ending at boilerplate (and, forward, at bullets). */
function collectHeadline(lines: string[], from: number, step: 1 | -1): { start: number; end: number; text: string } {
  const picked: number[] = [];
  let seenBullets = false;
  for (let i = from; i >= 0 && i < lines.length; i += step) {
    const line = lines[i];
    if (BULLET.test(line)) {
      seenBullets = true;
      if (step === 1 && picked.length) break;
      continue;
    }
    if (isBoiler(line)) {
      if (picked.length) break;
      continue;
    }
    // Reading backwards: a long paragraph right above the dateline is body copy, not a headline.
    if (step === -1 && !picked.length && !seenBullets && line.length > 400) continue;
    picked.push(i);
    if (picked.map((j) => lines[j]).join(" ").length > 260 || picked.length >= 3) break;
  }
  picked.sort((a, b) => a - b);
  return { start: picked[0] ?? lines.length, end: picked.at(-1) ?? -1, text: flatten(picked.map((j) => lines[j]).join(" ")) };
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
const TAIL_STOP = String.raw`(?=\s(?:Subject|Transaction|Deal|Acquisition|Agreement|Following|Pending|Upon|After|Expanding|Adding|Creating|Strengthening|Establishing|Accelerating|Enhancing|Broadening|Extending|SUBJECT|TRANSACTION|DEAL|ACQUISITION|AGREEMENT|FOLLOWING|PENDING|EXPANDING|ADDING|CREATING|STRENGTHENING|ESTABLISHING|ACCELERATING|ENHANCING|BROADENING|EXTENDING)\b)`;

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
    // ("TowerBrook and Further Global Announce Acquisition of …": two buyers, one target.)
    re: rx(String.raw`^${NAME}\s+(?i:acquires|has acquired|announces? (?:the |its |their )?${DEAL_ADJ}acquisition of|announces (?:it has|that it has) acquired)\s+${LEAD_QUAL}${NAME}(?:${STOP}|${SUBHEAD_STOP}|${TAIL_STOP})`),
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

// A dual listing names the home exchange first or last: "(TSX: SSL; NYSE: SAND)", "(NYSE: SAND; TSX: SSL)".
const TICKER_RE =
  /([A-Z][A-Za-z0-9&.,'’\- ]{1,70}?)\s*\((?:"[^"]*"\)?\s*\()?(?:the\s+)?(?:(?:TSXV|TSX|LSE|ASX|AIM)\s*:\s*[A-Z][A-Z0-9.\-]{0,6}\s*[;,]\s*)?(NYSE American|NYSE Arca|NYSE|NASDAQ|Nasdaq|Cboe|OTCQX|OTCQB|OTC|TSXV|TSX|LSE|ASX)(?:\s+and\s+[A-Za-z]+)?\s*:\s*([A-Z][A-Z0-9.\-]{0,6})(?:\s*[;,]\s*(?:TSXV|TSX|LSE|ASX|AIM)\s*:\s*[A-Z][A-Z0-9.\-]{0,6})?\s*\)/g;

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

function withTicker(name: string, all: PartyMention[], other?: string): PartyMention {
  // A listing whose name runs both parties together ("Tamboran Resources and Falcon Oil & Gas Ltd. (TSXV: FO)", "SKF and
  // Kaydon Corporation") belongs to neither alone; "Infinity Property and Casualty Corporation" is one name.
  const mentions = all.filter((m) => {
    const after = m.name.split(/\s+and\s+/).slice(1).join(" and ");
    return !after || /\sand\s/.test(name) || !other || !sameCompany(after, other);
  });
  // A party written as its own ticker ("UWMC Announces Strategic Acquisition of TWO"): the mention listing that ticker
  // carries the name ("UWM Holdings Corporation (NYSE: UWMC)"). Written exactly as the ticker ("Land" is not LAND), and
  // the name starts with the ticker's letter: a mention run can carry page furniture ("About Dell Dell Inc.", "Page 5 …").
  const byTicker = mentions.find(
    (m) => m.ticker === name.trim() && m.name.length > name.length && isPlausibleName(m.name) && !/^(?:About|Page|Links)\b/.test(m.name) && m.name.replace(/^The\s+/, "")[0]?.toUpperCase() === m.ticker?.[0],
  );
  if (byTicker && !mentions.some((m) => sameCompany(m.name, name))) return { name: byTicker.name, ticker: byTicker.ticker, exchange: byTicker.exchange };
  let matches = mentions.filter((m) => sameCompany(m.name, name));
  // A description in front of the name: "Specialty Insurance Company ProSight Global" is "ProSight Global, Inc.".
  if (!matches.length) {
    const plain = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9&]+/g, " ").replace(/\b(?:inc|incorporated|corp|corporation|ltd|limited|llc|plc|co|lp)\b/g, " ").replace(/\s+/g, " ").trim();
    const n = plain(name);
    matches = mentions.filter((m) => {
      const core = plain(m.name);
      return core.split(" ").length >= 2 && n.endsWith(` ${core}`);
    });
    if (matches.length) {
      const best = matches.find((m) => m.exchange && US_EXCHANGES.has(m.exchange)) ?? matches[0];
      return { name: best.name, ticker: best.ticker, exchange: best.exchange };
    }
  }
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

/**
 * Numbers that describe a market, a combined company or a firm's history, not this deal's price. A firm's track record
 * names a count of deals ("376 transactions completed, valued at $212 billion in the year ended March 31, 2020";
 * "80 investments … 200 add-on acquisitions … with a total value of approximately $50 billion"), and a debt buyer's
 * portfolio has a face value ("a face value of over $130 billion").
 */
const NOT_DEAL_VALUE =
  /\b(?:market|markets|TAM|industry|opportunit\w*|combined (?:company|enterprise|business|entity)|pro forma|since (?:its )?inception|since \d{4}|ha(?:s|ve) (?:managed|invested|completed|deployed)|assets under management|AUM|portfolio compan\w*|projected to|expected to reach|forecast|CAGR|annual(?:ized)? revenue|revenues? of|sales of|backlog|in \d{4}|face value|\d[\d,]* (?:transactions|deals|investments|add-on acquisitions|acquisitions))\b/i;
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
    // A CVR or milestone payment ("plus one CVR worth up to $3.50 per share") is not the offer price.
    if (/contingent value right|\bCVRs?\b|milestones?|earn-?out|\bup to\s*$/i.test(clause.slice(-120))) continue;
    // Nor a buyback in the target's earnings release ("repurchased 0.9 million shares at an average price of $23.04 per
    // share": Beazer, whose offer was $33.50), a share price quoted for reference ("based on Herman Miller's five-day
    // volume weighted average price of $43.94 per share"), a collar bound ("provided that this volume weighted average
    // price is no less than $23.12 per share"; "Sentio stockholders will receive … no less than $14.37 per share" is
    // the offer) or a top-up ("up to an additional $0.55 per share").
    if (/repurchas|buy-?backs?/i.test(clause.slice(-120))) continue;
    if (/(?:(?:average|closing|trading|market)(?: (?:stock|share|sale|trading))? price|\bVWAP)(?: of)?(?: approximately| about)?\s*$|\badditional\s*$/i.test(before)) continue;
    if (/\b(?:less|greater|more|lower|higher) than\s*$/i.test(before) && /\bprice\b|\bVWAP\b/i.test(clause.slice(-120))) continue;
    let score = 0;
    // "acquire[d] … for" may run past an abbreviation: "to be acquired by Dream Finders Homes, Inc. for $33.50".
    if (/receive|for each|in exchange for|purchase price|offer price|offer of|consideration|acquire(?:[^.]|\b(?:Inc|Corp|Co|Ltd|Bros)\.){0,80}\bfor\b|valued at|implies|implied|equal to|equivalent to|price of|at a price/i.test(before)) score += 2;
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
    /((?:enterprise|equity|transaction|deal|aggregate|total|purchase|implied)(?:\s+(?:equity|enterprise|transaction|deal|purchase))?\s+(?:value|price|consideration)|valued at|valuing\b[\w\s,]{0,40}?\bat|value of|values? [\w\s']{0,40}? at)[^$.;•]{0,70}?(?:(?:US|U\.S\.|C|CAD|A)?\$|\bUSD\s?)\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,3})?)\s*(trillion|billion|million|bn|mm|mn|B|M)\b/gi;
  for (const m of t.matchAll(re)) {
    const lead = m[1].toLowerCase();
    if (/per share/i.test(t.slice(m.index!, m.index! + m[0].length + 12))) continue;
    // Skip non-USD currencies (C$, A$, NT$, HK$, S$ …) — we only report USD. "NT$6.8 billion (approximately US$223 million)".
    if (/(?:^|[\s(])(?:C|CA|CAD|A|AU|AUD|NT|HK|NZ|S|SG|R|MX|Mex)\$/.test(m[0])) continue;
    if (NOT_DEAL_VALUE.test(valueContext(t, m.index!, m[0].length))) continue;
    // "$200 million of run-rate cost synergies" is not a price.
    // Nor a later instalment: "Thermo Fisher has agreed to pay $125 million in January 2027".
    const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 60);
    if (/^\s*(?:of|in)?\s*(?:(?:annual|annualized|run-rate|cost|revenue|pre-tax|net)\s+)*synerg/i.test(after)) continue;
    if (/^\s*in\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/.test(after)) continue;
    // Nor a year's activity: "valued at $212 billion in the year ended March 31, 2020" (a firm's track record).
    if (/^\s*(?:in|during|for|over) the (?:fiscal |twelve months |calendar )?(?:year|twelve months) ended/i.test(after)) continue;
    // Nor costs or "value creation": "$2.8 billion in value creation …, net of ~$400 million in expected one-time
    // transaction and integration costs" (Aon / NFP).
    if (/^\s*(?:in|of)\s+(?:(?:expected|estimated|one-time|total)\s+)*(?:value creation|transaction|integration|restructuring|financing)\b/i.test(after)) continue;
    // The size of what the deal creates, not its price: "creating a premier … business, with an initial enterprise
    // value over $35 billion" (EQT / Equitrans), "the resulting company will have …".
    // Same sentence only: "… acquire Webster for $12.3 billion" after a sentence about creating a bank still counts.
    const sentenceBefore = t.slice(Math.max(0, m.index! - 160), m.index!).split(/[.;•]\s|\s[•+]\s/).pop() ?? "";
    if (/\b(?:creat(?:e|es|ing)|form(?:s|ing)\s+(?:a|an|the)|combined|resulting)\b/i.test(sentenceBefore)) continue;
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

function classifyConsideration(t: string, offer = false): Consideration | null {
  const cash =
    /all[- ]cash|per share in cash|\$\s?\d[\d.,]*\s*(?:per share\s*)?in cash|cash consideration|in cash for each/i.test(t) ||
    // In the sentence saying what holders get only: "£4.39 ($7.06) in cash". Not "$80 million in cash": a lump sum
    // there is often a CVR or one part of a merger of equals, and elsewhere the balance sheet.
    (offer && /\d\)\s+in cash/i.test(t));
  const stock =
    /all[- ]stock|stock[- ]for[- ]stock|exchange ratio|shares? of [\w&.'’ ]{1,60}?(?:common stock|common shares|ordinary shares)? for each|\b\d+(?:\.\d+)? (?:shares|ordinary shares|common shares) of\b|in (?:\w+ )?(?:common )?stock of|per share in stock/i.test(t) ||
    // "one Union Pacific common share and $88.82 in cash", "0.5 Acme ADSs", "one ListCo Share and $5.00 in cash" (a count
    // of shares, not a $ price per share)
    /(?<![$\d.,]\s?)\b(?:one|two|three|\d+\.\d+|\d+)\s+(?:[A-Z][\w&.'’-]*\s+){0,4}(?:common\s+|ordinary\s+)?(?:[Ss]hares?|ADSs?)\b(?!\s+(?:outstanding|repurchase))/.test(t) ||
    // An exchange ratio before legal words: "3.8721 fully paid and non-assessable Parent Shares" (Penumbra).
    // Not "0.640 KMI warrants per share", nor a share count ("2.785 million shares").
    /(?<![$\d.,]\s?)\b\d+\.\d{3,4}\s+(?!million|billion)(?:[\w&.'’-]+\s+){0,6}?(?<!\bper\s)(?:[Ss]hares?|ADSs?)\b/.test(t);
  // A cash-or-stock election is mixed: "at the election of the holder … 3.8721 Parent Shares … or $374.00 in cash".
  const mixed =
    /cash and (?:[\d.]+ )?(?:\w+ )?(?:common )?(?:stock|shares)|stock and cash|combination of cash and|cash-and-stock|cash and stock|\b(?:cash|stock) election\b/i.test(t);
  if (mixed || (cash && stock)) return "Mixed";
  if (stock) return "Stock";
  if (cash) return "Cash";
  return null;
}

export function extractConsideration(raw: string): Consideration | null {
  const t = raw.replace(/no cash consideration[^.]*|without (?:any )?cash[^.]*|cash and cash equivalents|no (?:new )?(?:shares|stock) (?:will be|is being) issued[^.]*/gi, " ");
  // The sentence saying what holders get decides it. Financing talk elsewhere ("funded with cash on hand and new
  // shares") made an all-cash deal (HPE / Juniper) look mixed.
  const offer = /(?:[^.]|\.(?=\d))*\b(?:will receive|would receive|to receive|right to receive|entitled to receive)\b(?:[^.]|\.(?=\d))*/i.exec(t)?.[0];
  return (offer && classifyConsideration(offer, true)) || classifyConsideration(t);
}

// ---------------------------------------------------------------------------
// Advisors
// ---------------------------------------------------------------------------

export function extractAdvisors(t: string, acq: string, tgt: string, issuerRole: "acquirer" | "target" | null, tgtTicker: string | null) {
  const acquirerAdvisors: string[] = [];
  const targetAdvisors: string[] = [];
  const re = /financial advis[oe]rs?\b/gi;
  let prevEnd = 0;
  // An "Advisors" section heading names whom the lines under it advise: "Herc Advisors Guggenheim Securities, LLC is
  // serving as lead financial advisor … Credit Agricole … is serving as co-financial advisor".
  let heading: { name: string; at: number } | null = null;
  for (const m of t.matchAll(re)) {
    const i = m.index!;
    const pre = t.slice(Math.max(prevEnd, i - 260), i);
    const post = t.slice(i + m[0].length, i + m[0].length + 220);
    prevEnd = i + m[0].length;

    // "<Bank> is serving as financial advisor to X" — banks precede the phrase.
    // Only the clause right before the phrase counts (after the last sentence break).
    const clause = pre.split(/(?<![A-Z]\.[A-Z]|\b(?:Co|Inc|Corp|Ltd|L\.P|LLC|No|Mr|Ms|Dr|U\.S))[.;]\s+(?=[A-Z])/).pop() ?? pre;
    // "Citi is acting as Pfizer's financial advisor": the possessive names the recipient (not a bank).
    const possessive = /((?:[A-Z][\w&.’-]*\s+){0,4}?[A-Z][\w&.’-]*)['’]s\s+(?:lead\s+|exclusive\s+|sole\s+|co-|joint\s+|independent\s+)*$/.exec(clause);
    const headed = /(?:^|\s)((?:[A-Z][\w&.'’-]*\s){0,3}?[A-Z][\w&.'’-]*)\s+Advis[oe]rs\s*:?\s+(?=[A-Z])/.exec(clause);
    if (headed && !findBanks(headed[1]).length) heading = { name: headed[1], at: i };
    let banks = findBanks(possessive ? clause.slice(0, possessive.index) : clause);
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

    if (possessive && !findBanks(possessive[1]).length) recipientText = possessive[1];
    // "Financial advisors to Clearlake include Morgan Stanley, Goldman Sachs, JP Morgan, …"
    const listed = /^\s*(?:to|for)\s+(?:the\s+)?([^,;.]{1,60}?)\s+(?:include|includes|included|are|were)\s+([^.;]{2,300})/.exec(post);
    if (!banks.length && listed && findBanks(listed[2]).length) {
      banks = findBanks(listed[2]);
      recipientText = listed[1];
    }
    // "Lazard is acting as lead financial advisor with BofA Securities acting as co-advisor …"
    const co = /^\s*,?\s*(?:with|and)\s+([^,;.]{2,80}?)\s+(?:acting|serving)\s+as\s+(?:a\s+)?co-(?:financial\s+)?advis[oe]r/.exec(post);
    if (banks.length && co) banks = [...banks, ...findBanks(co[1])];
    // "the Company and its financial advisor, BofA Securities, ..."
    if (!banks.length) {
      const after = /^\s*,?\s*([^,.;]{2,60})/.exec(post)?.[1] ?? "";
      banks = findBanks(after);
      if (banks.length) recipientText = /\bits\s*$/i.test(pre) ? "the Company" : recipientText;
    }
    if (!banks.length) continue;

    let role: "acquirer" | "target" | null = null;
    const r = recipientText.trim();
    // "ExxonMobil" is Exxon Mobil Corporation: compare without spaces too.
    const squash = (s: string) => normalizeName(s).replace(/\s+/g, "");
    const same = (a: string, b: string) => sameCompany(a, b) || (squash(a).length >= 4 && squash(a) === squash(b));
    // A short form in a possessive: "Bel's financial advisor" (BEL Fuse Inc.), "ANB's" (ANB Holdings, Inc.).
    const short = (a: string, full: string) => {
      const [x, y] = [normalizeName(a), normalizeName(full)];
      return !!possessive && x.length >= 3 && (y === x || y.startsWith(`${x} `));
    };
    if (!r) role = /\bits\s*$/i.test(pre) ? issuerRole : null;
    else if (r === possessive?.[1] && short(r, tgt) !== short(r, acq)) role = short(r, tgt) ? "target" : "acquirer";
    else if (same(r, tgt) || (tgtTicker && r.includes(tgtTicker)) || /special committee|transaction committee|independent directors/i.test(r)) role = "target";
    else if (same(r, acq) || /investor group|buyer|purchaser|parent\b/i.test(r)) role = "acquirer";
    else if (/^(?:the )?company\b|board of directors|^us\b|^we\b/i.test(r)) role = issuerRole;
    if (!role && heading && i - heading.at < 700) role = same(heading.name, tgt) ? "target" : same(heading.name, acq) ? "acquirer" : null;
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
  const name = raw.replace(/\s*[\\/]\s*[A-Za-z]{2,4}\s*[\\/]?\s*$/, "").replace(/\s*[\\/]\s*$/, "").trim();
  if (name !== name.toUpperCase()) return name;
  // Several words: the shared rules keep acronyms and suffixes ("NORTHSTRIVE FUND II LP" -> "Northstrive Fund II LP").
  if (/\s/.test(name)) return titleCaseCaps(name);
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

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PART_WORDS =
  /^(?:\s+[\w&.,-]+){0,4}?\s+(?:business(?:es)?|division|unit|assets|operations|segments?|portfolio|subsidiar(?:y|ies)|product lines?|products|brands?|plants?|facilit(?:y|ies)|stake|interest|properties|rights)\b/i;
/** After a possessive: a part of the company ("'s valve unit", "'s Environmental Solutions Business"). */
const PART_OF = { test: (rest: string) => /^\s+[a-z]/.test(rest) || PART_WORDS.test(rest) };

/**
 * "Acme Acquires Honeywell's Aerospace Unit": a carve-out, not a purchase of the named company. A possessive followed
 * by a name is the name itself ("Mama Mary's Pizza Crusts", "Papa Murphy's").
 */
export function isCarveOut(headline: string, intro: string, targetName: string): boolean {
  const own = /(?:['’]s|s['’])(\s.*)$/.exec(targetName);
  if (own && PART_OF.test(own[1])) return true;
  const possessive = new RegExp(`${escapeRx(targetName)}['’]s(\\s.{0,80})`).exec(headline);
  if (possessive && PART_OF.test(possessive[1])) return true;
  // The headline goes on with an asset word right after the name (or a list of them): "… Acquisition of Producing
  // Properties in the Gulf", "… of South32's Bauxite, Alumina, and Aluminum Assets". Only after the verb: "Rouse
  // Properties Reports … Results" names the company.
  if (new RegExp(`(?:acquisition of|acquires?|acquired|acquiring)\\s+(?:the\\s+)?${escapeRx(targetName)}(?:,\\s+(?:and\\s+)?[A-Z][\\w&.-]*)*,?\\s+(?:business(?:es)?|division|unit|assets|operations|portfolio|properties|product lines?|rights|production|reserves|acreage|leases|wells|royalt(?:y|ies))\\b`, "i").test(headline)) return true;
  // The unit's own name may stand in between: "… to Acquire the L3Harris Space and Navigation Business".
  // Case matters for the unit's name (capitalised words), so the verb and the business word list both cases.
  if (new RegExp(`(?:[Aa]cquisition [Oo]f|ACQUISITION OF|[Aa]cquires?|ACQUIRES?|[Aa]cquired|ACQUIRED|[Aa]cquiring|ACQUIRING)\\s+(?:the|The|THE)\\s+${escapeRx(targetName)}\\s+(?:[A-Z][\\w&.-]*\\s+(?:and\\s+|AND\\s+|&\\s+)?){1,3}(?:Business(?:es)?|BUSINESS(?:ES)?|Division|DIVISION|Unit|UNIT|Segment|SEGMENT|Operations|OPERATIONS)\\b`).test(headline)) return true;
  const start = intro.slice(0, 1200);
  // Assets bought from the named company: "to acquire DJ Basin crude oil and gas gathering and storage assets from
  // Chevron" (Hess Midstream). Only "assets": "business from Michigan Insurance Company in its pooling agreement" is
  // premiums, and a possessive in the text is often the whole company ("LHC Group's outstanding common stock").
  if (new RegExp(`\\bassets\\s+from\\s+${escapeRx(targetName)}`, "i").test(intro)) return true;
  return new RegExp(`(?:business|division|unit|assets|operations|segment|portfolio)\\s+of\\s+${escapeRx(targetName)}`, "i").test(start);
}

const NAME_END = /^(?:for|in|at|to|from|with|via|and|or|creating|valued|transaction|deal|acquisition|agreement|merger|subject|following|per)$/i;

/** The headline's name with its possessive kept, when a name follows it: "Mama Mary" → "Mama Mary's Pizza Crusts". */
function withApostrophe(name: string, headline: string): string {
  const m = new RegExp(`(?:^|\\s)${escapeRx(name)}['’]s((?:\\s+[A-Z0-9][\\w&.'’-]*)*)`).exec(headline);
  if (!m || PART_OF.test(headline.slice(m.index + m[0].length - m[1].length))) return name;
  const words: string[] = [];
  for (const w of m[1].split(/\s+/).filter(Boolean)) {
    if (NAME_END.test(w)) break;
    words.push(w);
  }
  return [`${name}'s`, ...words].join(" ");
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
  // "Early termination of the HSR waiting period" is an antitrust clearance, the opposite of a deal ending.
  if (/\bterminat/.test(hl.slice(0, 160)) && !/\b(?:early\s+)?terminat\w*\s+of\s+(?:the\s+)?(?:applicable\s+)?(?:Hart-Scott-Rodino|HSR|waiting period)|waiting period[^.]{0,40}terminat/.test(hl.slice(0, 200)))
    kind = "termination";
  // Completion only when the headline's main verb says so ("X Completes Acquisition of Y"),
  // not when a sub-clause mentions closing or completion.
  else if (
    /^.{0,90}?\b(?:completes?|completed|closes|closed|finalizes|finalized)\b\s+(?:its\s+|the\s+)?(?:previously announced\s+)?(?:\$[\d.,]+\s*(?:billion|million)\s+)?(?:acquisition|merger|sale|combination|business combination|tender offer|transaction|take[- ]private)/i.test(
      headline,
    ) ||
    /^(?:completion|closing) of (?:the )?(?:acquisition|merger)/i.test(headline) ||
    // "Acme Acquires Widget" / "Acme Has Acquired Widget": signed and closed at once (typical for private targets).
    /^.{0,90}?\b(?:acquires|has acquired)\b/i.test(headline) ||
    (new RegExp(String.raw`^.{0,90}?\bannounces (?:the |its )?${DEAL_ADJ}acquisition of\b`, "i").test(headline) && /\b(?:has|have) (?:completed|closed|acquired)\b|\b(?:completed|closed) (?:its|the) acquisition\b/i.test(intro.slice(0, 900)))
  ) {
    kind = "completion";
  }
  else if (
    // Unless the headline announces the deal itself (Western Digital's SanDisk release mentions an earlier investment).
    (/previously announced|previously disclosed/i.test(intro.slice(0, 600)) && !(ANNOUNCES_DEAL.test(headline) && !/\b(?:amend|revis|increas|rais|extend)/i.test(headline))) ||
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
    const buy = new RegExp(String.raw`^(.{2,90}?)\s+(?i:acquires|has acquired|completes (?:the |its )?acquisition of|announces (?:the |its )?${DEAL_ADJ}acquisition of|to acquire|agrees to acquire|announces (?:a )?(?:definitive )?agreement to acquire)\s+${LEAD_QUAL}${NAME}(?:${STOP}|${SUBHEAD_STOP}|${TAIL_STOP})`).exec(headline);
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
  parties.tgt = withApostrophe(parties.tgt, headline);
  // A headline cut after a description ("… Acquisition of Mobile Game Creator" / "Playdemic from AT&T"): the name
  // follows it in the text, and the description goes (cleanPartyName).
  // Only a mixed-case word that runs on into lower case ("Playdemic from AT&T"): what follows a cut headline is
  // usually the dateline ("CLEVELAND, Ohio", "London, UK") or the first sentence ("The …", "Energy Steel & Supply").
  if (/\s(?:Leader|Provider|Maker|Developer|Specialist|Producer|Creator|Manufacturer|Supplier|Distributor)$/.test(parties.tgt)) {
    const named = new RegExp(`${escapeRx(parties.tgt)}\\s+([A-Z](?=[\\w.&'’-]*[a-z])[\\w.&'’-]{2,})(?=\\s+[a-z])`).exec(flatten(text).slice(0, 5000));
    if (named && isPlausibleName(named[1]) && !/^(?:The|This|That|These|Today|Its|Our)$/.test(named[1]) && !sameCompany(named[1], parties.acq))
      parties.tgt = cleanPartyName(`${parties.tgt} ${named[1]}`);
  }

  // "Thoma Bravo PROS Shareholders" -> "Thoma Bravo": cut the acquirer where the target's name starts.
  const tgtFirst = parties.tgt.replace(/^The\s+/, "").split(/[\s,]+/)[0];
  if (tgtFirst.length >= 3) {
    const at = parties.acq.indexOf(` ${tgtFirst}`);
    // ("Galenica and Relypsa Announce Agreement for Galenica to Acquire Relypsa" cuts to "Galenica and".)
    if (at > 0) parties.acq = parties.acq.slice(0, at).replace(/\s+(?:and|&|or|of|for|with|the)$/i, "");
  }
  parties.acq = parties.acq.replace(/\s+(?:Shareholders|Stockholders)$/, "");

  const acquirer = withTicker(parties.acq, mentions, parties.tgt);
  let target = withTicker(parties.tgt, mentions, parties.acq);
  // Two targets in one headline ("Royal Gold to Acquire Sandstorm Gold and Horizon Copper"): the one the release lists on
  // a US exchange ("Sandstorm Gold Ltd. (TSX: SSL; NYSE: SAND)"); Horizon trades over the counter.
  // The listed company's name must start with the part: "Golar LNG Partners" is not Golar LNG Limited, and "AIG Star"
  // (a carve-out of AIG's Japanese life insurers) is not AIG.
  if (!target.ticker && /\s(?:and|&)\s/.test(target.name)) {
    for (const part of target.name.split(/\s+(?:and|&)\s+/)) {
      const p = normalizeName(part);
      if (p.length < 4) continue;
      const m = mentions.find((x) => x.ticker && x.exchange && /^(?:NYSE|NASDAQ|NYSE American|Cboe)$/.test(x.exchange) && (normalizeName(x.name) === p || normalizeName(x.name).startsWith(`${p} `)));
      if (m) {
        target = { name: m.name, ticker: m.ticker, exchange: m.exchange };
        break;
      }
    }
  }
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
