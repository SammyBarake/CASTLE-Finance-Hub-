/**
 * Fairness-opinion parser. A merger proxy / 14D-9 summarises each bank's valuation work:
 * "Discounted Cash Flow Analysis ... resulted in an implied per share equity value range of
 * $103.40 to $171.75", the DCF assumptions, and the bank's fee. We read only inside each
 * "Opinion of <Bank>" section so bids from the background story and termination fees are ignored.
 */
import { findBanks } from "../../lib/banks";
import type { FairnessOpinion, ValuationRange } from "../../lib/types";

/** Analysis families, most specific first. Matched against the text just before a range. */
const METHODS: { method: string; re: RegExp }[] = [
  { method: "Analyst price targets", re: /price targets?/i },
  { method: "52-week trading range", re: /52[- ]week|fifty-two|(?:had )?traded in a range/i },
  { method: "Premiums paid", re: /premi(?:ums?|a) paid|premiums? analys|premia analys/i },
  { method: "Leveraged buyout", re: /leveraged buyout|\bLBO\b/i },
  { method: "Sum of the parts", re: /sum[- ]of[- ]the[- ]parts/i },
  { method: "Liquidation", re: /liquidation analys/i },
  { method: "Future share price", re: /future (?:share|stock) price|discounted equity value|present value of (?:illustrative )?future/i },
  { method: "Precedent transactions", re: /precedent transactions?|selected (?:precedent )?transactions? analys|transactions? multiples? analys|selected (?:m&a|acquisition) transactions/i },
  { method: "Trading comparables", re: /(?:selected |comparable )(?:public |publicly traded )?compan(?:y|ies)|trading comparables|public trading/i },
  { method: "Discounted cash flow", re: /discounted cash flow|\bDCF\b|dividend discount/i },
];

const NUM = String.raw`\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)`;
/**
 * A per-share range: "$9.10 to $15.20", "$7.54 - $9.11", "between $X and $Y", never followed by million/billion.
 * The separator is captured: "and" makes a range only after "between" (`twoFigures`).
 */
const RANGE = new RegExp(String.raw`${NUM}\s*(to|-|–|—|and)\s*${NUM}(?!\s*(?:million|billion|thousand|mm|bn|[MB]\b))`, "g");
const TRIGGER = /(?:resulted in|results in|indicated|indicating|derived?|yield(?:ed|ing|s)?|calculated|implied|reference ranges?|ranging from|range of)/i;

const num = (s: string) => Number(s.replace(/,/g, ""));

interface Section {
  start: number;
  end: number;
  heading: string;
}

