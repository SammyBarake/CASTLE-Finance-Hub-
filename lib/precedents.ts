/**
 * Precedent transactions: pick comparable deals and summarise their multiples the way a
 * comps page does (high / 75th / mean / median / 25th / low). Pure and testable.
 */
import { SECTORS, type Consideration, type DcfSummary, type Deal, type FairnessOpinion, type Sector } from "./types";
import type { Spec } from "./urlState";

export type PrecedentWindow = "12m" | "24m" | "all";

export interface PrecedentScreen {
  sector: Sector | "all";
  /** Case-insensitive match on the target's SEC industry, e.g. "software". */
  industry: string;
  /** Deal value bounds in USD billions, as typed (empty = no bound). */
  min: string;
  max: string;
  window: PrecedentWindow;
  consideration: Consideration | "all";
  /** Only deals with at least one valuation multiple. */
  withMultiples: boolean;
  includeTerminated: boolean;
}

/** What a shared precedents link carries (`lib/urlState.ts`), next to ?deal= and the unticked outliers (?x=). */
export const PRECEDENT_SPEC: Spec<PrecedentScreen> = {
  sector: { kind: "enum", values: ["all", ...SECTORS] },
  industry: { kind: "text" },
  min: { kind: "number" },
  max: { kind: "number" },
  window: { kind: "enum", values: ["12m", "24m", "all"] },
  consideration: { kind: "enum", values: ["all", "Cash", "Stock", "Mixed"] },
  withMultiples: { kind: "bool" },
  includeTerminated: { kind: "bool" },
};

export const DEFAULT_PRECEDENTS: PrecedentScreen = {
  sector: "all",
  industry: "",
  min: "",
  max: "",
  window: "24m",
  consideration: "all",
  withMultiples: true,
  includeTerminated: false,
};

export const WINDOW_OPTIONS: { value: PrecedentWindow; label: string }[] = [
  { value: "12m", label: "Past 12 months" },
  { value: "24m", label: "Past 24 months" },
  { value: "all", label: "All dates" },
];

const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

/** The screen in words, for an export's cover: "Sector: Tech", "Deal value: $1B – $10B", "Announced: Past 24 months". */
export function describeScreen(s: PrecedentScreen): string[] {
  const min = num(s.min);
  const max = num(s.max);
  return [
    `Sector: ${s.sector === "all" ? "All sectors" : s.sector}`,
    ...(s.industry.trim() ? [`Industry contains: ${s.industry.trim()}`] : []),
    ...(min != null || max != null ? [`Deal value: ${min != null ? `$${min}B` : "any"} – ${max != null ? `$${max}B` : "any"}`] : []),
    `Announced: ${WINDOW_OPTIONS.find((w) => w.value === s.window)?.label ?? s.window}`,
    `Consideration: ${s.consideration === "all" ? "Any" : s.consideration}`,
    `Valuation multiple required: ${s.withMultiples ? "Yes" : "No"}`,
    `Terminated deals: ${s.includeTerminated ? "Included" : "Excluded"}`,
  ];
}

function windowStart(window: PrecedentWindow, asOf: string): string {
  if (window === "all") return "0000-01-01";
  const d = new Date(asOf);
  d.setUTCMonth(d.getUTCMonth() - (window === "12m" ? 12 : 24));
  return d.toISOString().slice(0, 10);
}

/** Deal size used for comparability: enterprise value, else the headline value. */
export const dealSize = (d: Deal) => d.enterpriseValueUsd ?? d.valueUsd;

export function screenPrecedents(deals: Deal[], s: PrecedentScreen, asOf: string): Deal[] {
  const start = windowStart(s.window, asOf);
  const min = num(s.min);
  const max = num(s.max);
  const industry = s.industry.trim().toLowerCase();
  return deals
    .filter((d) => {
      const size = dealSize(d);
      return (
        d.announcedDate >= start &&
        (s.sector === "all" || d.sector === s.sector) &&
        (!industry || (d.industry ?? "").toLowerCase().includes(industry)) &&
        (min == null || (size != null && size >= min * 1e9)) &&
        (max == null || (size != null && size <= max * 1e9)) &&
        (s.consideration === "all" || d.consideration === s.consideration) &&
        (s.includeTerminated || d.status !== "Terminated") &&
        (!s.withMultiples || d.evEbitda != null || d.evRevenue != null)
      );
    })
    .sort((a, b) => b.announcedDate.localeCompare(a.announcedDate) || a.id.localeCompare(b.id));
}

/** Comparable-deal screen seeded from one deal: same sector, a third to three times its size. */
export function screenForDeal(deal: Deal): PrecedentScreen {
  const size = dealSize(deal);
  const round = (v: number) => String(Math.round(v * 100) / 100);
  return {
    ...DEFAULT_PRECEDENTS,
    sector: deal.sector,
    min: size ? round(size / 3 / 1e9) : "",
    max: size ? round((size * 3) / 1e9) : "",
  };
}

