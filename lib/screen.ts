/**
 * Deal screener: the filter/sort model behind Deal Flow and saved views.
 * Pure functions so they're testable and identical wherever they run.
 */
import { matchDeal } from "./search";
import { DEAL_STATUSES, SECTORS, type Consideration, type Deal, type DealStatus, type Sector } from "./types";
import type { Spec } from "./urlState";

export type DateWindow = "all" | "week" | "month" | "quarter";
export type DealSort = "date" | "value" | "premium";

export interface DealScreen {
  query: string;
  sector: Sector | "all";
  status: DealStatus | "all";
  date: DateWindow;
  /** Deal value bounds in USD billions, as typed (empty = no bound). */
  min: string;
  max: string;
  /** Minimum premium in %, as typed. */
  premium: string;
  advisor: string; // "all" or a bank name (either side)
  consideration: Consideration | "all";
  /** Listed targets only, private companies only, or both. */
  targetType: "all" | "public" | "private";
  watchOnly: boolean;
  sort: DealSort;
}

export const DEFAULT_SCREEN: DealScreen = {
  query: "",
  sector: "all",
  status: "all",
  date: "all",
  min: "",
  max: "",
  premium: "",
  advisor: "all",
  consideration: "all",
  targetType: "all",
  watchOnly: false,
  sort: "date",
};

/**
 * What a shared link carries (`lib/urlState.ts`): every filter but the watchlist, which is the viewer's own.
 * "/deal-flow?sector=Tech&min=1&sort=value" opens Tech deals over $1B, largest first.
 */
export const DEAL_SCREEN_SPEC: Spec<DealScreen> = {
  query: { kind: "text" },
  sector: { kind: "enum", values: ["all", ...SECTORS] },
  status: { kind: "enum", values: ["all", ...DEAL_STATUSES] },
  date: { kind: "enum", values: ["all", "week", "month", "quarter"] },
  min: { kind: "number" },
  max: { kind: "number" },
  premium: { kind: "number" },
  advisor: { kind: "text" },
  consideration: { kind: "enum", values: ["all", "Cash", "Stock", "Mixed"] },
  targetType: { kind: "enum", values: ["all", "public", "private"] },
  sort: { kind: "enum", values: ["date", "value", "premium"] },
};

const DAY = 86_400_000;

/** Earliest announcement date included by a date window, relative to the data's as-of date. */
export function dateCutoff(window: DateWindow, asOf: string): string {
  const now = new Date(asOf);
  if (window === "week") return new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  if (window === "month") return new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10);
  if (window === "quarter") {
    const q = Math.floor(now.getUTCMonth() / 3) * 3;
    return new Date(Date.UTC(now.getUTCFullYear(), q, 1)).toISOString().slice(0, 10);
  }
  return "0000-01-01";
}

const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

export function screenDeals(deals: Deal[], s: DealScreen, ctx: { asOf: string; isWatched: (id: string) => boolean }): Deal[] {
  const q = s.query.trim().toLowerCase();
  const cutoff = dateCutoff(s.date, ctx.asOf);
  const min = num(s.min);
  const max = num(s.max);
  const prem = num(s.premium);
  const filtered = deals.filter(
    (d) =>
      matchDeal(d, { query: q, sector: s.sector, status: s.status }) &&
      d.announcedDate >= cutoff &&
      (min == null || (d.valueUsd != null && d.valueUsd >= min * 1e9)) &&
      (max == null || (d.valueUsd != null && d.valueUsd <= max * 1e9)) &&
      (prem == null || (d.premiumPct != null && d.premiumPct >= prem)) &&
      (s.advisor === "all" || d.acquirerAdvisors.includes(s.advisor) || d.targetAdvisors.includes(s.advisor)) &&
      (s.consideration === "all" || d.consideration === s.consideration) &&
      ((s.targetType ?? "all") === "all" || (s.targetType === "private") === !!d.privateTarget) &&
      (!s.watchOnly || ctx.isWatched(d.id)),
  );
  // Unknown values sort last.
  return filtered.sort((a, b) =>
    s.sort === "value"
      ? (b.valueUsd ?? -1) - (a.valueUsd ?? -1)
      : s.sort === "premium"
        ? (b.premiumPct ?? -1) - (a.premiumPct ?? -1)
        : b.announcedDate.localeCompare(a.announcedDate) || a.id.localeCompare(b.id),
  );
}

const DATE_LABEL: Record<DateWindow, string> = { all: "All dates", week: "Past 7 days", month: "Past 30 days", quarter: "This quarter" };
const CONSIDERATION_LABEL: Record<Consideration, string> = { Cash: "All cash", Stock: "All stock", Mixed: "Cash and stock" };

/** Filters that differ from the defaults, as removable chips. `sort` is not a filter. */
export function activeFilters(s: DealScreen): { key: keyof DealScreen; label: string }[] {
  const out: { key: keyof DealScreen; label: string }[] = [];
  if (s.query.trim()) out.push({ key: "query", label: `Search: ${s.query.trim()}` });
  if (s.sector !== "all") out.push({ key: "sector", label: s.sector });
  if (s.status !== "all") out.push({ key: "status", label: s.status });
  if (s.date !== "all") out.push({ key: "date", label: DATE_LABEL[s.date] });
  if (num(s.min) != null) out.push({ key: "min", label: `Min $${s.min}B` });
  if (num(s.max) != null) out.push({ key: "max", label: `Max $${s.max}B` });
  if (num(s.premium) != null) out.push({ key: "premium", label: `Premium ≥ ${s.premium}%` });
  if (s.advisor !== "all") out.push({ key: "advisor", label: s.advisor });
  if (s.consideration !== "all") out.push({ key: "consideration", label: CONSIDERATION_LABEL[s.consideration] });
  if (s.targetType && s.targetType !== "all") out.push({ key: "targetType", label: s.targetType === "private" ? "Private targets" : "Public targets" });
  if (s.watchOnly) out.push({ key: "watchOnly", label: "Watchlist" });
  return out;
}

export const DATE_OPTIONS = (Object.keys(DATE_LABEL) as DateWindow[]).map((value) => ({ value, label: DATE_LABEL[value] }));
export const CONSIDERATION_OPTIONS = (Object.keys(CONSIDERATION_LABEL) as Consideration[]).map((value) => ({ value, label: CONSIDERATION_LABEL[value] }));

// ---------------------------------------------------------------------------
// Table columns
// ---------------------------------------------------------------------------

export type DealColumn = "date" | "acquirer" | "target" | "value" | "premium" | "sector" | "status" | "advisor" | "consideration" | "evEbitda";

export const DEAL_COLUMNS: { key: DealColumn; label: string; locked?: boolean; sortable?: DealSort; right?: boolean }[] = [
  { key: "date", label: "Announced", sortable: "date" },
  { key: "acquirer", label: "Acquirer", locked: true },
  { key: "target", label: "Target", locked: true },
  { key: "value", label: "Deal value", sortable: "value", right: true },
  { key: "premium", label: "Premium", sortable: "premium", right: true },
  { key: "sector", label: "Sector" },
  { key: "status", label: "Status" },
  { key: "advisor", label: "Acquirer advisor" },
  { key: "consideration", label: "Consideration" },
  { key: "evEbitda", label: "EV / EBITDA", right: true },
];

export const DEFAULT_COLUMNS: DealColumn[] = ["date", "acquirer", "target", "value", "premium", "sector", "status"];
