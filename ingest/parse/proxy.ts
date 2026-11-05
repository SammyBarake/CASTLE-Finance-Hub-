/**
 * Merger proxy / Schedule 14D-9 parser: the target's own filing states the premium over
 * the unaffected price and names the bank that gave the fairness opinion. Used to fill
 * deals first seen in an 8-K, which usually has neither.
 */
import { findBanks } from "../../lib/banks";
import { namesCompany, sameCompany } from "./names";
import { extractAdvisors, isOverAHigh } from "./press";

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
const VERSUS = String.raw`(?:to|over|above|based on|(?:as\s+)?compared (?:to|with)|relative to|in excess of|of(?=\s[^.;]{0,60}\bclos))`;
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
  new RegExp(String.raw`(?:approximately |about )?${PCT}\s+(?:implied\s+)?premium\s+${VERSUS}\s+(?:the\s+)?${CTX}`, "gi"),
  // A later item of a premium's list: "a premium of approximately (a) 52% to the VWAP … and (b) 15% to the closing share price" (Cvent).
  new RegExp(String.raw`\((?:ii|iii|iv|b|c|d|2|3|4)\)\s*(?:a\s+premium\s+of\s+)?(?:approximately |about )?${PCT}\s+(?:premium\s+)?${VERSUS}\s+(?:the\s+)?${CTX}`, "gi"),
];
const LATER_ITEM = /^\((?:ii|iii|iv|b|c|d|2|3|4)\)/i;
// Words of the "Background of the Merger" (bids, proposals, talks), not of the deal itself. "The proposed (cash)
// consideration" / "proposed merger" in the board's reasons is the deal.
const BACKGROUND =
  /\bpropos(?:ed|al)\b(?!\s+(?:(?:cash|stock|per[- ]share|merger|offer)\s+)?(?:merger|transaction|consideration|acquisition|price))|\binitial\b|\bindication\b|\b(?:submitted|countered|revised|stated|reiterated)\b|\bcounter-?(?:offer|proposal)\b|\bon that date\b|\bwould\b|\bindicative\b|\bprepared to\b|\b(?:increase|raise)[sd]? (?:its|the|their) (?:offer|bid|price)\b/i;
const MONTH = "January|February|March|April|May|June|July|August|September|October|November|December";

/** What a contingent right in front of a premium must sit in: this list item, and the words that introduce its list ("… NPV represented: • a premium of 14% …; • a premium of 23% …"), never an earlier item of the board's reasons. */
function contingentScope(before: string): string {
  const head = /([^.;]*):\s*(?:[•·▪○◌■◾]|\((?:i|a|1)\))(?:(?!:\s*(?:[•·▪○◌■◾]|\((?:i|a|1)\)))[\s\S])*$/.exec(before)?.[1] ?? "";
  return head + " " + (before.split(/[•·▪○◌■◾]/).pop() ?? before);
}

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
    if (LATER_ITEM.test(m[0]) && !/\bpremium\b/i.test(sentenceStart)) continue;
    // A value that counts a contingent right: "the Scheme Consideration NPV represented: • a premium of 23%", "(a) in the event that the Milestone Payment is made, the Transaction represents: (i) …".
    if (/\bNPV\b|\bnet present value\b|\b(?:in the event that|assuming)\b[^.;]{0,60}\b(?:milestone|CVRs?|contingent)\b[^.;]{0,40}\b(?:is|are)\s+(?:made|paid|achieved)\b|\b(?:risk|probability)[- ](?:and\s+probability[- ])?adjusted\b/i.test(contingentScope(before.slice(-600)))) continue;
    // P2. A bid's total with its contingent rights, or a dated offer anywhere in the sentence ("Parent's July 10th Offer implied … and the aggregate consideration of up to $5.50 … (inclusive of … CVR payments)").
    if (/\bconsideration\s+of\s+up\s+to\s+\$\s?\d|\binclusive\s+of\b[^.;]{0,60}\b(?:CVRs?|contingent|milestone)/i.test(near) || /\b\d{1,2}(?:st|nd|rd|th)\s+(?:offer|proposal|bid)\b/i.test(sentenceStart)) continue;
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
    // ("Unaffected" reads as a close above, and a high is none: "a premium of 33% to Kellanova's unaffected 52-week high",
    // "a 15 percent premium over our all time high of the undisturbed share price".)
    if (/volume[- ]weighted|VWAP|average|\b\d+[- ](?:trading[- ]|calendar[- ])?day\b|\d+-month/i.test(ctx) || isOverAHigh(ctx)) continue;
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
    if (!score && !/merger agreement|arrangement agreement|transaction agreement|consideration|exchange ratio|offer price|purchase price|acquisition price|value to be received|pursuant to the (?:merger|offer)/i.test(sentenceStart)) continue;
    found.push({ pct, score: LATER_ITEM.test(m[0]) ? -1 : score, index: m.index!, text: (sentenceStart + m[0]).slice(-320) });
  }
  for (const m of t.matchAll(/\b(?:based\s+(?:up)?on)\s+(?:the\s+)?(?:unaffected\s+|last\s+(?:reported\s+)?)?closing\s+(?:\w+\s+)?price\b((?:[^.;]|\.(?=\d)){0,240}?)\bconsideration\b(?:[^.;]|\.(?=\d)){0,60}?\bpremium\s+of\s+(?:approximately\s+|about\s+)?(\d{1,3}(?:\.\d{1,2})?)\s?(?:%|percent\b)/gi)) {
    const pct = Number(m[2]);
    if (/\bup\s+to\b|\bproposal\b|\boffer\b/i.test(m[0].slice(0, -12)) || !(pct > 0 && pct < 300)) continue;
    if (/^\s*(?:over|to|above|relative to|compared (?:to|with))\b[^.;]{0,80}\b(?:volume[- ]weighted|VWAP|average|high)\b/i.test(t.slice(m.index! + m[0].length, m.index! + m[0].length + 120))) continue;
    found.push({ pct, score: /unaffected|undisturbed/i.test(m[0]) ? 2 : 1, index: m.index!, text: m[0].slice(-320) });
  }
  return found.sort((a, b) => b.score - a.score || a.index - b.index);
}