/** "Opinion of X" headings that open a real fairness section (followed by financial analyses). */
function fairnessSections(t: string): Section[] {
  const starts: { index: number; heading: string }[] = [];
  const re = /(?:^|\n)[ \t]*(?:\(\w\)\s*)?(Opinion of [^\n]{3,140})/g;
  for (const m of t.matchAll(re)) {
    const index = m.index! + m[0].indexOf("Opinion of");
    const heading = m[1].trim();
    // Cross-references ("... (page 50)", "... beginning on page 55") and annex titles are not sections.
    if (/\bpage\s+\d|\bAnnex\b|^Opinion of Financial Advisors?\s*$|\bA-\d+\b/i.test(heading)) continue;
    const ahead = t.slice(index, index + 40_000);
    if (!/financial analys|discounted cash flow|selected (?:public )?compan|precedent transaction/i.test(ahead)) continue;
    starts.push({ index, heading });
  }
  // A section ends at the next "Opinion of" line of any kind, or at the next major proxy heading.
  const allHeadings = [...t.matchAll(/(?:^|\n)[ \t]*(?:\(\w\)\s*)?Opinion of [^\n]{3,140}/g)].map((m) => m.index! + m[0].indexOf("Opinion of"));
  const STOP = /\n[ \t]*(?:Certain (?:Unaudited )?(?:Prospective |Financial )?(?:Financial Information|Projections|Forecasts)|(?:Unaudited )?Prospective Financial Information|Management Projections|Interests of (?:the )?(?:Company's |Our )?(?:Directors|Executive)|Financing of the (?:Merger|Offer)|Regulatory Approvals)[^\n]{0,80}\n/g;
  const sections: Section[] = [];
  for (const s of starts) {
    const nextHeading = allHeadings.find((i) => i > s.index + 20) ?? t.length;
    STOP.lastIndex = s.index + 20;
    const stop = STOP.exec(t)?.index ?? t.length;
    sections.push({ start: s.index, end: Math.min(nextHeading, stop, s.index + 70_000), heading: s.heading });
  }
  return sections.filter((s) => countRanges(t.slice(s.start, s.end)) > 0);
}

function countRanges(s: string): number {
  let n = 0;
  for (const m of s.matchAll(RANGE)) {
    const before = s.slice(Math.max(0, m.index! - 220), m.index!);
    if (TRIGGER.test(before) && /per (?:company )?share|per share|equity values?|per unit|share price|price range/i.test(before + s.slice(m.index!, m.index! + 120))) n++;
  }
  return n;
}

const methodIn = (s: string) => METHODS.find(({ re }) => re.test(s))?.method ?? null;
/** A cross-reference says nothing about this analysis: Qatalyst's selected transactions "calculated utilizing the same methodology as used in the above discounted cash flow analysis" (Splunk, Ansys). */
const withoutCrossRef = (s: string) => s.replace(/\b(?:as used in )?(?:the )?(?:above|foregoing|preceding|prior)[a-z ]{0,30}analysis/gi, " ");
/** A run-in heading, which may have a space before its period ("Discounted Cash Flow Analysis . Citi performed"). */
const RUN_IN = /^([A-Z][^.]{3,90}\bAnalys[ie]s)\s?\.\s/;

/**
 * The analysis a range belongs to: named in the same sentence ("price targets ... ranging from"),
 * else the paragraph's topic, else the nearest analysis heading above it (a short line like "Discounted Cash Flow Analysis").
 */
export function methodFor(lookback: string, sentence: string): string | null {
  // 1. Named in the same sentence.
  const inSentence = methodIn(withoutCrossRef(sentence));
  if (inSentence) return inSentence;
  const lines = lookback.split("\n");
  // 2. The paragraph's run-in heading, else its first sentence. A passing mention further on ("terminal multiples of the
  // selected companies": EA's and Jamf's DCFs) doesn't outrank the heading above.
  const paragraph = withoutCrossRef(lines.at(-1) ?? "").replace(/^[^A-Za-z0-9]+/, "");
  const runIn = RUN_IN.exec(paragraph)?.[1];
  const topic = (runIn && methodIn(runIn)) || methodIn(paragraph.split(/\.\s+(?=[A-Z])/)[0] ?? "");
  if (topic) return topic;
  // 3. The nearest heading above: a short line, or a run-in heading ("Illustrative Discounted Cash Flow Analysis. Goldman ...").
  for (const line of lines.slice(0, -1).reverse()) {
    // Headings often start with bullets, zero-width spaces or other invisible characters.
    const l = line.replace(/^[^A-Za-z0-9]+/, "").trim();
    const head = l.length < 110 ? l : (RUN_IN.exec(l)?.[1] ?? "");
    const m = head && /analys|review|targets?|trading range/i.test(head) ? methodIn(head) : null;
    if (m) return m;
  }
  // 4. The last mention in the paragraph, then in the text just above, ignoring passing references to price targets / 52-week ranges.
  return lastMention(paragraph, false) ?? lastMention(lookback.slice(-2500), true);
}

function lastMention(s: string, skipIncidental: boolean): string | null {
  let best: { method: string; at: number } | null = null;
  for (const { method, re } of METHODS) {
    if (skipIncidental && (method === "Analyst price targets" || method === "52-week trading range")) continue;
    const last = [...s.matchAll(new RegExp(re.source, "gi"))].at(-1);
    if (last && (!best || last.index! > best.at)) best = { method, at: last.index! };
  }
  return best?.method ?? null;
}

/**
 * Bump when the parser changes so stored opinions are re-read on the next ingest.
 */
export const FAIRNESS_PARSER_VERSION = 3;

/** "a transaction fee that is estimated, based on the information available ..., at approximately $45 million" (Goldman Sachs), "$53,000,000", "total compensation of". */
const FEE = /((?:\w+\s+)?)(?:fees?\b|(?:total|additional) compensation\b)([^.$]{0,160}?)\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(million|billion))?/gi;
/** Work before this deal ("for which Moelis received a fee", "in the two years prior", KCS's "$5 million to $15 million in connection with such services"). */
const PAST_WORK = /\b(?:two|2|three|3)[- ]years?\b|\byears? (?:prior|preceding|before)|\bmonths? (?:prior|preceding)|\bprior to the date\b|\bfees? recogni[sz]ed\b|\bfor which\b|\bin connection with such services\b|\bfor such services (?:was|were)\b|\bother than a fee\b|\bhas provided\b|\bhave provided\b|\bhad provided\b|\bpreviously provided\b|\bduring (?:the|such) period\b|\bin the future\b/i;
/**
 * The part paid for the opinion or on a milestone, not the fee: "a fee of $1.5 million, which was payable upon delivery of Morgan
 * Stanley's opinion" (QTS's total comes later, "an aggregate fee equal to $25 million (against which the opinion fee will be credited)").
 */
const OPINION_ONLY = /^(?:[^.$]{0,40}?)\b(?:upon|on|for|following|in connection with)\s+(?:[^.$]{0,30}?\s)?(?:delivery|rendering|its opinion|his opinion|execution)|^(?![^.$]{0,20}\b(?:against|to) which\b)[^.$]{0,50}\bcredited\b|^(?![^.$]{0,20}\b(?:against|to) which\b)[^.$]{0,60}\b(?:opinion fee|referred to as the "?Opinion)/i;

/** A short form of the bank's name: "Perella" for Perella Weinberg, "BGL" for Brown Gibbons Lang. */
const sameFirm = (payee: string, bank: string) => bank.split(/\s+/).some((w) => w.length >= 3 && payee.includes(w)) || payee.startsWith(bank.split(/\s+/).map((w) => w[0]).join(""));

/**
 * The bank's own fee for this deal: "the Company has agreed to pay Goldman Sachs a transaction fee of approximately
 * $42 million". Never a termination fee, never the target's own fee income ("management fees", "fee-related earnings
 * of $132 million"), which asset-manager proxies are full of, never past work or another bank's fee. An opinion or
 * milestone fee counts only when the section states no other.
 */
export function bankFee(body: string, bank: string | null = null): number | null {
  let opinionFee: number | null = null;
  for (const m of body.matchAll(FEE)) {
    const amount = Math.round(Number(m[3].replace(/,/g, "")) * (m[4] ? (/billion/i.test(m[4]) ? 1e9 : 1e6) : 1));
    if (amount < 1_000_000 && !m[4]) continue; // Reimbursement caps, retainers and closing fees in full dollars.
    // A fixed window, not a sentence split: bank names like "J.P. Morgan" contain ". ".
    const end = m.index! + m[0].length;
    const lead = body.slice(Math.max(0, m.index! - 220), end);
    const sentence = body.slice(Math.max(0, m.index! - 120), end);
    const near = body.slice(Math.max(0, m.index! - 40), m.index!) + m[0];
    if (/termination|break[- ]?up|expense|reimburse|legal fee|counsel|described above|discretion/i.test(near.slice(0, near.length - (m[3].length + 12)))) continue;
    if (/management fees?|fee[- ]related|catch-up|FRE\b|fee revenue|fee income|fee earnings|incentive fees? (?:revenue|income)/i.test(sentence)) continue;
    // It must be a payment to the adviser.
    if (!/\b(?:pay|paid|payable|receive[sd]?|entitled|agreed|engagement letter|compensat|earned|provides for)/i.test(lead)) continue;
    // The sentence, read back further than the window above; "J.P. Morgan" is no sentence end.
    const own = body.slice(Math.max(0, m.index! - 260), end).split(/[a-z0-9)]\.\s+(?=[A-Z])|\bMiscellaneous\b/).pop() ?? "";
    if (PAST_WORK.test(own) || /\bterminat|\bobligated to pay\b/i.test(own)) continue;
    // The amount must be the fee's own, not a figure in a clause on the way to it.
    if (/\b(?:plus|less|up to \d)\b/i.test(m[2]) && !m[4]) continue;
    // "potential fees payable to Goldman Sachs would be less than $3.5 million" (TopBuild) states no fee.
    if (/(?<!\bno |\bnot )\bless than\s+$/i.test(m[2])) continue;
    // A section can run on: "the nine non-employee directors ... received aggregate total compensation of $1,507,766" (Pacific Mercantile).
    if (/compensation/i.test(m[0]) && /\b(?:directors?|officers?|employees?|executives?)\b/i.test(sentence)) continue;
    // Another bank's fee in this section ("RBA has agreed to pay Evercore a fee of $2.5 million" under Guggenheim's opinion).
    if (bank) {
      const named = findBanks(body.slice(Math.max(0, m.index! - 90), m.index!));
      if (named.length && !named.includes(bank)) continue;
      // Or to a firm not on the bank list: "the Company has agreed to pay Moorgate a cash fee equal to $5,579,070" under Canaccord's
      // opinion (Leaf Group), "GulfStar will be entitled to a success fee" under Houlihan Lokey's (Adams Resources).
      const above = body.slice(Math.max(0, m.index! - 70), m.index!) + m[1];
      const payee = /\bpay\s+([A-Z][\w&.'-]+(?:\s+[A-Z][\w&.'-]+){0,3})\s+(?:an?|its|certain)\s+[^.$]{0,40}$/.exec(above)?.[1] ?? /\b([A-Z][\w&.'-]+(?:\s+[A-Z][\w&.'-]+){0,3})\s+(?:will be|is|was|became|would be)\s+entitled to\s+(?:receive\s+)?(?:an?\s+)[^.$]{0,40}$/.exec(above)?.[1];
      if (payee && !findBanks(payee).includes(bank) && !sameFirm(payee, bank)) continue;
    }
    // A fee stated as a range has no one figure ("an aggregate fee of between $15 million and $20 million": Safehold), nor
    // one stated in parts ("a transaction fee ... to consist of (i) $2.0 million ... and (ii) approximately $2.4 million": VOXX).
    if (/\bbetween\s+$|\bconsist of\s*\(\w\)\s*$/i.test(m[2])) return null;
    const after = body.slice(end, end + 120);
    // "the following fees: an opinion fee of $2,500,000, ...; a transaction fee ... of approximately $24 million" (Signify);
    // "an initial fee of $1,000,000 ... a success fee equal to $7,170,000" (Continental); "an announcement fee of $8 million" (Essential Utilities).
    if ((OPINION_ONLY.test(after) && !/^[^.$]{0,40}\bof which\b/i.test(after)) || /\b(?:milestone|opinion|retainer|initial|announcement|approval)\s+$/i.test(m[1]) || /\b(?:milestone|opinion|retainer|initial|announcement|approval)\s+fees?\b[^$]*$/i.test(m[2])) {
      opinionFee ??= amount;
      continue;
    }
    return amount;
  }
  return opinionFee;
}

