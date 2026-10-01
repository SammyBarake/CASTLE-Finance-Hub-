import { describe, expect, it } from "vitest";
import { computeMultiples, latestInstant, ltm } from "./financials";

const f = (start: string | undefined, end: string, val: number) => ({ start, end, val, form: "10-Q", filed: end });

describe("ltm", () => {
  it("adds current YTD and subtracts prior-year YTD to the last fiscal year", () => {
    const rows = [
      f("2025-01-01", "2025-12-31", 1000), // FY2025
      f("2025-01-01", "2025-06-30", 450), // H1 2025
      f("2026-01-01", "2026-06-30", 550), // H1 2026
    ];
    expect(ltm(rows)).toBe(1000 + 550 - 450);
  });

  it("falls back to the fiscal year when no later quarter exists", () => {
    expect(ltm([f("2025-01-01", "2025-12-31", 800)])).toBe(800);
  });
});

describe("latestInstant", () => {
  it("sums share classes reported on the same date", () => {
    const rows = [f(undefined, "2026-06-30", 100), f(undefined, "2026-06-30", 20), f(undefined, "2026-03-31", 90)];
    expect(latestInstant(rows, true)).toBe(120);
  });
});

describe("computeMultiples", () => {
  const fin = { revenueLtm: 500e6, ebitdaLtm: 100e6, debt: 300e6, cash: 100e6, sharesOutstanding: 50e6 };

  it("builds EV from offer price, shares and net debt", () => {
    const m = computeMultiples({ valueUsd: null, valueKind: null, pricePerShare: 20 }, fin);
    expect(m.enterpriseValueUsd).toBe(20 * 50e6 + 200e6);
    expect(m.evEbitda).toBe(12);
    expect(m.evRevenue).toBe(2.4);
  });

  it("uses a stated enterprise value as is", () => {
    expect(computeMultiples({ valueUsd: 1.5e9, valueKind: "enterprise", pricePerShare: 20 }, fin).enterpriseValueUsd).toBe(1.5e9);
  });

  it("drops meaningless multiples (negative EBITDA)", () => {
    expect(computeMultiples({ valueUsd: 1e9, valueKind: "enterprise", pricePerShare: null }, { ...fin, ebitdaLtm: -5e6 }).evEbitda).toBeNull();
  });

  it("gives banks, insurers and mortgage REITs no EV (deposits and repo funding aren't debt)", () => {
    const deal = { valueUsd: 450e6, valueKind: "equity" as const, pricePerShare: 20 };
    expect(computeMultiples(deal, { ...fin, debt: 4e9 }, { sic: "6022", name: "Blue Ridge Bankshares" }).enterpriseValueUsd).toBeNull();
    expect(computeMultiples(deal, fin, { sic: "6311", name: "American National Group" }).evRevenue).toBeNull();
    expect(computeMultiples(deal, fin, { sic: "6798", name: "Two Harbors Investment Corp." }).enterpriseValueUsd).toBeNull();
    // An equity REIT keeps its EV: its debt is real.
    expect(computeMultiples(deal, fin, { sic: "6798", name: "Sotherly Hotels Inc." }).enterpriseValueUsd).not.toBeNull();
  });

  it("ignores a share count that doesn't fit the stated value (reverse split since the last filing)", () => {
    // $5.50 x 330M pre-split shares = $1.8B, against a stated $180M equity value.
    const m = computeMultiples({ valueUsd: 180e6, valueKind: "equity", pricePerShare: 5.5 }, { ...fin, sharesOutstanding: 330e6, debt: 100e6, cash: 50e6 });
    expect(m.impliedEquityUsd).toBeNull();
    expect(m.enterpriseValueUsd).toBe(230e6);
  });

  it("ignores an implausibly small share count", () => {
    expect(computeMultiples({ valueUsd: null, valueKind: null, pricePerShare: 5.02 }, { ...fin, sharesOutstanding: 1000 }).impliedEquityUsd).toBeNull();
  });
});
