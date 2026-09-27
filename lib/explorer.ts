/**
 * Deal volume explorer: the full-screen view behind the volume chart. Everything is computed
 * from raw deals so any filter, metric or selection can be combined. Pure and testable.
 */
import { SECTORS } from "./sectors";
import type { Consideration, Deal, DealStatus, Sector } from "./types";

export type ExplorerMetric = "value" | "count" | "avgSize" | "medianPremium" | "medianEvEbitda";
export type Granularity = "month" | "quarter";

export const EXPLORER_METRICS: { value: ExplorerMetric; label: string; unit: string }[] = [
  { value: "value", label: "$ Value", unit: "USD billions" },
  { value: "count", label: "Deal count", unit: "Transactions" },
  { value: "avgSize", label: "Avg. size", unit: "USD billions per deal" },
  { value: "medianPremium", label: "Median premium", unit: "% over unaffected price" },
  { value: "medianEvEbitda", label: "Median EV/EBITDA", unit: "x LTM EBITDA" },
];

export interface ExplorerFilters {
  /** Inclusive month bounds, "YYYY-MM". */
  from: string;
  to: string;
  sectors: Sector[];
  status: DealStatus | "all" | "active";
  consideration: Consideration | "all";
  /** USD billions, as typed. */
  min: string;
  max: string;
  /** Company, ticker or advisor text. */
  query: string;
}

export const monthOf = (iso: string) => iso.slice(0, 7);

/** Every month from `from` to `to` inclusive ("YYYY-MM"). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export const periodKey = (month: string, g: Granularity) => (g === "month" ? month : `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`);

export function periodLabel(key: string): string {
  if (key.includes("Q")) return `${key.slice(5)} ${key.slice(0, 4)}`;
  const d = new Date(`${key}-01T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Periods covering the filter window, in order. */
export function periods(filters: Pick<ExplorerFilters, "from" | "to">, g: Granularity): string[] {
  return [...new Set(monthRange(filters.from, filters.to).map((m) => periodKey(m, g)))];
}

const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Deals passing every filter except the chart selection. */
export function filterDeals(deals: Deal[], f: ExplorerFilters): Deal[] {
  const min = num(f.min);
  const max = num(f.max);
  const q = f.query.trim().toLowerCase();
  const sectors = new Set(f.sectors);
  return deals.filter((d) => {
    const m = monthOf(d.announcedDate);
    if (m < f.from || m > f.to || !sectors.has(d.sector)) return false;
    if (f.status === "active" ? d.status === "Terminated" : f.status !== "all" && d.status !== f.status) return false;
    if (f.consideration !== "all" && d.consideration !== f.consideration) return false;
    if (min != null && (d.valueUsd == null || d.valueUsd < min * 1e9)) return false;
    if (max != null && (d.valueUsd == null || d.valueUsd > max * 1e9)) return false;
    if (q) {
      const hay = [d.target.name, d.target.ticker, d.acquirer.name, d.acquirer.ticker, d.industry, ...d.acquirerAdvisors, ...d.targetAdvisors].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function metricOf(deals: Deal[], metric: ExplorerMetric): number | null {
  const values = deals.map((d) => d.valueUsd).filter((v): v is number => v != null);
  switch (metric) {
    case "value":
      return Math.round((values.reduce((a, b) => a + b, 0) / 1e9) * 10) / 10;
    case "count":
      return deals.length;
    case "avgSize":
      return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length / 1e9) * 100) / 100 : null;
    case "medianPremium": {
      const m = median(deals.map((d) => d.premiumPct).filter((v): v is number => v != null));
      return m == null ? null : Math.round(m * 10) / 10;
    }
    case "medianEvEbitda": {
      const m = median(deals.map((d) => d.evEbitda).filter((v): v is number => v != null));
      return m == null ? null : Math.round(m * 10) / 10;
    }
  }
}

export interface ExplorerSeries {
  label: Sector | "All sectors";
  data: (number | null)[];
}

/** One series per selected sector (or a single combined series), one point per period. */
export function explorerSeries(deals: Deal[], f: ExplorerFilters, metric: ExplorerMetric, g: Granularity, combined: boolean): { keys: string[]; series: ExplorerSeries[] } {
  const keys = periods(f, g);
  const buckets = new Map<string, Deal[]>();
  for (const d of deals) {
    const k = `${combined ? "All sectors" : d.sector}|${periodKey(monthOf(d.announcedDate), g)}`;
    buckets.set(k, [...(buckets.get(k) ?? []), d]);
  }
  // Sums are zero in an empty period; medians and averages are simply unknown.
  const empty = metric === "value" || metric === "count" ? 0 : null;
  const labels: ExplorerSeries["label"][] = combined ? ["All sectors"] : SECTORS.filter((s) => f.sectors.includes(s));
  return {
    keys,
    series: labels.map((label) => ({ label, data: keys.map((k) => (buckets.has(`${label}|${k}`) ? metricOf(buckets.get(`${label}|${k}`)!, metric) : empty)) })),
  };
}

export type ExplorerSort = "date" | "value" | "premium" | "evEbitda";

export function sortDeals(deals: Deal[], sort: ExplorerSort): Deal[] {
  const by = (v: (d: Deal) => number | null) => [...deals].sort((a, b) => (v(b) ?? -Infinity) - (v(a) ?? -Infinity) || b.announcedDate.localeCompare(a.announcedDate));
  if (sort === "value") return by((d) => d.valueUsd);
  if (sort === "premium") return by((d) => d.premiumPct);
  if (sort === "evEbitda") return by((d) => d.evEbitda);
  return [...deals].sort((a, b) => b.announcedDate.localeCompare(a.announcedDate) || a.id.localeCompare(b.id));
}

/** Most frequent names with their deal counts and total value. */
export function leaders(deals: Deal[], pick: (d: Deal) => string[], limit = 6): { name: string; count: number; valueUsd: number }[] {
  const m = new Map<string, { name: string; count: number; valueUsd: number }>();
  for (const d of deals)
    for (const name of new Set(pick(d))) {
      const e = m.get(name) ?? { name, count: 0, valueUsd: 0 };
      e.count++;
      e.valueUsd += d.valueUsd ?? 0;
      m.set(name, e);
    }
  return [...m.values()].sort((a, b) => b.count - a.count || b.valueUsd - a.valueUsd).slice(0, limit);
}
