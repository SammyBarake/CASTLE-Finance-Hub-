/**
 * Deal protections from a merger agreement summary (8-K Item 1.01, or the "Termination Fees" part of a merger
 * proxy): the break fee the target pays, the reverse fee the buyer pays, go-shop vs no-shop, and financing.
 *
 * Never guess: a fee is kept only when the payer is clear from the sentence (who pays, or who is paid, or a
 * defined term such as "Parent Termination Fee"); amounts next to expense reimbursement are ignored. What a
 * draft or a rejected bid contained is the negotiation's story, not the deal.
 */
import { findBanks } from "../../lib/banks";
import type { DealTerms } from "../../lib/types";

/**
 * Bump after changing this parser: stored terms are then re-read on the next ingest.
 */
export const TERMS_PARSER_VERSION = 2;

const flatten = (t: string) => t.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million|thousand)?\b/gi;
const toUsd = (num: string, unit?: string) => {
  const v = Number(num.replace(/,/g, ""));
  // A full-dollar figure ("$5,560,000") is already in dollars: a unit word after it belongs to the next phrase.
  // ("$1,250 million" is a real style, so only amounts of a million or more lose the unit.)
  if (v >= 1e6) return v;
  const mult = !unit ? 1 : /^b/i.test(unit) ? 1e9 : /^m/i.test(unit) ? 1e6 : 1e3;
  return Math.round(v * mult); // 1.07 billion is otherwise 1070000000.0000001
};

const BUYER_WORDS = "Parent|Buyer|Purchaser|Acquir[eo]r|Merger Sub|Holdings|Topco|Bidco";
const BUYER_WORD = new RegExp(`^(?:${BUYER_WORDS})$`, "i");

