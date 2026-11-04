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
import { cleanPartyName, identicalNames, isDescriptionOnly, isPlausibleName, normalizeName, sameCompany, titleCaseCaps } from "./names";

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
  /** The release lists the target on a foreign exchange only ("Logan Energy Corp. ("Logan") (TSXV: LGN)"): out of scope. */
  targetListedAbroad?: boolean;
  /** Merger 8-K: the signing date it states ("On February 3, 2026, … entered into …", "As previously announced, on April 26, 2021, …"). */
  signedOn?: string;
  /**
   * The date the document gives for the announcement, when it isn't the filing date: a release's dateline (an exhibit
   * can be filed days later), the release an Item 1.01 8-K says went out, or the announcement a completion refers back to.
   * Never the signing itself, which usually comes a day or a weekend before the release.
   */
  announcedOn?: string;
  /** Read from a merger 8-K's Item 1.01: terms as the lawyers state them, which a release's headline figures outrank. */
  item101?: boolean;
  /** Merger 8-K: its Item 1.02 reports an earlier merger agreement ended, so this signing is a new deal, not that one. */
  endsEarlierAgreement?: boolean;
  /** Opens as a results report, with the deal only further down (`opensAsResults`). */
  resultsReport?: boolean;
}

// ---------------------------------------------------------------------------
// Headline & body
// ---------------------------------------------------------------------------

const SKIP_LINE =
  /^(?:ex-?\d|exhibit\b|\d+$|[\w-]+\.html?$|press release|news release|(?:for )?immediate (?:release|distribution)|contacts?:|media contact|investor contact|tsxv?:|nyse|nasdaq|otc|\(?nyse|\(?nasdaq|[a-z]+ \d{1,2},? \d{4}$|\d{4}$|page \d)/i;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept?\\.?|Oct\\.?|Nov\\.?|Dec\\.?";
const DATELINE = new RegExp(`(?:^|\\n)[^\\n]{0,160}?(?:${MONTHS})\\s*,?\\s*\\d{1,2}\\s*,\\s*(?:19|20)\\d{2}\\s*[-–—/]+\\s*`, "i");
const ANNOUNCED_ON = new RegExp(`\\b(?:previously\\s+)?announced\\s+on\\s+(?:${MONTHS})\\s*\\d{1,2},\\s*\\d{4}`, "i");
const DATE_IN_TEXT = new RegExp(`(${MONTHS})\\s*,?\\s*(\\d{1,2})\\s*,\\s*((?:19|20)\\d{2})`, "gi");
const MONTH_NUMBER: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** The last "Month D, YYYY" in `s` as an ISO date ("Nov. 14, 2025" → "2025-11-14"). */
export function isoDateIn(s: string | undefined): string | undefined {
  const m = s ? [...s.matchAll(DATE_IN_TEXT)].at(-1) : undefined;
  const month = m ? MONTH_NUMBER[m[1].slice(0, 3).toLowerCase()] : undefined;
  if (!m || !month || Number(m[2]) < 1 || Number(m[2]) > 31) return undefined;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

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
const RESULTS_TOP =
  /\b(?:financial report|financial summary|financial results|(?:first|second|third|fourth|q[1-4]|[1-4]q)[- ]?(?:quarter)?\s*(?:(?:and|&)\s+(?:full[- ]year|fiscal(?: year)?|year[- ]end)\s+)?(?:\d{4}\s+)?(?:financial\s+|operating\s+)?(?:results|earnings)|(?:reports?|announces?|posts?|releases?)\s+(?:[\w'’&-]+\s+){0,6}(?:results|earnings))\b/i;
const DEAL_NEAR_TOP = /\b(?:to be acquired|to acquire|acquired by|acquisition of|definitive (?:merger )?agreement|merger agreement|merger with|to merge|to combine)\b/i;
/**
 * A document that opens as a results report and doesn't name a deal up there: Veoneer's "Financial Report July - September
 * 2021 Financial Summary", whose highlights further down mention a merger agreement. Not "IBM Releases First-Quarter
 * Results … Announces strategic acquisition of HashiCorp", which announces it.
 */
export const opensAsResults = (flat: string) => RESULTS_TOP.test(flat.slice(0, 500)) && !DEAL_NEAR_TOP.test(flat.slice(0, 400));
const allCaps = (l: string) => /[A-Z]/.test(l) && !/[a-z]/.test(l);
/** Line `b` carries on the headline of line `a` (one headline wrapped over two lines), not a new sub-headline. */
// (A line ending in a comma goes on when a name follows: "… to Acquire Montney Oil Producer," / "Logan Energy Corp.";
// not a sub-headline: "Optum and LHC Group to Combine," / "Advancing Abilities to Extend Value-Based Care …". So does a
// line of just the business word: "… to Acquire Advanced Technology Distributors" / "Business".)
const wraps = (a: string, b: string) =>
  /^[a-z]/.test(b) ||
  CONTINUES_HEADLINE.test(b) ||
  /\b(?:for|to|of|by|with|and|the|a|an|in|on|into|be|acquire|merge|combine|definitive)$/i.test(a) ||
  (/,$/.test(a) && /^(?![A-Za-z]+ing\b)[A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,5}\.?$/.test(b)) ||
  /^(?:Business(?:es)?|Division|Unit|Assets|Operations|Segment|Portfolio)\.?$/i.test(b) ||
  (allCaps(a) && allCaps(b));

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
// the surrounding keywords are case-insensitive via (?i:...) groups, which rx() spells out (caseless) so the engine
// never sees the modifier: Node 24 (V8 13.6) gets (?i:...) wrong in capitals and title case, silently, in two ways
// (some alternatives with several optional parts, and every (?i:a|b) compiled once a long run has built many i-flag
// regexes; CLAUDE.md, "Inline (?i:…) groups"). Build every pattern with a (?i:) group through rx().
const SUFFIX = String.raw`,\s(?:Inc|Corp|Ltd|LLC|L\.P|LP|Co|N\.V|S\.A|plc|PLC|Limited|Incorporated)\.?`;
// A slash between letters belongs to a name ("RE/MAX Holdings" was read as "MAX Holdings"; "Quad/Graphics", "Danfoss
// A/S"); not in dates or phone numbers ("11/14/11", "212/355-4449").
const NAME = String.raw`([A-Z0-9][\w&.'’\-]*(?:/[A-Za-z][\w&.'’\-]*)*(?:${SUFFIX}|\s(?:[A-Z0-9&][\w&.'’\-]*(?:/[A-Za-z][\w&.'’\-]*)*|of|and|de|du|la|for|the|by))*?)`;
// (A buy-out of the rest of a company is that company: "Ionis Pharmaceuticals to Acquire Remaining Stake in Akcea
// Therapeutics", "ONEOK … to Acquire Remaining Public Stake in ONEOK Partners".)
// ("an? (?:newly formed )?entity …" missed "AN ENTITY CONTROLLED BY" in capitals or title case, so the article and
// "newly formed" are spelled out as alternatives, in the order the quantifiers tried them.)
const LEAD_QUAL = String.raw`(?i:(?:certain )?affiliates? of |entities (?:affiliated with|managed by) |funds? (?:managed|advised) by |an newly formed entity (?:to be )?(?:formed|owned|controlled) by |an entity (?:to be )?(?:formed|owned|controlled) by |a newly formed entity (?:to be )?(?:formed|owned|controlled) by |a entity (?:to be )?(?:formed|owned|controlled) by |an investor group led by |investment funds? (?:managed|advised) by |the remaining (?:public )?(?:stake|interest|ownership interest) in |remaining (?:public )?(?:stake|interest|ownership interest) in |remaining (?:outstanding )?shares of |the )?`;
const STOP = String.raw`(?=['’]s\b|\s*(?:[,;:(]|$)|\.(?:\s|$)|\s(?i:for|in|at|to|from|with|via|and (?:expand|create|strength|accelerat|add|form)|creating|expanding|adding|strengthening|accelerating|valued|forming|through|—|-|–)(?:\b|\s))`;

/** A capitalized word followed by a lowercase one (not a name connector): the start of a sub-headline. */
const SUBHEAD_STOP = String.raw`(?=\s[A-Z][a-z]+\s(?!(?:of|and|de|du|la|for|the|by)\b)[a-z])`;
/** Headline words that follow the target, never part of its name ("… BankWyse Subject to …", "… DBM Global Transaction …"). */
const TAIL_STOP = String.raw`(?=\s(?:Subject|Transaction|Deal|Acquisition|Agreement|Following|Pending|Upon|After|Expanding|Adding|Creating|Strengthening|Establishing|Accelerating|Enhancing|Broadening|Extending|SUBJECT|TRANSACTION|DEAL|ACQUISITION|AGREEMENT|FOLLOWING|PENDING|EXPANDING|ADDING|CREATING|STRENGTHENING|ESTABLISHING|ACCELERATING|ENHANCING|BROADENING|EXTENDING)\b)`;

/**
 * The pattern with each (?i:…) group turned into a plain group with its letters spelled out ("to" → "[tT][oO]"), the
 * same match as the `i` flag gives ASCII letters, so the engine never sees the modifier. Inside a (?i:) group only
 * letters, escapes like \s and \b, and group syntax may stand: anything it can't spell out exactly is refused.
 */
export function caseless(src: string): string {
  let out = "";
  let ci = false;
  const outer: boolean[] = []; // whether each enclosing group is case-insensitive
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const e = src[i + 1] ?? "";
      if (ci && /[A-Za-z]/.test(e) && !/[bBdDsSwWnrtfv]/.test(e)) throw new Error(`caseless: "\\${e}" inside (?i:…) in ${src}`);
      out += c + e;
      i++;
    } else if (c === "[") {
      let j = i + 1;
      if (src[j] === "^") j++;
      if (src[j] === "]") j++;
      while (j < src.length && src[j] !== "]") j += src[j] === "\\" ? 2 : 1;
      const cls = src.slice(i, j + 1);
      if (ci && /[A-Za-z]/.test(cls.replace(/\\./g, ""))) throw new Error(`caseless: letters in ${cls} inside (?i:…) in ${src}`);
      out += cls;
      i = j;
    } else if (c === "(") {
      outer.push(ci);
      if (src.startsWith("(?i:", i)) {
        ci = true;
        out += "(?:";
        i += 3;
        continue;
      }
      const open = /^\((?:\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>))?/.exec(src.slice(i))![0];
      if (open === "(" && src[i + 1] === "?") throw new Error(`caseless: unknown group ${src.slice(i, i + 6)} in ${src}`);
      out += open;
      i += open.length - 1;
    } else if (c === ")") {
      ci = outer.pop() ?? false;
      out += c;
    } else if (ci && /[A-Za-z]/.test(c)) {
      out += `[${c.toLowerCase()}${c.toUpperCase()}]`;
    } else {
      if (ci && c.charCodeAt(0) > 127 && c.toLowerCase() !== c.toUpperCase()) throw new Error(`caseless: "${c}" inside (?i:…) in ${src}`);
      out += c;
    }
  }
  return out;
}

const rx = (src: string) => new RegExp(caseless(src));

const HEADLINE_PATTERNS: { re: RegExp; roles: ["acq" | "tgt", "acq" | "tgt"] }[] = [
  {
    // Two buyers take the plural verb: "CD&R and McKesson Corporation Sign Agreement to Acquire Option Care Health" (one
    // target, bought jointly), which the "A and B sign" reading below made McKesson the target.
    // The plural forms are separate alternatives on purpose: written "signs? (?:an? )?(?:definitive )?…" inside (?i:…),
    // Node 24's engine failed to match "GENTEX SIGNS DEFINITIVE AGREEMENT TO ACQUIRE" (190 releases lost), and with
    // "(?:an? )?" it still failed "SIGN AN DEFINITIVE AGREEMENT TO", so each article is an alternative of its own.
    re: rx(
      String.raw`^${NAME}\s+(?i:to|will|agrees to|has agreed to|signs (?:a )?definitive (?:merger )?agreement to|enters into (?:a )?definitive (?:merger )?agreement to|announces (?:a )?(?:definitive )?(?:merger )?agreement to|announces (?:plans? )?to|agree to|have agreed to|sign an (?:definitive )?(?:merger )?agreement to|sign a (?:definitive )?(?:merger )?agreement to|sign (?:definitive )?(?:merger )?agreement to|signs agreement to|enter into an (?:definitive )?(?:merger )?agreement to|enter into a (?:definitive )?(?:merger )?agreement to|enter into (?:definitive )?(?:merger )?agreement to|enters into agreement to|announce an (?:definitive )?(?:merger )?agreement to|announce a (?:definitive )?(?:merger )?agreement to|announce (?:definitive )?(?:merger )?agreement to)\s+(?i:acquire)\s+${LEAD_QUAL}${NAME}(?:${STOP}|${SUBHEAD_STOP}|${TAIL_STOP})`,
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
    re: rx(String.raw`^${NAME}\s+(?i:announces|enters into|signs)\s+(?i:a\s+)?(?:(?:US)?\$[\d.,]+\s+(?i:billion|million)\s+)?(?i:definitive (?:merger )?agreement with)\s+${LEAD_QUAL}${NAME}${STOP}`),
    roles: ["tgt", "acq"],
  },
];

const SYMMETRIC_HEADLINE = rx(String.raw`^${NAME}\s+(?i:and)\s+${NAME}\s+(?i:to combine|to merge|announce|agree to|enter into|sign)\b`);

/** "<anything naming the filer> Acquires <target>": the buyer is the filer (see parsePressRelease). */
const FILER_BUYER_HEADLINE = rx(
  String.raw`^(.{2,90}?)\s+(?i:acquires|has acquired|completes (?:the |its )?acquisition of|announces (?:the |its )?${DEAL_ADJ}acquisition of|to acquire|agrees to acquire|announces (?:a )?(?:definitive )?agreement to acquire)\s+${LEAD_QUAL}${NAME}(?:${STOP}|${SUBHEAD_STOP}|${TAIL_STOP})`,
);

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
    // What a firm's "About" paragraph says it runs is not the firm: "… including management of Blackstone Mortgage Trust
    // (NYSE: BXMT)" gave Blackstone's half of the Extended Stay deal that mortgage REIT's ticker.
    const end = (m.index ?? 0) + m[1].trimEnd().length - (run?.[1].length ?? 0);
    if (/\bmanagement of\s+$/i.test(text.slice(Math.max(0, end - 30), end))) continue;
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
  // Two buyers named together ("Blackstone and Starwood Capital Group") have no listing of their own, and a shared first
  // word proves nothing about them, so "Blackstone Mortgage Trust" doesn't count: only a name that one begins with, or that
  // begins with it ("Infinity Property and Casualty Corporation"; also "Blackstone Inc." for the lead buyer).
  let matches = mentions.filter((m) => (/\sand\s/.test(name) ? identicalNames(m.name, name) : sameCompany(m.name, name)));
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
 * portfolio has a face value ("a face value of over $130 billion"). "Portfolio companies" is a firm's holdings; "Proofpoint,
 * a portfolio company of Thoma Bravo" only describes the buyer, and hid "valued at approximately $6.3 billion". "An
 * enterprise value for the combined companies of approximately $17 billion" is Cabot and Cimarex together, not the price.
 * Nor pay, warrants or the deal's financing: "performance based compensation having a value of approximately $28.9 million"
 * (Navitas), "the Black Scholes value of such warrants", "financed the purchase price using $55 million in new debt".
 */
const NOT_DEAL_VALUE =
  /\b(?:market|markets|TAM|industry|opportunit\w*|combined (?:compan(?:y|ies)|enterprise|business|entity)|pro forma|since (?:its )?inception|since \d{4}|ha(?:s|ve) (?:managed|invested|completed|deployed)|assets under management|AUM|portfolio companies|projected to|expected to reach|forecast|CAGR|annual(?:ized)? revenue|revenues? of|sales of|backlog|in \d{4}|face value|compensation|Black[- ]Scholes|value of (?:such |the )?warrants|(?:financ|fund)(?:ed|ing) the purchase price (?:using|with|through|from)|\d[\d,]* (?:transactions|deals|investments|add-on acquisitions|acquisitions))\b/i;
// The amount's own sentence only: "… an all-stock transaction valued at $35 billion. The combination will create the
// industry's leading …" (AMD / Xilinx) is a deal value.
const valueContext = (t: string, index: number, length: number) =>
  (t.slice(Math.max(0, index - 90), index).split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])/).pop() ?? "") +
  t.slice(index, index + length + 50).split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])/)[0];

