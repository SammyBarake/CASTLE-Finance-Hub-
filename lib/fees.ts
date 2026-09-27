/**
 * Advisory fees disclosed in merger proxies (from each fairness opinion): which banks earn the
 * most, and what fees look like as a share of the deal. Pure and testable.
 */
import type { Deal } from "./types";

export interface FeeRecord {
  bank: string;
  deal: Deal;
  feeUsd: number;
  side: "target" | "acquirer";
  /** Fee as basis points of the deal value (1 bp = 0.01%), when the value is known. */
  bps: number | null;
}

export function feeRecords(deals: Deal[]): FeeRecord[] {
  const out: FeeRecord[] = [];
  for (const deal of deals)
    for (const o of deal.fairness ?? []) {
      if (!o.bank || o.feeUsd == null || o.feeUsd <= 0) continue;
      // A fee above 5% of the deal is a parsing slip (e.g. a fee range read as a single number): leave it out.
      const bps = deal.valueUsd ? (o.feeUsd / deal.valueUsd) * 10_000 : null;
      if (bps != null && bps > 500) continue;
      out.push({ bank: o.bank, deal, feeUsd: o.feeUsd, side: o.side, bps });
    }
  return out;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface BankFees {
  bank: string;
  totalUsd: number;
  deals: number;
  medianUsd: number;
  medianBps: number | null;
  largest: FeeRecord;
}

export function feeLeague(records: FeeRecord[]): BankFees[] {
  const byBank = new Map<string, FeeRecord[]>();
  for (const r of records) byBank.set(r.bank, [...(byBank.get(r.bank) ?? []), r]);
  return [...byBank.entries()]
    .map(([bank, rs]) => ({
      bank,
      totalUsd: rs.reduce((s, r) => s + r.feeUsd, 0),
      deals: rs.length,
      medianUsd: median(rs.map((r) => r.feeUsd))!,
      medianBps: median(rs.map((r) => r.bps).filter((v): v is number => v != null)),
      largest: [...rs].sort((a, b) => b.feeUsd - a.feeUsd)[0],
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
}

/** Median fee % by deal size band: small deals pay a far higher share than mega-deals. */
export const SIZE_BANDS: { label: string; max: number }[] = [
  { label: "Under $500M", max: 5e8 },
  { label: "$500M – $2B", max: 2e9 },
  { label: "$2B – $10B", max: 1e10 },
  { label: "Over $10B", max: Infinity },
];

export function feesBySize(records: FeeRecord[]): { label: string; medianBps: number | null; medianUsd: number | null; n: number }[] {
  return SIZE_BANDS.map((band, i) => {
    const lo = SIZE_BANDS[i - 1]?.max ?? 0;
    const rs = records.filter((r) => r.deal.valueUsd != null && r.deal.valueUsd >= lo && r.deal.valueUsd < band.max);
    return { label: band.label, medianBps: median(rs.map((r) => r.bps!)), medianUsd: median(rs.map((r) => r.feeUsd)), n: rs.length };
  });
}

export const formatBps = (bps: number | null) => (bps == null ? "n/a" : bps >= 100 ? `${(bps / 100).toFixed(1)}%` : `${(bps / 100).toFixed(2)}%`);

export function feeInsights(records: FeeRecord[], league: BankFees[], bySize: ReturnType<typeof feesBySize>): string[] {
  const out: string[] = [];
  if (!records.length) return out;
  const total = records.reduce((s, r) => s + r.feeUsd, 0);
  const top = league[0];
  const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(v < 1e7 ? 1 : 0)}M`);
  out.push(`${records.length} disclosed fees add up to ${usd(total)}. ${top.bank} earned the most: ${usd(top.totalUsd)} across ${top.deals} deal${top.deals === 1 ? "" : "s"}.`);
  const small = bySize[0];
  const mega = bySize.at(-1)!;
  if (small.medianBps != null && mega.medianBps != null && small.n >= 3 && mega.n >= 3)
    out.push(
      `Small deals pay a much bigger share: a median ${formatBps(small.medianBps)} of the deal under $500M vs ${formatBps(mega.medianBps)} over $10B. The work (diligence, the fairness opinion, running a sale) doesn't shrink with the deal, so fees don't scale down proportionally.`,
    );
  const biggest = [...records].sort((a, b) => b.feeUsd - a.feeUsd)[0];
  out.push(`The biggest single fee was ${usd(biggest.feeUsd)} to ${biggest.bank} for ${biggest.deal.target.name.replace(/\.$/, "")}. Most of a fee is usually paid only if the deal closes (a "success fee"); a small part is due when the bank delivers its fairness opinion.`);
  return out;
}
