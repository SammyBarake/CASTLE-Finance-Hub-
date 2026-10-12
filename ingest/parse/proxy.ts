/**
 * Merger proxy / Schedule 14D-9 parser: the target's own filing states the premium over
 * the unaffected price and names the bank that gave the fairness opinion. Used to fill
 * deals first seen in an 8-K, which usually has neither.
 */
import { findBanks } from "../../lib/banks";
import { namesCompany, sameCompany } from "./names";
import { extractAdvisors } from "./press";

export interface ParsedProxy {
  premiumPct: number | null;
  targetAdvisors: string[];
  /** A stock or mixed deal's value per target share at announcement (`extractImpliedPerShare`). */
  impliedPerShare: number | null;
  /** The buyer's banks, from a joint proxy's "Opinion of <buyer>'s Financial Advisor" (`sideAdvisors`). */
  acquirerAdvisors: string[];
  /** The target's banks as its own heading names them (empty when the proxy has no per-side headings). */
  targetHeadingAdvisors: string[];
}

/** Premium over the target's unaffected / last closing price, never an average, VWAP or precedent statistic. */
// "47%" or "47 percent" (Poly: "a premium of approximately 47 percent to the closing price").
const PCT = String.raw`(\d{1,3}(?:\.\d{1,2})?)\s?(?:%|percent\b)(?!\s*(?:to|-|–)\s*\d)`;
const CTX = String.raw`((?:[^.;•◾■]|\.(?=\d)){0,240})`;
// "to", "over", "above", "based on", "(as) compared to", "relative to", "in excess of".
const VERSUS = String.raw`(?:to|over|above|based on|(?:as\s+)?compared (?:to|with)|relative to|in excess of)`;
const PREMIUM_RES = [
  // "a premium of approximately 32% over the closing price", "a premium of (i) approximately 68% to …", "a premium of
  // approximately: • 125% over the closing stock price", "at a premium above X's stock price: • approximately 78% above …",
  // "a premium of 36% based on the closing price", "a premium of: • approximately 20.4% above the closing price" (Veritiv),
  // "a premium of approximately (i) 34% compared to the closing price" (Potbelly), "a premium of 28% per share, based on".
  new RegExp(
    String.raw`premium\s+(?:of\s*)?(?:(?:approximately|about)\s*)?(?:above\s+[^:.;•]{0,60}?)?:?\s*(?:[•·▪◾■]\s*|\((?:i|1|a)\)\s*)?(?:approximately |about )?(?:\((?:i|1|a)\)\s*)?${PCT}\s+(?:per share,?\s+)?(?:premium\s+)?${VERSUS}\s+(?:the\s+)?${CTX}`,
    "gi",
  ),
  // "a 32% premium over the $52.00 closing price", "an approximately 61% premium over the closing price", "a 17% premium
  // as compared to the closing price" (ChampionX).
  new RegExp(String.raw`(?:approximately |about )?${PCT}\s+premium\s+${VERSUS}\s+(?:the\s+)?${CTX}`, "gi"),
];
// Words of the "Background of the Merger" (bids, proposals, talks), not of the deal itself. "The proposed (cash)
// consideration" / "proposed merger" in the board's reasons is the deal.
const BACKGROUND =
  /\bpropos(?:ed|al)\b(?!\s+(?:(?:cash|stock|per[- ]share|merger|offer)\s+)?(?:merger|transaction|consideration|acquisition|price))|\binitial\b|\bindication\b|\b(?:submitted|countered|revised|stated|reiterated)\b|\bcounter-?(?:offer|proposal)\b|\bon that date\b|\bwould\b|\bindicative\b|\bprepared to\b|\b(?:increase|raise)[sd]? (?:its|the|their) (?:offer|bid|price)\b/i;
const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";

