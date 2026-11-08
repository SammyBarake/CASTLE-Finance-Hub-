import type { Consideration } from "./types";

const B = 1e9;
const M = 1e6;

/** $8.40B, $980M, $1.62T. Used for deal values and aggregates. */
export function formatUsd(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= B) return `$${(value / B).toFixed(2)}B`;
  return `$${Math.round(value / M).toLocaleString("en-US")}M`;
}

/** 2,610: a count with thousands separators. */
export const formatCount = (value: number) => value.toLocaleString("en-US");

/** "$652B", "$98.4B", "$5.71B", "$1.21T", "$980M": three significant figures, for figures set large. */
export function formatUsdShort(value: number | null): string {
  if (value == null) return "—";
  if (value === 0) return "$0";
  if (value < 5e5) return "<$1M";
  if (value >= 999.5e9) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 99.95e9) return `$${Math.round(value / 1e9)}B`;
  if (value >= 9.995e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 999.5e6) return `$${(value / 1e9).toFixed(2)}B`;
  return `$${Math.round(value / 1e6)}M`;
}

/** $286.4B. League-table style, one decimal. */
export const formatUsdB1 = (value: number) => `$${(value / B).toFixed(1)}B`;

/** $850M, $1.10B. IPO raises. */
export function formatRaise(value: number | null): string {
  if (value == null) return "—";
  if (value >= B) return `$${(value / B).toFixed(2)}B`;
  return `$${Math.round(value / M).toLocaleString("en-US")}M`;
}

export const formatPct = (value: number | null, digits = 1) =>
  value == null ? "—" : `${value.toFixed(digits)}%`;

export const formatSignedPct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

export const formatMultiple = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)}x`);

export const formatPrice = (value: number | null) => (value == null ? "—" : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const utc = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);

/** Sep 24, 2026 */
export const formatDate = (iso: string) =>
  utc(iso).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });

/** Sep 24, 2026 (no leading zero; for prose and detail views) */
export const formatDateLong = (iso: string) =>
  utc(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** September 24, 2026 */
export const formatDateFull = (iso: string) =>
  utc(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

/** Sep 24, 2026 · 18:00 ET */
export function formatTimestampET(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/New_York" });
  return `${date} · ${time} ET`;
}

/** "2026-08" -> "Aug 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "2026-08" -> "August 2026" */
export function formatMonthLong(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "2026-08" -> "Aug 31" (last day of month) */
export function formatMonthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "2026-Q3" -> "Q3 2026" */
export const formatQuarter = (quarter: string) => quarter.split("-").reverse().join(" ");

const CONSIDERATION_LABEL: Record<Consideration, string> = {
  Cash: "All cash",
  Stock: "All stock",
  Mixed: "Cash and stock",
};

export const considerationLabel = (c: Consideration | null) => (c ? CONSIDERATION_LABEL[c] : "Not disclosed");
