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
  { method: "52-week trading range", re: /52[- ]week|fifty-two/i },
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
/** A per-share range: "$9.10 to $15.20", "$7.54 - $9.11", "between $X and $Y", never followed by million/billion. */
const RANGE = new RegExp(String.raw`${NUM}\s*(?:to|-|–|—|and)\s*${NUM}(?!\s*(?:million|billion|thousand|mm|bn|[MB]\b))`, "g");
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

/**
 * The analysis a range belongs to: named in the same sentence ("price targets ... ranging from"),
 * else the nearest analysis heading above it (a short line like "Discounted Cash Flow Analysis").
 */
export function methodFor(lookback: string, sentence: string): string | null {
  // 1. Named in the same sentence.
  const inSentence = methodIn(sentence);
  if (inSentence) return inSentence;
  const lines = lookback.split("\n");
  // 2. The paragraph's own run-in heading, else the last mention in the paragraph.
  const paragraph = (lines.at(-1) ?? "").replace(/^[^A-Za-z0-9]+/, "");
  const runIn = /^([A-Z][^.]{3,90}\bAnalys[ie]s)\.\s/.exec(paragraph)?.[1];
  const inParagraph = (runIn && methodIn(runIn)) || lastMention(paragraph, false);
  if (inParagraph) return inParagraph;
  // 3. The nearest heading above: a short line, or a run-in heading ("Illustrative Discounted Cash Flow Analysis. Goldman ...").
  for (const line of lines.slice(0, -1).reverse()) {
    // Headings often start with bullets, zero-width spaces or other invisible characters.
    const l = line.replace(/^[^A-Za-z0-9]+/, "").trim();
    const head = l.length < 110 ? l : (/^([A-Z][^.]{3,90}\bAnalys[ie]s)\.\s/.exec(l)?.[1] ?? "");
    const m = head && /analys|review|targets?|trading range/i.test(head) ? methodIn(head) : null;
    if (m) return m;
  }
  // 4. The nearest mention in the text just above, ignoring passing references to price targets / 52-week ranges.
  return lastMention(lookback.slice(-2500), true);
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

/** Bump when the parser changes so stored opinions are re-read on the next ingest. */
export const FAIRNESS_PARSER_VERSION = 3;

/**
 * The bank's own fee: "the Company has agreed to pay Goldman Sachs a transaction fee of approximately
 * $42 million". Never a termination fee, and never the target's own fee income ("management fees",
 * "fee-related earnings of $132 million"), which asset-manager proxies are full of.
 */
export function bankFee(body: string): number | null {
  for (const m of body.matchAll(/(\w+\s+)?fees?\b[^.$]{0,70}?(?:of|totaling|equal to|currently estimated to be|estimated at)\s+(?:approximately |up to )?\$(\d+(?:\.\d+)?)\s*(million|billion)/gi)) {
    // A fixed window, not a sentence split: bank names like "J.P. Morgan" contain ". ".
    const end = m.index! + m[0].length;
    const lead = body.slice(Math.max(0, m.index! - 220), end);
    const sentence = body.slice(Math.max(0, m.index! - 120), end);
    const near = body.slice(Math.max(0, m.index! - 40), m.index!) + m[0];
    if (/termination|break[- ]?up|expense|reimburse/i.test(near.slice(0, near.length - (m[2].length + 12)))) continue;
    if (/management fees?|fee[- ]related|catch-up|FRE\b|fee revenue|fee income|fee earnings|incentive fees? (?:revenue|income)/i.test(sentence)) continue;
    // It must be a payment to the adviser.
    if (!/\b(?:pay|paid|payable|receive[sd]?|entitled|agreed|engagement letter|compensat)/i.test(lead)) continue;
    return Number(m[2]) * (/billion/i.test(m[3]) ? 1e9 : 1e6);
  }
  return null;
}

const pair = (s: string, re: RegExp): [number, number] | null => {
  const m = re.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 0 && b > 0 && a <= b ? [a, b] : null;
};

export function parseFairness(text: string, ctx: { acquirerName: string; offerPrice: number | null }): FairnessOpinion[] {
  // Proxies are full of curly quotes and non-breaking / thin spaces ("Premiums&nbsp;Paid"); normalise so patterns match.
  const t = text.replace(/[‘’]/g, "'").replace(/[  -   ]/g, " ");
  const acqWord = ctx.acquirerName.split(/[\s,]+/).find((w) => w.length > 3 && /^[A-Z]/.test(w));
  const opinions: FairnessOpinion[] = [];

  for (const sec of fairnessSections(t)) {
    let body = t.slice(sec.start, sec.end);

    // Bank: named in the heading, else the known bank mentioned most at the top of the section.
    let bank = findBanks(sec.heading)[0] ?? null;
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
    const side: FairnessOpinion["side"] =
      /\bParent's|Buyer's|Purchaser's|Acquiror's/i.test(sec.heading) || (acqWord && new RegExp(String.raw`\b${acqWord}'?s\b`).test(sec.heading)) ? "acquirer" : "target";

    const ranges: ValuationRange[] = [];
    for (const m of body.matchAll(RANGE)) {
      const low = num(m[1]);
      const high = num(m[2]);
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
      const sentence = before.split(/\.\s+(?=[A-Z])/).pop() ?? before;
      const method = methodFor(body.slice(Math.max(0, m.index! - 10_000), m.index!), sentence) ?? "Other analysis";
      if (ranges.some((r) => r.method === method && r.low === low && r.high === high)) continue;
      ranges.push({ method, low, high });
      if (ranges.length >= 10) break;
    }
    if (!ranges.length) continue;
    let feeUsd: number | null = null;

    feeUsd = bankFee(body);

    opinions.push({
      bank,
      side,
      ranges,
      feeUsd,
      discountRatePct: pair(body, /discount rates?[^.%]{0,60}?(?:ranging )?from\s+(\d+(?:\.\d+)?)\s?%\s*to\s*(\d+(?:\.\d+)?)\s?%/i),
      perpetuityGrowthPct: pair(body, /perpetuity growth rates?[^.%]{0,60}?(?:ranging )?from\s+(-?\d+(?:\.\d+)?)\s?%\s*to\s*(\d+(?:\.\d+)?)\s?%/i),
      terminalMultiple: pair(body, /terminal[^.]{0,40}?multiples?[^.x]{0,60}?(?:ranging )?(?:from\s+)?(\d+(?:\.\d+)?)\s?x\s*to\s*(\d+(?:\.\d+)?)\s?x/i),
    });
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
