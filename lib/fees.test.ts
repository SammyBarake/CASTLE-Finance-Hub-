import { describe, expect, it } from "vitest";
import { feeInsights, feeLeague, feeRecords, feesBySize, formatBps } from "./fees";
import type { Deal, FairnessOpinion } from "./types";

const op = (bank: string, feeUsd: number | null, side: "target" | "acquirer" = "target"): FairnessOpinion => ({
  bank,
  side,
  ranges: [],
  feeUsd,
  discountRatePct: null,
  perpetuityGrowthPct: null,
  terminalMultiple: null,
});
const deal = (valueUsd: number | null, fairness: FairnessOpinion[], name = "T"): Deal => ({
  id: Math.random().toString(36),
  announcedDate: "2026-05-10",
  acquirer: { name: "A", ticker: null, cik: null },
  target: { name, ticker: null, cik: "1" },
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
  fairness,
});

describe("fees", () => {
  const deals = [
    deal(20e9, [op("Goldman Sachs", 60e6), op("Centerview", 50e6)], "Mega"),
    deal(15e9, [op("Goldman Sachs", 40e6)]),
    deal(12e9, [op("Lazard", 30e6)]),
    deal(200e6, [op("Houlihan Lokey", 4e6)]),
    deal(300e6, [op("Houlihan Lokey", 5e6)]),
    deal(400e6, [op("Jefferies", 6e6)]),
    deal(1e8, [op("Tiny Bank", 50e6)]), // 50% of the deal: a parsing slip
    deal(null, [op("Evercore", 10e6), op(null as unknown as string, 5e6)]),
  ];
  const records = feeRecords(deals);

  it("collects fees, dropping implausible ones and unnamed banks", () => {
    expect(records).toHaveLength(8);
    expect(records.find((r) => r.bank === "Goldman Sachs")!.bps).toBe(30);
    expect(records.some((r) => r.bank === "Tiny Bank")).toBe(false);
  });

  it("ranks banks by total fees", () => {
    const league = feeLeague(records);
    expect(league[0]).toMatchObject({ bank: "Goldman Sachs", totalUsd: 100e6, deals: 2, medianUsd: 50e6 });
    expect(league[0].largest.deal.target.name).toBe("Mega");
  });

  it("shows fees shrinking as a share of bigger deals", () => {
    const bands = feesBySize(records);
    expect(bands[0]).toMatchObject({ label: "Under $500M", n: 3 });
    expect(bands[0].medianBps).toBeCloseTo(166.7, 1);
    expect(bands[3]).toMatchObject({ label: "Over $10B", n: 4 });
    expect(bands[3].medianBps!).toBeLessThan(40);
    expect(formatBps(200)).toBe("2.0%");
    expect(formatBps(25)).toBe("0.25%");
    const text = feeInsights(records, feeLeague(records), bands).join(" ");
    expect(text).toContain("Goldman Sachs earned the most");
    expect(text).toContain("Small deals pay a much bigger share");
  });
});