const LEGAL = /\s*,?\s+(?:Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|LLC|L\.L\.C|LP|L\.P|PLC|N\.V|S\.A|SE|AG|Holdings?|Group|Trust)\.?(?=\s|,|$).*$/i;
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GENERIC_TERM = /^(?:the|company|parent|buyer|purchaser|merger sub|acquiror|acquirer|registrant|us|we|our|issuer|combined company|surviving corporation|surviving company)$/i;
/** A first word too ordinary to stand for a company on its own. */
const ORDINARY_FIRST = /^(?:first|united|american|national|general|energy|global|bank|equity|community|southern|northern|western|eastern|pacific|central|capital|real|great|home|union|north|south|west|east|citizens|peoples|people's|heritage|independent|independence|premier|summit|liberty|pioneer|diamond|black|blue|green|golden|royal|standard|sterling|atlantic|mountain|river|valley|ocean|star|sun|alpha|delta|omega)$/i;

/** The names a party goes by in this document: its name without the legal suffix, shorter forms and the term the proxy defines for it. */
function aliasesOf(name: string, t: string): string[] {
  const core = name.replace(/^the\s+/i, "").replace(LEGAL, "").trim();
  if (core.length < 2) return [];
  const aliases = new Set<string>([core]);
  // "Old National" for Old National Bancorp, "NextEra" for NextEra Energy.
  const shorter = core.replace(/\s+(?:Bancorp(?:oration)?|Bancshares|Bankshares|Banc|Financial|Energy|Therapeutics|Pharmaceuticals|Technologies|Properties|Realty|Resources|Partners|Communities|Systems|Solutions|Medical|Industries|Brands|Services|International)(?:\s+(?:Corp|Inc|Services))?$/i, "");
  if (shorter !== core && shorter.length > 3) aliases.add(shorter);
  const words = core.split(/\s+/);
  if (words.length > 2) aliases.add(words.slice(0, 2).join(" ")); // "Diamond S" for Diamond S Shipping.
  if (words[0].length >= 4 && !ORDINARY_FIRST.test(words[0])) aliases.add(words[0]); // "Veeco" for Veeco Instruments.
  // The defined term: 'Kimberly-Clark Corporation ("K-C")'.
  const loose = core.split(/[\s-]+/).map(escapeRx).join("[\\s-]*");
  const defined = new RegExp(`(?<![\\w-])${loose}(?:[,\\s]+(?:Inc|Incorporated|Corp|Corporation|Limited|Ltd|LLC|L\\.?L\\.?C|L\\.?P|plc|N\\.?V|Company|Co|Holdings?|Group|Trust)\\.?)*[,\\s]*\\([^()"“]{0,60}["“]([A-Z][\\w&.\\-]{0,24})["”]`, "gi");
  for (const m of t.slice(0, 200_000).matchAll(defined)) if (!GENERIC_TERM.test(m[1])) aliases.add(m[1]);
  return [...aliases];
}

/** A party's names, compiled once per proxy. A short name is matched case-sensitively ("ICON", not "icon"). */
interface Party {
  names: string[];
  words: RegExp[];
  /** "Transocean Projections", "management of Black Hills": whose forecast, not whose shares. */
  forecasts: RegExp[];
}

function partyOf(name: string, t: string): Party {
  const names = aliasesOf(name, t);
  // A possessive and a plain final "s" are one name: the registrant is "Brinks Co", the proxy writes "Brink's Common Stock" (NCR Atleos).
  for (const n of [...names]) if (/^[A-Z][a-z]{2,}s$/.test(n) && new RegExp(`\\b${n.slice(0, -1)}'s\\s+(?:Common|Board|Financial)`).test(t)) names.push(`${n.slice(0, -1)}'s`);
  return {
    names,
    words: names.map((n) => new RegExp(`(?<![\\w-])${escapeRx(n)}(?![\\w-])`, n.length <= 4 ? "g" : "gi")),
    forecasts: names.map((n) => new RegExp(`(?:(?:management|board) of (?:the )?)${escapeRx(n)}(?![\\w-])|(?<![\\w-])${escapeRx(n)}(?:'s?)?\\s+(?:management|projections?|forecasts?|forecasted|estimates|board)\\b`, "gi")),
  };
}

const lastOf = (s: string, party: Party): number => {
  let at = -1;
  for (const re of party.words) {
    const i = [...s.matchAll(re)].at(-1)?.index;
    if (i != null && i > at) at = i;
  }
  return at;
};

const withoutForecasts = (s: string, party: Party): string => party.forecasts.reduce((out, re) => out.replace(re, (m) => " ".repeat(m.length)), s);

/** "... common stock" right after a range says whose shares it values. */
const SHARE_WORD = /^[^.]{0,50}?\b(?:per share|per [A-Z]|common stock|common shares?|common units?|ordinary shares?|ADS)/;

/**
 * This range values the buyer's shares or the combined company's, not the target's: "$368 to $431 per share of S&P Global common
 * stock", "implied per share equity value reference range for Equity Residential of $70.57 to $92.64".
 */
function valuesBuyer(before: string, after: string, buyer: Party, target: Party, whole: string): boolean {
  // The subject follows the range.
  const clause = after.split(/\.\s|;|,|\band\b/)[0];
  if (SHARE_WORD.test(clause)) {
    if (/\b(?:for|of) the combined company\b/i.test(clause)) return true;
    const b = lastOf(clause, buyer);
    const tg = lastOf(clause, target);
    if (b >= 0 || tg >= 0) return b > tg;
  }
  if (/\b(?:for|of) the combined company\b[^.]{0,60}$/i.test(before)) return true;
  // The subject comes before it: the party named last, not counting either side's forecast owners ("EV / '26E EBITDA (Transocean
  // Projections) $55.07 - $62.86" is Valaris's; "Implied Equity Value Per CPRL Common Share ... (KCS management unaudited CPRL projections)" is CP's).
  const tg = lastOf(withoutForecasts(before, target), target);
  const bn = lastOf(withoutForecasts(before, buyer), buyer);
  if (tg >= 0) return bn > tg;
  if (lastOf(before, target) < 0) return lastOf(before, buyer) >= 0;
  if (bn >= 0) return true;
  // Only forecast owners in reach, the target's among them: the sentence's start names the shares ("the number of fully diluted
  // outstanding shares of NextEra Energy, as provided by the management of NextEra Energy and approved ... by the management of Dominion Energy, ...").
  const opening = withoutForecasts(withoutForecasts(whole.split(/\.\s+(?=[A-Z])/).pop() ?? "", target), buyer);
  return lastOf(opening, buyer) > lastOf(opening, target);
}

/**
 * Not a value of the target at all: what's being paid ("a range of implied values of the Aggregate Consideration of $31.95 to $34.14
 * per share", Albertsons), what synergies are worth ("implied values per share of Xilinx common stock of the expected net synergies ...,
 * of $10 to $26 per share"; KCS's "Pro-Forma $377 million synergy case" table), or a cost ("Morgan Stanley estimated these costs at a
 * range of $3.07 to $3.50 per share": Columbia). The words just before the range, so an input earlier in the sentence doesn't count,
 * nor "per share ... implied by the merger consideration" printed beside a real range.
 */
const NOT_A_VALUATION = /\bimplied values? of the (?:(?:aggregate|merger|total|transaction|offer|per share|share component of the aggregate|cash component of the aggregate) )*consideration of\s*$|\bimplied values?\b[^.$]{0,90}\bof the (?:(?:expected|estimated|anticipated|potential|net|cost|revenue|run-rate) )*synergies\b[^.$]{0,60}$|\bpro[- ]forma\b[\s\S]{0,120}\bsynergy case\b[\s\S]{0,60}$|\bestimated (?:these|such|the)? ?(?:costs?|fees?|expenses?)\b(?! of (?:equity|capital|debt))[^.$]{0,40}$/i;

/**
 * Which column a table headed by both parties puts a range in, when it's the buyer's: "Equity Residential / AvalonBay / Peer Range /
 * Illustrative Share Price / Peer Range / Illustrative Share Price ... Average Range N/A $61.09 to $70.54 N/A $168.65 to $194.93". Only
 * two lines that are each a party's name alone: a row of one company's ranges by metric (II-VI / Coherent's four columns) has no such head.
 */
function inBuyersColumn(above: string, rest: string, buyer: Party, target: Party): boolean {
  const alone = (line: string, p: Party) => p.names.some((n) => squish(n) === squish(line));
  const lines = above.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 2; i >= 0; i--) {
    const [a, b] = [lines[i], lines[i + 1]];
    const buyerFirst = alone(a, buyer) && alone(b, target);
    if (!buyerFirst && !(alone(a, target) && alone(b, buyer))) continue;
    // Prose since the head: no longer its table.
    if (lines.slice(i + 2).some((l) => /[a-z]{3}\.(?:\s+[A-Z]|$)/.test(l))) return false;
    // A further range in the row: this is the first column. A range just before it: the second.
    const first = RANGE_NEXT.test(rest);
    const second = RANGE_LAST.test(above);
    return first ? buyerFirst : second ? !buyerFirst : false;
  }
  return false;
}
const RANGE_NEXT = /^\s*(?:[^\n$]{0,25}\s)?\$\s?[\d.,]+\s*(?:to|-|–|—)\s*\$/;
const RANGE_LAST = /\$\s?[\d.,]+\s*(?:to|-|–|—)\s*\$\s?[\d.,]+\s+(?:[^\n$]{0,25}\s)?$/;

