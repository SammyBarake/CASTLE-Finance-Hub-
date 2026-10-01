/**
 * Advisory fees disclosed in merger proxies (from each fairness opinion): which banks earn the
 * most, and what fees look like as a share of the deal. Pure and testable.
 */
import type { Deal, FeeRow } from "./types";

export interface FeeRecord {
  bank: string;
  deal: Deal;
  feeUsd: number;
  side: "target" | "acquirer";
  /** Fee as basis points of the deal value (1 bp = 0.01%), when the value is known. */
  bps: number | null;
}

/** Compact fee rows from full deals (server side, so the page feed can drop the opinions). */
export function feeRows(deals: Deal[]): FeeRow[] {
  const out: FeeRow[] = [];
  for (const deal of deals)
    for (const o of deal.fairness ?? []) if (o.bank && o.feeUsd != null && o.feeUsd > 0) out.push({ dealId: deal.id, bank: o.bank, feeUsd: o.feeUsd, side: o.side });
  return out;
}

/** Fee rows joined to their deals. A fee above 5% of the deal is a parsing slip (e.g. a fee range read as one number): left out. */
export function feeRecords(rows: FeeRow[], deals: Deal[]): FeeRecord[] {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const out: FeeRecord[] = [];
  for (const r of rows) {
    const deal = byId.get(r.dealId);
    if (!deal) continue;
    const bps = deal.valueUsd ? (r.feeUsd / deal.valueUsd) * 10_000 : null;
    if (bps != null && bps > 500) continue;
    out.push({ bank: r.bank, deal, feeUsd: r.feeUsd, side: r.side, bps });
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

export const formatBps = (bps: number | null) => (bps == null ? "—" : bps >= 100 ? `${(bps / 100).toFixed(1)}%` : `${(bps / 100).toFixed(2)}%`);

export function feeInsights(records: FeeRecord[], league: BankFees[], bySize: ReturnType<typeof feesBySize>): string[] {
  const out: string[] = [];
  if (!records.length) return out;
  const total = records.reduce((s, r) => s + r.feeUsd, 0);
  const top = league[0];
  const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(v < 1e7 ? 1 : 0)}M`);
  // The KPIs already show the total and the top earner; add its share of the pool.
  if (league.length > 1) out.push(`${top.bank} took ${Math.round((top.totalUsd / total) * 100)}% of all disclosed fees; the top five took ${Math.round((league.slice(0, 5).reduce((s, b) => s + b.totalUsd, 0) / total) * 100)}%.`);
  const small = bySize[0];
  const mega = bySize.at(-1)!;
  if (small.medianBps != null && mega.medianBps != null && small.n >= 3 && mega.n >= 3)
    out.push(`Small deals pay a much bigger share: ${formatBps(small.medianBps)} of value under $500M vs ${formatBps(mega.medianBps)} over $10B (median).`);
  const biggest = [...records].sort((a, b) => b.feeUsd - a.feeUsd)[0];
  out.push(`Largest single fee: ${usd(biggest.feeUsd)} to ${biggest.bank} on ${biggest.deal.target.name.replace(/\.$/, "")}.`);
  return out;
}