/** Sentence-ish span around `index`: back to the previous ". X" and forward to the next. */
function sentenceAround(t: string, index: number): string {
  const before = t.slice(Math.max(0, index - 600), index);
  const cut = Math.max(before.lastIndexOf(". "), before.lastIndexOf("; "));
  const start = cut >= 0 ? index - before.length + cut + 2 : Math.max(0, index - 600);
  const after = t.slice(index, index + 500);
  const end = after.search(/[.;]\s+(?=[A-Z(])/);
  return t.slice(start, end >= 0 ? index + end + 1 : index + 500);
}

const ABBREVIATION = /(?:\bN\.A|\bInc|\bCorp|\bCo|\bLtd|\bL\.P|\bLLC|\bL\.L\.C|\bJ\.P|\bU\.S|\bS\.A|\bP\.L\.C|\bNo|\bMr|\bMs|\bDr)$/;
const SENTENCE_OPENING = /^(?:The|This|These|Those|In|On|Under|Pursuant|Such|Each|For|As|At|If|Upon|We|Our|It|Its|Additionally|Also|Further|Following|Subject|Representatives|Later|After|Before)\b/;
const NEXT_LENDER = /^ (?:and )?[A-Z][\w&.'-]*(?: [A-Z][\w&.'-]*)*,? (?:(?:Inc|LLC|Ltd|N\.A|plc|PLC|Bank|Corp)\b|[A-Z(]|;)/;

/**
 * The whole sentence, for a list of banks: "JPMorgan Chase Bank, N.A. and …" or "J.P. Morgan" ends no sentence, unless an
 * ordinary opening follows. Slack's "Citigroup Global Markets Inc., Bank of America, N.A., JPMorgan Chase Bank, N.A." lost its
 * banks at the first cut, and Twitter's "Goldman Sachs and J.P." lost the adviser wording after it. Fees stay on
 * sentenceAround: its short window is what keeps a fee from being read out of the next sentence.
 * `lenders`: a semicolon before the next name ends nothing (TXNM's "Royal Bank of Canada; RBC Capital Markets, LLC; BNP Paribas; …
 * MUFG Bank, Ltd.; and Sumitomo Mitsui Banking Corporation … provided"). Lists of lenders only: in a go-shop's sentence it ran
 * on into the next clause and flipped Sealed Air's and CynergisTek's.
 */
function fullSentenceAround(t: string, index: number, reach = 1200, lenders = false): string {
  const lo = Math.max(0, index - reach);
  const ends = (i: number) => {
    // The next item of a list (II-VI's glossary of "debt commitment letter", then "debt financing"), unless the sentence
    // introduces the list: PNM's "… Sumitomo Mitsui Banking Corporation … provided: • the TNMP Debt Commitment Letter".
    if (t[i] === "•") return t[i - 2] !== ":";
    if (t[i] === ";") return t[i + 1] === " " && !(lenders && NEXT_LENDER.test(t.slice(i + 1, i + 60)));
    if (t[i] !== "." || t[i + 1] !== " ") return false;
    return !ABBREVIATION.test(t.slice(Math.max(lo, i - 8), i)) || SENTENCE_OPENING.test(t.slice(i + 2, i + 16));
  };
  let start = lo;
  for (let i = index - 1; i > lo; i--) {
    if (ends(i)) {
      start = i + 2;
      break;
    }
  }
  const hi = Math.min(t.length, index + reach);
  let end = hi;
  for (let i = index; i < hi - 2; i++) {
    if (ends(i) && (t[i] === "•" || /[A-Z(]/.test(t[i + 2]))) {
      end = i + 1;
      break;
    }
  }
  return t.slice(start, end);
}

const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";
const DATED_SENTENCE = new RegExp(`(?:^|[.;•]\\s+|\\s)(?:On|Between|Later (?:that|on)|During the (?:week|period)|Over the) (?:${MONTH}|the (?:same|following)|that)\\b`, "g");
const FULL_DATE = new RegExp(`\\b(?:${MONTH}) \\d{1,2}, \\d{4}\\b`, "g");

/**
 * The story of the negotiation: two dated sentences ("On January 21, 2025, …") in the 2,500 characters before. JetBlue's
 * "$200 million" reverse fee was an early offer in Spirit's Background; Cerner's "45 day go-shop" a request.
 */
function inBackground(t: string, at: number): boolean {
  return (t.slice(Math.max(0, at - 2500), at).match(DATED_SENTENCE) ?? []).length >= 2;
}

/** Stricter, for a go-shop: "The initial draft … proposed (a) a go-shop period" (Agiliti) has few dates before it. */
function inTheStory(t: string, at: number): boolean {
  if (inBackground(t, at)) return true;
  if ((t.slice(Math.max(0, at - 2500), at).match(FULL_DATE) ?? []).length >= 3) return true;
  return /\b(?:draft|mark-?up|letter of intent|term sheet|issues list)\b/i.test(t.slice(Math.max(0, at - 1500), at));
}

type Side = "target" | "buyer";
type Party = (word: string) => boolean;
type Parties = { target: Party; buyer: Party };

const BUYER_TERM = /\b(?:Parent|Buyer|Purchaser|Acquir[eo]r|Reverse|Regulatory|Antitrust) Termination (?:Fee|Payment|Amount)\b/i;
const TARGET_TERM = /\bCompany Termination (?:Fee|Payment|Amount)\b/i;
const CAPS = `[A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,3}`;

/**
 * Which party a few capitalised words name: a word of its name first, then "Parent" or "the Company". Both or neither gives
 * nothing ("Energy" alone is in both Dominion Energy and NextEra Energy, and is dropped from both in parseDealTerms).
 */
function sideOfWords(words: string, parties: Parties): Side | null {
  const list = words.split(/\s+/).filter((w) => !/^the$/i.test(w));
  const buyer = list.some(parties.buyer);
  const target = list.some(parties.target);
  if (buyer !== target) return buyer ? "buyer" : "target";
  if (buyer) return null;
  const role = list.some((w) => BUYER_WORD.test(w)) || /\bMerger Sub\b/i.test(words);
  const company = list.some((w) => /^Company$/i.test(w));
  return role === company ? null : role ? "buyer" : "target";
}

/** A fee either side may owe the other: "Take-Two or Zynga may be required to pay the other", "each of A and B is required to pay the other". */
function feeOfEitherSide(head: string, tail: string): boolean {
  // Close to the amount: an earlier question in a proxy's Q&A ("… pay the other?") is no part of this one (Valaris).
  const near = head.slice(-360);
  const pay = [...near.matchAll(/\b(?:pay|payable)\b/gi)].at(-1)?.index;
  if (pay == null) return false;
  if (!/\bthe other(?: party)?\b/i.test(near.slice(pay)) && !/^\s*(?:\([^)]*\)\s*)?to the other\b/i.test(tail)) return false;
  const beforePay = near.slice(0, pay);
  return /\b(?:either|each|such party)\b/i.test(beforePay) || new RegExp(`[A-Z][\\w&.'-]*\\s+or\\s+(?:the\\s+)?[A-Z][^.]{0,80}$`).test(beforePay);
}

/** Ranger's "the Company or Parent would be required to pay the other party a termination fee of $60 million and $95 million, respectively": where each amount stands. */
function sidesRespectively(s: string, parties: Parties): Map<number, Side> | null {
  const m = new RegExp(`(?:the\\s+)?(${CAPS})\\s+or\\s+(?:the\\s+)?(${CAPS})\\s+[^$]{0,160}?(\\$[^$]{1,25}?)\\s+and\\s+(\\$[^$]{1,25}?),?\\s+respectively\\b`).exec(s);
  if (!m) return null;
  const [first, second] = [sideOfWords(m[1], parties), sideOfWords(m[2], parties)];
  if (!first || !second || first === second) return null;
  const at = m.index + m[0].lastIndexOf(m[3]);
  return new Map([[at, first], [at + m[3].length + m[0].slice(m[0].lastIndexOf(m[3]) + m[3].length).indexOf("$"), second]]);
}

/** Who pays the fee at `at` (an offset inside `s`): what's written right beside this amount first, then the sentence. */
function payer(s: string, at: number, len: number, parties: Parties): Side | "both" | null {
  const head = s.slice(0, at);
  const tail = s.slice(at + len, at + len + 90);
  // Its own label: "$7 billion (the "Regulatory Termination Fee")" beside a "Company Termination Fee" (Paramount / WBD);
  // "$109,000,000 (the "Instructure Termination Fee")" names a party.
  const own = /^\s*(?:in cash\s*)?\(\s*(?:the|a|an)?\s*"?\s*([^")]{0,50}?)\s*"?\s*\)/.exec(tail)?.[1] ?? "";
  if (BUYER_TERM.test(own)) return "buyer";
  if (TARGET_TERM.test(own)) return "target";
  if (/termination (?:fee|payment|amount)/i.test(own)) {
    const named = sideOfWords(own.replace(/termination.*/i, "").trim(), parties);
    if (named) return named;
  }
  // "the Parent termination fee of $6.0 million" (Intricon).
  const label = /((?:\w+\s+){0,2}termination (?:fee|payment|amount))\s*(?:\([^)]*\)\s*)?(?:of|equal to|in the amount of)(?:\s+up to)?\s*$/i.exec(head)?.[1] ?? "";
  if (BUYER_TERM.test(label)) return "buyer";
  if (TARGET_TERM.test(label)) return "target";
  // Cherry Hill's "in the case of payment by the Company, $4,700,000 and, in the case of payment by Parent, $7,990,000".
  const inCaseOf = new RegExp(`\\bin the case of (?:payment by )?(?:the\\s+)?(${CAPS}),\\s*$`).exec(head);
  // SomaLogic's "a termination fee in the amount of $19,123,214, in the case of Standard BioTools, and in the amount of $17,176,173, in the case of SomaLogic";
  // Flowserve's "equal to $250 million in cash, in the case of Chart, and $215 million in cash, in the case of Flowserve".
  const caseAfter = new RegExp(`^,?\\s*(?:in cash,?\\s*)?\\(?in the case of (?:the\\s+)?(${CAPS})`).exec(tail);
  const inCase = sideOfWords(inCaseOf?.[1] ?? caseAfter?.[1] ?? "", parties);
  if (inCase) return inCase;
  // "a termination fee of $90 million will be payable by either NYCB or Flagstar", "by HomeTrust or Blue Ridge".
  if (new RegExp(`^\\s*(?:\\([^)]*\\)\\s*)?(?:(?:will|would|may) be )?payable by (?:either\\s+)?(?:the\\s+)?${CAPS}\\s+or\\s+(?:the\\s+)?[A-Z]`).test(tail)) return "both";
  // "$1,075,000,000 (payable by IHS Markit)", "a termination fee by IHS Markit to S&P Global of $1.075 billion".
  const byAfter = new RegExp(`^\\s*\\(?(?:(?:will|may) be\\s+)?payable by\\s+(?:the\\s+)?(${CAPS})`).exec(tail);
  const byBefore = new RegExp(`\\bby\\s+(?:the\\s+)?(${CAPS})\\s+to\\s+(?:the\\s+)?${CAPS}\\s+of\\s*$`).exec(head);
  const by = sideOfWords(byAfter?.[1] ?? byBefore?.[1] ?? "", parties);
  if (by) return by;
  if (feeOfEitherSide(head, tail)) return "both";
  // Marlin's "to guarantee Parent's obligation to pay the Parent Termination Fee": the fee's name, not who is paid.
  const payTerm = /\b(?:pay|payable)\s+(?:the\s+)?(?:(Parent|Buyer|Purchaser|Acquir[eo]r|Reverse)|Company) Termination (?:Fee|Payment|Amount)\b[^.$]{0,60}$/i.exec(head);
  if (payTerm) return payTerm[1] ? "buyer" : "target";
  // "the Company's termination fee in such instance would be $710,000" (CynergisTek).
  if (/\bCompany's termination (?:fee|payment|amount)\b[^.]{0,60}$/i.test(head)) return "target";
  if (/\breverse termination (?:fee|payment)\b/i.test(s.slice(Math.max(0, at - 60), at + 60))) return "buyer";
  // Said plainly, who pays comes before a defined term further off, which can be the next clause's: Manning's $8.79M
  // stands before "Parent Termination Fee".
  const subjectRe = new RegExp(`\\b(?:the\\s+)?(${CAPS})\\s+(?:will|would|shall|may|must|is|has(?: also)? agreed to|have agreed to)\\s+(?:also\\s+)?(?:be\\s+)?(?:required\\s+|obligated\\s+)?(?:to\\s+)?pay`, "g");
  let subject: RegExpExecArray | null = null;
  for (const m of head.matchAll(subjectRe)) subject = m;
  const paying = subject ? sideOfWords(subject[1], parties) : null;
  if (paying) return paying;
  // "… pay (to) Parent …" / "payable to the Company": the payee is the other side.
  let last: RegExpExecArray | null = null;
  for (const m of head.matchAll(new RegExp(`\\b(?:pay|payable)\\s+(?:to\\s+)?(?:the\\s+)?(${CAPS})`, "g"))) last = m;
  const paid = last ? sideOfWords(last[1], parties) : null;
  if (paid) return paid === "buyer" ? "target" : "buyer";
  const near = s.slice(Math.max(0, at - 160), at + 120);
  if (/\b(?:Parent|Buyer|Purchaser|Acquir[eo]r|Reverse) Termination (?:Fee|Payment)\b/.test(near)) return "buyer";
  if (/\bCompany Termination (?:Fee|Payment)\b/.test(near)) return "target";
  return null;
}