/** Every premium over a closing price the filing states, with how strongly it reads as the deal's own (for debugging). */
export function premiumCandidates(t: string): { pct: number; score: number; index: number; text: string }[] {
  const found: { pct: number; score: number; index: number; text: string }[] = [];
  for (const re of PREMIUM_RES) for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, m.index! - 900), m.index!);
    // The sentence, or the list item ("…; • the fact that …"), the premium is in.
    const sentenceStart = before.split(/\.\s+(?=[A-Z•·▪○◌■◾])|;\s*(?:and\s+)?[•·▪○◌■◾]/).pop() ?? before;
    // Background words are looked for close by, in this list item only: a board's-reasons list runs on through its
    // bullets, and its introduction ("… be submitted to the shareholders …: • the fact that …") is not a bid.
    const near = (sentenceStart.split(/[•·▪○◌■◾]/).pop() ?? sentenceStart).slice(-250);
    // This premium's own clause: up to the next bullet (the regex), the next "premium", or the next figure ("…, and
    // approximately 85% over the 30-day average": that VWAP isn't this premium's).
    const ctx = m[2].split(/\bpremium\b|\(ii\)|,?\s+and\s+(?:a\s+|an\s+)?(?:approximately\s+|about\s+)?\d/i)[0];
    // Precedent-transaction statistics and ranges: "median premium of 44%", "premiums of 20% to 30%".
    if (/\b(?:median|mean|average|percentile|range|selected|precedent)\b[^.]{0,40}$/i.test(before)) continue;
    // Earlier, rejected proposals in the "Background of the Merger": "The proposed price represented a premium of 21% over
    // ... on such date", "The March 28 Offer represented a 65% premium …", "Party A offered $9.00, which represented …".
    // "The proposed consideration" / "proposed merger" in the board's reasons is the deal itself.
    if (BACKGROUND.test(near)) continue;
    // Named bidders and dated offers: "Party A's March 26th Offer", "Bidder 2", "the $4.50 per share offer".
    if (/\b(?:Party|Bidder|Sponsor|Company) [A-Z0-9]\b(?![\w.])|\$[\d.,]+ (?:in cash )?per share (?:cash )?(?:offer|bid)\b|\b\d{1,2}(?:st|nd|rd|th) (?:Offer|Proposal|Bid)\b/.test(near)) continue;
    if (new RegExp(String.raw`\b(?:${MONTH})\s+\d{1,2}(?:,\s*\d{4})?\s+(?:Offer|Bid|Letter|Proposal)\b|\b\d{1,2}\s?(?:st|nd|rd|th)\s+(?:offer|proposal|bid)\b`, "i").test(near)) continue;
    // The "Background of the Merger" narrates by date: "On October 16, 2025, K-C … representing … a premium of 41.6% …".
    if (new RegExp(String.raw`^\s*(?:On|As of|Later on|Also on|By)\s+(?:${MONTH})\s+\d`).test(sentenceStart)) continue;
    // A range from a bid ("a 121% - 176% premium"), or the price when talks began ("preceding the discussion between …").
    if (/\d\s?%\s*(?:-|–|to)\s*$/.test(before)) continue;
    if (/\b(?:such|that) date\b|\bproposal\b|\binitial indication\b|\b(?:discussions?|meeting) between\b/i.test(ctx)) continue;
    // A price some time before signing ("one month prior to the Agreement Date", "90 days prior"), not the last close.
    // "two trading days before the public announcement" is still the unaffected price (ZeroFox).
    if (/\b(?:\d+|one|two|three|six|twelve)\s+(?:calendar\s+|trading\s+)?(?:days?|weeks?|months?|years?)\s+(?:prior|before)\b(?!\s+(?:to\s+)?the\s+(?:public\s+)?announcement)/i.test(ctx.slice(0, 160))) continue;
    const closing = /\b(?:closing|close|unaffected|undisturbed)\b[^.;]{0,40}\b(?:price|share price|stock price|trading price)s?\b|\bunaffected\b/i.test(ctx);
    if (!closing) continue;
    if (/volume[- ]weighted|VWAP|average|\b\d+[- ](?:trading[- ]|calendar[- ])?day\b|\bhighest\b|\ball-time high\b|52\)?[- ]week|fifty-two|\d+-month/i.test(ctx)) continue;
    const pct = Number(m[1]);
    if (!(pct > 0 && pct < 300)) continue;
    const score =
      (/unaffected|undisturbed|last (?:full )?trading day (?:before|prior to) the (?:public )?announcement/i.test(ctx) ? 2 : /last (?:full )?trading day|prior to|before the/i.test(ctx) ? 1 : 0) +
      (/merger consideration|offer price|per share consideration/i.test(sentenceStart) ? 1 : 0);
    // With no announcement / trading-day reference, the sentence must at least be about the deal itself (background
    // bids and stale prices are worded like this too: "for $63.00 per share in cash (representing an approximate 16% …").
    // Unanchored (no announcement / trading-day reference): the whole list item must be free of background words too
    // (Kenvue's "K-C delivered a revised proposal …, representing … a premium of 41.6%", 300 characters back).
    if (!score && BACKGROUND.test(sentenceStart.split(/[•·▪○◌■◾]/).pop() ?? sentenceStart)) continue;
    // A bid named by its amount: "The $11.00 transaction consideration represented a premium of 49% over the November 16,
    // 2022 closing sale price" (HNI's successive proposals for Kimball), not "the Merger Consideration".
    if (!score && /\$\d[\d.,]*\s+(?:(?:per[- ]share|aggregate)\s+)?(?:transaction\s+)?consideration\b/i.test(sentenceStart)) continue;
    if (!score && !/merger agreement|arrangement agreement|transaction agreement|consideration|exchange ratio|offer price|purchase price|acquisition price|pursuant to the (?:merger|offer)/i.test(sentenceStart)) continue;
    found.push({ pct, score, index: m.index!, text: (sentenceStart + m[0]).slice(-320) });
  }
  return found.sort((a, b) => b.score - a.score || a.index - b.index);
}