/**
 * Two figures, not a range: "$7.56 and $9.41, respectively" (Blue Apron), "closing share price and 30-day VWAP ... of $42.60 and
 * $45.53" (Diamond Offshore). "between $7.75 and $10.00" is a range.
 */
const twoFigures = (separator: string, before: string, after: string) => separator === "and" && (!/between\b[\s\S]{0,170}$/i.test(before) || /^[^.]{0,40}\brespectively\b/i.test(after));

/**
 * A table's enterprise-value column in $ millions, printed without "million" beside the per-share column: of two ranges in a row,
 * the first is the enterprise value (Emcore's "Implied Enterprise Value Reference Range* ... $7.0 - $16.6").
 */
const enterpriseValueColumn = (above: string, rest: string) => /Enterprise Value[^$]{0,90}Per Share/i.test(above) && /^\s*\$\s?[\d.,]+\s*(?:-|–|—|to)\s*\$/.test(rest);

/**
 * The statement that goes with the first DCF kept: the last one above it, else the first after. A bank that values the buyer
 * first states the buyer's rate first (Alexion's 7.0%-9.5% comes after AstraZeneca's 6.0%-7.5%). Without a DCF, the section's first.
 */
const statedPair = (s: string, re: RegExp, upTo: number | null, skipAbove?: RegExp): [number, number] | null => {
  let found: [number, number] | null = null;
  for (const m of s.matchAll(re)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!(a > 0 && b > 0 && a <= b)) continue;
    if (skipAbove?.test(s.slice(Math.max(0, m.index! - 300), m.index!).split(/\.\s+(?=[A-Z])/).pop() ?? "")) continue;
    if (upTo == null) return [a, b];
    if (m.index! > upTo) return found ?? [a, b];
    found = [a, b];
  }
  return found;
};

