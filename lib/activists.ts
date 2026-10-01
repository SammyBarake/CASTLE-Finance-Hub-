/**
 * Activist stakes (Schedule 13D): who is building stakes, what they ask for, and which targets
 * later agreed to be sold. Pure and testable.
 */
import type { ActivistStake, Deal } from "./types";

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The first deal announced for the stake's company after the 13D, if Castle tracked one. */
export function laterDeal(stake: ActivistStake, deals: Deal[]): Deal | null {
  if (!stake.company.cik) return null;
  const cik = stake.company.cik.replace(/^0+/, "");
  return (
    deals
      .filter((d) => d.target.cik?.replace(/^0+/, "") === cik && d.announcedDate >= stake.filedDate)
      .sort((a, b) => a.announcedDate.localeCompare(b.announcedDate))[0] ?? null
  );
}

export interface ActivistStats {
  count: number;
  companies: number;
  since: string | null;
  medianPercent: number | null;
  aims: { aim: string; count: number }[];
  investors: { name: string; count: number; companies: string[]; stake: ActivistStake }[];
  /** Stakes whose company later agreed to be acquired. */
  sold: { stake: ActivistStake; deal: Deal }[];
}

export function activistStats(stakes: ActivistStake[], deals: Deal[]): ActivistStats {
  const aims = new Map<string, number>();
  for (const s of stakes) for (const a of s.aims) aims.set(a, (aims.get(a) ?? 0) + 1);
  const investors = new Map<string, { name: string; count: number; companies: string[]; stake: ActivistStake }>();
  for (const s of stakes) {
    const e = investors.get(s.investor.name) ?? { name: s.investor.name, count: 0, companies: [], stake: s };
    e.count++;
    if (!e.companies.includes(s.company.name)) e.companies.push(s.company.name);
    investors.set(s.investor.name, e);
  }
  const sold = stakes.map((stake) => ({ stake, deal: laterDeal(stake, deals) })).filter((x): x is { stake: ActivistStake; deal: Deal } => x.deal != null);
  return {
    count: stakes.length,
    companies: new Set(stakes.map((s) => s.company.cik ?? s.company.name)).size,
    since: stakes.map((s) => s.filedDate).sort()[0] ?? null,
    medianPercent: median(stakes.map((s) => s.percent).filter((v): v is number => v != null)),
    aims: [...aims.entries()].map(([aim, count]) => ({ aim, count })).sort((a, b) => b.count - a.count),
    investors: [...investors.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8),
    sold,
  };
}

export function activistInsights(s: ActivistStats): string[] {
  const out: string[] = [];
  if (!s.count) return out;
  const [top, next, third] = s.aims;
  if (top) out.push(`Most common demand: ${top.aim.toLowerCase()} (${top.count} of ${s.count} stakes).`);
  if (next) out.push(`Then ${next.aim.toLowerCase()} (${next.count})${third ? ` and ${third.aim.toLowerCase()} (${third.count})` : ""}.`);
  if (s.medianPercent != null) out.push(`Median stake ${s.medianPercent.toFixed(1)}% of shares: enough to sway votes, far from control.`);
  const lead = s.investors[0];
  if (lead && lead.count > 1) out.push(`Most active: ${lead.name} (${lead.count} stakes).`);
  if (s.sold.length) out.push(`${s.sold.length} targeted ${s.sold.length === 1 ? "company" : "companies"} later agreed to be acquired.`);
  return out;
}
