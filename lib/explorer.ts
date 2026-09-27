/**
 * Helpers for the full-screen volume explorer (the deal list behind the volume chart). Pure and testable.
 */
import type { Deal } from "./types";

export const monthOf = (iso: string) => iso.slice(0, 7);

/** "2026-05" -> "May 2026". */
export function periodLabel(month: string): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export type ExplorerSort = "date" | "value" | "premium";

/** Newest first, or largest / highest first with undisclosed values last. */
export function sortDeals(deals: Deal[], sort: ExplorerSort): Deal[] {
  if (sort === "date") return [...deals].sort((a, b) => b.announcedDate.localeCompare(a.announcedDate) || a.id.localeCompare(b.id));
  const v = (d: Deal) => (sort === "value" ? d.valueUsd : d.premiumPct);
  return [...deals].sort((a, b) => (v(b) ?? -Infinity) - (v(a) ?? -Infinity) || b.announcedDate.localeCompare(a.announcedDate));
}