/** Whose adviser a section is: the parent heading above a bank's own heading ("Opinions of K-C's Financial Advisors" / "Opinion of J.P. Morgan"). */
function partyHeadings(t: string): { at: number; who: string }[] {
  return [...t.matchAll(/(?:^|\n)[ \t]*(?:Opinions? of (?:the )?(?:Financial Advisors? to |Financial Advisors? of )?)([^\n]{2,60}?)(?:'s?)?(?: Financial Advisors?)?[ \t]*(?:\n|$)/g)]
    .map((m) => ({ at: m.index!, who: m[1].trim() }))
    .filter((p) => findBanks(p.who).length === 0 && !/^financial advisors?$/i.test(p.who));
}

const squish = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const namesParty = (who: string, party: Party) =>
  party.words.some((re) => {
    re.lastIndex = 0;
    return re.test(who);
  }) || party.names.some((n) => who.length >= 3 && (squish(n).replace(/'?s$/, "") === squish(who).replace(/'?s$/, "") || n.toLowerCase().startsWith(`${who.toLowerCase()} `)));

/** "Opinion of DBO (Page 98 ; Annex B )": the name a heading gives the bank, so a short form can match by itself, as "Stephens" does. */
const headingName = (heading: string) => /^Opinion of (.+?)\s*(?:\(.*)?$/.exec(heading)?.[1] ?? "";

/**
 * One analyses section for two banks, under "Financial Analyses of Allen & Company and J.P. Morgan" (Warner Bros. Discovery): where
 * it starts and what each is called. Both must be banks, the section's among them.
 */
function jointAnalyses(body: string, bank: string): { at: number; other: string; forms: Map<string, string> } | null {
  const m = /\n[ \t]*(?:Summary of (?:the )?)?(?:Joint )?(?:Financial )?Analyses of ([^\n]{2,50}?) and ([^\n]{2,50}?)[ \t]*(?=\n)/.exec(body);
  if (!m) return null;
  const [a, b] = [findBanks(m[1])[0], findBanks(m[2])[0]];
  if (!a || !b || a === b || (a !== bank && b !== bank)) return null;
  return { at: m.index, other: a === bank ? b : a, forms: new Map([[a, m[1]], [b, m[2]]]) };
}

/**
 * Where a joint section is one bank's alone: from the paragraph naming it ("J.P. Morgan calculated ranges of terminal values", "then
 * calculated by Allen & Company using selected ranges of discount rates") through the first range after it. "by Allen & Company and
 * J.P. Morgan" and "Allen & Company and J.P. Morgan calculated" are both banks' and stay in both.
 */
function stretchesOf(body: string, from: number, form: string, otherForm: string): [number, number][] {
  const name = escapeRx(form);
  const other = escapeRx(otherForm);
  const re = new RegExp(`(?<!${other} and )\\b${name}\\s+(?:then\\s+)?(?:calculated|performed|derived)\\b|\\b(?:calculated|performed|derived)\\s+by\\s+${name}(?!\\s+and\\s+${other})`, "g");
  const out: [number, number][] = [];
  let cursor = from;
  for (const m of body.matchAll(re)) {
    if (m.index < cursor) continue;
    const range = new RegExp(RANGE.source, "g");
    range.lastIndex = m.index;
    const hit = range.exec(body);
    if (!hit) break;
    const start = Math.max(cursor, body.lastIndexOf("\n", m.index) + 1);
    cursor = hit.index + hit[0].length;
    out.push([start, cursor]);
  }
  return out;
}

const blanked = (s: string, spans: [number, number][]) => spans.reduce((out, [a, b]) => out.slice(0, a) + " ".repeat(b - a) + out.slice(b), s);

export function parseFairness(text: string, ctx: { acquirerName: string; offerPrice: number | null; targetName?: string; consideration?: string | null }): FairnessOpinion[] {
  // Proxies are full of curly quotes and non-breaking / thin spaces ("Premiums&nbsp;Paid"); normalise so patterns match.
  // Invisible direction marks go too: U+202C after "$35.8" hid Aerojet's fee.
  const t = text.replace(/[​-‏‪-‮⁠﻿]/g, "").replace(/[‘’]/g, "'").replace(/[  -   ]/g, " ");
  const acqWord = ctx.acquirerName.split(/[\s,]+/).find((w) => w.length > 3 && /^[A-Z]/.test(w));
  const buyer = partyOf(ctx.acquirerName, t);
  const target = partyOf(ctx.targetName ?? "", t);
  // In an all-cash deal nobody values the buyer's shares, and a buyer's name above a range is only the deal being described.
  const checkBuyer = ctx.consideration !== "Cash" && buyer.names.length > 0 && target.names.length > 0;
  const parents = partyHeadings(t);

  // The heading's party, else the nearest heading above that names one. A bank with no party named advises the target.
  const isGeneric = (who: string) => /\bcompany|special committee|the board|our\b|transaction committee/i.test(who);
  const naming = (who: string) => namesParty(who, target) || namesParty(who, buyer) || isGeneric(who);
  const sideOf = (sec: Section): FairnessOpinion["side"] => {
    if (/\bParent's|Buyer's|Purchaser's|Acquiror's/i.test(sec.heading)) return "acquirer";
    const own = /^Opinions? of (?:the )?(?:Financial Advisors? (?:to|of) )?(.+?)(?:'s?)?(?: Financial Advisors?)?(?:\s*\(.*)?$/.exec(sec.heading)?.[1] ?? "";
    const toWhom = /Financial Advisors? to (.{2,50}?)\.?$/.exec(sec.heading)?.[1] ?? /,\s*([^,]{2,40}?)'s? Financial Advisor/.exec(sec.heading)?.[1] ?? null;
    const who = toWhom ?? (naming(own) ? own : null) ?? [...parents].reverse().find((p) => p.at < sec.start && naming(p.who))?.who ?? "";
    if (!who || namesParty(who, target)) return "target";
    // A buyer's own committee is the buyer's ("the MSGE Special Committee"), and so is "The Walt Disney Company"'s adviser.
    if (namesParty(who, buyer)) return "acquirer";
    if (isGeneric(who)) return "target";
    return acqWord && new RegExp(String.raw`\b${escapeRx(acqWord)}\b`, "i").test(who) ? "acquirer" : "target";
  };

  const opinions: FairnessOpinion[] = [];

  const readOpinion = (body: string, bank: string | null, side: FairnessOpinion["side"], feeBody = body) => {
    const ranges: ValuationRange[] = [];
    let dropped = false;
    let firstDcfAt: number | null = null;
    for (const m of body.matchAll(RANGE)) {
      const low = num(m[1]);
      const high = num(m[3]);
      if (!(low > 0 && high > low)) continue;
      const before = body.slice(Math.max(0, m.index! - 220), m.index!);
      const after = body.slice(m.index!, m.index! + 140);
      if (!TRIGGER.test(before)) continue;
      if (!/per (?:company )?share|per share|equity values?|per unit|share price|price range|price targets/i.test(before + after)) continue;
      // Bids and offers are not valuation ranges.
      if (/\b(?:proposal|proposed|offer(?:ed)? a price|bid|indication of interest)\b/i.test(before.slice(-120))) continue;
      if (ctx.offerPrice && (high > ctx.offerPrice * 8 || low < ctx.offerPrice / 8)) continue;
      // Tables of near-identical values (exchange ratios, CVR scenarios) are not valuation ranges.
      if (high / low < 1.03) continue;
      if (NOT_A_VALUATION.test(before)) continue;
      const rest = body.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
      // A share doesn't cost four figures; an equity-value column in $ millions does ("Implied Equity Value ($ in millions) ... $ 3,251 - $4,205": Patterson-UTI).
      const buyersShares = checkBuyer && (valuesBuyer(before, after.slice(m[0].length), buyer, target, body.slice(Math.max(0, m.index! - 900), m.index!)) || inBuyersColumn(body.slice(Math.max(0, m.index! - 1500), m.index!), rest, buyer, target));
      if (low >= 1000 || twoFigures(m[2], before, after.slice(m[0].length)) || enterpriseValueColumn(body.slice(Math.max(0, m.index! - 600), m.index!), rest) || buyersShares) {
        dropped = true;
        continue;
      }
      // Cross-references come out first, since the window can cut one in half (Slack's second selected-companies figure).
      const sentence = withoutCrossRef(body.slice(Math.max(0, m.index! - 600), m.index!)).slice(-220).split(/\.\s+(?=[A-Z])/).pop() ?? before;
      const method = methodFor(body.slice(Math.max(0, m.index! - 10_000), m.index!), sentence) ?? "Other analysis";
      if (ranges.some((r) => r.method === method && r.low === low && r.high === high)) continue;
      ranges.push({ method, low, high });
      if (method === "Discounted cash flow") firstDcfAt ??= m.index!;
      if (ranges.length >= 10) break;
    }
    // An opinion whose ranges were all the buyer's or not ranges at all is still an opinion, with a bank and a fee.
    if (!ranges.length && !(dropped && bank)) return;

    opinions.push({
      bank,
      side,
      ranges,
      feeUsd: bankFee(feeBody, bank),
      // Lazard's rate for one segment isn't the DCF's (its Corporate segment read 3.5%-4.5%).
      discountRatePct: statedPair(body, /(?:discount rates?(?: range)?|cost of (?:equity|capital) range)[^.%]{0,60}?(?:(?:ranging )?from|of|between)\s+(\d+(?:\.\d+)?)\s?%\s*(?:to|-|–|—|and)\s*(\d+(?:\.\d+)?)\s?%/gi, firstDcfAt, /\bsegment\b/i),
      perpetuityGrowthPct: statedPair(body, /perpetuity growth rates?[^.%]{0,60}?(?:ranging )?from\s+(-?\d+(?:\.\d+)?)\s?%\s*to\s*(\d+(?:\.\d+)?)\s?%/gi, firstDcfAt),
      terminalMultiple: statedPair(body, /terminal[^.]{0,40}?multiples?[^.x]{0,60}?(?:ranging )?(?:from\s+)?(\d+(?:\.\d+)?)\s?x\s*to\s*(\d+(?:\.\d+)?)\s?x/gi, firstDcfAt),
    });
  };

  for (const sec of fairnessSections(t)) {
    let body = t.slice(sec.start, sec.end);

    // Bank: named in the heading, else the known bank mentioned most at the top of the section.
    let bank = findBanks(sec.heading)[0] ?? findBanks(headingName(sec.heading))[0] ?? null;
    if (!bank) {
      const counts = new Map<string, number>();
      for (const name of findBanks(body.slice(0, 4000))) counts.set(name, (counts.get(name) ?? 0) + 1);
      bank = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    // Another bank's analyses start at a heading like "Summary of J.P. Morgan's Financial Analyses".
    if (bank) {
      for (const h of body.slice(500).matchAll(/\n([^\n]{0,140}(?:Financial Analys|Opinion|Analyses of|Materials|Presentations?|Discussion)[^\n]{0,140})(?=\n)/g)) {
        const named = findBanks(h[1]);
        if (named.length && !named.includes(bank)) {
          body = body.slice(0, 500 + h.index!);
          break;
        }
      }
    }
    const side = sideOf(sec);

    const joint = bank ? jointAnalyses(body, bank) : null;
    if (joint) {
      // Each bank's own figures in one section, and its own fee from its own section above (Allen & Company's has no ranges, so it's no section of its own).
      const [mine, theirs] = [joint.forms.get(bank!)!, joint.forms.get(joint.other)!];
      const heading = [...t.slice(0, sec.start).matchAll(/(?:^|\n)[ \t]*Opinion of [^\n]{3,140}/g)].filter((h) => findBanks(h[0]).includes(joint.other) && !/\bpage\s+\d/i.test(h[0])).at(-1);
      for (const name of joint.forms.keys()) {
        if (name === bank) readOpinion(blanked(body, stretchesOf(body, joint.at, theirs, mine)), bank, side);
        else readOpinion(blanked(body, [[0, joint.at], ...stretchesOf(body, joint.at, mine, theirs)]), name, side, heading ? t.slice(heading.index, sec.start) : "");
      }
      continue;
    }
    readOpinion(body, bank, side);
  }

  // The same bank's section can be found twice (summary + full text): keep the richer one.
  const byBank = new Map<string, FairnessOpinion>();
  for (const o of opinions) {
    const key = `${o.bank ?? "?"}:${o.side}`;
    const prev = byBank.get(key);
    if (!prev || o.ranges.length > prev.ranges.length) byBank.set(key, o);
  }
  return [...byBank.values()];
}