export function extractProxyPremium(t: string): number | null {
  return premiumCandidates(t)[0]?.pct ?? null;
}

/** Banks that advised the target: fairness-opinion headings, "the Board considered the opinion of X", "X, the Company's financial advisor". */
export function extractProxyAdvisors(t: string, targetName: string): string[] {
  const banks: string[] = [];
  // "Opinion of Goldman Sachs & Co. LLC" (skip "Opinion of the Company's Financial Advisor" / "Opinion of Viper's Financial Advisor").
  for (const m of t.matchAll(/\bOpinion of (?!the\b|Financial\b|[A-Z][\w.&'’ -]{0,30}?['’]?s Financial Advis)([^\n]{0,70})/g)) {
    const name = m[1].split(/,\s*(?:dated|the|which)\b|\s{2,}|\(|\.\s/)[0];
    banks.push(...findBanks(name));
  }
  for (const m of t.matchAll(/(?:Board|Special Committee|Transaction Committee)\s+(?:also\s+)?(?:considered|received|relied on)\s+the\s+(?:oral\s+|written\s+)?(?:and\s+written\s+)?opinion\s+of\s+([^,;(]{2,40})/gi)) {
    banks.push(...findBanks(m[1]));
  }
  if (!banks.length) banks.push(...extractAdvisors(t.slice(0, 200_000), "Parent", targetName, "target", null).targetAdvisors);
  return [...new Set(banks)].slice(0, 4);
}

export function parseMergerProxy(text: string, targetName: string, acquirer?: { name: string; ticker?: string | null }): ParsedProxy {
  const sides = acquirer ? sideAdvisors(text, { name: targetName }, acquirer) : { acquirer: [], target: [] };
  // A joint proxy labels each side's opinion; otherwise the "Opinion of <bank>" headings are the target's, less any bank
  // the buyer's heading named.
  const targetAdvisors = sides.target.length ? sides.target : extractProxyAdvisors(text, targetName).filter((b) => !sides.acquirer.includes(b));
  return { premiumPct: extractProxyPremium(text), targetAdvisors, impliedPerShare: extractImpliedPerShare(text), acquirerAdvisors: sides.acquirer, targetHeadingAdvisors: sides.target };
}

/** The heading's party is this company: its name, a short form or acronym ("AGM", "AHL"), or its ticker ("MSGE"). */
function isParty(party: string, company: { name: string; ticker?: string | null }): boolean {
  return sameCompany(party, company.name) || namesCompany(party, company.name) || (!!company.ticker && party.toUpperCase() === company.ticker.toUpperCase());
}

/**
 * Each side's banks in a joint proxy: "Opinion of Nicolet's Financial Advisor", "Opinion of the Financial Advisors to the
 * MSGE Special Committee", "Opinion of AGM's Financial Advisor" — the bank named first under the heading. A heading
 * whose party is neither company is skipped, and a bank under both is the target's.
 */
export function sideAdvisors(t: string, target: { name: string; ticker?: string | null }, acquirer: { name: string; ticker?: string | null }): { acquirer: string[]; target: string[] } {
  const acq: string[] = [];
  const tgt: string[] = [];
  const re = /\bOpinions? of (?:the )?(?:Financial Advis[eo]rs? to (?:the )?([A-Z][\w.&'’ -]{1,40}?)|([A-Z][\w.&'’ -]{1,40}?)\s?['’]\s?s?\s+Financial Advis[eo]rs?)\b/g;
  for (const m of t.matchAll(re)) {
    const party = (m[1] ?? m[2]).replace(/\s+(?:Special|Conflicts|Transaction|Independent|Strategic)\s+(?:Review\s+)?Committee$|\s+Board(?: of Directors)?$/i, "").trim();
    const side = isParty(party, acquirer) && !isParty(party, target) ? acq : isParty(party, target) && !isParty(party, acquirer) ? tgt : null;
    if (!side) continue;
    const bank = findBanks(t.slice(m.index! + m[0].length, m.index! + m[0].length + 1500))[0];
    if (bank) side.push(bank);
  }
  const target_ = [...new Set(tgt)];
  return { acquirer: [...new Set(acq)].filter((b) => !target_.includes(b)), target: target_ };
}

/** "the last (full) trading day before the (first) public announcement" (not the latest practicable date). */
const ANNOUNCE_DAY = /\b(?:last|final)\s+(?:full\s+|completed\s+)?(?:trading\s+)?day\s+(?:immediately\s+)?(?:before|prior\s+to|preceding)\s+(?:the\s+)?(?:first\s+)?(?:public\s+)?announcement/i;

/**
 * A stock deal's value per target share at announcement, as the merger proxy states it: "Based on the closing price of
 * Extra Space common stock of $… on March 31, 2023, the last trading day before public announcement of the proposed
 * transaction, the exchange ratio represented approximately $145.82 in Extra Space common stock for each share of Life
 * Storage common stock"; "… the value of the per share merger consideration payable to holders of Prudential shares was
 * $17.52". Only figures tied to the announcement day (the latest practicable date's value is another); null unless every
 * statement agrees.
 */
export function extractImpliedPerShare(t: string): number | null {
  const found: number[] = [];
  for (const m of t.matchAll(/[^.]*(?:\.\d[^.]*)*\./g)) {
    const s = m[0];
    if (s.length > 900 || !ANNOUNCE_DAY.test(s) || /latest practicable|range of|ranging from|average|volume[- ]weighted/i.test(s)) continue;
    const v =
      /\b(?:exchange ratio|merger consideration|per share (?:merger )?consideration|stock consideration)\s+(?:represented|represents|had|has|was|equaled|equates to)\s+(?:an?\s+)?(?:implied\s+)?(?:value\s+of\s+)?(?:approximately\s+)?\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+(?:in\s+(?:value|[A-Z][\w&.'’ -]{0,40}?common (?:stock|shares))\s+)?(?:for|per)\s+(?:each\s+)?(?:outstanding\s+)?share\b/i.exec(s) ??
      /\b(?:implied\s+)?value of the (?:per share )?(?:merger|stock|transaction) consideration\b[^$]{0,120}?\b(?:was|is|of)\s+(?:approximately\s+)?\$\s?(\d{1,4}(?:\.\d{1,4})?)\b(?!\s*(?:million|billion))/i.exec(s) ??
      /\bimplied (?:per share )?value of (?:approximately\s+)?\$\s?(\d{1,4}(?:\.\d{1,4})?)\s+per\s+(?:[A-Z][\w&.'’ -]{0,40}?\s+)?share\b/i.exec(s);
    if (v) found.push(Number(v[1]));
  }
  if (!found.length) return null;
  return found.every((x) => Math.abs(x / found[0] - 1) < 0.005) && found[0] > 0 ? found[0] : null;
}