/** No announced deal has been valued above this (the largest ever were ~$200B). */
export const MAX_DEAL_VALUE = 300e9;

const num = (s: string) => Number(s.replace(/,/g, ""));
const unitMult = (u: string) => (/^b/i.test(u) ? 1e9 : /^t/i.test(u) ? 1e12 : 1e6);

/**
 * Another dollar written with a letter prefix: "C$1.40 per share" (Ovintiv / Logan), "A$", "NT$", "HK$", "R$". The
 * price patterns would read the "$1.40" inside it as US dollars.
 */
export const otherDollar = (t: string, dollarAt: number) => /[A-Z]$/.test(t.slice(Math.max(0, dollarAt - 1), dollarAt)) && !/(?:\bUS|U\.S\.)$/.test(t.slice(Math.max(0, dollarAt - 4), dollarAt));

/**
 * The cash part of a cash-and-shares price, not the price. Cash written before the shares ("the right to receive $26.45
 * in cash, without interest, … (the "Cash Consideration"), and 1.0340 shares": James Hardie / AZEK) or after them in a
 * numbered list ("(i) 0.9693 shares of Class A Common Stock, par value $0.01 per share, of Parent …, and (ii) $96.00 in
 * cash": Fox / Roku). `before` and `after` are the text either side of the amount, within its sentence.
 */
export function isCashLeg(before: string, after: string): boolean {
  const shares = String.raw`(?:one|two|three|\d+(?:\.\d+)?|a fraction of(?: a| one)?)\s+(?:\(the\s[^()]{1,40}\)\s+)?(?:fully[- ]paid\s+(?:and\s+)?non-?assessable\s+)?(?:[A-Z][\w&.'’-]*\s+){0,4}(?:(?:class\s+[A-Z]\s+)?common\s+|ordinary\s+)?(?:[Ss]hares?|ADSs?|[Uu]nits?)\b`;
  const sentenceAfter = after.split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])|;/)[0];
  // Not across another amount: "either $12.00 in cash (the "Cash Election"), or a combination of $3.00 in cash … and one
  // Class A Share" (J. Alexander's) is a cash election worth the whole price.
  if (new RegExp(String.raw`^(?:[^;$]{0,220}?[,)]\s*|\s*)(?:and|plus|as well as|together with)\s+(?:\([a-z0-9]{1,4}\)\s+)?${shares}`).test(sentenceAfter)) return true;
  const sentenceBefore = before.split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z(])|;\s/).pop() ?? before;
  return new RegExp(String.raw`(?<![$\d.,]\s?)\b${shares}(?:[^;]){0,260}?\b(?:and|plus)\s+(?:\([a-z0-9]{1,4}\)\s+)?(?:an amount (?:in cash )?equal to\s+)?$`).test(sentenceBefore);
}

/** Holders choose cash or shares: the cash on offer is then worth the whole price. */
const ELECTION = /\belect(?:s|ing|ed)?\s+to\s+receive\b|\b(?:right|permitted|entitled|able|option)\s+to\s+elect\b|\bmay\s+elect\b|\b(?:cash|stock|share|mixed)\s+election\b|\b(?:the|their|its|his or her)\s+election\b|\bthe\s+election\s+of\s+(?:the\s+)?(?:holder|shareholder|stockholder)/i;