const WORD_NUM: Record<string, number> = { ten: 10, fifteen: 15, twenty: 20, "twenty-five": 25, thirty: 30, "thirty-five": 35, forty: 40, "forty-five": 45, fifty: 50, "fifty-five": 55, sixty: 60 };
const num = (s: string) => WORD_NUM[s.toLowerCase()] ?? Number(s);

/** The go-shop's length, from the text around a mention. */
function goShopDaysNear(w: string): number | null {
  const days =
    /\b(\d{1,3}|ten|fifteen|twenty|twenty-five|thirty|thirty-five|forty|forty-five|fifty|fifty-five|sixty)[- ](?:calendar[- ])?day\s+"?go[- ]shop/i.exec(w) ??
    /go[- ]shop[^.]{0,260}?\b(?:until|through|ending|end(?:s|ing)? on|expir\w*)[^.]{0,120}?\b(\d{1,3})(?:st|nd|rd|th)\s+(?:calendar\s+)?day\b/i.exec(w) ??
    // Not a tail after its end: Necessity Retail's "a go shop bidder on or before the date that is 15 days following the end of go-shop period" (it ran 30).
    /go[- ]shop[^.]{0,260}?\b(\d{1,3}|thirty|thirty-five|forty|forty-five|fifty|sixty)\s+(?:calendar\s+)?days\s+(?:after|following|from)\b(?!\s+the\s+(?:end|expiration)\b)/i.exec(w) ??
    /\b(\d{1,3}|thirty|thirty-five|forty|forty-five|fifty|sixty)\s+(?:calendar\s+)?days\s+(?:after|following|from)\b[^.]{0,100}?\(the\s+"?go[- ]shop"?\s+period\)/i.exec(w) ??
    // The day comes first: "... until 11:59 p.m. on the 45th day after the date of the Merger Agreement (the "Go-Shop Period")".
    /\b(\d{1,3})(?:st|nd|rd|th)\s+(?:calendar\s+)?day\s+(?:after|following)[^.]{0,160}?go[- ]shop/i.exec(w);
  const d = days ? num(days[1]) : null;
  return d && d >= 10 && d <= 90 ? d : null;
}

