/**
 * A bank's fingerprint from the deals it advised: which side, which sectors, how big, which clients came back, and
 * which banks it most often faced. Pure: the advisor drawer computes it from the feed.
 */
import { companyId } from "./companies";
import { median } from "./metrics";
import type { Company, Deal, Sector } from "./types";

export interface BankFingerprint {
  deals: number;
  /** Advised the buyer / the target. */
  buySide: number;
  sellSide: number;
  /** Median headline value of its deals with a disclosed value. */
  medianValueUsd: number | null;
  /** Median premium of the targets it advised (public targets with a stated premium). */
  medianPremiumPct: number | null;
  sectors: { sector: Sector; count: number; share: number }[];
  /** Clients it advised on two or more deals: the buyer when it advised the buyer, the target when it advised the target. */
  repeatClients: { company: Company; count: number }[];
  /** Banks on the other side of its deals, most frequent first. */
  counterparts: { bank: string; count: number }[];
}

const count = <T>(items: T[], key: (x: T) => string) => {
  const m = new Map<string, { item: T; count: number }>();
  for (const x of items) {
    const k = key(x);
    const e = m.get(k);
    if (e) e.count++;
    else m.set(k, { item: x, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
};

export function bankFingerprint(bank: string, deals: Deal[]): BankFingerprint {
  const buy = deals.filter((d) => d.acquirerAdvisors.includes(bank));
  const sell = deals.filter((d) => d.targetAdvisors.includes(bank) && !d.acquirerAdvisors.includes(bank));
  const all = [...buy, ...sell];
  const clients = [...buy.map((d) => d.acquirer), ...sell.map((d) => d.target)];
  const across = [...buy.flatMap((d) => d.targetAdvisors), ...sell.flatMap((d) => d.acquirerAdvisors)].filter((b) => b !== bank);
  return {
    deals: all.length,
    buySide: buy.length,
    sellSide: sell.length,
    medianValueUsd: median(all.map((d) => d.valueUsd).filter((v): v is number => v != null)),
    medianPremiumPct: median(sell.map((d) => d.premiumPct).filter((v): v is number => v != null)),
    sectors: count(all, (d) => d.sector).map(({ item, count: n }) => ({ sector: item.sector, count: n, share: (n / all.length) * 100 })),
    repeatClients: count(clients, companyId)
      .filter((c) => c.count >= 2)
      .map(({ item, count: n }) => ({ company: item, count: n })),
    counterparts: count(across, (b) => b).map(({ item, count: n }) => ({ bank: item, count: n })),
  };
}
