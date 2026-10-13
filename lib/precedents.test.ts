import { describe, expect, it } from "vitest";
import { dcfOf, dcfRows, DEFAULT_PRECEDENTS, percentile, screenForDeal, screenPrecedents, similarDeals, summarize, summarizeComps, summarizeDcf } from "./precedents";
import type { Deal } from "./types";

const deal = (over: Partial<Deal>): Deal => ({
  id: Math.random().toString(36),
  announcedDate: "2026-05-10",
  acquirer: { name: "A", ticker: null, cik: null },
  target: { name: "T", ticker: "T", cik: "1" },
  valueUsd: 1e9,
  pricePerShare: null,
  premiumPct: null,
  consideration: "Cash",
  sector: "Tech",
  industry: "Services-Prepackaged Software",
  status: "Announced",
  statusDate: null,
  enterpriseValueUsd: null,
  evEbitda: 12,
  evRevenue: 3,
  acquirerAdvisors: [],
  targetAdvisors: [],
  filings: [],
  ...over,
});

const ASOF = "2026-09-26T00:00:00Z";

describe("percentile / summarize", () => {
  it("matches Excel PERCENTILE.INC", () => {
    const xs = [1, 2, 3, 4, 10];
    expect(percentile(xs, 0.5)).toBe(3);
    expect(percentile(xs, 0.25)).toBe(2);
    expect(percentile(xs, 0.75)).toBe(4);
    expect(percentile([5, 7], 0.5)).toBe(6);
  });

  it("ignores missing values", () => {
    expect(summarize([10, null, 20, 30])).toEqual({ n: 3, high: 30, p75: 25, mean: 20, median: 20, p25: 15, low: 10 });
    expect(summarize([null]).median).toBeNull();
  });
});

describe("screenPrecedents", () => {
  const deals = [
    deal({ id: "a", sector: "Tech", enterpriseValueUsd: 2e9 }),
    deal({ id: "b", sector: "Healthcare", industry: "Pharmaceutical Preparations" }),
    deal({ id: "c", announcedDate: "2024-01-01" }),
    deal({ id: "d", status: "Terminated" }),
    deal({ id: "e", evEbitda: null, evRevenue: null }),
    deal({ id: "f", valueUsd: 20e9 }),
  ];

  it("applies sector, window, status and multiple filters", () => {
    const ids = screenPrecedents(deals, { ...DEFAULT_PRECEDENTS, sector: "Tech" }, ASOF).map((d) => d.id);
    expect(ids.sort()).toEqual(["a", "f"]);
  });

  it("filters by industry text and by size (EV first)", () => {
    expect(screenPrecedents(deals, { ...DEFAULT_PRECEDENTS, industry: "pharma" }, ASOF).map((d) => d.id)).toEqual(["b"]);
    const sized = screenPrecedents(deals, { ...DEFAULT_PRECEDENTS, min: "1.5", max: "10" }, ASOF).map((d) => d.id);
    expect(sized).toEqual(["a"]);
  });

  it("seeds a screen from a deal", () => {
    expect(screenForDeal(deal({ sector: "Energy", valueUsd: 3e9 }))).toMatchObject({ sector: "Energy", min: "1", max: "9" });
  });

  it("summarises the comps", () => {
    const s = summarizeComps([deal({ evEbitda: 10, premiumPct: 30 }), deal({ evEbitda: 14, premiumPct: null })]);
    expect(s.evEbitda.median).toBe(12);
    expect(s.premium.n).toBe(1);
    expect(s.size.median).toBe(1e9);
  });
});

describe("DCF from fairness opinions", () => {
  const opinion = (side: "target" | "acquirer", low: number, high: number) => ({
    bank: side === "target" ? "Goldman Sachs" : "Lazard",
    side,
    ranges: [{ method: "Trading comparables", low: 10, high: 20 }, { method: "Discounted cash flow", low, high }],
    feeUsd: null,
    discountRatePct: [9, 11] as [number, number],
    perpetuityGrowthPct: [2, 3] as [number, number],
    terminalMultiple: null,
  });

  it("takes the target bank's DCF and skips the buyer's and implausible ranges", () => {
    expect(dcfOf([opinion("acquirer", 50, 60), opinion("target", 30, 40)])).toEqual({ bank: "Goldman Sachs", low: 30, high: 40, discountRatePct: [9, 11], perpetuityGrowthPct: [2, 3] });
    expect(dcfOf([opinion("target", 0, 40)])).toBeNull();
    expect(dcfOf([opinion("target", 5, 40)])).toBeNull();
    expect(dcfOf(undefined)).toBeNull();
  });

  it("places each offer against its DCF midpoint and summarises the assumptions", () => {
    const deal = (id: string, price: number | null, low: number, high: number) =>
      ({ id, pricePerShare: price, dcf: { bank: "Citi", low, high, discountRatePct: [9, 11], perpetuityGrowthPct: [2, 3] } }) as unknown as Deal;
    const rows = dcfRows([deal("a", 42, 30, 40), deal("b", null, 10, 14), { id: "c", pricePerShare: 5 } as unknown as Deal]);
    expect(rows).toHaveLength(2);
    expect(rows[0].vsMid).toBeCloseTo(20);
    expect(rows[1].vsMid).toBeNull();
    const s = summarizeDcf(rows);
    expect(s.discount.median).toBe(10);
    expect(s.growth.median).toBe(2.5);
    expect(s.vsMid.n).toBe(1);
  });
});

describe("similarDeals", () => {
  const d = (id: string, over: Partial<Deal>) => ({ id, announcedDate: "2024-01-01", sector: "Tech", status: "Closed", industry: "Software", valueUsd: 1e9, enterpriseValueUsd: null, acquirer: { name: "Acme", cik: "1", ticker: "ACM" }, ...over }) as unknown as Deal;
  const type = (x: Deal) => (/Partners/.test(x.acquirer.name) ? "Private equity" : "Strategic");
  it("picks same-sector deals of a similar size, same buyer type first", () => {
    const subject = d("s", { valueUsd: 1e9 });
    const deals = [
      subject,
      d("near", { valueUsd: 1.1e9 }),
      d("pe", { valueUsd: 1.05e9, acquirer: { name: "Vista Partners", cik: null, ticker: null } }),
      d("far", { valueUsd: 9e9 }),
      d("other-sector", { valueUsd: 1e9, sector: "Energy" }),
      d("ended", { valueUsd: 1e9, status: "Terminated" }),
      d("private", { valueUsd: 1e9, privateTarget: true }),
    ];
    expect(similarDeals(subject, deals, type).map((x) => x.id)).toEqual(["near", "pe"]);
  });
});