/** What someone asked for, not what was signed. */
const NOT_IN_THE_DEAL = /\b(?:propos(?:e|ed|ing|al)|contemplat\w+|draft\w*|request\w*|suggest\w*|counter\w*|negotiated|discussed|remov\w+|eliminat\w+|dropp\w+|did not (?:include|contain)|without a|no go|importance of|would (?:enable|permit|allow|include)|could solicit|was not necessary|absence of|no market check|willing|amenable|forego\w*|limited ability|reasonable condition)\b/i;
/** "Superior proposal" is the deal's own language, and so is an acquisition proposal the target may solicit. */
const DEAL_PROPOSAL = /\b(?:superior|acquisition|alternative(?: acquisition)?|competing|takeover) proposals?\b/gi;

/** A heading or a defined term states the go-shop outright: VMware's "Go Shop; No Solicitation of Other Offers by VMware". */
function isGoShopHeading(t: string, at: number): boolean {
  const label = t.slice(Math.max(0, at - 1), at + 50);
  if (/^.?(?:The\s+)?"?Go[- ]Shop"?(?: Period)?\s*[;,-]?\s*(?:"?No[- ]Shop"?|and No[- ]Shop|No Solicitation)/i.test(label)) return true;
  // Terran Orbital's "Go-Shop; Covenants Regarding Non-Solicitation", Datto's contents line "Go Shop 66".
  if (/^.?Go[- ]Shop(?:;\s+[A-Z]|\s+\(?(?:page\s+)?\d{1,3}\b)/.test(label)) return true;
  return /^.?Go[- ]Shop (?:Period|End Date|Party|Parties)\b/.test(label) && /\(the "?$|"$/.test(t.slice(Math.max(0, at - 8), at));
}

/** Where a go-shop is mentioned outside the story: the deal's own statements, and all of them. */
function goShopMentions(t: string) {
  const all = [...t.matchAll(/\bgo[- ]shop\b/gi)].map((m) => m.index!).filter((at) => !inTheStory(t, at));
  const stated = all.filter((at) => isGoShopHeading(t, at) || !NOT_IN_THE_DEAL.test(fullSentenceAround(t, at).replace(DEAL_PROPOSAL, "")));
  return { all, stated };
}
const goShopDaysAt = (t: string, at: number) => goShopDaysNear(t.slice(Math.max(0, at - 300), at + 600));

function goShopTerms(t: string): Pick<DealTerms, "goShop" | "goShopDays"> {
  const { all, stated } = goShopMentions(t);
  if (stated.length) {
    // Once a mention proves it, its length may stand in a sentence that mentions the go-shop in passing.
    const days = [...stated, ...all].map((at) => goShopDaysAt(t, at)).find((d) => d != null) ?? null;
    return { goShop: true, goShopDays: days };
  }
  // A "no-shop period start date" with a date before it exists because a go-shop ends on it: Medallia's "until 12:01 a.m. on September 4, 2021
  // (which we refer to as the "no-shop period start date")", in a summary that never says go-shop. The term alone isn't one: Verint's.
  if (/\b\d{4}\s*\(\s*(?:which we refer to as|referred to as|the)?\s*(?:the\s+)?"?\s*no[- ]shop period start date\b/i.test(t)) return { goShop: true, goShopDays: null };
  if (/\bno[- ]shop\b|\bnon-?solicitation\b|\bnot\s+to\s+(?:directly or indirectly\s+)?(?:solicit|initiate)|\bshall not,?\s[^.]{0,120}\bsolicit\b/i.test(t)) return { goShop: false, goShopDays: null };
  return { goShop: null, goShopDays: null };
}

/** Independent advisory firms don't lend: a mention near "financing" is their advisory role. */
const ADVISORY_ONLY = /^(?:Lazard|Moelis|PJT Partners|Centerview|Evercore|Perella Weinberg|Qatalyst|Houlihan Lokey|Allen & Company|Greenhill|Solomon Partners|Ardea Partners|MarshBerry|Rothschild & Co|Ducera|Kroll|Duff & Phelps|LionTree|Raine|Guggenheim|Robert W\. Baird|Piper Sandler|William Blair|Stephens|Hovde Group|Janney|Keefe, Bruyette & Woods|KBW|Raymond James|Stifel|TD Cowen|Leerink Partners|Needham|Oppenheimer|Cantor Fitzgerald|BTIG|Canaccord Genuity|Craig-Hallum|Roth Capital|Maxim Group|ThinkEquity|Benchmark|FT Partners|Foros|DH Capital|Chardan|Harris Williams|Lincoln International|MTS Health Partners|Intrepid Partners|Robert A\. Stanger|Sandler O'Neill|Stone Key|Gordon Dyal|Cain Brothers|Mooreland Partners|.* Advisors|Blackstone Advisory Partners)$/;

const FINANCING_MENTION = /\b(?:debt commitment letter|commitment letter|committed to provide|bridge (?:loan|facility)|financing commitments?|commitment parties|debt financing sources|lead arrangers? and (?:joint )?bookrunners? for the debt financing)\b/gi;
/**
 * A sentence saying who was in the room, who runs an old facility, or what a bidder hoped for names no committed lender:
 * Twitter's "representatives of each of Goldman Sachs and J.P. Morgan", Denny's "Representatives of Truist Securities updated the Board".
 * Nor an adviser's assumption (Organon, AssetMark, SP Plus: "Morgan Stanley assumed that ... Sun Pharma will obtain financing in
 * accordance with the terms set forth in the Debt Commitment Letter"), nor a merger agreement's index of defined terms, which has no periods
 * and reads as one long sentence (STORE's "Financing Commitments Recital D ... Goldman Sachs Section 3.19"; Domtar, Guild, Bluegreen, CBIZ):
 * four section references in a row, not dollar amounts or percentages. A glossary line counts only for the letter or its lenders (VICI / MGP's
 * "Lenders" refers to Morgan Stanley Senior Funding, Inc., JPMorgan Chase Bank, N.A. and Citigroup Global Markets Inc.).
 */
const NOT_A_COMMITMENT = /\brepresentatives? (?:of|from)\b|\bhighly confident\b|\bdrafts?\b|\bproposals?\b|\bBidder\b|\bParty [A-Z]\b|\bconfirmed to\b|\bcommunicated\b|\bfinancial advis|\bfairness\b|\bopinion\b|"(?!(?:debt |bridge )?commitment letter|bridge|(?:initial )?lenders|commitment parties)[^"]{1,40}" refers to\b|\bGoldman Sachs Affiliated Entit|\blong or short positions\b|\bdeemed appropriate\b|\bwill obtain financing in accordance\b|(?:(?<!\$\s?)\b(?:Section |A-)?\d+\.\d+(?:\([a-z]+\))*(?!\d*\s?%)[^.]{0,60}){4}|(?:\bA-\d+[^.]{0,60}){4}/i;
/** An old facility's agent, unless the sentence makes a commitment too: Brink's "entered into a debt commitment letter … with Morgan Stanley Senior Funding" also names the credit agreement it replaces. */
const OLD_FACILITY = /\bas (?:the )?(?:administrative|collateral|syndication|escrow) agent\b|\bCredit Agreement,? dated\b|\bBridge Loan Agreement,? dated\b/i;
const STRONG_COMMITMENT = /\b(?:have|has|had)(?: each)?(?: severally)? committed\b|\bcommitted to provide\b|\bagreed to provide\b|\bentered into\b[^.]{0,200}\bcommitment letter\b|\bpursuant to (?:a|the) (?:debt )?commitment letter\b|\bamended and restated to add\b|\badditional commitment parties\b|"(?:debt )?commitment letter" refers to\b/i;

/**
 * "not subject to the availability of the Debt Financing" (Bally's), "not conditioned upon consummation of the debt financing" (HNI / Kimball),
 * "not subject to Parent or Merger Sub's receipt of financing" (Sealed Air), "The receipt of financing by BIPC or Parent is not a condition" (Triton).
 */
const NOT_CONDITIONED = String.raw`(?<!(?:would|could|must|should|may|might)\s)\bnot\s+(?:be\s+)?(?:subject to|conditioned\s+(?:up)?on|contingent\s+(?:up)?on)`;
const NO_FINANCING_CONDITION = new RegExp(String.raw`\b(?:receipt of|obtaining|availability of)\s+(?:the\s+)?(?:debt\s+)?financing\b[^.]{0,40}\b(?:is|are)\s+not\s+a\s+condition\b|${NOT_CONDITIONED}\s+(?:(?:[A-Z][\w&-]*\s+){0,3}(?:or\s+(?:[A-Z][\w&-]*\s+){0,3})?[\w&-]+(?:'s|')\s+|[\w&-]+(?:'s|')\s+|its\s+|[A-Z][\w&-]*\s+(?=obtaining))?(?:any\s+|the\s+)?(?:receipt\s+(?:by\s+[\w& -]{1,40}\s+)?of\s+|obtaining\s+|ability to (?:obtain|finance)\s+|availability of\s+|consummation of\s+|completion of\s+)?(?:any\s+|the\s+)?(?:debt\s+|third[- ]party\s+)?financing\b|${NOT_CONDITIONED}\s+a\s+financing condition\b|\bno financing (?:condition|contingency)\b|\bwithout\s+(?:any\s+)?(?:financing|financing condition)\b`, "gi");
const FINANCING_CONDITION = /\b(?:is|are|will be)\s+(?:subject to|conditioned\s+(?:up)?on|contingent\s+(?:up)?on)\s+(?:the\s+)?(?:receipt|consummation|completion|availability)\s+of\s+(?:the\s+)?(?:debt\s+)?financing\b/gi;

function financingTerms(t: string): Pick<DealTerms, "financingCondition" | "financingBanks"> {
  let financingCondition: boolean | null = null;
  // A bid's "would not be subject to any financing contingency" (Sumo Logic's Sponsor D) or "The December 18th Proposal was not
  // contingent on Sanofi obtaining financing" (Inhibrx) says nothing of the signed deal. A statement in the present or future
  // is the deal's, whatever stands before it (Utz's "is not subject to any financing condition").
  const signed = (re: RegExp) =>
    [...t.matchAll(re)].some((m) => {
      const at = m.index!;
      if (/\b(?:is|are|will)\s$/.test(t.slice(Math.max(0, at - 6), at))) return true;
      return !inBackground(t, at) && !/\b(?:proposal|letter of intent|draft|bid|mark-?up)\b/i.test(t.slice(Math.max(0, at - 400), at));
    });
  if (signed(NO_FINANCING_CONDITION)) financingCondition = false;
  else if (signed(FINANCING_CONDITION)) financingCondition = true;

  const banks: string[] = [];
  for (const m of t.matchAll(FINANCING_MENTION)) {
    const s = fullSentenceAround(t, m.index!, 1200, true);
    if (NOT_A_COMMITMENT.test(s)) continue;
    if ((OLD_FACILITY.test(s) || inBackground(t, m.index!)) && !STRONG_COMMITMENT.test(s)) continue;
    for (const b of findBanks(s)) if (!banks.includes(b) && !ADVISORY_ONLY.test(b)) banks.push(b);
  }
  return { financingCondition, financingBanks: banks.slice(0, 8) };
}

const GENERIC = /^(?:the|and|company|inc|corp|corporation|co|ltd|llc|lp|plc|group|holdings?|international|technologies|partners|capital|trust|bancorp|financial|services|systems|industries|global|america|american|parent|merger|sub)$/i;
const LEGAL = /^(?:inc|corp|corporation|co|company|ltd|limited|llc|lp|plc|sa|nv|ag|se)$/i;
const wordsOf = (n: string) =>
  n
    .split(/[\s,./()]+/)
    .map((w) => w.replace(/[^\w&'-]/g, ""))
    .filter(Boolean);
const distinctive = (n: string) => wordsOf(n).filter((w) => w.length >= 3 && !GENERIC.test(w));

/**
 * How a filing may write a party: any distinctive word of its name ("NCR Atleos" as "Atleos"), never one the other party shares
 * (the "Energy" of Dominion Energy and NextEra Energy), or its initials, with and without the legal suffix ("KCS", "CPRL").
 */
function partyMatcher(name: string, other: string): Party {
  const theirs = new Set(distinctive(other).map((w) => w.toLowerCase()));
  const own = new Set(distinctive(name).map((w) => w.toLowerCase()).filter((w) => !theirs.has(w)));
  const all = wordsOf(name);
  const initialsOf = (ws: string[]) => ws.map((w) => w[0]).join("").toUpperCase();
  const initials = [initialsOf(all.filter((w) => !LEGAL.test(w))), initialsOf(all)].filter((x) => x.length >= 3);
  return (word) => {
    const w = word.replace(/[.,]$/, "");
    return own.has(w.toLowerCase()) || initials.includes(w);
  };
}

const BID_WORDING = /\bproposal,? (?:providing|offering)\b|\bbest and final\b|\bcounter-?proposal\b|\bwould have equaled\b|\bwould need to\b|\bin lieu of a\b|\b(?:revised|initial) draft\b|\bdraft (?:of the )?merger agreement\b|\bmark-?up\b/i;

/**
 * Parse deal protections. `names` are the parties' names (to recognise "Acme will pay" when the
 * filing uses names instead of "Parent" / "the Company").
 */
export function parseDealTerms(text: string, names: { target: string; acquirer: string }): DealTerms {
  const t = flatten(text);
  const parties: Parties = { target: partyMatcher(names.target, names.acquirer), buyer: partyMatcher(names.acquirer, names.target) };

  let targetFee: number | null = null;
  let reverseFee: number | null = null;
  const seen = new Set<string>();
  // "a fee of $4.0 million upon termination" (Intricon, Union Pacific), "termination amount" (AZEK).
  for (const m of t.matchAll(/\btermination (?:fee|payment|amount)s?\b|\ba (?:cash )?fee (?:of|equal to)\b/gi)) {
    if (inBackground(t, m.index!)) continue;
    const s = sentenceAround(t, m.index!);
    if (seen.has(s)) continue;
    seen.add(s);
    // A bank's fee in a sentence that happens to mention termination is no break fee.
    if (!/^termination/i.test(m[0]) && (!/\bterminat/i.test(s) || /\badvis|\bopinion\b/i.test(s) || findBanks(s).length)) continue;
    // (Holly Energy's "pay HF Sinclair a termination fee in an amount in cash equal to $10.0 million" is the fee, expenses beside it or not.)
    if (/\bexpense reimbursement\b|\breimburse\b/i.test(s) && !/termination (?:fee|amount) (?:of|equal to|in an amount)/i.test(s)) continue;
    // "the December 9 Chatham Proposal contemplated that Chatham would pay … the applicable termination fee of $20,000,000 to Atlas": a bid's terms.
    if (/\bproposals?\s+(?:contemplated|included|provided)\b/i.test(s)) continue;
    // Further bid wording, where too few dates stand near for inBackground: Shockwave's "Company B's 'best and final' proposal … a $500 million reverse
    // termination fee", Cowen's "a revised draft merger agreement … a 'reverse termination fee' of $100.0 million", Holly Energy's counterproposal that
    // "would have equaled approximately $40 million". The named bidder is case-sensitive: "the other party a termination fee" (CyrusOne, Clearwater) is the deal's.
    // (Not the window's end cutting a word: Atrion's "the Company S[tockholder Approval]" stood after its $40.725M reverse fee.)
    if (BID_WORDING.test(s) || /\b(?:Company|Party|Bidder|Sponsor) [A-Z]\b(?! [a-z]|$)/.test(s)) continue;
    const respectively = sidesRespectively(s, parties);
    for (const a of s.matchAll(AMOUNT)) {
      const around = s.slice(Math.max(0, a.index! - 70), a.index! + a[0].length + 40);
      // An expense cap or a per-share figure isn't the fee.
      if (/\bexpenses?\b|\breimburs|\bper share\b|\bcap(?:ped)?\b/i.test(around) && !/termination (?:fee|payment|amount)/i.test(around)) continue;
      // iCAD's "(i) $1,000,000, plus (ii) … all documented fees and expenses …, up to an amount of $2,000,000": the cap on the expenses.
      if (/\bup to(?: an amount of| a maximum of)?\s*$/i.test(s.slice(0, a.index!)) && /\bexpenses\b/i.test(s.slice(Math.max(0, a.index! - 200), a.index!))) continue;
      // Spirit's "an increase of at least $270 million from the initial reverse termination fee" is a change, not a fee;
      // Whitestone's "in no event more than $80.0 million for such reverse termination fee, damages and enforcement costs" a cap.
      if (/\bincrease of\b[^$]{0,40}$|\b(?:in no event|not to exceed|not exceed|cap of)\b[^$]{0,40}$/i.test(s.slice(0, a.index!))) continue;
      const usd = toUsd(a[1], a[2]);
      if (usd < 1e5) continue;
      const side = respectively?.get(a.index!) ?? payer(s, a.index!, a[0].length, parties);
      if (side === "target" || side === "both") targetFee = Math.max(targetFee ?? 0, usd);
      if (side === "buyer" || side === "both") reverseFee = Math.max(reverseFee ?? 0, usd);
    }
  }
  return { targetFeeUsd: targetFee, reverseFeeUsd: reverseFee, ...goShopTerms(t), ...financingTerms(t) };
}

/**
 * A day count written beside the merger agreement or the go-shop's end, when nothing outside the story disagrees: VMware's
 * "merger agreement that permit VMware, during a 40-day go-shop period". PS Business Parks' bid of "45 days" stands against its
 * signed 30, and Enstar's Board "discussed" a "25-day" period for a go-shop that ran 35: both stay blank.
 */
function goShopDaysFurtherOn(text: string): number | null {
  const t = flatten(text);
  const { all } = goShopMentions(t);
  const counts = new Set(all.map((at) => goShopDaysAt(t, at)).filter((d) => d != null));
  if (counts.size !== 1) return null;
  const beside = (at: number) => t.slice(Math.max(0, at - 200), at + 200).replace(DEAL_PROPOSAL, "");
  const said = all.some((at) => goShopDaysAt(t, at) != null && /\bmerger agreement\b|\bexpired\b/i.test(beside(at)) && !NOT_IN_THE_DEAL.test(beside(at)));
  return said ? [...counts][0] : null;
}

/**
 * A merger proxy: fees and go-shop from its summary, lenders from anywhere in it ("Financing of the Merger"). A long front
 * matter puts the summary's fee section past the first 150,000 characters (Dominion at 177,000, Qorvo at 179,000), so a side
 * still blank is read further on; further on only fills, since the reasons and the story there quote what was asked for
 * (Extended Stay's "reverse termination fee of $350 million", Heska's "go shop"). For the same reason the wider read gives a
 * go-shop only its days, once the summary has shown it (VMware's 40).
 */
export function parseProxyTerms(text: string, names: { target: string; acquirer: string }): DealTerms {
  const summary = parseDealTerms(text.slice(0, 150_000), names);
  const further = parseDealTerms(text.slice(0, 300_000), names);
  const whole = parseDealTerms(text, names);
  return {
    ...summary,
    targetFeeUsd: summary.targetFeeUsd ?? further.targetFeeUsd,
    reverseFeeUsd: summary.reverseFeeUsd ?? further.reverseFeeUsd,
    goShopDays: summary.goShop === true ? (summary.goShopDays ?? goShopDaysFurtherOn(text.slice(0, 300_000))) : null,
    financingBanks: whole.financingBanks,
    financingCondition: summary.financingCondition ?? whole.financingCondition,
  };
}

/**
 * The 8-K and the proxy into one record. A go-shop stated in either beats a no-shop inferred from the other's silence (VMware's
 * 8-K against its proxy's "Go Shop; No Solicitation"), and its days come from the document that says go-shop: a record once read
 * goShop false with a draft's 45 days.
 */
export function combineTerms(a: DealTerms, b: DealTerms, dealValue: number | null): DealTerms {
  const shop = a.goShop === true ? a : b.goShop === true ? b : a.goShop != null ? a : b;
  return {
    targetFeeUsd: saneFee(a.targetFeeUsd ?? b.targetFeeUsd, dealValue, "target"),
    reverseFeeUsd: saneFee(a.reverseFeeUsd ?? b.reverseFeeUsd, dealValue, "reverse"),
    goShop: shop.goShop,
    goShopDays: shop.goShop === true ? shop.goShopDays : null,
    financingCondition: a.financingCondition ?? b.financingCondition,
    financingBanks: [...new Set([...a.financingBanks, ...b.financingBanks])].slice(0, 8),
  };
}

/**
 * A fee outside 0.3%–10% of the deal value (12% for a reverse fee, which runs higher) is a misread: a different
 * amount in the sentence, or a deal value that is itself wrong. Drop it rather than show an absurd percentage.
 */
export function saneFee(fee: number | null, dealValue: number | null, side: "target" | "reverse" = "target"): number | null {
  if (fee == null) return null;
  if (dealValue == null) return fee;
  const pct = (fee / dealValue) * 100;
  return pct >= 0.3 && pct <= (side === "reverse" ? 12 : 10) ? fee : null;
}
