import { describe, expect, it } from "vitest";
import { buildMacroMonthly, buildSectorMonthly, inflationFactor, monthsBetween, previousMonth } from "./history";
import type { Sector } from "./types";

const tickers: Record<Sector, string> = { Tech: "XLK", Healthcare: "XLV", Energy: "XLE", Financials: "XLF", Industrials: "XLI" };

describe("month helpers", () => {
  it("lists months up to (not including) `before`", () => {
    expect(monthsBetween("2015-11", "2016-02")).toEqual(["2015-11", "2015-12", "2016-01"]);
    expect(previousMonth("2016-01")).toBe("2015-12");
  });

  it("inflates to the latest CPI month, leaving months without CPI yet at face value", () => {
    const cpi = { "2015-01": 200, "2026-08": 300 };
    expect(inflationFactor(cpi, "2015-01")).toEqual({ factor: 1.5, base: "2026-08" });
    expect(inflationFactor(cpi, "2026-09").factor).toBe(1);
  });

  it("interpolates a month missing inside the CPI series (October 2025 was never published)", () => {
    const cpi = { "2025-09": 324, "2025-11": 326, "2026-08": 330 };
    expect(inflationFactor(cpi, "2025-10").factor).toBeCloseTo(330 / Math.sqrt(324 * 326), 10);
  });
});

describe("buildSectorMonthly", () => {
  const rows = buildSectorMonthly({
    deals: [
      { announcedDate: "2015-01-10", sector: "Tech", status: "Closed", valueUsd: 1e9, valueKind: "transaction" },
      { announcedDate: "2015-01-20", sector: "Tech", status: "Closed", valueUsd: 2e9, valueKind: "equity" },
      { announcedDate: "2015-01-25", sector: "Tech", status: "Pending", valueUsd: null, valueKind: null },
      { announcedDate: "2015-01-28", sector: "Tech", status: "Terminated", valueUsd: 5e9, valueKind: "transaction" },
      { announcedDate: "2015-02-03", sector: "Energy", status: "Closed", valueUsd: 4e8, valueKind: "transaction" },
    ],
    ipos: [{ pricedDate: "2015-02-12", sector: "Energy" }],
    etf: { Tech: [{ month: "2014-12", close: 40, adjClose: 40 }, { month: "2015-01", close: 41, adjClose: 42 }, { month: "2015-02", close: 40, adjClose: 41 }] },
    etfTickers: tickers,
    cpi: { "2015-01": 200, "2015-02": 200, "2026-08": 300 },
    from: "2015-01",
    before: "2015-03",
  });
  const row = (s: Sector, m: string) => rows.find((r) => r.sector === s && r.month === m)!;

  it("has one row per sector per month", () => {
    expect(rows).toHaveLength(10);
  });

  it("sums one value type in today's dollars and counts what it leaves out", () => {
    expect(row("Tech", "2015-01")).toMatchObject({
      dealCount: 3, // the terminated deal isn't counted
      dealValueKind: "transaction",
      dealValueUsd: 1.5e9,
      dealValueN: 1,
      dealValueNullN: 1,
      dealValueOtherKindN: 1,
      cpiBaseMonth: "2026-08",
    });
    expect(row("Energy", "2015-02")).toMatchObject({ dealCount: 1, dealValueUsd: 6e8, ipoCount: 1 });
  });

  it("computes total returns from the adjusted close, including the first month", () => {
    expect(row("Tech", "2015-01").etfReturnPct).toBe(5);
    expect(row("Tech", "2015-02")).toMatchObject({ etfClose: 40, etfReturnPct: -2.38 });
    expect(row("Healthcare", "2015-01")).toMatchObject({ etfTicker: "XLV", etfClose: null, etfReturnPct: null });
  });

  it("can sum another value type instead", () => {
    const eq = buildSectorMonthly({ deals: [{ announcedDate: "2015-01-20", sector: "Tech", status: "Closed", valueUsd: 2e9, valueKind: "equity" }], ipos: [], etf: {}, etfTickers: tickers, cpi: {}, from: "2015-01", before: "2015-02", valueKind: "equity" });
    expect(eq.find((r) => r.sector === "Tech")).toMatchObject({ dealValueKind: "equity", dealValueUsd: 2e9, dealValueN: 1 });
  });
});

describe("buildMacroMonthly", () => {
  it("lines the FRED series up by month, null where a series has no value", () => {
    const rows = buildMacroMonthly({ fedFunds: { "2015-01": 0.11 }, vix: { "2015-01": 19.1, "2015-02": 15.9 } }, "2015-01", "2015-03");
    expect(rows).toEqual([
      { month: "2015-01", fedFundsPct: 0.11, treasury10yPct: null, hySpreadPct: null, baaSpreadPct: null, vix: 19.1, cpi: null },
      { month: "2015-02", fedFundsPct: null, treasury10yPct: null, hySpreadPct: null, baaSpreadPct: null, vix: 15.9, cpi: null },
    ]);
  });
});