export function extractProxyPremium(t: string): number | null {
  return premiumCandidates(t)[0]?.pct ?? null;
}

/**
 * Banks that advised the target: fairness-opinion headings, "the Board considered the opinion of X", "X, the Company's financial advisor".
 * That last, loose reading gives up the buyer's banks as the story names them: "Parent also engaged Barclays Capital Inc. ... to serve as
 * its financial advisor" (Shell Midstream, whose committee's adviser no heading names). Only there: beside an "Opinion of" heading the
 * helper's false conflicts would bite (`buyerBanksInProxy`).
 */
export function extractProxyAdvisors(t: string, targetName: string, buyerName?: string): string[] {
  const banks: string[] = [];
  // "Opinion of Goldman Sachs & Co. LLC" (skip "Opinion of the Company's Financial Advisor" / "Opinion of Viper's Financial Advisor").
  for (const m of t.matchAll(/\bOpinion of (?!the\b|Financial\b|[A-Z][\w.&'’ -]{0,30}?['’]?s Financial Advis)([^\n]{0,70})/g)) {
    const name = m[1].split(/,\s*(?:dated|the|which)\b|\s{2,}|\(|\.\s/)[0];
    banks.push(...findBanks(name));
  }
  for (const m of t.matchAll(/(?:Board|Special Committee|Transaction Committee)\s+(?:also\s+)?(?:considered|received|relied on)\s+the\s+(?:oral\s+|written\s+)?(?:and\s+written\s+)?opinion\s+of\s+([^,;(]{2,40})/gi)) {
    banks.push(...findBanks(m[1]));
  }
  if (!banks.length) {
    // Not one the story also gives the target: Callodine's "representatives of Gibson Dunn, PJT Partners, Sidley Austin, Callodine's financial advisors" beside "PJT Partners was retained by Company" (Manning & Napier).
    const ours = buyerName ? targetsOwnBanks(t, targetName) : [];
    const theBuyers = buyerName ? buyerBanksInProxy(t, buyerName).filter((b) => !ours.includes(b)) : [];
    banks.push(...extractAdvisors(t.slice(0, 200_000), "Parent", targetName, "target", null).targetAdvisors.filter((b) => !theBuyers.includes(b)));
  }
  return [...new Set(banks)].slice(0, 4);
}

/** Banks the story says the target itself engaged: "was retained by Company", "Blue Apron engaged J.P. Morgan", "the Company's financial advisor, X". */
function targetsOwnBanks(text: string, targetName: string): string[] {
  const word = targetName.replace(/^the\s+/i, "").split(/[\s,]+/)[0].replace(/[^\w&-]/g, "");
  const who = String.raw`(?:${word.length >= 3 ? word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "Company"}(?:\s+[A-Z][\w&]*){0,2}|Company)`;
  const flat = text.replace(/\s+/g, " ").replace(/’/g, "'").slice(0, 400_000);
  const banks = new Set<string>();
  const re = new RegExp(String.raw`[^.]{0,160}\b(?:retained|engaged) by (?:the )?${who}\b[^.]{0,60}|\b${who}(?: Board)? (?:had |has )?(?:engaged|retained) [^.;]{0,120}|[^.;]{0,120}\b${who}'s (?:exclusive |sole |lead )?financial advis[eo]rs?\b[^.;]{0,100}`, "g");
  for (const m of flat.matchAll(re)) findBanks(m[0]).forEach((b) => banks.add(b));
  return [...banks];
}

/**
 * The buyer's banks as the proxy's story names them, for a buyer no release gave one: "Novo's financial advisor, BofA Securities,
 * Inc." (Akero), "Citigroup Global Markets Inc. ("Citi"), Stryker's financial advisor" (Inari), "Amazon, its financial advisor,
 * Goldman Sachs & Co." (Globalstar), "Sumitomo and SMBC AC had engaged Goldman Sachs Group, Inc. … and Citigroup Global Markets
 * Inc. … as their financial advisors" (Air Lease). Only ever to fill an empty list: these sentences also mention the target's
 * bank, so as a referee of sides they misfire (16 false conflicts in 40 deals). The caller drops any bank on the target's list.
 */
export function buyerBanksInProxy(text: string, buyerName: string): string[] {
  const word = buyerName.replace(/^the\s+/i, "").split(/[\s,]+/)[0].replace(/[^\w&-]/g, "");
  const who = String.raw`(?:${word.length >= 3 ? word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "Parent"}(?:\s+[A-Z][\w&]*){0,2}|Parent)`;
  // The bank right next to the words, not the sentence's others: "representatives of Jefferies, Citibank, Lockheed Martin's financial advisor" (Terran Orbital's own adviser beside it).
  const after = new RegExp(String.raw`\b${who}(?:'s|’s|')\s+(?:exclusive\s+|sole\s+|lead\s+)?financial\s+advis[eo]rs?(?:\s+in connection with the [a-z ]{3,40})?,?\s+((?:(?!\s(?:and|to|in|on)\s(?:the|its)\b)[^.;(,]){3,120}(?:\.\s?[A-Z]\.[^.;(,]{0,60})?)`, "g");
  const before = new RegExp(String.raw`((?:[A-Z][\w&.]*[ ,]+){1,6})(?:\(?[^()]{0,30}\)?\s*)?,\s+${who}(?:'s|’s|')\s+(?:exclusive\s+|sole\s+|lead\s+)?financial\s+advis[eo]rs?\b`, "g");
  const its = new RegExp(String.raw`\b${who},?\s+(?:and\s+)?its\s+financial\s+advis[eo]rs?,?\s+((?:(?!\s(?:and|to|in|on)\s(?:the|its)\b)[^.;(,]){3,120})`, "g");
  const engaged = new RegExp(String.raw`\b${who}\b[^.;]{0,40}?\b(?:had\s+|has\s+|have\s+)?(?:engaged|retained)\s+([^;]{3,160}?)\s+as\s+(?:its|their)\s+(?:exclusive\s+|sole\s+|lead\s+)?financial\s+advis[eo]rs?\b`, "g");
  const flat = text.replace(/\s+/g, " ").slice(0, 400_000);
  const banks = new Set<string>();
  for (const re of [after, its, engaged]) for (const m of flat.matchAll(re)) findBanks(m[1]).forEach((b) => banks.add(b));
  for (const m of flat.matchAll(before)) {
    const nearest = findBanks(m[1].split(/,\s+/).filter(Boolean).at(-1) ?? "");
    (nearest.length ? nearest : findBanks(m[1])).forEach((b) => banks.add(b));
  }
  return [...banks];
}

// From the meeting's name to its date: "… to be held at 9:00 a.m., Eastern Time, on May 29, 2024", "… TO BE HELD TUESDAY, DECEMBER 9,
// 2025", "… DATE & TIME October 6, 2023". Never across the record date, the mailing, a deadline ("no later than") or the
// board's own meetings: "a special meeting of the board held on" isn't it. Periods are allowed: "a.m.", "Inc.", a web address.
const TO_MEETING_DATE = String.raw`(?:(?!\b(?:record|close of business|mailed|dated|no later than|board|directors|committee)\b)[\s\S]){0,220}?(?:\bon\s+|\bheld\s+|\bdate(?:\s*(?:&|and)\s*time)?\s*:?\s+)(?:[a-z]+day,?\s+)?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d\d)`;
const MEETING_RES = [
  new RegExp(String.raw`(?:\bspecial(?:\s+general)?|\bextraordinary(?:\s+general)?|(?<!annual\s)\bgeneral|\bcourt|\bstockholders?['’]?|\bshareholders?['’]?)\s+meetings?\b${TO_MEETING_DATE}|\bEGM\b${TO_MEETING_DATE}`, "gi"),
  // A merger put to the annual meeting (Navistar, Tenneco, Avangrid), when the proxy names no other.
  new RegExp(String.raw`\bannual\s+(?:general\s+)?meeting\b${TO_MEETING_DATE}`, "gi"),
];

/** Every date the opening pages give for a meeting, in order; `meetingDateOf` chooses. */
export function meetingDates(text: string): string[] {
  const head = text.slice(0, 40_000);
  return MEETING_RES.flatMap((re) =>
    [...head.matchAll(re)].flatMap((m) => {
      const t = Date.parse(`${(m[1] ?? m[2]).replace(/\s+/g, " ").replace(/,?\s(20\d\d)$/, ", $1")} UTC`);
      return Number.isNaN(t) ? [] : [new Date(t).toISOString().slice(0, 10)];
    }),
  );
}

/**
 * The day of the meeting a definitive proxy calls: a merger vote's 8-K comes on or after it, and an 8-K before it is the
 * annual meeting's (Hess, Synaptics, Silicon Labs). Null when none is clearly stated. Not a date before it was filed, nor
 * over six months after: the proxy's own date, a later section's.
 */
export function meetingDateOf(text: string, filedOn: string): string | null {
  const latest = new Date(Date.parse(filedOn) + 183 * 86_400_000).toISOString().slice(0, 10);
  return meetingDates(text).find((d) => d >= filedOn && d <= latest) ?? null;
}

export function parseMergerProxy(text: string, targetName: string, acquirer?: { name: string; ticker?: string | null }): ParsedProxy {
  const sides = acquirer ? sideAdvisors(text, { name: targetName }, acquirer) : { acquirer: [], target: [] };
  // A joint proxy labels each side's opinion; otherwise the "Opinion of <bank>" headings are the target's, less any bank
  // the buyer's heading named.
  const targetAdvisors = sides.target.length ? sides.target : extractProxyAdvisors(text, targetName, acquirer?.name).filter((b) => !sides.acquirer.includes(b));
  return { premiumPct: extractProxyPremium(text), targetAdvisors, impliedPerShare: extractImpliedPerShare(text), acquirerAdvisors: sides.acquirer, targetHeadingAdvisors: sides.target };
}

/** The heading's party is this company: its name, a short form or acronym ("AGM", "AHL"), or its ticker ("MSGE"). */
function isParty(party: string, company: { name: string; ticker?: string | null }): boolean {
  const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return sameCompany(party, company.name) || namesCompany(party, company.name) || (!!company.ticker && party.toUpperCase() === company.ticker.toUpperCase());
}

/**
 * Each side's banks in a joint proxy: "Opinion of Nicolet's Financial Advisor", "Opinion of the Financial Advisors to the
 * MSGE Special Committee", "Opinion of AGM's Financial Advisor" — the bank named first under the heading. A heading
 * whose party is neither company is skipped, and a bank under both is the target's. Under the target's heading, the buyer's own
 * name is no adviser: "TriState Capital engaged Stephens ... in connection with the proposed sale of TriState Capital to Raymond James".
 */
export function sideAdvisors(t: string, target: { name: string; ticker?: string | null }, acquirer: { name: string; ticker?: string | null }): { acquirer: string[]; target: string[] } {
  const acq: string[] = [];
  const tgt: string[] = [];
  const re = /\bOpinions? of (?:the )?(?:Financial Advis[eo]rs? to (?:the )?([A-Z][\w.&'’ -]{1,40}?)|([A-Z][\w.&'’ -]{1,40}?)\s?['’]\s?s?\s+Financial Advis[eo]rs?)\b/g;
  for (const m of t.matchAll(re)) {
    const party = (m[1] ?? m[2]).replace(/\s+(?:Special|Conflicts|Transaction|Independent|Strategic)\s+(?:Review\s+)?Committee$|\s+Board(?: of Directors)?$/i, "").trim();
    const side = isParty(party, acquirer) && !isParty(party, target) ? acq : isParty(party, target) && !isParty(party, acquirer) ? tgt : null;
    if (!side) continue;
    const end = m.index! + m[0].length;
    if (/^\s*\d{1,3}\s+[A-Z]/.test(t.slice(end, end + 40))) continue;
    // A cross-reference opens no section: `see "... Opinion of Heritage's Financial Advisor" beginning on page 79` stood before "Opinion of CVBF's Financial Advisor" and J.P. Morgan.
    if (/^\s?[.,]?\s?["”]/.test(t.slice(end, end + 6))) continue;
    const buyerItself = side === tgt ? findBanks(acquirer.name) : [];
    const window = t.slice(end, end + 1500);
    const next = window.search(/\bOpinions? of (?:the )?(?:Financial Advis[eo]rs? to|[A-Z][\w.&'’ -]{1,40}?\s?['’]\s?s?\s+Financial Advis[eo]rs?)\b/);
    const bank = findBanks(next >= 0 ? window.slice(0, next) : window).find((b) => !buyerItself.includes(b));
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
