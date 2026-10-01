import { describe, expect, it } from "vitest";
import { feeLabel, termsInsights, termsRows, termsStats } from "./terms";
import type { Deal, DealTerms } from "./types";

const terms = (over: Partial<DealTerms>): DealTerms => ({ targetFeeUsd: null, reverseFeeUsd: null, goShop: false, goShopDays: null, financingCondition: false, financingBanks: [], ...over });
const deal = (valueUsd: number, t: Partial<DealTerms> | null, over: Partial<Deal> = {}): Deal => ({
  id: Math.random().toString(36),
  announcedDate: "2026-06-01",
  acquirer: { name: "Buyer", ticker: null, cik: "1" },
  target: { name: "Target", ticker: null, cik: "2" },
  valueUsd,
  pricePerShare: null,
  premiumPct: null,
  consideration: "Cash",
  sector: "Tech",
  industry: null,
  status: "Announced",
  statusDate: null,
  enterpriseValueUsd: null,
  evEbitda: null,
  evRevenue: null,
  acquirerAdvisors: [],
  targetAdvisors: [],
  filings: [],
  ...(t ? { terms: terms(t) } : {}),
  ...over,
});

describe("deal terms analytics", () => {
  const deals = [
    deal(200e6, { targetFeeUsd: 8e6 }),
    deal(300e6, { targetFeeUsd: 12e6, goShop: true, goShopDays: 30 }),
    deal(400e6, { targetFeeUsd: 14e6 }),
    deal(5e9, { targetFeeUsd: 125e6, reverseFeeUsd: 250e6, financingBanks: ["JPMorgan", "Goldman Sachs"] }),
    deal(6e9, { targetFeeUsd: 150e6, reverseFeeUsd: 300e6, financingBanks: ["JPMorgan"] }),
    deal(7e9, { targetFeeUsd: 175e6, goShop: true, goShopDays: 40 }),
    deal(1e9, null),
    deal(1e9, { targetFeeUsd: 30e6 }, { privateTarget: true }),
  ];
  const rows = termsRows(deals);
  const s = termsStats(rows);

  it("keeps public deals with terms and measures fees against deal value", () => {
    expect(rows).toHaveLength(6);
    expect(rows[0].targetFeePct).toBe(4);
    expect(rows[3]).toMatchObject({ targetFeePct: 2.5, reverseFeePct: 5 });
  });

  it("summarises market terms, by size, and the lender league", () => {
    expect(s).toMatchObject({ count: 6, goShopCount: 2, medianGoShopDays: 35, reverseSharePct: 33, noFinancingConditionPct: 100 });
    expect(s.bySize[0]).toMatchObject({ n: 3, targetFee: 4 });
    expect(s.bySize[2]).toMatchObject({ n: 3, targetFee: 2.5, reverseFee: 5 });
    expect(s.lenders[0]).toMatchObject({ bank: "JPMorgan", deals: 2, valueUsd: 11e9 });
  });

  it("writes short takeaways", () => {
    const text = termsInsights(s).join(" ");
    expect(text).toContain("Break fees shrink with size: 4.0% of value under $500M vs 2.5% at $2B – $10B");
    expect(text).toContain("Most active lender: JPMorgan");
    expect(termsInsights(termsStats([]))).toEqual([]);
  });

  it("formats a fee with its share of the deal", () => {
    const usd = (v: number | null) => (v == null ? "—" : `$${(v / 1e6).toFixed(1)}M`);
    expect(feeLabel(57.7e6, 3, usd)).toBe("$57.7M · 3.0%");
    expect(feeLabel(null, null, usd)).toBe("—");
  });
});
