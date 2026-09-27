import { describe, expect, it } from "vitest";
import { DEFAULT_PRECEDENTS, percentile, screenForDeal, screenPrecedents, summarize, summarizeComps } from "./precedents";
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