export interface Summary {
  n: number;
  high: number | null;
  p75: number | null;
  mean: number | null;
  median: number | null;
  p25: number | null;
  low: number | null;
}

/** Percentile with linear interpolation between closest ranks (Excel PERCENTILE.INC). */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function summarize(values: (number | null)[]): Summary {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  return {
    n: xs.length,
    high: xs.at(-1) ?? null,
    p75: percentile(xs, 0.75),
    mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null,
    median: percentile(xs, 0.5),
    p25: percentile(xs, 0.25),
    low: xs[0] ?? null,
  };
}

export const SUMMARY_ROWS: { key: Exclude<keyof Summary, "n">; label: string }[] = [
  { key: "high", label: "High" },
  { key: "p75", label: "75th percentile" },
  { key: "mean", label: "Mean" },
  { key: "median", label: "Median" },
  { key: "p25", label: "25th percentile" },
  { key: "low", label: "Low" },
];

export interface CompsSummary {
  size: Summary;
  evEbitda: Summary;
  evRevenue: Summary;
  premium: Summary;
}

export const summarizeComps = (deals: Deal[]): CompsSummary => ({
  size: summarize(deals.map(dealSize)),
  evEbitda: summarize(deals.map((d) => d.evEbitda)),
  evRevenue: summarize(deals.map((d) => d.evRevenue)),
  premium: summarize(deals.map((d) => d.premiumPct)),
});

/**
 * The target bank's DCF from its fairness opinions: the first target-side opinion with a discounted cash flow range (the
 * buyer's bank values the buyer's shares). Implausible ranges (non-positive, or a high over five times the low) are left out.
 */
export function dcfOf(fairness: FairnessOpinion[] | undefined): DcfSummary | null {
  for (const o of fairness ?? []) {
    if (o.side !== "target") continue;
    const r = o.ranges.find((x) => x.method === "Discounted cash flow");
    if (!r || !(r.low > 0) || r.high < r.low || r.high > r.low * 5) continue;
    return { bank: o.bank, low: r.low, high: r.high, discountRatePct: o.discountRatePct, perpetuityGrowthPct: o.perpetuityGrowthPct };
  }
  return null;
}

export interface DcfRow {
  deal: Deal;
  dcf: DcfSummary;
  /** The offer against the DCF midpoint, % (+12 = 12% above). Null without an offer price. */
  vsMid: number | null;
  discountMid: number | null;
  growthMid: number | null;
}

const mid = (r: [number, number] | null) => (r ? (r[0] + r[1]) / 2 : null);

/** Precedents whose target's bank ran a DCF, with the offer placed against it. */
export function dcfRows(deals: Deal[]): DcfRow[] {
  return deals
    .filter((d): d is Deal & { dcf: DcfSummary } => !!d.dcf)
    .map((d) => {
      const m = (d.dcf.low + d.dcf.high) / 2;
      return { deal: d, dcf: d.dcf, vsMid: d.pricePerShare != null ? (d.pricePerShare / m - 1) * 100 : null, discountMid: mid(d.dcf.discountRatePct), growthMid: mid(d.dcf.perpetuityGrowthPct) };
    });
}

export const summarizeDcf = (rows: DcfRow[]) => ({
  vsMid: summarize(rows.map((r) => r.vsMid)),
  discount: summarize(rows.map((r) => r.discountMid)),
  growth: summarize(rows.map((r) => r.growthMid)),
});

/**
 * The deals most like this one, for the deal drawer: same sector and kind of target (public or private), not
 * terminated, within a quarter to four times its size, nearest in size first, then the same buyer type (strategic or
 * private equity), the same industry and the most recent. Without a size on either side, recency and buyer type decide.
 */
export function similarDeals(deal: Deal, deals: Deal[], buyerTypeOf: (d: Deal) => string, n = 5): Deal[] {
  const size = dealSize(deal);
  const type = buyerTypeOf(deal);
  const years = (d: Deal) => Math.abs(Date.parse(d.announcedDate) - Date.parse(deal.announcedDate)) / (365.25 * 86_400_000);
  return deals
    .filter((d) => d.id !== deal.id && d.sector === deal.sector && !!d.privateTarget === !!deal.privateTarget && d.status !== "Terminated")
    .map((d) => {
      const s = dealSize(d);
      if (size && s && (s > size * 4 || s < size / 4)) return null;
      const sizeGap = size && s ? Math.abs(Math.log(s / size)) : size ? 1.5 : 0.5;
      const score = sizeGap + (buyerTypeOf(d) === type ? 0 : 0.5) + (deal.industry && d.industry === deal.industry ? 0 : 0.3) + years(d) * 0.15;
      return { d, score };
    })
    .filter((x): x is { d: Deal; score: number } => x != null)
    .sort((a, b) => a.score - b.score || b.d.announcedDate.localeCompare(a.d.announcedDate))
    .slice(0, n)
    .map((x) => x.d);
}
