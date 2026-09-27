/**
 * Helpers for the full-screen volume explorer: month labels, deal sorting, and the summary +
 * plain-English insights shown for whatever the user has selected. Pure and testable.
 */
import { SECTORS } from "./sectors";
import type { Deal, Sector } from "./types";

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

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Generic buyer descriptions that aren't one company ("The Investor Group", "Parent"). */
const GENERIC_BUYER = /^(?:the\s+)?(?:investor group|buyer group|consortium|parent|buyer|purchaser|undisclosed.*)$/i;

export interface SelectionStats {
  count: number;
  totalUsd: number;
  withValue: number;
  medianValueUsd: number | null;
  medianPremium: number | null;
  medianEvEbitda: number | null;
  /** Share of deals paid entirely in cash, 0–100. */
  cashPct: number | null;
  biggest: Deal[];
  sectors: { sector: Sector; count: number; valueUsd: number; sharePct: number }[];
  buyers: { name: string; count: number; valueUsd: number; deals: Deal[] }[];
}

export function selectionStats(deals: Deal[]): SelectionStats {
  const values = deals.map((d) => d.valueUsd).filter((v): v is number => v != null);
  const totalUsd = values.reduce((a, b) => a + b, 0);
  const known = deals.filter((d) => d.consideration);
  const buyers = new Map<string, { name: string; count: number; valueUsd: number; deals: Deal[] }>();
  for (const d of deals) {
    if (GENERIC_BUYER.test(d.acquirer.name.trim())) continue;
    const b = buyers.get(d.acquirer.name) ?? { name: d.acquirer.name, count: 0, valueUsd: 0, deals: [] };
    b.count++;
    b.valueUsd += d.valueUsd ?? 0;
    b.deals.push(d);
    buyers.set(d.acquirer.name, b);
  }
  return {
    count: deals.length,
    totalUsd,
    withValue: values.length,
    medianValueUsd: median(values),
    medianPremium: median(deals.map((d) => d.premiumPct).filter((v): v is number => v != null)),
    medianEvEbitda: median(deals.map((d) => d.evEbitda).filter((v): v is number => v != null)),
    cashPct: known.length ? Math.round((known.filter((d) => d.consideration === "Cash").length / known.length) * 100) : null,
    biggest: sortDeals(deals.filter((d) => d.valueUsd != null), "value").slice(0, 5),
    sectors: SECTORS.map((sector) => {
      const inSector = deals.filter((d) => d.sector === sector);
      return { sector, count: inSector.length, valueUsd: inSector.reduce((s, d) => s + (d.valueUsd ?? 0), 0), sharePct: deals.length ? (inSector.length / deals.length) * 100 : 0 };
    })
      .filter((s) => s.count)
      .sort((a, b) => b.count - a.count),
    buyers: [...buyers.values()].sort((a, b) => b.count - a.count || b.valueUsd - a.valueUsd).slice(0, 5),
  };
}

const usd = (v: number) => (v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6)}M`);

/** Two to four plain-English observations about a selection, for someone learning how M&A works. */
export function insights(s: SelectionStats): string[] {
  const out: string[] = [];
  if (!s.count) return out;
  const top = s.biggest[0];
  if (top?.valueUsd) {
    const share = s.totalUsd ? Math.round((top.valueUsd / s.totalUsd) * 100) : 0;
    out.push(`The biggest deal was ${top.acquirer.name} buying ${top.target.name} for ${usd(top.valueUsd)}${share >= 20 ? `, ${share}% of all the money in this period on its own` : ""}.`);
  }
  if (s.medianValueUsd != null && s.totalUsd && s.withValue >= 4) {
    const mean = s.totalUsd / s.withValue;
    if (mean > s.medianValueUsd * 2)
      out.push(`A typical deal was ${usd(s.medianValueUsd)}, but the average is ${usd(mean)}: a few mega-deals pull the total up. That is why spikes on the chart usually mean one huge deal, not a busy month.`);
  }
  const lead = s.sectors[0];
  if (lead && s.sectors.length > 1) out.push(`${lead.sector} was the busiest sector with ${lead.count} of ${s.count} deals (${Math.round(lead.sharePct)}%).`);
  if (s.medianPremium != null) out.push(`Buyers paid a median ${Math.round(s.medianPremium)}% above the target's share price before the deal: the "control premium" for taking over a whole company.`);
  if (s.cashPct != null && s.count >= 4) out.push(`${s.cashPct}% of deals were paid all in cash; the rest used the buyer's own shares, or a mix.`);
  return out.slice(0, 4);
}
