/**
 * Precedent transactions: pick comparable deals and summarise their multiples the way a
 * comps page does (high / 75th / mean / median / 25th / low). Pure and testable.
 */
import type { Consideration, Deal, Sector } from "./types";

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
