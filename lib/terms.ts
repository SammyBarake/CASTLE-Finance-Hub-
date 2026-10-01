/**
 * Deal protection analytics: what's "market" for break fees, reverse fees, go-shops and financing, and which
 * banks commit the debt. Fees are measured against the headline deal value.
 */
import { median } from "./metrics";
import type { Deal, DealTerms, Sector } from "./types";

export interface TermsRow {
  deal: Deal;
  targetFeePct: number | null;
  reverseFeePct: number | null;
}

export const SIZE_BANDS = [
  { label: "Under $500M", min: 0, max: 5e8 },
  { label: "$500M – $2B", min: 5e8, max: 2e9 },
  { label: "$2B – $10B", min: 2e9, max: 1e10 },
  { label: "$10B+", min: 1e10, max: Infinity },
] as const;

const pct = (fee: number | null | undefined, value: number | null) => (fee != null && value ? Math.round((fee / value) * 1000) / 10 : null);

/** Deals whose merger agreement terms Castle has read, newest first. */
export function termsRows(deals: Deal[]): TermsRow[] {
  return deals
    .filter((d) => d.terms && !d.privateTarget)
    .map((d) => ({ deal: d, targetFeePct: pct(d.terms!.targetFeeUsd, d.valueUsd), reverseFeePct: pct(d.terms!.reverseFeeUsd, d.valueUsd) }));
}

const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x != null);
const share = (yes: number, of: number) => (of ? Math.round((yes / of) * 100) : null);

export interface LenderRow {
  bank: string;
  deals: number;
  valueUsd: number;
  largest: Deal;
}

export function termsStats(rows: TermsRow[]) {
  const goShopKnown = rows.filter((r) => r.deal.terms!.goShop != null);
  const goShops = goShopKnown.filter((r) => r.deal.terms!.goShop);
  const finKnown = rows.filter((r) => r.deal.terms!.financingCondition != null);
  const withReverse = rows.filter((r) => r.reverseFeePct != null);

  const lenders = new Map<string, LenderRow>();
  for (const r of rows)
    for (const bank of r.deal.terms!.financingBanks) {
      const e = lenders.get(bank) ?? { bank, deals: 0, valueUsd: 0, largest: r.deal };
      e.deals++;
      e.valueUsd += r.deal.valueUsd ?? 0;
      if ((r.deal.valueUsd ?? 0) > (e.largest.valueUsd ?? 0)) e.largest = r.deal;
      lenders.set(bank, e);
    }

  const bySize = SIZE_BANDS.map((b) => {
    const inBand = rows.filter((r) => r.deal.valueUsd != null && r.deal.valueUsd >= b.min && r.deal.valueUsd < b.max);
    return {
      label: b.label,
      n: inBand.length,
      targetFee: median(nums(inBand.map((r) => r.targetFeePct))),
      reverseFee: median(nums(inBand.map((r) => r.reverseFeePct))),
    };
  });

  const sectors = [...new Set(rows.map((r) => r.deal.sector))] as Sector[];
  const bySector = sectors
    .map((s) => {
      const inSector = rows.filter((r) => r.deal.sector === s);
      return { sector: s, n: inSector.length, targetFee: median(nums(inSector.map((r) => r.targetFeePct))), reverseFee: median(nums(inSector.map((r) => r.reverseFeePct))) };
    })
    .sort((a, b) => b.n - a.n);

  return {
    count: rows.length,
    medianTargetFee: median(nums(rows.map((r) => r.targetFeePct))),
    medianReverseFee: median(nums(rows.map((r) => r.reverseFeePct))),
    reverseSharePct: share(withReverse.length, rows.length),
    goShopSharePct: share(goShops.length, goShopKnown.length),
    goShopCount: goShops.length,
    medianGoShopDays: ((d) => (d == null ? null : Math.round(d)))(median(nums(goShops.map((r) => r.deal.terms!.goShopDays)))),
    financedCount: rows.filter((r) => r.deal.terms!.financingBanks.length).length,
    noFinancingConditionPct: share(finKnown.filter((r) => r.deal.terms!.financingCondition === false).length, finKnown.length),
    bySize,
    bySector,
    lenders: [...lenders.values()].sort((a, b) => b.deals - a.deals || b.valueUsd - a.valueUsd),
  };
}

export type TermsStats = ReturnType<typeof termsStats>;

const f1 = (v: number) => `${v.toFixed(1)}%`;

/** Short, number-led findings for the takeaways strip. */
export function termsInsights(s: TermsStats): string[] {
  const out: string[] = [];
  if (!s.count) return out;
  const small = s.bySize[0];
  const large = [...s.bySize].reverse().find((b) => b.n >= 3 && b.targetFee != null);
  if (small.targetFee != null && large && large !== small && small.n >= 3)
    out.push(`Break fees shrink with size: ${f1(small.targetFee)} of value under $500M vs ${f1(large.targetFee!)} at ${large.label}.`);
  if (s.medianTargetFee != null && s.medianReverseFee != null)
    out.push(`Where both exist, the buyer's reverse fee (${f1(s.medianReverseFee)}) is typically larger than the target's (${f1(s.medianTargetFee)}).`);
  if (s.goShopCount) out.push(`${s.goShopCount} deals had a go-shop${s.medianGoShopDays ? `, typically ${s.medianGoShopDays} days` : ""}; the rest restrict the target from shopping.`);
  const top = s.lenders[0];
  if (top) out.push(`Most active lender: ${top.bank}, committing debt on ${top.deals} deal${top.deals === 1 ? "" : "s"}.`);
  return out;
}

export const goShopLabel = (t: DealTerms) => (t.goShop ? (t.goShopDays ? `${t.goShopDays}-day go-shop` : "Go-shop") : t.goShop === false ? "No-shop" : "—");

export const financingLabel = (t: DealTerms, max = 3) =>
  t.financingBanks.length
    ? `Committed · ${t.financingBanks.slice(0, max).join(", ")}${t.financingBanks.length > max ? ` +${t.financingBanks.length - max}` : ""}`
    : t.financingCondition === false
      ? "No financing condition"
      : t.financingCondition
        ? "Conditioned on financing"
        : "—";

/** Compact table form: "BofA, JPM +1" / "No condition". */
export const financingShort = (t: DealTerms, short: (bank: string) => string) =>
  t.financingBanks.length
    ? `${t.financingBanks.slice(0, 2).map(short).join(", ")}${t.financingBanks.length > 2 ? ` +${t.financingBanks.length - 2}` : ""}`
    : t.financingCondition === false
      ? "No condition"
      : t.financingCondition
        ? "Conditioned"
        : "—";

/** Fee amounts keep a decimal: "$4.5M", "$170M", "$1.20B". */
export const feeUsd = (v: number | null) => (v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e8 ? `$${Math.round(v / 1e6)}M` : `$${(v / 1e6).toFixed(1)}M`);

/** "$57.7M · 3.0%" */
export function feeLabel(fee: number | null | undefined, pctOfValue: number | null, usd: (v: number | null) => string): string {
  if (fee == null) return "—";
  return pctOfValue != null ? `${usd(fee)} · ${pctOfValue.toFixed(1)}%` : usd(fee);
}