/** Offer price per share. Needs buyout context; ignores par values, dividends, EPS and note prices. */
export function extractPrice(t: string): number | null {
  const re =
    /(?:(?:US|U\.S\.)?\$|\bUSD\s?)\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,4})?)\s*(?:per|a|\/)\s*(?:(?:[A-Z][\w&.'’\-]*\s){0,4})?(?:outstanding\s|issued\s)?(?:common\s|ordinary\s)?share\b/gi;
  let best: { v: number; score: number } | null = null;
  let mixed: boolean | undefined;
  // "The transaction values each TopBuild share at $505" (QXO / TopBuild, a cash-or-stock election): the stated value of
  // each share, whatever its holder elects.
  const each = /\bvalu(?:es|ing|ed)\s+each\s+(?:outstanding\s+)?(?:[A-Z][\w&.'’-]*\s+){0,4}(?:common\s+|ordinary\s+)?share(?:\s+of\s+(?:[A-Z][\w&.'’-]*\s+){1,4}(?:common\s+stock|ordinary\s+shares)?)?\s*\bat\s+(?:approximately\s+|about\s+)?(?:US\$|\$)\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,4})?)(?!,?\d|\.\d|\s*(?:million|billion))/i.exec(t);
  if (each && !otherDollar(t, each.index! + each[0].lastIndexOf("$"))) {
    const v = num(each[1]);
    if (v >= 0.05 && v < 10_000) best = { v, score: 3 };
  }
  for (const m of t.matchAll(re)) {
    const v = num(m[1]);
    if (!(v >= 0.05 && v < 10_000)) continue;
    if (otherDollar(t, m.index!)) continue;
    const before = t.slice(Math.max(0, m.index! - 140), m.index!);
    const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
    // Exclusions only look within the same clause as the amount.
    const clause = before.split(/[.;]\s+(?=[A-Z])/).pop() ?? before;
    if (/par value|dividend|distribution|exercise price|conversion price|strike|warrants?|earnings|EPS|FFO|AFFO|net (?:income|loss)|book value|NAV\b|per share data|guidance|outlook/i.test(clause.slice(-70) + after.slice(0, 20))) continue;
    // A CVR or milestone payment ("plus one CVR worth up to $3.50 per share") is not the offer price.
    if (/contingent value right|\bCVRs?\b|milestones?|earn-?out|\bup to\s*$/i.test(clause.slice(-120))) continue;
    // Nor a debenture's conversion price: "the Debenture is convertible at the option of Solitario into Zazu Shares at a
    // price of US$0.22 per Zazu Share".
    if (/\bdebentures?\b|\b(?:convertible|exchangeable)\s+(?:at|into)\b|\bconvertible\s+(?:senior\s+)?(?:notes?|bonds?)\b/i.test(clause)) continue;
    // Nor a buyback in the target's earnings release ("repurchased 0.9 million shares at an average price of $23.04 per
    // share": Beazer, whose offer was $33.50), a share price quoted for reference ("based on Herman Miller's five-day
    // volume weighted average price of $43.94 per share"), a collar bound ("provided that this volume weighted average
    // price is no less than $23.12 per share"; "Sentio stockholders will receive … no less than $14.37 per share" is
    // the offer) or a top-up ("up to an additional $0.55 per share").
    if (/repurchas|buy-?backs?/i.test(clause.slice(-120))) continue;
    if (/(?:(?:average|closing|trading|market)(?: (?:stock|share|sale|trading))? price|\bVWAP)(?: of)?(?: approximately| about)?\s*$|\badditional\s*$/i.test(before)) continue;
    if (/\b(?:less|greater|more|lower|higher) than\s*$/i.test(before) && /\bprice\b|\bVWAP\b/i.test(clause.slice(-120))) continue;
    // Nor the cash leg of cash and shares: "$3.50 per share in cash as well as 0.14625 Kimberly-Clark shares … for a
    // total consideration … of $21.01 per share" (Kenvue). Cash plus a CVR ("and one contingent value right") is the price.
    const tail = t.slice(m.index! + m[0].length, m.index! + m[0].length + 120);
    if (/^\s*(?:,\s*)?(?:in cash\s*)?(?:,\s*)?(?:and|plus|as well as|together with)\s+(?:\d+(?:\.\d+)?|one|a fraction of(?: a)?)\s+(?:[A-Z][\w&.'’-]*\s+){0,4}(?:common\s+|ordinary\s+)?(?:[Ss]hares?|ADSs?|[Uu]nits?)\b/.test(tail)) continue;
    if (isCashLeg(t.slice(Math.max(0, m.index! - 320), m.index!), t.slice(m.index! + m[0].length, m.index! + m[0].length + 320))) continue;
    // …named as such in a cash-and-shares deal: "the cash consideration of $96.00 per share to be paid by FOX" (Fox's pro
    // forma statements for Roku, a deal of 0.9693 Fox shares and $96.00 in cash).
    // ("the total stock and cash consideration … is $11.35 per share" is the whole price, and so is the cash a holder may
    // elect instead of shares: "stockholders electing to receive cash consideration will receive the cash consideration
    // of $28.00 per share", Bioventus / Misonix.)
    // (A leg after another: "stock consideration of $10.11 per share and cash consideration of $1.12 per share" is no "stock
    // and cash consideration" of a whole: AG Mortgage / WMC.)
    if (/(?<!(?<!\bper\s)\b(?:stock|shares?|equity)\s+(?:and|or|plus)\s+)(?<!\btotal\s+)\bcash\s+(?:consideration|portion|component|payment)\b[^.;$]{0,80}$/i.test(before) && (mixed ??= extractConsideration(t) === "Mixed" && !ELECTION.test(t))) continue;
    // Nor a collar's bound: "LPS stockholders receive a minimum of $15.794 per share in value on the stock portion".
    if (/\b(?:minimum|maximum)\s+(?:of\s+)?$/i.test(before)) continue;
    // Nor the buyer's share price a stock deal is worked out from: "7,692,308 shares (determined as $200 million divided
    // by $26.00 per share)" (Revolution Medicines / EQRx, which read as a $12.7B deal for about $1.07B).
    if (/\bdivided\s+by\s+(?:the\s+)?(?:(?:price|value)\s+of\s+)?$/i.test(before)) continue;
    // Nor the value put on the buyer's own shares issued as payment: "approximately 9 million shares of Smith & Wesson
    // common stock, valued at $13.62 per share (i.e. the volume weighted average price per share of Smith & Wesson
    // common stock …)" (Savage Arms).
    if (/\bshares\s+of\s+[^,.;]{1,60}?\b(?:common\s+(?:stock|shares)|ordinary\s+shares|stock)\s*,?\s*(?:each\s+)?valued\s+at\s+(?:approximately\s+|about\s+)?$/i.test(before)) continue;
    // (Not "(representing an approximate 37% premium to the closing share price …)", which describes an offer.)
    if (/^\s*\(\s*(?![^()]*\bpremium\b)(?:(?:i\.e\.,?|being|which (?:is|was|represents)|equal to|representing)\s+(?:the\s+)?[^()]{0,40}?(?:volume[- ]weighted|VWAP|average|closing)|(?:the\s+)?(?:\d+[- ](?:trading[- ]|calendar[- ])?day\s+)?(?:volume[- ]weighted|VWAP))/i.test(tail)) continue;
    // "This represents a $20.40 per share value based on the closing price of CoreWeave Class A common stock as of July 3,
    // 2025" (CoreWeave / Core Scientific): the implied value of each target share. Not one based on an average ("… based on
    // the buyer's 5-day VWAP"), which is not the value at the last close.
    const valueWord = /^\s*(?:implied\s+)?value\b/i.test(after);
    if (valueWord && /^[^.;]{0,120}?\bbased\s+(?:up)?on\s+(?:the\s+)?(?:[\w'’.&-]+\s+){0,4}?(?:\d+[- ](?:trading[- ]|calendar[- ])?day\s+)?(?:volume[- ]weighted|VWAP|average)/i.test(tail)) continue;
    let score = valueWord ? 2 : 0;
    // "acquire[d] … for" may run past an abbreviation: "to be acquired by Dream Finders Homes, Inc. for $33.50", and past
    // a description when "for" leads straight to the amount ("will acquire Option Care Health, an independent provider of
    // home and alternate site infusion services, for $32.05 per share").
    if (/receive|for each|in exchange for|purchase price|offer price|offer of|consideration|acquire(?:[^.]|\b(?:Inc|Corp|Co|Ltd|Bros)\.){0,80}\bfor\b|acquire[^.]{0,130}\bfor\s*$|valued at|implies|implied|equal to|equivalent to|price of|at a price/i.test(before)) score += 2;
    if (/^\s*(?:,\s*)?(?:in cash|net to the seller|payable in cash)/i.test(after)) score += 2;
    if (/premium/i.test(after)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { v, score };
  }
  return best?.v ?? null;
}

/**
 * A premium stated over a high, which is no last close, "unaffected" or not: "a 13% premium to Altair's unaffected all-time
 * high closing price", "33% to Kellanova's unaffected 52-week high", "a 9.5% premium to our all-time peak trading price",
 * "over the Common Stock's 5-year high closing price", "the highest closing price". Only in the premium's own reference:
 * "… closing share price of $52.57 on March 14, 2018 and exceeds Connecticut Water's all-time high price of $69.72", "…
 * closing price of $.97 and is 34% above Magellan's 52-week high" are premiums over the close. ("Peak" in lower case only:
 * Peak Resorts and Jagged Peak are companies, High River a bidder.)
 */
export function isOverAHigh(ctx: string): boolean {
  const own = ctx.split(/\bexceed\w*|[;•·]|,?\s+which\s+(?:was|is)\b|,?\s+and\s+(?:is\s+)?(?:an?\s+)?(?:approximately\s+|about\s+)?\d/i)[0];
  return (
    /52\)?\s*[- ]?\s*(?:weeks?|wk)\b|\bfifty[- ]two\b|\bhighest\b|\ball[- ]\s*time\b|\b(?:record|historic(?:al)?|intra-?day|lifetime|year-to-date|(?:month|year)s?)\s+(?:(?:closing|trading|stock|share|price)\s+)*(?:highs?|peak)\b/i.test(own) ||
    // In lower case: "$4.55/share High level of certainty" runs in from a slide's next line.
    /\b(?:trading|closing|stock|share|price)\s+(?:highs?|peak)\b|\bhigh\s+(?:(?:closing|trading|stock|share)\s+)*price\b|\bhigh\s+of\s+\$|\bpeak\b/.test(own)
  );
}

/**
 * A premium over something other than the market price: a bid ("33.3% to Dell's offer price", "over the $18 offered by
 * Acme"), net asset value, book value, enterprise value. Only as its reference, after the "to" or "over", and read up to any
 * market price the sentence goes on to name: "a 40% premium to the pre-offer closing price", "over the price of CPEX shares on
 * January 7, the day prior to … an unsolicited offer" are over the market; "a 41% premium or approximately 0.85x tangible book
 * value" (Ready Capital / Broadmark) and "the 15.9% premium offered by VICI" (MGM Growth Properties) don't name one.
 */
export function isOverAnotherValue(ctx: string): boolean {
  const own = ctx.split(/\b(?:closing|close[ds]?|unaffected|last (?:full )?trading|last (?:reported )?sale|(?:market|stock|share|trading)\s+price)\b|(?<!\boffer(?:ed)?\s)\bprice\b(?!\s+offered)/i)[0];
  return /\b(?:to|over|above|on|from)\s+[^;]{0,160}?(?:(?<!pre-)\b(?:offer(?:ed)?|bid|proposal)\b(?!-)|\bper[- ]share (?:transaction|deal|merger)\b|\bnet asset values?\b|\bNAVs?\b|\b(?:tangible\s+)?book(?:\s+value)?\b|\benterprise value\b|\bliquidation value\b)/i.test(own);
}

/** How surely a premium's own words make it the premium over the last close: "unaffected" and "closing price" for it. */
function premiumScore(ctx: string): number {
  let score = 0;
  if (/unaffected/i.test(ctx)) score += 3;
  if (/closing (?:share |stock )?price|last (?:full )?trading day|close\b|current (?:market |share |stock |trading )?price/i.test(ctx)) score += 2;
  // An average is never the last close, unaffected or not: "a 23.0% premium to TXNM Energy's unaffected 30-day volume
  // weighted average price (VWAP)" (Blackstone / TXNM Energy) netted to zero and passed. Nor is a high (isOverAHigh).
  if (/volume[- ]weighted|VWAP|\d{1,3}[- ](?:trading[- ]|calendar[- ])?day|average|month/i.test(ctx) || isOverAHigh(ctx) || isOverAnotherValue(ctx)) score -= 6;
  return score;
}

export function extractPremium(text: string): number | null {
  // "a premium of approximately 30 percent" (KnowBe4, PROS).
  const t = text.replace(/(\d)\s+per\s?cent\b/gi, "$1%");
  const found: { v: number; score: number; i: number }[] = [];
  const re = /(?:premium of (?:approximately |about |roughly |nearly |over |more than )?(\d{1,3}(?:\.\d{1,2})?)\s?%|(\d{1,3}(?:\.\d{1,2})?)\s?% premium)/gi;
  // With contingent value rights, the premium of "the total transaction value" counts them at their most: "The total
  // transaction value represents … a premium of 21% to Lantheus' unaffected closing price" (Curium / Lantheus: $102.50 in
  // cash plus CVRs of up to $12.00). The price kept is the cash, so that is not its premium.
  const cvr = /contingent value rights?|\bCVRs?\b/i.test(t);
  for (const m of t.matchAll(re)) {
    const v = Number(m[1] ?? m[2]);
    if (!(v > 0 && v < 500)) continue;
    // Only this premium's own clause: stop at the next "premium" or the end of the sentence, a quote's too ("… prior to the
    // public disclosure of Ramius' unsolicited proposal. "For more than two months, …": Cypress Bioscience).
    const raw = t.slice(m.index!, m.index! + 220);
    const stop = /\bpremium\b|\.\s+(?=["“]?[A-Z])/gi;
    stop.lastIndex = m[0].length;
    const ctx = raw.slice(0, stop.exec(raw)?.index ?? raw.length);
    const before = t.slice(Math.max(0, m.index! - 120), m.index!);
    if (/conversion|convertible|notes?\b|exchangeable|warrant/i.test(before + ctx.slice(0, 80))) continue;
    // "Core deposit premium of 18.2%", "deposits were acquired at a premium of approximately 1.6%", "Tangible book value premium
    // of 185%": what a bank pays over its deposits or book.
    if (/\b(?:deposits?\b[^.]{0,40}|book(?:\s+value)?\s+|NAV\s+)$/i.test(before)) continue;
    if (cvr) {
      const sentence = t.slice(Math.max(0, m.index! - 300), m.index!).split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z"“])|[•·]\s/).pop() ?? "";
      if (/\btotal\s+(?:(?:transaction|deal|per[- ]share|potential|merger)\s+)?(?:value|consideration)\b|\bincluding\s+(?:the\s+)?(?:CVRs?|contingent)|\binclusive\s+of\b|\bup\s+to\b/i.test(sentence)) continue;
    }
    // "a premium of 19.8% to TopBuild's 60-day volume-weighted average price and 23.1% to TopBuild's closing price on
    // Friday, April 17, 2026" (QXO / TopBuild): each figure has its own reference. Only when the first names its own
    // ("a premium of 30% and 35% to the 30- and 60-day VWAPs" shares one).
    const more = [...ctx.matchAll(/(?:[,;]\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)(?:approximately\s+|about\s+|roughly\s+|nearly\s+)?(\d{1,3}(?:\.\d{1,2})?)\s?%\s+(?:to|over|above|relative to|compared to|in excess of|based (?:up)?on)\b/gi)].filter((x) => x.index! >= m[0].length);
    if (more.length && /\b(?:to|over|above|relative to|compared to|in excess of|based (?:up)?on)\b/i.test(ctx.slice(m[0].length, more[0].index))) {
      found.push({ v, score: premiumScore(ctx.slice(0, more[0].index)), i: m.index! });
      more.forEach((x, k) => {
        const w = Number(x[1]);
        const score = premiumScore(ctx.slice(x.index!, more[k + 1]?.index ?? ctx.length));
        // A later figure counts only with a reference that makes it the premium over the last close.
        if (w > 0 && w < 500 && score > 0) found.push({ v: w, score, i: m.index! + x.index! });
      });
      continue;
    }
    found.push({ v, score: premiumScore(ctx), i: m.index! });
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score || a.i - b.i);
  // Only averages (VWAP, 30-day) were stated: that isn't the premium over the unaffected price.
  return found[0].score >= 0 ? found[0].v : null;
}

const SENTENCE_END = /(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])/;
const DOLLARS = String.raw`(?<![A-Z])(?:US\$|\$|USD\s?)\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,3})?)\s*(trillion|billion|million|bn|mm|mn|B|M)\b`;
const ABOUT = String.raw`(?:(?:approximately|about|roughly|nearly|over)\s+)?`;

/** The words after an amount can name it: "values ADT at approximately $7.6 billion in equity value". */
const LABEL_AFTER = /^\s*(?:(?:in|of)\s+)?(?:(?:total|implied|consolidated|aggregate|approximate)\s+){0,2}(enterprise|equity)\s+value\b/i;

const EV_BESIDE = new RegExp(
  String.raw`${DOLLARS}\s+(?:(?:in|of)\s+)?(?:(?:total|implied|consolidated|aggregate|approximate)\s+){0,2}enterprise\s+value\b|\benterprise\s+value\s+(?:(?:of|is|at)\s+)?${ABOUT}${DOLLARS}`,
  "i",
);

/**
 * An enterprise value stated beside the amount, in its sentence: the deal's size as a banker quotes it, and usually the
 * release's own headline ("ADT to be Acquired by Thrive Holdings in $15.3 Billion Transaction": "approximately $7.6 billion
 * in equity value and $15.3 billion in enterprise value"). Only when it's the larger: with a cash-rich target the headline
 * stays what the buyer pays. Not the size of what the deal creates ("… $5 billion, creating a company with an enterprise
 * value of $20 billion"), nor the whole company's beside a stake ("values the minority stake being acquired at $7.2 billion,
 * and values the total company at … an enterprise value of $16.8 billion": Emerson / AspenTech). A bullet is a sentence, and
 * "$586¹ million" (a footnote on a slide: NTELOS) is no "$5861 million".
 */
function enterpriseValueBeside(t: string, from: number, usd: number): number | null {
  const sentence = t.slice(from, from + 400).split(SENTENCE_END)[0].split(/[•·●]/)[0];
  const m = EV_BESIDE.exec(sentence);
  if (!m || /\b(?:creat(?:e|es|ing)|form(?:s|ing)\s+(?:a|an|the)|combined|resulting|pro forma|stake|minority|remaining|total company)\b/i.test(sentence.slice(0, m.index + m[0].length))) return null;
  const figure = m[1] ?? m[3];
  if (/^\d{4,}$/.test(figure)) return null;
  const ev = Math.round(num(figure) * unitMult(m[2] ?? m[4]));
  return ev > usd && ev <= MAX_DEAL_VALUE ? ev : null;
}

/** A headline that's a ceiling: "will acquire Nordeus for up to $378 million", "a transaction valued up to $1.1 billion". */
const CEILING = new RegExp(String.raw`\b(?:acquir\w*|acquisition of|purchase of)\b[^.;]{0,220}?\bfor\s+up\s+to\s+${ABOUT}${DOLLARS}|\bvalued\s+up\s+to\s+${ABOUT}${DOLLARS}`, "i");
/** What's paid at once under a ceiling: "$225 million in cash upfront". Not a financing's ("$115 million in upfront proceeds"). */
const UPFRONT = new RegExp(
  String.raw`${DOLLARS}\s+(?:(?:in|of)\s+)?(?:(?:cash|stock|equity)\s+)?(?:upfront|up-front|at\s+closing)\b(?!\s+(?:financing|funding|proceeds|investment))|\b(?:upfront|up-front)\s+(?:(?:cash\s+)?(?:payment|consideration|purchase\s+price|price|amount)\s+)?of\s+${ABOUT}${DOLLARS}`,
  "i",
);
const amountOf = (m: RegExpExecArray | null) => (m ? Math.round(num(m[1] ?? m[3]) * unitMult(m[2] ?? m[4])) : 0);

const CONTRACT_THEN_VALUE =
  /\b(?:(?:sub)?contracts?|awards?|orders?|backlog|extensions?|renewals?)(?:\s+(?:extension|renewal|award|win|modification))?\s*,?\s*(?:(?:that|which|is|was|are|were|has|have|currently|now)\s+)*(?:(?:with|having|for|of|at)\s+)?(?:(?:an?|the)\s+)?(?:(?:total|aggregate|combined|estimated|potential|approximate|initial|maximum|ceiling|lifetime|annual|notional|fair|contract)\s+){0,3}$/i;
const CONTRACT_EARLIER =
  /\b(?:(?:sub)?contracts?(?!\s+(?:manufactur|research|development|logistics|drilling|sales|services?|packag|electronics|compression|pharma|labor|staffing|mining|operator))|(?<=\b(?:an|the)\s)award(?![- ]winning)|(?<!\bin\s)orders?|extensions?|renewals?)\b/i;
const DEAL_WORD = /\b(?:acqui\w*|merge\w*|transactions?|deal|buy\w*|bought|sale|sell\w*|purchase(?!\s+orders?\b)|takeover|combination|tender offer|(?:share|stock)holders?)\b/i;

/**
 * A customer contract valued in the amount's sentence, not the deal: "a contract extension valued at more than $45 million
 * from a longstanding customer" (IEC's results, in the release announcing its sale), "an executed contract and awarded
 * order value of approximately $416 million" (STI Norland), "the largest order in MTS history …, valued at over $70
 * million", "operations contract (total contract value of $4.6 billion)", and an employee's "award of … restricted shares …
 * not to exceed a total value of $3.8 million" (Meta / Crestmark). Only a plain "valued at" or "value of", with the
 * contract right before it or earlier in the sentence and no word of a deal there: "the contract manufacturing business …
 * in an all-cash transaction valued at $8.0 million" (Sparton) and "under the terms of the merger agreement" are deals.
 */
function valuesAContract(t: string, index: number, lead: string): boolean {
  if (!/^(?:valued at|value of|(?:total|aggregate)\s+value)$/.test(lead)) return false;
  const sentence = t.slice(Math.max(0, index - 240), index).split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])|[;•·●○■▪◾]\s/).pop() ?? "";
  return CONTRACT_THEN_VALUE.test(sentence) || (CONTRACT_EARLIER.test(sentence) && !DEAL_WORD.test(sentence));
}

export function extractValue(t: string): { usd: number; kind: ParsedPress["valueKind"] } | null {
  // Once a ceiling has been skipped, the amounts after it explain it (the earn-out, the warrants, the financing).
  let ceiling = 0;
  const re =
    /((?:enterprise|equity|transaction|deal|aggregate|total|purchase|implied)(?:\s+(?:equity|enterprise|transaction|deal|purchase))?\s+(?:value|price|consideration)|valued at|valuing\b[\w\s,]{0,40}?\bat|value of|values? [\w\s']{0,40}? at)[^$.;•]{0,70}?(?:(?:US|U\.S\.|C|CAD|A)?\$|\bUSD\s?)\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,3})?)\s*(trillion|billion|million|bn|mm|mn|B|M)\b/gi;
  for (const m of t.matchAll(re)) {
    const lead = m[1].toLowerCase();
    if (/per share/i.test(t.slice(m.index!, m.index! + m[0].length + 12))) continue;
    // Skip non-USD currencies (C$, A$, NT$, HK$, S$ …) — we only report USD. "NT$6.8 billion (approximately US$223 million)".
    if (/(?:^|[\s(])(?:C|CA|CAD|A|AU|AUD|NT|HK|NZ|S|SG|R|MX|Mex)\$/.test(m[0])) continue;
    if (NOT_DEAL_VALUE.test(valueContext(t, m.index!, m[0].length))) continue;
    if (valuesAContract(t, m.index!, lead)) continue;
    // An adjustment to the price, not the price: "The total transaction consideration is also subject to a downward
    // adjustment of a maximum $110 million" (Amazon / Globalstar). Only the amount the adjustment is of: "the purchase
    // price, subject to customary adjustments, of $2.4 billion" is the price.
    const dollar = m[0].indexOf("$");
    if (dollar > 0 && /\b(?:adjustment|reduction|decrease|holdback|escrow)s?\s+(?:of\s+)?(?:up\s+to\s+|a\s+maximum\s+(?:of\s+)?|approximately\s+)?(?:US|U\.S\.)?$/i.test(m[0].slice(0, dollar))) continue;
    // A ceiling, not the price: "valued at up to $1.3 billion", which the release goes on to explain "includes up to $150
    // million in earnout" in another sentence (IonQ / Elisity).
    if (dollar > 0 && /\bup\s+to\s+(?:approximately\s+|about\s+)?(?:US|U\.S\.)?$/i.test(m[0].slice(0, dollar))) {
      ceiling = num(m[2]) * unitMult(m[3]);
      continue;
    }
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
    // ("Following the merger, CMFT will be one of the largest credit-focused REITs with approximately $6.1 billion in enterprise value".)
    if (/\b(?:creat(?:e|es|ing)|form(?:s|ing)\s+(?:a|an|the)|combined|resulting|following\s+the\s+(?:merger|transaction|combination|closing|acquisition))\b/i.test(sentenceBefore)) continue;
    // Nor the most the sellers could get: "Selling stockholders may earn additional consideration of up to $97.5 million
    // …, bringing total potential transaction value to approximately $455 million" (Cardinal / Hughes Brothers, bought
    // "for $357.5 million"). A total that includes an earn-out or other contingent payment is not the price agreed.
    // (Nor a collar's bounds: "the maximum value of the IBG common stock at closing would be approximately $11 million and
    // the minimum value … approximately $9 million".)
    if (/\b(?:potential|maximum|minimum)\s+(?:(?:total|aggregate)\s+)?$/i.test(sentenceBefore)) continue;
    // "$122 Million (including contingent consideration)", "valued at up to $14.5 million, including earnouts", "The
    // transaction, including the $75 million in contingent consideration, is valued at $216 million" (SteadyMed). Not
    // "$20 million in upfront cash plus … potential contingent payments of up to $14 million" (Sientra / Miramar).
    const CONTINGENT_PART = String.raw`(?:earn-?outs?|contingent|milestones?|CVRs?|additional consideration)`;
    const afterAmount = t.slice(m.index! + m[0].length, m.index! + m[0].length + 120).split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])|;/)[0];
    if (new RegExp(String.raw`^[^.;]{0,40}?\b(?:including|includes|inclusive of|which include[sd]?)\b[^.;]{0,60}?\b${CONTINGENT_PART}`, "i").test(afterAmount)) continue;
    const leadIn = t.slice(Math.max(0, m.index! - 300), m.index!).split(/(?<!\b(?:Inc|Corp|Co|Ltd|L\.P|U\.S|No))\.\s+(?=[A-Z])|[•·;]\s/).pop() ?? "";
    if (new RegExp(String.raw`\b(?:including|inclusive of)\b[^.;]{0,80}?\b${CONTINGENT_PART}\b[^.;]{0,60}$|\b${CONTINGENT_PART}\b[^.;]{0,200}\bbringing\b[^.;]{0,80}$`, "i").test(leadIn)) continue;
    // The amount can come first: "Transaction at $13 Billion Equity Value and $25 Billion Consolidated Enterprise Value"
    // (Endeavor) paired "Equity Value" with the $25 billion after it.
    const amountFirst = /\bvalue$/.test(lead)
      ? /(?<![A-Z]{1,3})(?:US\$|\$|USD\s?)\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,3})?)\s*(trillion|billion|million|bn|mm|mn|B|M)\s+(?:(?:consolidated|implied|total|aggregate|approximate)\s+){0,2}$/i.exec(t.slice(Math.max(0, m.index! - 40), m.index!))
      : null;
    const usd = Math.round(amountFirst ? num(amountFirst[1]) * unitMult(amountFirst[2]) : num(m[2]) * unitMult(m[3])); // whole dollars: 1.035 × 1e9 is 1034999999.9999999
    if (usd < 1e6 || usd > MAX_DEAL_VALUE) continue;
    // The words up to the amount, not just the lead: "values EA at an enterprise value of approximately $55 billion".
    const named = (dollar > 0 ? m[0].slice(0, dollar) : m[0]).toLowerCase();
    // (A later amount named as the deal's whole value counts: "CVRs valued at up to $1 billion … a total equity value of
    // $4.8 billion", Bristol Myers / Mirati.)
    if (ceiling && !/\b(?:upfront|up-front|at closing|base purchase price|(?:enterprise|equity) value)\b/i.test(t.slice(Math.max(0, m.index! - 5), m.index!) + named + after)) continue;
    const label = amountFirst ? undefined : LABEL_AFTER.exec(after)?.[1].toLowerCase();
    const kind = label ? (label as "enterprise" | "equity") : named.includes("enterprise value") || lead.includes("enterprise") ? "enterprise" : named.includes("equity value") || lead.includes("equity") ? "equity" : "transaction";
    const ev = kind === "enterprise" ? null : enterpriseValueBeside(t, m.index! + Math.max(0, dollar), usd);
    return ev ? { usd: ev, kind: "enterprise" } : { usd, kind };
  }
  // Private-company deals usually just say "acquired Widget Co. … for $185 million" (or "for USD 6.2 billion").
  for (const m of t.matchAll(PRICE_FOR)) {
    const end = m.index! + m[0].length;
    // The amount's own sentence after it: "… or approximately $158,700,000, subject to customary closing adjustments.
    // Founded in 1969, …" is a price.
    if (NOT_DEAL_VALUE.test(t.slice(end - 40, end) + t.slice(end, end + 50).split(SENTENCE_END)[0])) continue;
    const usd = Math.round(m[1] ? num(m[1]) * unitMult(m[2]) : num(m[3]));
    if (usd < 1e6 || usd > MAX_DEAL_VALUE) continue;
    // "… for approximately $8 billion in equity value" (Salesforce / Informatica).
    const label = LABEL_AFTER.exec(t.slice(end, end + 60))?.[1].toLowerCase() as "enterprise" | "equity" | undefined;
    const ev = label === "enterprise" ? null : enterpriseValueBeside(t, end, usd);
    return ev ? { usd: ev, kind: "enterprise" } : { usd, kind: label ?? "transaction" };
  }
  // Only a real share of the ceiling: "$1 million at closing" under "up to $24.5 million" is some other payment.
  const top = ceiling || amountOf(CEILING.exec(t));
  const upfront = top ? amountOf(UPFRONT.exec(t)) : 0;
  return upfront >= 1e6 && upfront >= top * 0.1 && upfront < top ? { usd: upfront, kind: "transaction" } : null;
}

/**
 * Another currency before the dollar figure: "for £120 million, or approximately $158,700,000" (Alamo Group / Econ
 * Engineering), "for an aggregate purchase price of approximately €16.0 million ($18.0 million)" (Climb / NeoVAD).
 */
const FOREIGN_FIRST = String.raw`(?:(?:${String.fromCharCode(0x20ac)}|${String.fromCharCode(0xa3)}|${String.fromCharCode(0xa5)}|(?:EUR|GBP|CHF|JPY|SEK|NOK|DKK|CAD|AUD)\s?|(?:C|CA|A|AU)\$)\s?\d{1,4}(?:,\d{3})*(?:\.\d{1,3})?\s*(?:billion|million|bn|mm|mn|m|B|M)?\b\s*,?\s*(?:or\s+)?\(?\s*(?:approximately\s+|about\s+)?)`;
/**
 * "acquired Widget Co. … for $185 million": a name may end in an abbreviation before its defined term ("Hughes Brothers
 * Construction Inc. ("Hughes Brothers"), a leading … contractor, for $357.5 million"), and the dollars may be written in
 * full ("$158,700,000").
 */
const PRICE_FOR = new RegExp(
  String.raw`\b(?:acquir\w*|acquisition of|purchase of)\b(?:[^.;]|\.(?=,|\s+[a-z])|(?<=\b(?:Inc|Corp|Co|Ltd|Bros|L\.P))\.(?=\s*[(,])){0,220}?\bfor\s+(?:an?\s+(?:total\s+|aggregate\s+)?(?:purchase price|consideration)\s+of\s+)?(?:approximately\s+|about\s+)?${FOREIGN_FIRST}?(?:US\$|\$|USD\s?)\s?(?:(\d{1,4}(?:,\d{3})*(?:\.\d{1,3})?)\s*(billion|million|bn|mm|mn|B|M)\b|(\d{1,3}(?:,\d{3}){2,})(?!,?\d|\.\d|\s*(?:billion|million|bn|mm|mn)\b))(?!\s*(?:per share|a share))(?!\s*\(?\s*(?:CAD|CDN|AUD|NZD|HKD|SGD|MXN|EUR|GBP|CHF|JPY)\b)`,
  "gi",
);

/**
 * `forStock` is the text the stock and mixed tests read: employee-award sentences are left out of it (their conversion
 * into the buyer's stock is not the holders' price), but not out of the cash test ("Cisco will pay $76 per share in cash
 * … and assume outstanding equity awards": Sourcefire).
 */
function classifyConsideration(t: string, offer = false, forStock = t): Consideration | null {
  const cash =
    // "$148.50 per Biohaven share in cash", "$66.00 per Ordinary Share and ADS in Cash" (Talend)
    /all[- ]cash|per share in cash|\$\s?\d[\d.,]*\s*(?:per (?:\w+\s+){0,3}?share(?:\s+and\s+ADS)?\s*,?\s*)?in cash|cash consideration|in cash for each|cash tender offer|net to the (?:seller|holder)s?(?: thereof)? in cash|(?<!contingent )(?:total |aggregate )?cash purchase price|\b(?:an?|the) cash transaction|\bin upfront cash\b|\b(?:remainder|balance|rest)\s+of\s+the\s+(?:purchase price|consideration)\b[^.;]{0,40}?\b(?:payable|paid)\s+in\s+cash\b/i.test(t) ||
    // The consideration in amounts: "total consideration … will consist of approximately $1.89 billion of cash … and $82
    // million in equity" (Tradeweb / Trumid).
    // Not its financing: "the additional consideration … would be financed with an additional $25.0 million in equity"
    // (Plato's bid for Renaissance Learning).
    // (Also "$335 million cash", "acquisition price", a leg further on or after a semicolon: "consisting of approximately
    // $425 million in cash, subject to customary adjustments for …, and …"; never cash that buys out options.)
    // (And full dollars, "$625,000 cash", or the rest "payable in cash": "The remainder of the purchase price will be paid
    // in cash".)
    // (Not what the total is "inclusive of": "approximately $54 million in cash and 2.5 million Sucampo shares … held by
    // R-Tech Ueno", the target's own holdings.)
    /\b(?:consideration|(?:purchase|acquisition) price)\b(?:(?!financ|fund|inclusive)[^.]|\.(?=\d)){0,250}?(?:\$\s?\d[\d.,]*(?:\s*(?:million|billion))?\s+(?:(?:in|of)\s+)?cash\b(?!\s+(?:flow|equivalents|balance)|\s+to\s+(?:cash\s+out|settle|holders\s+of\s+(?:stock\s+)?options))|\b(?:remainder|balance|rest)\b[^.;]{0,60}?\b(?:payable|paid)\s+in\s+cash\b|\$\s?\d[\d.,]*(?:\s*(?:million|billion))?\s+(?:will\s+be\s+)?(?:payable|paid)\s+in\s+cash\b)/i.test(t) ||
    // In the sentence saying what holders get only: "£4.39 ($7.06) in cash", "the right to receive cash in an amount
    // equal to the Offer Price" (Cerner). Not "$80 million in cash": a lump sum there is often a CVR or one part of a
    // merger of equals, and elsewhere the balance sheet.
    // (Also "1.5 shares of MITT common stock … and a cash payment from Angelo Gordon"; not one for fractional shares.)
    (offer && /\d\)\s+in cash|\b(?:and|plus)\s+a\s+cash\s+payment\b(?!\s+(?:in\s+lieu|for\s+(?:any\s+|the\s+)?fraction))|\breceive\s+(?:an\s+amount\s+in\s+)?cash\b(?!\s+and\b)|\breceive\s+the\s+(?:Offer Price|Merger Consideration|Per Share (?:Merger )?(?:Amount|Consideration|Price))\s*,?\s+(?:net\s+to\s+the\s+holder\s+)?in\s+cash\b(?!\s+and\b)|\breceive\s+an?\s+(?:upfront\s+)?cash\s+payment\s+(?:of\s+(?:approximately\s+|about\s+)?\$|equal\s+to\s+an?\s+[\d.]+%\s+premium)|\b(?:one-time|upfront|special)\s+cash\s+payment\s+of\s+(?:approximately\s+|about\s+)?\$[\d.,]+\s+(?:per|for each)\b/i.test(t));
  const stock =
    // Not "available to all stockholders" (Sequenom) nor a count tendered or outstanding ("35,852,857 shares of Audentes
    // common stock were validly tendered"); an aggregate count paid counts ("will receive 30,700,000 shares of HF common
    // stock").
    // (Not an offering's or a conversion rate's count: "a public offering of 11,075,000 shares of common stock", "a
    // conversion rate of 166.11 shares of common stock per $1,000 of accreted value".)
    /\ball[- ]stock\b(?!holder)|stock[- ]for[- ]stock|exchange ratio|shares? of [\w&.'’ ]{1,60}?(?:common stock|common shares|ordinary shares)? for each|(?<![\d,.])(?<!\boffering of\s)(?<!\brate of\s)\b(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?) (?:restricted )?(?:shares|ordinary shares|common shares) of\b(?![^.;]{0,60}?\b(?:were|are|have been|had been)\s+(?:validly\s+)?(?:tendered|issued and outstanding|outstanding))(?![^.;]{0,40}?\bper\s+\$)|in (?:\w+ )?(?:common )?stock of|per share in stock/i.test(forStock) ||
    // "one Union Pacific common share and $88.82 in cash", "0.5 Acme ADSs", "one ListCo Share and $5.00 in cash" (a count
    // of shares, not a $ price per share)
    // Not a tender's top-up threshold: "constitutes one Share more than 90% of the outstanding Shares", "one share of
    // Common Stock more than 80%". Nor the merger sub's own shares: "… will be converted into and become one share of
    // common stock of the surviving corporation" (Revance). Nor an ADS ratio: "(each ADS representing one ordinary
    // share)" (Talend).
    // (… nor across a par value: "one share of common stock, par value $0.01 per share, of the Surviving Corporation"
    // (Surgery Partners, a cash deal), "… of the Webster Subsidiary" (Webster's reincorporation step before Santander's
    // share exchange); the period in "$0.01" ended the old look-ahead.)
    // (Also a ratio with no leading zero, ".30 shares of CenterState's common stock", and units: "1.3 Enterprise common
    // units".)
    /(?<![$\d.,]\s?)(?<!\brepresent(?:s|ing)\s)(?:\b(?:one|two|three|\d+\.\d+|\d+)|(?<=\s)\.\d+)\s+(?:[A-Z][\w&.'’-]*\s+){0,4}(?:common\s+|ordinary\s+)?(?:[Ss]hares?|ADSs?|(?<=[Cc]ommon\s)[Uu]nits?)\b(?!\s+(?:outstanding|repurchase|points?)|[^.;]{0,40}?\b(?:more|less|fewer) than\b|[^;]{0,70}?\bof (?:the )?(?:[A-Z][\w&.'’-]*\s+){0,2}(?:[Ss]urviving|[Ss]ubsidiary)\b)/.test(forStock) ||
    // An exchange ratio before legal words: "3.8721 fully paid and non-assessable Parent Shares" (Penumbra).
    // Not "0.640 KMI warrants per share", nor a share count ("2.785 million shares").
    /(?<![$\d.,]\s?)\b\d+\.\d{3,4}\s+(?!million|billion)(?:[\w&.'’-]+\s+){0,6}?(?<!\bper\s)(?:[Ss]hares?|ADSs?)\b/.test(forStock) ||
    // "the right to receive 0.70 of a fully paid and nonassessable share of Martin Marietta common stock" (TXI)
    /(?<![$\d.,]\s?)\b\d*\.\d+\s+of\s+(?:a|one)\s+(?:fully[- ]paid\s+(?:and\s+)?non-?assessable\s+)?(?:[A-Z][\w&.'’-]*\s+){0,3}(?:common\s+|ordinary\s+)?(?:share|ADS)\b/i.test(forStock) ||
    // "… and $82 million in equity" (Trumid), and in what holders receive, a share count: "a cash payment of $350
    // million and 5 million shares of RadNet, Inc. common stock" (ONRAD; elsewhere "5 million shares" is often a buyback).
    // (Also "worth of" / "equivalent of", units, "acquisition price"; not the target's book equity the price is set on,
    // "a premium on $336 million of core tangible common equity", nor employees' awards, "$20 million in restricted stock
    // to certain employee equity holders".)
    /\b(?:consideration|(?:purchase|acquisition) price)\b(?:(?!financ|fund|employee|award|inclusive)[^.]|\.(?=\d)){0,250}?(?<!\bon\s)\$\s?\d[\d.,]*\s*(?:million|billion)\s+(?:in|of|worth\s+of|equivalent\s+of|in\s+value\s+of)\s+(?:(?!(?:cash|for|and|or|the|of|with|plus|to|core|tangible|book)\b)[\w&.'’-]+\s+){0,4}?(?:equity|stock|shares|units)\b(?!\s+value)(?![^.;]{0,40}\b(?:employees?|members of (?:senior )?management|management team|officers|award holders|equity holders)\b)/i.test(forStock) ||
    // "The transaction consideration will consist of approximately 117.3 million shares of Diamondback common stock and
    // $8 billion of cash" (Endeavor). A count of shares of a stock, never a dollar amount ("an aggregate of up to
    // approximately $309.6 million excluding shares held by Lilly") nor the count the price is worked out on ("$294
    // million (which consists of approximately 35.9 million shares, inclusive of all shares …)": HealthGrades).
    // ("43.8 million Talos shares and $212.5 million in cash" counts; "35.9 million shares, inclusive of …" doesn't.)
    // (A count may follow a comma: "$136 million in cash, 3.14 million shares of Comverse's common stock".)
    /\b(?:[Cc]onsideration|(?:[Pp]urchase|[Aa]cquisition) [Pp]rice)\b(?:(?!financ|fund|inclusive)[^.]|\.(?=\d)){0,250}?(?<![$\d.]\s?)(?<!\d,)(?<!\beach of (?:the )?(?:approximately |about )?)\b\d+(?:\.\d+)?\s+million\s+(?:[A-Z][\w&.'’-]*\s+){0,3}?(?:common\s+|ordinary\s+)?(?:shares|units)\b(?!\s*[,)])(?![^.;]{0,40}?\b(?:outstanding|tendered|repurchased|issued and|already owned|owned by|held by)\b)/.test(forStock) ||
    // "… will receive a cash payment equal to … and shares of BSPRT common stock" (Capstead)
    // (After the payment, never the excluded shares: "(subject to certain exceptions, including shares of Common Stock owned
    // by the Company … and shares of Common Stock owned by stockholders who have … demanded appraisal)", iRobot.)
    // "newly-issued stock valued at $217 million", and in what holders receive "$30 million in Intrexon common stock".
    // (Issued stock only: "All-Cash Transaction For $25 Per Share of Common Stock Valued at Approximately $5.8 Billion".)
    /\b(?:newly[- ]issued|issued|new)\s+(?:common\s+)?stock\s+valued\s+at\s+(?:approximately\s+)?\$\s?\d/i.test(forStock) ||
    (offer && /\$\s?\d[\d.,]*\s*(?:million|billion)\s+(?:in|of)\s+(?:[A-Z][\w&.'’-]*\s+){1,4}(?:common\s+)?(?:stock|shares)\b/.test(forStock)) ||
    // (Nor the target's own spin-off handed out beside the cash: "$24.25 in Cash plus Shares of Bluerock Homes Trust, …
    // Spin-Off".)
    (offer && /\b(?:cash|payment|\$[\d.,]+(?:\s*(?:million|billion))?)\b(?:[^.;()]|\.(?=\d)){0,120}?\b(?:and|plus)\s+(?:newly[- ]issued\s+)?shares\s+of\b(?![^.;]{0,120}\bspin-?off\b)/i.test(forStock)) ||
    // (Not the count outstanding: "$85.00 in cash in return for each of the approximately 9.1 million shares outstanding".)
    // "between 50% and 75% of the total consideration in the Company's common stock and the remainder will be paid in cash"
    /\b\d{1,3}%\s+of\s+the\s+(?:total\s+|aggregate\s+)?(?:merger\s+)?consideration\s+in\s+(?:[\w'’]+\s+){0,3}(?:common\s+)?(?:stock|shares)\b/i.test(forStock) ||
    (offer && /(?<![$\d.]\s?)(?<!\d,)(?<!\beach of (?:the )?(?:approximately |about )?)\b\d+(?:\.\d+)?\s+(?:million|billion)\s+(?:[A-Z][\w&.'’,-]*\s+){0,4}?(?:common\s+|ordinary\s+)?shares\b(?![^.;]{0,40}?\b(?:outstanding|tendered|repurchased|issued and|already owned|owned by|held by)\b)/.test(forStock));
  // A cash-or-stock election is mixed: "at the election of the holder … 3.8721 Parent Shares … or $374.00 in cash".
  const mixed =
    // (Not a rival's: "superior to the stock and cash proposal from GFI's management and CME", "the $5.25 per share stock
    // and cash transaction announced by CME and GFI".)
    /cash and (?:[\d.]+ )?(?:\w+ )?(?:common )?(?:stock|shares)(?!\s+(?:proposal|offer|bid|transaction\s+announced\s+by)\b)|stock and cash(?!\s+(?:proposal|offer|bid|transaction\s+announced\s+by)\b)|combination of cash and|cash-and-stock|cash and stock|\b(?:cash|stock) election\b/i.test(forStock) ||
    // "a combination of Smith & Wesson equity and cash" (Savage Arms); "up to $378 million in cash, stock, and potential
    // earn-out", "upfront cash, stock and unvested restricted stock units"
    // (Not "(e) Represents non-cash, stock-based compensation expense".) An election between cash and shares is mixed:
    // "At least 70% of the consideration will be paid in cash and Infinera's shareholders can elect to receive up to 30% …
    // in the form of Nokia ADSs".
    // (The election is between cash and shares, never two kinds of equity: "may elect to receive exchangeable shares …
    // instead of the CTGO Shares", "BEPC shares or BEP units"; nor a financing's "issuance of common stock, cash on hand".)
    /\bcombination of [^.;]{0,40}?\b(?:equity|shares|stock)\s+and\s+cash\b|(?<!\bnon-)\bcash,\s+(?:common\s+)?stock\b(?!-)|(?<!\bissuance of (?:common )?)\bstock,\s+cash\b(?!\s+on\s+hand)|\bcash\b[^.;]{0,200}?(?<!\bwarrants?\b[^.;]{0,80})\belect\s+to\s+receive\b[^.;]{0,120}?\b(?:ADSs?|shares|stock)\b|(?<!\bwarrants?\b[^.;]{0,80})\belect\s+to\s+receive\b[^.;]{0,120}?\b(?:(?:ADSs?|shares|stock)\b[^.;]{0,120}?\bcash|cash\b[^.;]{0,80}?\b(?:ADSs?|shares|stock))\b|\bdepending on (?:their|its|the holder['’]s) election\b/i.test(forStock) ||
    // "72% stock (1:1 share) and 28% cash ($88.82/share)" (Union Pacific / Norfolk Southern), "36% cash ($11.25/BLFS
    // share) and 64% stock"
    /\b\d{1,2}% (?:stock|cash)\b(?:[^.;]|\.(?=\d)){0,40}?\b\d{1,2}% (?:stock|cash)\b/i.test(forStock) ||
    // "consisting of stock consideration of $10.11 per share and cash consideration of $1.12 per share", "WMC stockholders
    // will receive a portion of the merger consideration in cash" (AG Mortgage / WMC)
    /\bstock\s+consideration\b(?:[^.;]|\.(?=\d)){0,120}?\bcash\s+consideration\b|\bcash\s+consideration\b(?:[^.;]|\.(?=\d)){0,120}?\bstock\s+consideration\b|\b(?:portion|part)\s+of\s+the\s+(?:merger\s+|total\s+|aggregate\s+)?consideration\s+in\s+cash\b/i.test(forStock);
  // A lump sum of cash beside shares in what holders receive: "approximately 65.6 million shares of Bunge stock and
  // approximately US$2.0 billion in cash" (Viterra). Alone, such a sum is often a CVR or one side of a merger of equals.
  const lump = offer && /\$\s?\d[\d.,]*\s*(?:million|billion)\s+(?:(?:in|of)\s+)?cash\b(?!\s+(?:flow|equivalents|balance))/i.test(t);
  if (mixed || (cash && stock) || (lump && stock)) return "Mixed";
  if (stock) return "Stock";
  if (cash) return "Cash";
  return null;
}

export function extractConsideration(raw: string): Consideration | null {
  // "No fractional shares … will be issued, and holders … will receive cash in lieu of any fractional shares" says
  // nothing about the price (HFF). The clause only: it often ends the holders' own sentence ("… 0.5 shares of Parent
  // common stock, with cash paid in lieu of fractional shares").
  const t = raw.replace(
    /no cash consideration[^.]*|\bno cash,\s+stock\b[^.]*|without (?:any )?cash[^.]*|cash and cash equivalents|no (?:new )?(?:shares|stock) (?:will be|is being) issued[^.]*|\bno fractional shares[^.;]{0,120}?(?:will|shall) be issued[^.;,]*|\bcash\s+(?:will be paid\s+|being paid\s+|paid\s+|payable\s+)?in\s+lieu\s+of\s+(?:any\s+|such\s+|the\s+)?fraction(?:al|s)[^.;,)]*/gi,
    " ",
  );
  // The sentence saying what holders get decides it. Financing talk elsewhere ("funded with cash on hand and new
  // shares") made an all-cash deal (HPE / Juniper) look mixed.
  // (Not the earn-out's sentence: "ImmPACT shareholders will also be eligible to receive contingent consideration
  // consisting of 12.5 million shares of Lyell common stock" came before the upfront cash and shares.)
  // (A contingent value right beside the cash is no earn-out sentence: "(i) $13.00 in cash and (ii) a non-tradeable
  // contingent value right".)
  // (Nor a sub-headline about one part: "WMC Stockholders to Receive Cash Consideration as Part of Merger": AG Mortgage / WMC,
  // 1.5 shares and a cash payment, where it read as cash and the $1.12 cash leg as the offer price.)
  const offer = [...t.matchAll(/(?:[^.]|\.(?=\d))*\b(?:will receive|would receive|to receive|right to receive|entitled to receive)\b(?:[^.]|\.(?=\d))*/gi)].map((m) => m[0]).find((s) => !/\b(?:contingent consideration|earn-?outs?|milestone)\b/i.test(s) && !/\b(?:warrants?|options?|RSUs?)\b/i.test(s.split(/\b(?:will|would|to) receive\b/i)[0]) && !/\bconsideration\s+as\s+(?:a\s+)?part\s+of\b/i.test(s));
  // Employee awards converted into the buyer's stock ("… denominated in shares of Oracle's common stock … an exchange
  // ratio determined by dividing the Merger Consideration …") say nothing about what holders get: Cerner read as stock.
  const AWARDS = /\b(?:stock options?|options? to (?:purchase|acquire)|option awards?|replacement awards?|inducement (?:grants?|awards?)|restricted stock|RSUs?|PSUs?|performance (?:share |stock )?units?|(?:deferred )?(?:stock|share) units?(?: awards?)?|equity awards?|compensatory awards?|incentive awards?)\b/i;
  // A sentence about awards names them early; a holders' sentence can run on into them later (Ryland).
  const holders = t.split(/(?<=\.)\s+(?=[A-Z(])/).filter((s) => !AWARDS.test(s.slice(0, 150))).join(" ");
  return (offer && classifyConsideration(offer, true)) || classifyConsideration(t, false, holders);
}

// ---------------------------------------------------------------------------
// Advisors
// ---------------------------------------------------------------------------

export function extractAdvisors(t: string, acq: string, tgt: string, issuerRole: "acquirer" | "target" | null, tgtTicker: string | null) {
  const acquirerAdvisors: string[] = [];
  const targetAdvisors: string[] = [];
  // "ExxonMobil" is Exxon Mobil Corporation: compare without spaces too.
  const squash = (s: string) => normalizeName(s).replace(/\s+/g, "");
  const same = (a: string, b: string) => sameCompany(a, b) || (squash(a).length >= 4 && squash(a) === squash(b));
  // Names the release defines for a party: "Utility Innovation Holdings, Inc., which operates as UtilityInnovation Group
  // ("UIG")" (Vertiv's purchase), "Walgreens Boots Alliance (NASDAQ: WBA) (the "Company" or "WBA")".
  // The defined name must be the party's own, exactly: a shared first word is not enough ("Community Health Systems, Inc.
  // ("CHS")" is not Health Management Associates), nor the other party's name run in front ("by and among Atrion,
  // Nordson Corporation ("Nordson")").
  const defined = [...t.replace(/\((?:NYSE|NASDAQ|Nasdaq|Cboe)[^)]*\)\s*/g, "").matchAll(/((?:[A-Z][\w&.'’-]*,?\s+){1,6})\(([^()]{0,80}?["“][^()]{0,80})\)/g)];
  // It may add a word or descriptors to the party's name ("Western Midstream Partners, LP" ("WES") for Western Midstream,
  // "National Surgical Healthcare" ("NSH")), not a name of its own ("Monroe Capital Income Plus Corporation" ("MCIP") is
  // not Monroe Capital Corporation); a party named longer starts with it ("First Advantage Bancorp" ("FABK")).
  const DESCRIPTOR = /^(?:partners|holdings?|group|company|corporation|bancorp|bancshares|financial|trust|incorporated|enterprises|international|global|usa|us|america|technologies|systems|resources|industries|bank)$/;
  const aliasesOf = (name: string) =>
    defined
      .filter((d) => {
        const run = d[1].trim().replace(/,$/, "").replace(/^.*,\s+(?!(?:Inc|LLC|L\.?\s?P|Ltd|Corp|Co|N\.\s?A|S\.\s?A|plc|PLC|Limited)\b)/, "");
        const words = run.split(/\s+/);
        const x = normalizeName(name);
        const named = (s: string) => {
          if (s.replace(/ /g, "").length < 2 || x.length < 2) return false;
          if (s.replace(/ /g, "") === x.replace(/ /g, "")) return true;
          if (!s.startsWith(`${x} `)) return false;
          const extra = s.slice(x.length + 1).split(" ");
          return extra.length === 1 || extra.every((w) => DESCRIPTOR.test(w));
        };
        const whole = normalizeName(run);
        // A tail of the run only after a header or label in front ("WESTERN MIDSTREAM Western Midstream Partners, LP",
        // "Advisors Acme Corp."): "Beacon Roofing Supply, Inc." is not Roofing Supply Group.
        // (Also after another name's end, "… Corp. CVB Financial Corp." or "FORT MYERS, FL- First Busey Corporation", and the
        // name written twice, "American Industrial Partners American Industrial Partners".)
        const tailOk = (k: number) =>
          k === 0 ||
          /^[A-Z&]{2,}[-:.,]?$|[.:-]$/.test(words[k - 1]) ||
          /^(?:Advis[eo]rs?|About|Today|Contacts?|Exhibit|Release|News|Profile|Overview):?$/i.test(words[k - 1]) ||
          normalizeName(words.slice(0, k).join(" ")).endsWith(normalizeName(words.slice(k).join(" ")));
        return words.some((_, k) => tailOk(k) && named(normalizeName(words.slice(k).join(" ")))) || (whole.split(" ").length >= 2 && x.startsWith(`${whole} `));
      })
      .flatMap((d) => [...d[2].matchAll(/["“]\s*([A-Z][\w&.'’ -]{0,30}?[\w.])\s*,?\s*["”]/g)].map((q) => q[1]))
      .filter((a) => !/^(?:Company|Parent|Merger Sub|Purchaser|Buyer|Transaction|Merger|Agreement|Board)$/i.test(a));
  const [tgtAliases, acqAliases] = [aliasesOf(tgt), aliasesOf(acq)];
  const isAlias = (r: string, aliases: string[]) => aliases.some((a) => r === a || r.startsWith(`${a} `) || r.startsWith(`${a}'`) || r.startsWith(`${a}’`));
  // A company named by the start of a party's name ("Paramount" for Paramount Skydance Corporation) or its defined name.
  const startsName = (short: string, full: string) => {
    const [x, y] = [normalizeName(short), normalizeName(full)];
    return x.length >= 3 && (y === x || y.startsWith(`${x} `));
  };
  const ownerOf = (company: string): "acquirer" | "target" | null => {
    const a = startsName(company, acq) || isAlias(company, acqAliases);
    const b = startsName(company, tgt) || isAlias(company, tgtAliases);
    return a && !b ? "acquirer" : b && !a ? "target" : null;
  };
  /** Whose adviser a recipient ("to Copart", "to the Special Committee of …", "to UIG") is. */
  const partyRole = (r: string): "acquirer" | "target" | null => {
    // A committee's own company decides: "to the Special Committee of the Board of Directors of Paramount" is the
    // buyer's (Paramount / Warner Bros. Discovery), and so is "The ACR Special Committee" (ACR buying Broadmark).
    // (The last "of": "the special committee of independent directors of Zoom", "… of the VMware Board of Directors".)
    const of =
      /\bcommittee\b.*\bof\s+(?:the\s+)?([A-Z][^,;]*)$/i.exec(r.replace(/\s+Board(?:\s+of\s+Directors)?$/i, ""))?.[1] ??
      /^(?:[Tt]he\s+)?([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3})\s+(?:Special|Transaction|Independent|Strategic)\s+(?:Review\s+)?Committee\b/.exec(r)?.[1];
    const committee = /special committee|transaction committee|independent directors|strategic (?:review )?committee/i.test(r);
    // Or its name in front, in lower case or a possessive too: "BGC's special committee", "the SmartStop special committee".
    const before = /^(?:[Tt]he\s+)?([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3}?)(?:['’]s?)?\s+(?:independent\s+)?(?:[Ss]pecial|[Tt]ransaction|[Ii]ndependent|[Ss]trategic|[Cc]onflicts)\s+(?:[Rr]eview\s+)?[Cc]ommittee\b/.exec(r)?.[1];
    const whose = [of, before].find((x) => x && ownerOf(x));
    if (committee && whose) return ownerOf(whose);
    // A name the buyer's own name is inside, and the target's isn't ("First Busey Corporation" for Busey, against First
    // Community: same() matches on the shared first word).
    const has = (name: string, text: string) => {
      const n = normalizeName(name);
      return n.length >= 4 && ` ${normalizeName(text)} `.includes(` ${n} `);
    };
    if (has(acq, r) && !has(tgt, r)) return "acquirer";
    // A ticker as a word (ticker "S" isn't any capital S), and never when the name is the buyer's.
    const ticker = !!tgtTicker && (tgtTicker.length >= 2 ? r.includes(tgtTicker) : new RegExp(`(?:^|[^A-Za-z0-9])${tgtTicker}(?:$|[^A-Za-z0-9])`).test(r)) && !same(r, acq) && !isAlias(r, acqAliases);
    if (same(r, tgt) || isAlias(r, tgtAliases) || ticker || committee) return "target";
    if (same(r, acq) || isAlias(r, acqAliases) || /investor group|buyer|purchaser|parent\b/i.test(r)) return "acquirer";
    if (/^(?:the )?company\b|board of directors|^us\b|^we\b/i.test(r)) return issuerRole;
    return null;
  };
  const re = /financial advis[oe]rs?\b/gi;
  let prevEnd = 0;
  // An "Advisors" section heading names whom the lines under it advise: "Herc Advisors Guggenheim Securities, LLC is
  // serving as lead financial advisor … Credit Agricole … is serving as co-financial advisor".
  let heading: { name: string; at: number } | null = null;
  // "… are acting as lead financial advisors to Paramount, and Bank of America Securities, Citi, M. Klein & Company and
  // LionTree Advisors are also acting as financial advisors.": "also" with no recipient is the previous one's.
  let last: { role: "acquirer" | "target"; at: number } | null = null;
  for (const m of t.matchAll(re)) {
    const i = m.index!;
    const pre = t.slice(Math.max(prevEnd, i - 260), i);
    const post = t.slice(i + m[0].length, i + m[0].length + 220);
    // The recipient can end a long list: "UBS Investment Bank is acting as lead financial advisor, Goldman Sachs and J.P.
    // Morgan are acting as co-lead financial advisors, Citi and Wells Fargo …, Davis, Polk & Wardwell LLP is acting as
    // legal counsel and Bass Berry & Sims PLC is acting as healthcare regulatory counsel to Sycamore Partners."
    const postLong = t.slice(i + m[0].length, i + m[0].length + 420);
    prevEnd = i + m[0].length;

    // "<Bank> is serving as financial advisor to X" — banks precede the phrase.
    // Only the clause right before the phrase counts (after the last sentence break).
    // (An initial is no sentence end: "Citi, M. Klein & Company and LionTree Advisors". A sentence that opens with the phrase
    // has no clause before it: "… J.P. Morgan Securities LLC and legal advisor is Kirkland & Ellis LLP. Financial advisor to
    // General Parts International Inc. are Wells Fargo Advisors, LLC" credited Advance Auto Parts' banks to General Parts.)
    const clause = pre.split(/(?<![A-Z]\.[A-Z]|\b(?:Co|Inc|Corp|Ltd|L\.P|LLC|No|Mr|Ms|Dr|U\.S|[A-Z]))[.;]\s+(?=[A-Z]|$)/).pop() ?? pre;
    // "Citi is acting as Pfizer's financial advisor": the possessive names the recipient (not a bank).
    // (Or a bare apostrophe after an s: "Conatus' financial advisor in the transaction is Oppenheimer & Co., Inc.")
    const possessive = /((?:[A-Z][\w&.’-]*\s+){0,4}?[A-Z][\w&.’-]*?)(?:['’]s|(?<=s)['’])\s+(?:lead\s+|exclusive\s+|sole\s+|co-|joint\s+|independent\s+)*$/.exec(clause);
    // Not the section heading in front: "Advisors AbbVie's financial advisor is Morgan Stanley & Co. LLC".
    const owner = possessive?.[1].replace(/^(?:[\w&.’-]+\s+)*?Advis[oe]rs:?\s+(?=\S)/, "");
    const headed = /(?:^|\s)((?:[A-Z][\w&.'’-]*\s){0,3}?[A-Z][\w&.'’-]*)\s+Advis[oe]rs\s*:?\s+(?=[A-Z])/.exec(clause);
    if (headed && !findBanks(headed[1]).length) heading = { name: headed[1], at: i };
    // A contact list's label is no statement: "Goldman Sachs (financial advisor) Tim Ingrassia, +1 …".
    // ("Deutsche Bank (financial advisor to Warner Chilcott)" is one.) Nor are a broker's own advisers: "welcome the
    // talented financial advisors, their teams and clients to Raymond James".
    if (/\(\s*(?:lead\s+|exclusive\s+|co-)?$/i.test(pre) && /^\s*\)/.test(post)) continue;
    // (A count of them, "1,200 financial advisors"; not a footnote mark, "also served as 2 financial advisors to MetLife".)
    if (/\b(?:talented|experienced|veteran|wealth|retail|\d{2,}[\d,]*)\s+$/i.test(pre) || /^\s*,?\s*(?:their|and their|who)\b/i.test(post)) continue;
    // Banks only from the adviser's own clause: not a parent named beside it ("Greenhill, a Mizuho affiliate"), not one
    // named earlier for another role ("B. Riley FBR, Inc. is acting as capital markets advisor and private placement agent
    // to Trinity, and Raymond James … is acting as Trinity's financial advisor"), not a research-coverage list run in.
    // ("… to Patterson-UTI, while Morgan Stanley is acting as financial advisor to Seventy Seven", and a sentence that ended
    // on an abbreviation: "SunTrust Robinson Humphrey, Inc. Greenhill & Co. is serving as financial advisor".)
    let scan = (possessive ? clause.slice(0, possessive.index) : clause)
      .replace(/^.*(?:,\s*while|\bwhereas)\s+/i, "")
      .replace(/^.*\b(?:Inc|Corp|Ltd|LLC|L\.P)\.\s+(?:\d\s+)?(?!(?:LLC|L\.L\.C|LP|L\.P|Inc|Corp|Ltd|Co)\b)(?=[A-Z][\w&.'’-]*(?:,?\s+[A-Z&][\w&.'’-]*){0,5},?\s+(?:is|are|was|were|has|have|acted|served|acting|serving)\b)/, "")
      .replace(/,\s+an?\s+(?:[A-Z][\w.&'’-]*\s+){1,3}(?:affiliate|company|subsidiary|member)\b,?/gi, " ")
      .replace(/^.*\b(?:acting|serving|served|acted)\s+as\s+(?:its\s+|the\s+)?(?:exclusive\s+|sole\s+)?(?:capital markets|placement|legal|tax|accounting|regulatory|debt|structuring)\b[^.;]*?(?:,\s*and\s+|;\s*)/i, "");
    // (The list is bullets: "… Raymond James & Associates, Inc. • Robert W. Baird … Additional Information Keefe Bruyette
    // & Woods … served as financial advisor …".)
    if (/research coverage|•/i.test(scan)) scan = /\bAdditional Information\s+([\s\S]*)$/.exec(scan)?.[1] ??(/research coverage/i.test(scan) ? "" : scan.slice(scan.lastIndexOf("•") + 1));
    let banks = findBanks(scan);
    // Recipient: "... to Copart", "... and provided a fairness opinion to ACV", "... to H.I.G., and ..."
    // (A name's own period may come first: "… financial advisor to Apex Global Brands Inc., while …".)
    const RECIPIENT = String.raw`(?:to|for)\s+(?:the\s+)?((?:[A-Z]\.)+[A-Z]?\.?[^,;]{0,60}?|[^,;.]{1,90}?)(?=\.?[,;]|\.\s|\.$|\s+(?:and|in connection|on|with|in)\s|$)`;
    let recipientText = new RegExp(String.raw`^\s*(?:and [^,;]{0,90}?\s)?,?\s*(?:respectively\s*,?\s*)?${RECIPIENT}`).exec(post)?.[1] ?? "";
    // The recipient first: "For Clario, Evercore is serving as lead financial advisor and Latham & Watkins as deal counsel."
    if (!recipientText) recipientText = /^\s*(?:For|To)\s+(?:the\s+)?([A-Z][^,;]{1,60}?),\s/.exec(clause)?.[1] ?? "";
    // Otherwise, the recipient named at the end of the same sentence:
    // "Ardea is serving as lead financial advisor, Davis Polk ... and MarshBerry ... to The Baldwin Group."
    // (Or the one it says was advised: "Evercore acted as lead financial advisor, J.P. Morgan Securities LLC also advised
    // Range.")
    // The sentence ends at a period before a capital, a number, "###" or a web address, and after "Inc." too ("… to
    // Crescent Financial Bancshares, Inc. Sandler O'Neill … served as legal counsel to ECB Bancorp, Inc."); the long window
    // only when the sentence runs past the short one. Of its recipients, the first that is a party: a list of one side's
    // advisers and counsel can end with the other side's lawyers (", and Gibson, Dunn … served as counsel to Berkshire
    // Hathaway"), and the first "to" can be no party at all ("leading up to the Proposed Transaction").
    if (!recipientText) {
      const END = /(?<![A-Z]\.[A-Z]|\b(?:Co|Corp|Ltd|L\.P|LLC|U\.S|No|Mr|Ms|Mrs|Dr|[A-Z]))\.\s+(?=[A-Z0-9#]|www\.)/;
      const short = post.split(END)[0];
      const sentence = short.length < post.trimEnd().length - 1 ? short : postLong.split(END)[0];
      const all = [...sentence.matchAll(new RegExp(String.raw`\s${RECIPIENT}`, "g"))].map((x) => x[1]);
      recipientText = all.find((x) => partyRole(x.trim())) ?? all.at(-1) ?? /\badvised\s+(?!by\b)(?:the\s+)?([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,4})/.exec(sentence)?.[1] ?? "";
    }

    if (owner && !findBanks(owner).length) recipientText = owner;
    // "Financial advisors to Clearlake include Morgan Stanley, Goldman Sachs, JP Morgan, …"
    const listed = /^\s*(?:to|for)\s+(?:the\s+)?([^,;.]{1,60}?)\s+(?:include|includes|included|are|were)\s+([^.;]{2,300})/.exec(post);
    if (!banks.length && listed && findBanks(listed[2]).length) {
      banks = findBanks(listed[2]);
      recipientText = listed[1];
    }
    // "Lazard is acting as lead financial advisor with BofA Securities acting as co-advisor …", "ROTH Capital Partners acted
    // as the lead financial advisor to Navarre and Craig-Hallum acted as co-advisor", "Credit Suisse is serving as lead
    // financial advisor to IPC Healthcare and Evercore provided a fairness opinion".
    const co = /^\s*,?\s*(?:to\s+[^,;.]{1,60}?\s+)?(?:with|and)\s+([^,;.]{2,80}?)\s+(?:(?:acting|serving|acted|served)\s+as\s+(?:a\s+)?co-(?:financial\s+)?advis[oe]r|provided\s+(?:a|the)\s+fairness\s+opinion)/.exec(post);
    if (banks.length && co) banks = [...banks, ...findBanks(co[1])];
    // "the Company and its financial advisor, BofA Securities, ..."
    if (!banks.length) {
      // (Not another adviser's own clause after the recipient: "LUMA Securities acted as the financial advisor to Millennial
      // Media and GCA Savvian acted as the financial advisor to Nexage", where the first firm isn't on the bank list.)
      const wide = /^\s*,?\s*([^,.;]{2,140})/.exec(post)?.[1] ?? "";
      const after = (/^\s*,?\s*(?:to|for)\s/i.test(post) ? wide.split(/\s+and\s+(?=[^,;.]*?\b(?:acted|acting|served|serving|is|was|are|were|has|have|will)\b)/)[0] : wide).slice(0, 60);
      // (Not the recipient's own name: "Perkins Advisors LLC acted as financial advisor to Cowen".)
      banks = /^\s*,?\s*to\s/i.test(post) && findBanks(recipientText.trim().split(/\s+/)[0] ?? "").length ? [] : findBanks(after);
      if (banks.length) recipientText = /\bits\s*$/i.test(pre) ? "the Company" : recipientText;
    }
    if (!banks.length) continue;

    let role: "acquirer" | "target" | null = null;
    const r = recipientText.trim();
    // A short form in a possessive: "Bel's financial advisor" (BEL Fuse Inc.), "ANB's" (ANB Holdings, Inc.).
    const short = (a: string, full: string) => {
      const [x, y] = [normalizeName(a), normalizeName(full)];
      return !!possessive && x.length >= 3 && (y === x || y.startsWith(`${x} `));
    };
    if (!r) role = /\bits\s*$/i.test(pre) ? issuerRole : null;
    else if (r === owner && short(r, tgt) !== short(r, acq)) role = short(r, tgt) ? "target" : "acquirer";
    else role = partyRole(r);
    if (!role && heading && i - heading.at < 700) role = same(heading.name, tgt) ? "target" : same(heading.name, acq) ? "acquirer" : null;
    if (!role && !r && last && i - last.at < 600 && /\balso\b/i.test(clause)) role = last.role;
    // "UBS Investment Bank is acting as lead buyside financial advisor."
    if (!role && !r) role = /\bbuy[- ]?side\s+$/i.test(pre) ? "acquirer" : /\bsell[- ]?side\s+$/i.test(pre) ? "target" : null;
    // A recipient that is neither party ("to the consortium", "to Mr. Musk"), or none, leaves nothing for an "also" to
    // inherit.
    if (!role) {
      last = null;
      continue;
    }
    last = { role, at: i };
    (role === "acquirer" ? acquirerAdvisors : targetAdvisors).push(...banks);
  }
  // Banks credited without the words "financial advisor": "QXO is also being advised by Goldman Sachs, Citi, Centerview,
  // Credit Agricole, Wells Fargo and Mizuho." The party starts a sentence or a clause ("…, and TripIt was advised by
  // Deutsche Bank") and never runs back across a period ("… to Chase. KKR is advised by …"); its list stops at the next
  // party's ("Legg Mason was advised by Dechert, LLP and QS Investors was advised by RBC Capital Markets", "… and Oritani
  // by …").
  const SENTENCE_END = /(?<![A-Z]\.[A-Z]|\b(?:Co|Inc|Corp|Ltd|L\.P|LLC|U\.S|No|[A-Z]))\.\s|;/;
  // (A name may hold periods, "PersonalizationMall.com", "Kaleyra S.p.A", "S.T. Specialty Foods", but a word ends in one
  // only as an abbreviation; a page header may run in: "Page 2 of 6 GLOBAL EAGLE ENTERTAINMENT GEE was advised by Citi".)
  const WORD = String.raw`[A-Z][\w&'’-]*(?:\.[\w&'’-]+)*(?:(?<=\b(?:Inc|Co|Corp|Ltd|L\.P|[A-Z]))\.)?`;
  for (const m of t.matchAll(new RegExp(String.raw`((?:${WORD}\s+){0,4}?${WORD})\s+(?:is|are|was|were|has been|have been)\s+(?:also\s+)?(?:being\s+)?advised\s+by\s+`, "g"))) {
    // The party is the subject's longest tail that names one: "L.L.P. First M&F Corporation" (an abbreviation ended the
    // sentence before), "D.C. The Nashua Bank".
    const words = m[1].replace(/^(?:.*\s)?Advis[eo]rs?:?\s+/, "").split(/\s+/);
    const tails = words.map((_, k) => words.slice(k).join(" ")).filter((s) => normalizeName(s).length >= 3);
    const role = tails.map((s) => partyRole(s)).find(Boolean) ?? null;
    const end = m.index! + m[0].length;
    // The list ends where the next party's "… was advised by" begins, also after an abbreviation's period ("… Phelps
    // Dunbar, L.L.P. First M&F Corporation was advised by …", "Stephens Inc. SBI was advised by …").
    const list = t
      .slice(end, end + 300)
      .split(/\b(?:is|are|was|were|has been|have been)\s+(?:also\s+)?(?:being\s+)?advised\b/)[0]
      .split(SENTENCE_END)[0]
      .split(/\s+(?:and|while|whereas)\s+(?:the\s+)?[A-Z][\w&'’-]*(?:\s+[A-Z][\w&'’-]*){0,4}\s+(?:(?:is|are|was|were|has been|have been)\s+(?:also\s+)?(?:being\s+)?advised|by)\s|,?\s+(?:while|whereas)\s/)[0];
    if (role) (role === "acquirer" ? acquirerAdvisors : targetAdvisors).push(...findBanks(list));
  }
  // "J.P. Morgan Securities LLC also advised Range." (Only the banks of its own clause: "Jefferies LLC served as financial
  // advisor to CECO while William Blair & Company advised Met-Pro".)
  for (const m of t.matchAll(/\s(?:also\s+)?advised\s+(?!by\b)(?:the\s+)?([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,4})/g)) {
    const role = partyRole(m[1]);
    const before = t.slice(Math.max(0, m.index! - 160), m.index!).split(/[;,]\s|\s(?:while|whereas)\s|(?<![A-Z]\.[A-Z]|\b(?:Co|Inc|Corp|Ltd|L\.P|LLC|U\.S|[A-Z]))\.\s+(?=[A-Z])/).pop() ?? "";
    if (role) (role === "acquirer" ? acquirerAdvisors : targetAdvisors).push(...findBanks(before));
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
// (A unit's name may carry a trademark sign: "MKS Inc.'s Ophir ® Optics Business".)
const PART_WORDS =
  /^(?:\s+[\w&.,®™℠-]+){0,5}?\s+(?:business(?:es)?|division|unit|assets|operations|segments?|portfolio|subsidiar(?:y|ies)|product lines?|products|brands?|plants?|facilit(?:y|ies)|stake|interest|properties|rights|patent(?:s|ed)?|proprietary|technolog(?:y|ies)|intellectual property|licen[cs]es?|platforms?)\b/i;
/** After a possessive: a part of the company ("'s valve unit", "'s Environmental Solutions Business"). */
const PART_OF = { test: (rest: string) => /^\s+[a-z]/.test(rest) || PART_WORDS.test(rest) };

/**
 * "Acme Acquires Honeywell's Aerospace Unit": a carve-out, not a purchase of the named company. A possessive followed
 * by a name is the name itself ("Mama Mary's Pizza Crusts", "Papa Murphy's").
 */
export function isCarveOut(headline: string, intro: string, targetName: string): boolean {
  const own = /(?:['’]s|s['’])(\s.*)$/.exec(targetName);
  if (own && PART_OF.test(own[1])) return true;
  // Branches bought from a bank ("… Announce Agreement to Acquire Vision Bank Branch Locations"), a business or a joint
  // venture ("… Remaining Ownership Interest in Mechanical Services Business", "… in Filter Joint Venture with Panasonic").
  if (/\b(?:Branch(?:es| Locations| Offices)?|Business(?:es)?|Joint(?: Venture)?)$/i.test(targetName.trim())) return true;
  const possessive = new RegExp(`${escapeRx(targetName)}['’]s(\\s.{0,80})`).exec(headline);
  if (possessive && PART_OF.test(possessive[1])) return true;
  if (breaksAtPossessive(headline, intro, targetName)) return true;
  // The headline goes on with an asset word right after the name (or a list of them): "… Acquisition of Producing
  // Properties in the Gulf", "… of South32's Bauxite, Alumina, and Aluminum Assets". Only after the verb: "Rouse
  // Properties Reports … Results" names the company. Also a stake ("… Majority Stake in Digital Bank", "… Remaining
  // Public Stake in ONEOK Partners") and technology bought from someone ("… Crypto Technology from Token IQ"; not
  // "Linear Technology", whose name the parser cut, nor "Argotec, a Technology Leader"), and a site bought from someone
  // ("Valero to Acquire Former Houston Refinery from LyondellBasell").
  if (new RegExp(`(?:acquisition of|acquires?|acquired|acquiring)\\s+(?:the\\s+)?${escapeRx(targetName)}(?:,\\s+(?:and\\s+)?[A-Z][\\w&.-]*)*,?\\s+(?:business(?:es)?|division|unit|assets|operations|portfolio|properties|product lines?|rights|production|reserves|acreage|leases|wells|royalt(?:y|ies)|technology\\s+from|(?:refiner(?:y|ies)|plants?|facilit(?:y|ies)|terminals?|mines?|sites?)\\s+from|patents?|stake|interest)\\b`, "i").test(headline)) return true;
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

/**
 * A headline that breaks off at the possessive ("Allegion to Acquire Stanley Black & Decker's"): the unit follows on the
 * next line, which the release repeats ("… Stanley Black & Decker's Access Technologies Business"). A name can end that
 * way too ("Dave & Buster's Entertainment, Inc."), so the release's own words decide.
 */
function breaksAtPossessive(headline: string, intro: string, targetName: string): boolean {
  const base = targetName.replace(/['’]s$/, "");
  if (!new RegExp(`${escapeRx(base)}['’]s\\s*$`).test(headline)) return false;
  const rest = new RegExp(`${escapeRx(base)}['’]s(\\s.{0,80})`).exec(intro.slice(0, 600));
  return !!rest && PART_OF.test(rest[1]);
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
  // ("AG Mortgage Investment Trust Submits Offer to Acquire Western Asset Mortgage Capital": a proposal to the board.)
  if (/\b(?:propos(?:es|ed|al)|non-binding|unsolicited|indication of interest|letter to (?:the )?board|rejects?|bid for|submits? (?:an? )?(?:revised |superior |competing )?(?:offer|bid))\b/i.test(headline) && !/definitive (?:merger )?agreement|agreement and plan of merger/i.test(headline + " " + intro.slice(0, 600))) {
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
    const buy = FILER_BUYER_HEADLINE.exec(headline);
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
  // A description with the name at its end: "Disruptive Energy Drink Business GHOST" → "GHOST".
  // (Case-sensitive, so the name must be capitalised; the role word in Title Case or capitals.)
  const roles = "Business|Company|Provider|Platform|Firm|Developer|Leader|Pioneer|Maker|Manufacturer|Distributor|Producer|Specialist|Vendor|Innovator|Supplier|Agency";
  const tail = new RegExp(`^(.+\\s(?:${roles}|${roles.toUpperCase()}))\\s+([A-Z][\\w.&'’-]*(?:\\s+[A-Z][\\w.&'’-]*){0,2})$`).exec(parties.tgt);
  if (tail && isDescriptionOnly(tail[1]) && isPlausibleName(tail[2]) && !isDescriptionOnly(tail[2]) && !/^(?:of|in|for|and|the|to|with|from)\b/i.test(tail[2])) parties.tgt = tail[2];
  const runOn = () => new RegExp(`${escapeRx(parties!.tgt)}\\s+([A-Z](?=[\\w.&'’-]*[a-z])[\\w.&'’-]{2,})(?=\\s+[a-z])`).exec(flatten(text).slice(0, 5000));
  const runOnOk = (m: RegExpExecArray | null): m is RegExpExecArray => !!m && isPlausibleName(m[1]) && !/^(?:The|This|That|These|Today|Its|Our)$/.test(m[1]) && !sameCompany(m[1], parties!.acq);
  // (A listed company whose name is all ordinary words, "The New Home Company (NYSE: NWHM)", is a name.)
  const listedName = new RegExp(`${escapeRx(parties.tgt)}[^()]{0,40}\\((?:NYSE|NASDAQ|Nasdaq|NYSE American|Cboe)\\b`).test(flatten(text).slice(0, 8000));
  if (isDescriptionOnly(parties.tgt) && !listedName) {
    // No name at all: the headline gives it after the description ("… B2B Intelligence Leader, Clearbit", "… Edge AI
    // Pioneer Kinara to Redefine …"), as a name the release repeats (not "Combining …", "From Kvaerner", "In China").
    const flat = flatten(text);
    const m = new RegExp(`${escapeRx(parties.tgt)}(?:,\\s+|\\s+)([A-Z][\\w.&'’-]*(?:\\s+[A-Z][\\w.&'’-]*){0,3})(?=$|,|\\s+[a-z]|\\s+(?:To|For|In|With)\\b)`).exec(headline);
    const cand = m ? cleanPartyName(m[1].replace(/\s+(?:To|For|In|With)$/, "")) : null;
    const notWord = (c: string) => !/^(?:in|from|to|for|with|by|on|at|of|and|or|into|adjacent|including|plus|enters?|raises?|secures?|projected|expands?|adds?|creates?|strengthens?|bringing|combining|board|earnings|private|regulatory|assets?|locations?|business|portfolio|facilities|agency|center|greenhouse)\b|ing\b/i.test(c.split(/\s+/)[0]);
    const repeated = (c: string) => (flat.match(new RegExp(`\\b${escapeRx(c)}\\b`, "g")) ?? []).length >= 3;
    const usable = (c: string | null | undefined): c is string => !!c && isPlausibleName(c) && !isDescriptionOnly(c) && notWord(c) && repeated(c) && !sameCompany(c, parties!.acq);
    if (usable(cand)) parties.tgt = cand;
    // Or only the text does: "FRANKLIN ELECTRIC ACQUIRES WATER TREATMENT COMPANY … has acquired Puronics, Inc.".
    else if (usable(bodyParties?.tgt)) parties.tgt = bodyParties!.tgt;
  } else if (/\s(?:Leader|Provider|Maker|Developer|Specialist|Producer|Creator|Manufacturer|Supplier|Distributor)$/.test(parties.tgt)) {
    // The name after a comma: "Ovintiv Announces Agreement to Acquire Montney Oil Producer, Logan Energy Corp.".
    const afterComma = new RegExp(`${escapeRx(parties.tgt)},\\s+([A-Z][\\w.&'’-]*(?:\\s+[A-Z][\\w.&'’-]*){0,3})(?=$|,|\\s+[a-z])`).exec(headline);
    const named = runOn();
    // (Not a verb: "Exactech Acquires Key Supplier, Secures Proprietary …".)
    const verb = /^(?:Secures?|Expands?|Adds?|Strengthens?|Extends?|Enhances?|Creates?|Bolsters?|Broadens?|Accelerates?|Advances?|Enters?|Completes?|Acquires?|Announces?|Further\w*|\w+ing)\b/;
    if (afterComma && !verb.test(afterComma[1]) && isPlausibleName(cleanPartyName(afterComma[1])) && !sameCompany(afterComma[1], parties.acq)) parties.tgt = cleanPartyName(afterComma[1]);
    else if (runOnOk(named)) parties.tgt = cleanPartyName(`${parties.tgt} ${named[1]}`);
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
  // Buying a division or assets of a named company is not buying that company. A headline that breaks at the possessive
  // is checked by its own name too: the listing turns "Stanley Black & Decker's" into "Stanley Black & Decker, Inc.",
  // which the headline never writes. Only that check: the headline's name stops at any possessive ("O'Charley" of
  // "O'Charley's for $9.85"), and the other checks would read the lower-case word after it as a unit.
  if (isCarveOut(headline, intro, target.name) || (parties.tgt !== target.name && breaksAtPossessive(headline, intro, parties.tgt))) return null;

  const issuerRole: "acquirer" | "target" | null =
    sameCompany(ctx.filerName, target.name) || (target.ticker && ctx.filerTickers.includes(target.ticker))
      ? "target"
      : sameCompany(ctx.filerName, acquirer.name) || (acquirer.ticker && ctx.filerTickers.includes(acquirer.ticker))
        ? "acquirer"
        : null;

  const value = extractValue(terms);
  // (A ticker both sides read as is the buyer's: PAETEC / XETA's release lists only PAET.)
  const advisors = extractAdvisors(flatten(text), acquirer.name, target.name, issuerRole, target.ticker === acquirer.ticker ? null : target.ticker);
  // The release's own date: its dateline (Cardinal's release of October 13, 2026 for Hughes Brothers came with an 8-K
  // on October 19), or for a completion, the announcement it refers back to ("the definitive share sale and purchase
  // agreement … announced on December 9, 2025": Cronos / CanAdelaar). The ingest decides how far back it may reach.
  const announcedOn =
    kind === "announcement"
      ? isoDateIn(DATELINE.exec(text)?.[0])
      : kind === "completion"
        ? isoDateIn(ANNOUNCED_ON.exec(flatten(text).slice(0, 4000))?.[0])
        : undefined;

  // A target the release lists abroad only: "Logan Energy Corp. ("Logan") (TSXV: LGN)" (Ovintiv). Not one listed in the US
  // too ("(TSX: ABC, NYSE: ABC)").
  const tgtCore = escapeRx(target.name.replace(/,?\s+(?:Inc|Corp|Ltd|LLC|Limited|Corporation|plc)\.?$/, ""));
  const listing = target.ticker ? undefined : new RegExp(`${tgtCore}(?:,?\\s+(?:Inc|Corp|Ltd|LLC|Limited|Corporation|plc)\\.?)?\\s*(?:\\([^()]*["“][^()]*\\)\\s*)?\\(([^()]*:[^()]*)\\)`).exec(flatten(text).slice(0, 8000))?.[1];
  const ABROAD = /^(?:TSXV?|TSX-V|CSE|ASX|LSE|AIM|NEO|Euronext|SIX|HKEX|SGX|JSE|TASE)$/;
  const targetListedAbroad = target.exchange
    ? ABROAD.test(target.exchange)
    : !!listing && /\b(?:TSXV?|TSX-V|CSE|ASX|LSE|AIM|NEO|Euronext|SIX|HKEX|SGX|JSE|TASE)\s*:/.test(listing) && !/\b(?:NYSE|NASDAQ|Nasdaq|Cboe)\b/.test(listing);

  return {
    kind,
    headline,
    acquirer,
    target,
    ...(announcedOn ? { announcedOn } : {}),
    ...(targetListedAbroad ? { targetListedAbroad } : {}),
    privateTarget: isPrivateTarget(target.name, intro, target.ticker),
    pricePerShare: extractPrice(terms),
    premiumPct: extractPremium(terms),
    valueUsd: value?.usd ?? null,
    valueKind: value?.kind ?? null,
    consideration: extractConsideration(terms),
    ...advisors,
    ...(opensAsResults(flatten(text)) ? { resultsReport: true } : {}),
  };
}
