/**
 * Merger proxy / Schedule 14D-9 parser: the target's own filing states the premium over
 * the unaffected price and names the bank that gave the fairness opinion. Used to fill
 * deals first seen in an 8-K, which usually has neither.
 */
import { findBanks } from "../../lib/banks";
import { extractAdvisors } from "./press";

export interface ParsedProxy {
  premiumPct: number | null;
  targetAdvisors: string[];
}

/** Premium over the target's unaffected / last closing price, never an average, VWAP or precedent statistic. */
const PCT = String.raw`(\d{1,3}(?:\.\d{1,2})?)\s?%(?!\s*(?:to|-|–)\s*\d)`;
const CTX = String.raw`((?:[^.;•]|\.(?=\d)){0,240})`;
const PREMIUM_RES = [
  // "a premium of approximately 32% over the closing price", "a premium of (i) approximately 68% to …", "a premium of
  // approximately: • 125% over the closing stock price", "at a premium above X's stock price: • approximately 78% above …",
  // "a premium of 36% based on the closing price".
  new RegExp(
    String.raw`premium\s+(?:of\s+)?(?:(?:approximately|about)\s*)?(?:above\s+[^:.;•]{0,60}?)?:?\s*(?:[•·▪]\s*|\((?:i|1|a)\)\s*)?(?:approximately |about )?${PCT}\s+(?:premium\s+)?(?:to|over|above|based on)\s+(?:the\s+)?${CTX}`,
    "gi",
  ),
  // "a 32% premium over the $52.00 closing price", "an approximately 61% premium over the closing price".
  new RegExp(String.raw`(?:approximately |about )?${PCT}\s+premium\s+(?:to|over|above|based on)\s+(?:the\s+)?${CTX}`, "gi"),
];
const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";

/** Every premium over a closing price the filing states, with how strongly it reads as the deal's own (for debugging). */
export function premiumCandidates(t: string): { pct: number; score: number; index: number; text: string }[] {
  const found: { pct: number; score: number; index: number; text: string }[] = [];
  for (const re of PREMIUM_RES) for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, m.index! - 900), m.index!);
    // The sentence, or the list item ("…; • the fact that …"), the premium is in.
    const sentenceStart = before.split(/\.\s+(?=[A-Z•·▪○◌■])|;\s*(?:and\s+)?[•·▪○◌■]/).pop() ?? before;
    // This premium's own clause: up to the next bullet (the regex) or the next "premium".
    const ctx = m[2].split(/\bpremium\b/i)[0];
    // Precedent-transaction statistics and ranges: "median premium of 44%", "premiums of 20% to 30%".
    if (/\b(?:median|mean|average|percentile|range|selected|precedent)\b[^.]{0,40}$/i.test(before)) continue;
    // Earlier, rejected proposals in the "Background of the Merger": "The proposed price represented a premium of 21% over
    // ... on such date", "The March 28 Offer represented a 65% premium …", "Party A offered $9.00, which represented …".
    // "The proposed consideration" / "proposed merger" in the board's reasons is the deal itself.
    if (/\bpropos(?:ed|al)\b(?!\s+(?:merger|transaction|consideration|acquisition))|\binitial\b|\bindication\b|\b(?:submitted|countered|revised|stated|reiterated)\b|\bcounter-?(?:offer|proposal)\b|\bon that date\b|\bwould\b|\bindicative\b|\bprepared to\b|\b(?:increase|raise)[sd]? (?:its|the|their) (?:offer|bid|price)\b/i.test(sentenceStart)) continue;
    // Named bidders and dated offers: "Party A's March 26th Offer", "Bidder 2", "the $4.50 per share offer".
    if (/\b(?:Party|Bidder|Sponsor|Company) [A-Z0-9]\b(?![\w.])|\$[\d.,]+ (?:in cash )?per share (?:cash )?(?:offer|bid)\b|\b\d{1,2}(?:st|nd|rd|th) (?:Offer|Proposal|Bid)\b/.test(sentenceStart)) continue;
    if (new RegExp(String.raw`\b(?:${MONTH})\s+\d{1,2}(?:,\s*\d{4})?\s+(?:Offer|Bid|Letter|Proposal)\b|\b\d{1,2}\s?(?:st|nd|rd|th)\s+(?:offer|proposal|bid)\b`, "i").test(sentenceStart)) continue;
    // The "Background of the Merger" narrates by date: "On October 16, 2025, K-C … representing … a premium of 41.6% …".
    if (new RegExp(String.raw`^\s*(?:On|As of|Later on|Also on|By)\s+(?:${MONTH})\s+\d`).test(sentenceStart)) continue;
    // A range from a bid ("a 121% - 176% premium"), or the price when talks began ("preceding the discussion between …").
    if (/\d\s?%\s*(?:-|–|to)\s*$/.test(before)) continue;
    if (/\b(?:such|that) date\b|\bproposal\b|\binitial indication\b|\b(?:discussions?|meeting) between\b/i.test(ctx)) continue;
    // A price some time before signing ("one month prior to the Agreement Date", "90 days prior"), not the last close.
    if (/\b(?:\d+|one|two|three|six|twelve)\s+(?:calendar\s+|trading\s+)?(?:days?|weeks?|months?|years?)\s+(?:prior|before)\b/i.test(ctx.slice(0, 160))) continue;
    const closing = /\b(?:closing|close|unaffected|undisturbed)\b[^.;]{0,40}\b(?:price|share price|stock price|trading price)\b|\bunaffected\b/i.test(ctx);
    if (!closing) continue;
    if (/volume[- ]weighted|VWAP|average|\b\d+[- ](?:trading[- ]|calendar[- ])?day\b|\bhighest\b|\ball-time high\b|52\)?[- ]week|fifty-two|\d+-month/i.test(ctx)) continue;
    const pct = Number(m[1]);
    if (!(pct > 0 && pct < 300)) continue;
    const score =
      (/unaffected|undisturbed|last (?:full )?trading day (?:before|prior to) the (?:public )?announcement/i.test(ctx) ? 2 : /last (?:full )?trading day|prior to|before the/i.test(ctx) ? 1 : 0) +
      (/merger consideration|offer price|per share consideration/i.test(sentenceStart) ? 1 : 0);
    // With no announcement / trading-day reference, the sentence must at least be about the deal itself (background
    // bids and stale prices are worded like this too: "for $63.00 per share in cash (representing an approximate 16% …").
    if (!score && !/merger agreement|arrangement agreement|transaction agreement|merger consideration|exchange ratio|offer price|per share consideration|pursuant to the (?:merger|offer)/i.test(sentenceStart)) continue;
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

export function parseMergerProxy(text: string, targetName: string): ParsedProxy {
  return { premiumPct: extractProxyPremium(text), targetAdvisors: extractProxyAdvisors(text, targetName) };
}
