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
export function extractProxyPremium(t: string): number | null {
  const found: { pct: number; score: number; index: number }[] = [];
  const re = /premium of (?:approximately |about )?(\d{1,3}(?:\.\d{1,2})?)\s?%(?!\s*(?:to|-|–)\s*\d)\s+(?:to|over|above)\s+(?:the\s+)?((?:[^.;]|\.(?=\d)){0,240})/gi;
  for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, m.index! - 160), m.index!);
    const sentenceStart = before.split(/\.\s+(?=[A-Z])/).pop() ?? before;
    const ctx = m[2];
    // Precedent-transaction statistics and ranges: "median premium of 44%", "premiums of 20% to 30%".
    if (/\b(?:median|mean|average|percentile|range|selected|precedent)\b[^.]{0,40}$/i.test(before)) continue;
    // Earlier, rejected proposals in the "Background of the Merger": "The proposed price represented a premium of 21% over ... on such date."
    if (/\bpropos(?:ed|al)\b|\binitial\b|\bindication\b/i.test(sentenceStart) || /\b(?:such|that) date\b|\bproposal\b/i.test(ctx)) continue;
    const closing = /\b(?:closing|close|unaffected|undisturbed)\b[^.;]{0,40}\b(?:price|share price|stock price|trading price)\b|\bunaffected\b/i.test(ctx);
    if (!closing) continue;
    if (/volume[- ]weighted|VWAP|average|\d+[- ](?:trading[- ])?day (?:period|average)|\bhighest\b|52\)?[- ]week|fifty-two/i.test(ctx.slice(0, 120))) continue;
    const pct = Number(m[1]);
    if (!(pct > 0 && pct < 300)) continue;
    const score =
      (/unaffected|undisturbed|last (?:full )?trading day (?:before|prior to) the (?:public )?announcement/i.test(ctx) ? 2 : /last (?:full )?trading day|prior to|before the/i.test(ctx) ? 1 : 0) +
      (/merger consideration|offer price|per share consideration/i.test(sentenceStart) ? 1 : 0);
    found.push({ pct, score, index: m.index! });
  }
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score || a.index - b.index);
  return found[0].pct;
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
