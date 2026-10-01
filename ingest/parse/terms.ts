/**
 * Deal protections from a merger agreement summary (8-K Item 1.01, or the "Termination Fees" part of a merger
 * proxy): the break fee the target pays, the reverse fee the buyer pays, go-shop vs no-shop, and financing.
 *
 * Never guess: a fee is kept only when the payer is clear from the sentence (who pays, or who is paid, or a
 * defined term such as "Parent Termination Fee"); amounts next to expense reimbursement are ignored.
 */
import { findBanks } from "../../lib/banks";
import type { DealTerms } from "../../lib/types";

/** Bump after changing this parser: stored terms are then re-read on the next ingest. */
export const TERMS_PARSER_VERSION = 1;

const flatten = (t: string) => t.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|million|thousand)?\b/gi;
const toUsd = (num: string, unit?: string) => {
  const v = Number(num.replace(/,/g, ""));
  const mult = !unit ? 1 : /^b/i.test(unit) ? 1e9 : /^m/i.test(unit) ? 1e6 : 1e3;
  return v * mult;
};

const BUYER_WORDS = "Parent|Buyer|Purchaser|Acquir[eo]r|Merger Sub|Holdings|Topco|Bidco";
const TARGET_WORDS = "the Company|Company";

/** Sentence-ish span around `index`: back to the previous ". X" and forward to the next. */
function sentenceAround(t: string, index: number): string {
  const before = t.slice(Math.max(0, index - 600), index);
  const cut = Math.max(before.lastIndexOf(". "), before.lastIndexOf("; "));
  const start = cut >= 0 ? index - before.length + cut + 2 : Math.max(0, index - 600);
  const after = t.slice(index, index + 500);
  const end = after.search(/[.;]\s+(?=[A-Z(])/);
  return t.slice(start, end >= 0 ? index + end + 1 : index + 500);
}

type Side = "target" | "buyer";

/** Who pays the fee mentioned at `at` (an offset inside `s`)? */
function payer(s: string, at: number, names: { target: RegExp; buyer: RegExp }): Side | null {
  const head = s.slice(0, at);
  const near = s.slice(Math.max(0, at - 160), at + 120);
  // Defined terms are the clearest signal.
  if (/\b(?:Parent|Buyer|Purchaser|Acquir[eo]r|Reverse) Termination (?:Fee|Payment)\b/.test(near) || /\breverse termination fee\b/i.test(near)) return "buyer";
  if (/\bCompany Termination (?:Fee|Payment)\b/.test(near)) return "target";
  // "… pay (to) Parent …" / "payable to the Company": the payee is the other side.
  const payee = new RegExp(`\\b(?:pay|payable)\\s+(?:to\\s+)?(?:the\\s+)?(${BUYER_WORDS}|${TARGET_WORDS}|[A-Z][\\w&.'-]+)\\b`, "g");
  let last: RegExpExecArray | null = null;
  for (const m of head.matchAll(payee)) last = m;
  const subjectRe = new RegExp(`\\b(?:the\\s+)?(${BUYER_WORDS}|${TARGET_WORDS}|[A-Z][\\w&.'-]+)\\s+(?:will|would|shall|may|must|is|has agreed to)\\s+(?:be\\s+)?(?:required\\s+|obligated\\s+)?(?:to\\s+)?pay`, "g");
  let subject: RegExpExecArray | null = null;
  for (const m of head.matchAll(subjectRe)) subject = m;
  const side = (word: string): Side | null => {
    if (new RegExp(`^(?:${BUYER_WORDS})$`, "i").test(word) || names.buyer.test(word)) return "buyer";
    if (/^(?:the\s+)?Company$/i.test(word) || names.target.test(word)) return "target";
    return null;
  };
  if (subject) {
    const s1 = side(subject[1]);
    if (s1) return s1;
  }
  if (last) {
    const paid = side(last[1]);
    if (paid) return paid === "buyer" ? "target" : "buyer";
  }
  return null;
}

const WORD_NUM: Record<string, number> = { ten: 10, fifteen: 15, twenty: 20, "twenty-five": 25, thirty: 30, "thirty-five": 35, forty: 40, "forty-five": 45, fifty: 50, "fifty-five": 55, sixty: 60 };
const num = (s: string) => WORD_NUM[s.toLowerCase()] ?? Number(s);

function goShopTerms(t: string): Pick<DealTerms, "goShop" | "goShopDays"> {
  const at = t.search(/\bgo[- ]shop\b/i);
  if (at >= 0) {
    const s = t.slice(Math.max(0, at - 300), at + 600);
    const days =
      /\b(\d{1,3}|ten|fifteen|twenty|twenty-five|thirty|thirty-five|forty|forty-five|fifty|fifty-five|sixty)[- ](?:calendar[- ])?day\s+"?go[- ]shop/i.exec(s) ??
      /go[- ]shop[^.]{0,260}?\b(?:until|through|ending|end(?:s|ing)? on|expir\w*)[^.]{0,120}?\b(\d{1,3})(?:st|nd|rd|th)\s+(?:calendar\s+)?day\b/i.exec(s) ??
      /go[- ]shop[^.]{0,260}?\b(\d{1,3}|thirty|thirty-five|forty|forty-five|fifty|sixty)\s+(?:calendar\s+)?days\s+(?:after|following|from)\b/i.exec(s) ??
      // The day comes first: "... until 11:59 p.m. on the 45th day after the date of the Merger Agreement (the "Go-Shop Period")".
      /\b(\d{1,3})(?:st|nd|rd|th)\s+(?:calendar\s+)?day\s+(?:after|following)[^.]{0,160}?go[- ]shop/i.exec(s);
    const d = days ? num(days[1]) : null;
    return { goShop: true, goShopDays: d && d >= 10 && d <= 90 ? d : null };
  }
  if (/\bno[- ]shop\b|\bnon-?solicitation\b|\bnot\s+to\s+(?:directly or indirectly\s+)?(?:solicit|initiate)|\bshall not,?\s[^.]{0,120}\bsolicit\b/i.test(t)) return { goShop: false, goShopDays: null };
  return { goShop: null, goShopDays: null };
}

/** Independent advisory firms don't lend: a mention near "financing" is their advisory role. */
const ADVISORY_ONLY = /^(?:Lazard|Moelis|PJT Partners|Centerview|Evercore|Perella Weinberg|Qatalyst|Houlihan Lokey|Allen & Company|Greenhill|Solomon Partners|Ardea Partners|MarshBerry|Rothschild & Co|Ducera|Kroll|Duff & Phelps|LionTree|Raine|Guggenheim|Robert W\. Baird|Piper Sandler|William Blair|Stephens|Hovde Group|Janney|Keefe, Bruyette & Woods|KBW|Raymond James|Stifel|TD Cowen|Leerink Partners|Needham|Oppenheimer|Cantor Fitzgerald|BTIG|Canaccord Genuity|Craig-Hallum|Roth Capital|Maxim Group|ThinkEquity|Benchmark)$/;

function financingTerms(t: string): Pick<DealTerms, "financingCondition" | "financingBanks"> {
  let financingCondition: boolean | null = null;
  if (/\bnot\s+(?:subject to|conditioned\s+(?:up)?on|contingent\s+(?:up)?on)\s+(?:any\s+|the\s+)?(?:receipt of\s+|obtaining\s+|availability of\s+)?(?:any\s+)?(?:debt\s+|third[- ]party\s+)?financing\b|\bno financing condition\b|\bwithout\s+(?:any\s+)?(?:financing|financing condition)\b|\bnot\s+(?:subject to|conditioned on)\s+a\s+financing condition\b/i.test(t))
    financingCondition = false;
  else if (/\b(?:subject to|conditioned\s+(?:up)?on|contingent\s+(?:up)?on)\s+(?:the\s+)?(?:receipt|consummation|completion|availability)\s+of\s+(?:the\s+)?(?:debt\s+)?financing\b/i.test(t)) financingCondition = true;

  const banks: string[] = [];
  for (const m of t.matchAll(/\b(?:debt commitment letter|commitment letter|committed to provide|debt financing|bridge (?:loan|facility)|financing commitments?)\b/gi)) {
    const s = sentenceAround(t, m.index!);
    // Advisers named in the same sentence are not lenders.
    if (/financial advis|fairness|opinion/i.test(s)) continue;
    for (const b of findBanks(s)) if (!banks.includes(b) && !ADVISORY_ONLY.test(b)) banks.push(b);
  }
  return { financingCondition, financingBanks: banks.slice(0, 8) };
}

/**
 * Parse deal protections. `names` are the parties' names (to recognise "Acme will pay" when the
 * filing uses names instead of "Parent" / "the Company").
 */
export function parseDealTerms(text: string, names: { target: string; acquirer: string }): DealTerms {
  const t = flatten(text);
  // Any distinctive word of a party's name: "NCR Atleos will pay" names the target by its second word.
  const GENERIC = /^(?:the|and|company|inc|corp|corporation|co|ltd|llc|lp|plc|group|holdings?|international|technologies|partners|capital|trust|bancorp|financial|services|systems|industries|global|america|american|parent|merger|sub)$/i;
  const nameRe = (n: string) => {
    const words = n
      .split(/[\s,./()]+/)
      .map((w) => w.replace(/[^\w&'-]/g, ""))
      .filter((w) => w.length >= 3 && !GENERIC.test(w));
    return words.length ? new RegExp(`^(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i") : /^$/;
  };
  const re = { target: nameRe(names.target), buyer: nameRe(names.acquirer) };

  let targetFee: number | null = null;
  let reverseFee: number | null = null;
  for (const m of t.matchAll(/\btermination (?:fee|payment)s?\b/gi)) {
    const s = sentenceAround(t, m.index!);
    if (/\bexpense reimbursement\b|\breimburse\b/i.test(s) && !/termination fee (?:of|equal to)/i.test(s)) continue;
    for (const a of s.matchAll(AMOUNT)) {
      const around = s.slice(Math.max(0, a.index! - 70), a.index! + a[0].length + 40);
      // An expense cap or a per-share figure isn't the fee.
      if (/\bexpenses?\b|\breimburs|\bper share\b|\bcap(?:ped)?\b/i.test(around) && !/termination (?:fee|payment)/i.test(around)) continue;
      const usd = toUsd(a[1], a[2]);
      if (usd < 1e5) continue;
      const side = payer(s, a.index!, re);
      if (side === "target") targetFee = Math.max(targetFee ?? 0, usd);
      else if (side === "buyer") reverseFee = Math.max(reverseFee ?? 0, usd);
    }
  }
  return { targetFeeUsd: targetFee, reverseFeeUsd: reverseFee, ...goShopTerms(t), ...financingTerms(t) };
}

/** A fee outside 0.3%–15% of the deal value is a misread (a different amount in the sentence); drop it. */
export function saneFee(fee: number | null, dealValue: number | null): number | null {
  if (fee == null) return null;
  if (dealValue == null) return fee;
  const pct = (fee / dealValue) * 100;
  return pct >= 0.3 && pct <= 15 ? fee : null;
}
