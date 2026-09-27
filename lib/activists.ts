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
  out.push(
    `Anyone who buys more than 5% of a U.S.-listed company and may try to influence it must file a Schedule 13D within 5 business days, saying who they are, how much they own and what they want. Passive investors file the shorter 13G instead.`,
  );
  const top = s.aims[0];
  if (top) out.push(`The most common ask was "${top.aim.toLowerCase()}" (${top.count} of ${s.count} stakes). Many activists ask for several things at once.`);
  if (s.medianPercent != null) out.push(`The median stake was ${s.medianPercent.toFixed(1)}%: activists rarely need control, just enough shares to be taken seriously and win votes from other investors.`);
  if (s.sold.length) out.push(`${s.sold.length} of these companies later agreed to be acquired. Pushing for a sale is one of the fastest ways for an activist to cash in.`);
  return out;
}
