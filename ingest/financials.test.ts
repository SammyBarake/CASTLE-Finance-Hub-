import { describe, expect, it } from "vitest";
import { computeMultiples, ebitdaOf, financialsFrom, latestInstant, ltm, series } from "./financials";

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

describe("series", () => {
  it("takes total revenue over a sub-line tagged for the same period (REIT rents vs fee income)", () => {
    const cf = {
      facts: {
        "us-gaap": {
          RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [f("2025-01-01", "2025-12-31", 12e6)] } },
          Revenues: { units: { USD: [f("2025-01-01", "2025-12-31", 180e6)] } },
        },
      },
    };
    expect(ltm(series(cf, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"], "USD", "2026-06-01", true))).toBe(180e6);
    // Without the tie-break the first concept in the list wins.
    expect(ltm(series(cf, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"], "USD", "2026-06-01"))).toBe(12e6);
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

describe("EBITDA fallbacks and freshness", () => {
  const year = (val: number, y = 2025) => f(`${y}-01-01`, `${y}-12-31`, val);
  const facts = (tags: Record<string, ReturnType<typeof f>[]>) => ({ facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([k, rows]) => [k, { units: { USD: rows } }])) } });

  it("adds depreciation and intangibles amortization reported apart (Perficient)", () => {
    const cf = facts({ OperatingIncomeLoss: [year(116e6)], Depreciation: [year(8.7e6)], AmortizationOfIntangibleAssets: [year(19.7e6)] });
    expect(ebitdaOf(cf, "2026-05-06")).toBeCloseTo(144.4e6, -3);
    // Amortization reported but no full year of it: unknown, not zero.
    const partial = facts({ OperatingIncomeLoss: [year(116e6)], Depreciation: [year(8.7e6)], AmortizationOfIntangibleAssets: [f("2025-10-01", "2025-12-31", 5e6)] });
    expect(ebitdaOf(partial, "2026-05-06")).toBeNull();
  });

  it("builds EBIT from pre-tax income and interest when there is no operating-income line (ChampionX)", () => {
    const cf = facts({
      OperatingIncomeLoss: [year(300e6, 2017)],
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: [year(424e6)],
      InterestExpense: [year(50e6)],
      DepreciationDepletionAndAmortization: [year(236e6)],
    });
    expect(ebitdaOf(cf, "2026-04-02")).toBe(424e6 + 50e6 + 236e6);
  });

  it("ignores a figure from a fiscal year over 15 months old", () => {
    expect(ltm([year(800, 2022)], "2026-04-02")).toBeNull();
    expect(latestInstant([f(undefined, "2020-12-31", 1.9e9)], false, "2026-04-02")).toBeNull();
  });

  it("reads convertible notes as debt, and has no EV when debt can't be read but interest is paid (AES)", () => {
    const fin = financialsFrom(facts({ ConvertibleLongTermNotesPayable: [f(undefined, "2025-12-31", 556e6)], ConvertibleNotesPayableCurrent: [f(undefined, "2025-12-31", 451e6)] }), "2026-03-08");
    expect(fin.debt).toBe(1007e6);
    const aes = { revenueLtm: 12e9, ebitdaLtm: 2.9e9, debt: null, cash: 1.5e9, sharesOutstanding: 712e6, interestLtm: 1.4e9 };
    expect(computeMultiples({ valueUsd: 10.8e9, valueKind: "equity", pricePerShare: null }, aes).enterpriseValueUsd).toBeNull();
    // A stated enterprise value still stands.
    expect(computeMultiples({ valueUsd: 38e9, valueKind: "enterprise", pricePerShare: null }, aes).evEbitda).toBe(13.1);
  });
});
