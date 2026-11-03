import { describe, expect, it } from "vitest";
import { adjustedEbitdaOf, anchorOf, computeMultiples, ebitdaOf, financialsFrom, latestInstant, ltm, series } from "./financials";

const f = (start: string | undefined, end: string, val: number) => ({ start, end, val, form: "10-Q", filed: end });
const facts = (tags: Record<string, ReturnType<typeof f>[]>) => ({ facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([k, rows]) => [k, { units: { USD: rows } }])) } });

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
  const fin = { revenueLtm: 500e6, ebitdaLtm: 100e6, adjustedEbitdaLtm: 100e6, debt: 300e6, cash: 100e6, sharesOutstanding: 50e6 };

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

  it("ignores a share count tagged a thousand times too big", () => {
    // Sun Healthcare: 25.3 million shares read as 25.3 billion made an $8.50 offer a $215B deal.
    const m = computeMultiples({ valueUsd: null, valueKind: null, pricePerShare: 8.5 }, { ...fin, sharesOutstanding: 25.27e9 });
    expect(m.impliedEquityUsd).toBeNull();
    expect(m.enterpriseValueUsd).toBeNull();
    // Nor does price × shares alone make a $100B+ deal.
    expect(computeMultiples({ valueUsd: null, valueKind: null, pricePerShare: 90 }, { ...fin, sharesOutstanding: 12e9 }).impliedEquityUsd).toBeNull();
  });
});

describe("EBITDA fallbacks and freshness", () => {
  const year = (val: number, y = 2025) => f(`${y}-01-01`, `${y}-12-31`, val);

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
    const aes = { revenueLtm: 12e9, ebitdaLtm: 2.9e9, adjustedEbitdaLtm: 2.9e9, debt: null, cash: 1.5e9, sharesOutstanding: 712e6, interestLtm: 1.4e9 };
    expect(computeMultiples({ valueUsd: 10.8e9, valueKind: "equity", pricePerShare: null }, aes).enterpriseValueUsd).toBeNull();
    // A stated enterprise value still stands.
    expect(computeMultiples({ valueUsd: 38e9, valueKind: "enterprise", pricePerShare: null }, aes).evEbitda).toBe(13.1);
  });
});

describe("full D&A", () => {
  const asOf = "2026-08-15";
  const fy = (val: number) => f("2025-01-01", "2025-12-31", val);
  const h1 = (val: number) => f("2026-01-01", "2026-06-30", val);
  const h1Before = (val: number) => f("2025-01-01", "2025-06-30", val);
  const operating = { OperatingIncomeLoss: [fy(100e6), h1(60e6), h1Before(60e6)] };

  it("takes the big tag beside a small one, which the first tag on a tie used to hide (RealPage)", () => {
    const cf = facts({ ...operating, DepreciationDepletionAndAmortization: [fy(30e6)], DepreciationAndAmortization: [fy(115e6)] });
    expect(ebitdaOf(cf, asOf)).toBe(215e6);
  });

  it("takes an amortization tag above a small D&A tag (Informatica), and depreciation plus amortization above it", () => {
    expect(ebitdaOf(facts({ ...operating, DepreciationDepletionAndAmortization: [fy(15e6)], AmortizationOfIntangibleAssets: [fy(126e6)] }), asOf)).toBe(226e6);
    expect(ebitdaOf(facts({ ...operating, DepreciationDepletionAndAmortization: [fy(30e6)], Depreciation: [fy(40e6)], AmortizationOfIntangibleAssets: [fy(60e6)] }), asOf)).toBe(200e6);
  });

  it("ignores another reading above 60% of revenue (Chart's mistagged 2,772 against a real 270)", () => {
    const cf = facts({
      ...operating,
      Revenues: [fy(4000e6)],
      DepreciationDepletionAndAmortization: [fy(2772e6)],
      DepreciationAndAmortization: [fy(270e6), h1(140e6), h1Before(130e6)], // the latest data, so the first figure
    });
    expect(ebitdaOf(cf, asOf)).toBe(100e6 + 280e6);
  });

  it("keeps the first figure above 60% of revenue: it can be real, or revenue a sub-line (Pattern Energy, Triton)", () => {
    const cf = facts({ OperatingIncomeLoss: [fy(1044e6)], Revenues: [fy(148e6)], DepreciationDepletionAndAmortization: [fy(635e6)] });
    expect(ebitdaOf(cf, asOf)).toBe(1679e6);
  });

  it("treats a D&A tag's year to date as a floor when it has no full year (Citrix)", () => {
    const cf = facts({ ...operating, Revenues: [fy(3000e6)], Depreciation: [fy(65e6)], DepreciationDepletionAndAmortization: [h1(247e6)] });
    expect(ebitdaOf(cf, asOf)).toBe(347e6);
  });

  it("doesn't make D&A out of an amortization line alone: blank, as before", () => {
    expect(ebitdaOf(facts({ ...operating, AmortizationOfIntangibleAssets: [fy(126e6)] }), asOf)).toBeNull();
  });

  it("doesn't let a tag with only a full year beat the true LTM (Warner Bros. Discovery)", () => {
    const da = [fy(1000e6), h1(400e6), h1Before(600e6)]; // LTM 800
    // A second D&A tag and the parts, all on FY2025 only: 1,000 at most, which is no more than the first tag's own year.
    expect(ebitdaOf(facts({ ...operating, DepreciationDepletionAndAmortization: da, DepreciationAndAmortization: [fy(1000e6)] }), asOf)).toBe(900e6);
    expect(ebitdaOf(facts({ ...operating, DepreciationDepletionAndAmortization: da, Depreciation: [fy(300e6)], AmortizationOfIntangibleAssets: [fy(700e6)] }), asOf)).toBe(900e6);
    // Clearly above that year: another reading of the whole figure, so it counts.
    expect(ebitdaOf(facts({ ...operating, DepreciationDepletionAndAmortization: da, DepreciationAndAmortization: [fy(1500e6)] }), asOf)).toBe(1600e6);
    // With no year to date anywhere there's no LTM to stand against.
    const noQuarters = { OperatingIncomeLoss: [fy(100e6)], DepreciationDepletionAndAmortization: [fy(30e6)], DepreciationAndAmortization: [fy(115e6)] };
    expect(ebitdaOf(facts(noQuarters), asOf)).toBe(215e6);
  });

  it("doesn't add amortization to a depreciation tag equal to the D&A total (Bally's)", () => {
    const cf = facts({ OperatingIncomeLoss: [fy(100e6)], DepreciationDepletionAndAmortization: [fy(350e6)], Depreciation: [fy(350e6)], AmortizationOfIntangibleAssets: [fy(236e6)] });
    expect(ebitdaOf(cf, asOf)).toBe(450e6);
    // Depreciation apart from a smaller total: the parts are the fuller reading (Accuride, Sapiens).
    expect(ebitdaOf(facts({ OperatingIncomeLoss: [fy(100e6)], DepreciationDepletionAndAmortization: [fy(300e6)], Depreciation: [fy(350e6)], AmortizationOfIntangibleAssets: [fy(236e6)] }), asOf)).toBe(686e6);
    // A small amortization line is left alone: it can sit outside a depreciation-only tag.
    expect(ebitdaOf(facts({ OperatingIncomeLoss: [fy(100e6)], DepreciationDepletionAndAmortization: [fy(350e6)], Depreciation: [fy(350e6)], AmortizationOfIntangibleAssets: [fy(50e6)] }), asOf)).toBe(500e6);
  });

  it("reads DA_OTHER as a higher reading, never as the only one", () => {
    expect(ebitdaOf(facts({ OperatingIncomeLoss: [fy(100e6)], DepreciationDepletionAndAmortization: [fy(30e6)], OtherDepreciationAndAmortization: [fy(90e6)] }), asOf)).toBe(190e6);
    expect(ebitdaOf(facts({ OperatingIncomeLoss: [fy(100e6)], OtherDepreciationAndAmortization: [fy(90e6)] }), asOf)).toBeNull();
  });
});

describe("adjusted EBITDA", () => {
  const asOf = "2026-08-15";
  const fy = (val: number) => f("2025-01-01", "2025-12-31", val);
  const h1 = (val: number) => f("2026-01-01", "2026-06-30", val);
  const h1Before = (val: number) => f("2025-01-01", "2025-06-30", val);
  const operating = { OperatingIncomeLoss: [fy(100e6), h1(60e6), h1Before(60e6)], DepreciationDepletionAndAmortization: [fy(50e6)] };

  it("adds the largest impairment tag, never the sum: the total usually includes its parts (CMC)", () => {
    const cf = facts({ ...operating, GoodwillImpairmentLoss: [fy(227e6)], AssetImpairmentCharges: [fy(230e6)] });
    expect(ebitdaOf(cf, asOf)).toBe(150e6);
    expect(adjustedEbitdaOf(cf, asOf)).toBe(150e6 + 230e6);
  });

  it("takes a combined restructuring-and-impairment tag instead of the two groups, never on top (Berry, Rogers)", () => {
    // Berry tags the same figure both ways.
    expect(adjustedEbitdaOf(facts({ ...operating, RestructuringCharges: [fy(161e6)], RestructuringCostsAndAssetImpairmentCharges: [fy(161e6)] }), asOf)).toBe(150e6 + 161e6);
    // Rogers: the combined 13 is restructuring 12.3 plus impairment 0.6 (rounded).
    expect(adjustedEbitdaOf(facts({ ...operating, RestructuringCharges: [fy(12.3e6)], AssetImpairmentCharges: [fy(0.6e6)], RestructuringSettlementAndImpairmentProvisions: [fy(13e6)] }), asOf)).toBe(150e6 + 13e6);
    // The two groups can be the larger.
    expect(adjustedEbitdaOf(facts({ ...operating, RestructuringCharges: [fy(20e6)], GoodwillImpairmentLoss: [fy(50e6)], RestructuringCostsAndAssetImpairmentCharges: [fy(20e6)] }), asOf)).toBe(150e6 + 70e6);
  });

  it("reads every tag of a group: the later restructuring, deal-cost and stock-compensation tags", () => {
    expect(adjustedEbitdaOf(facts({ ...operating, SeveranceCosts1: [fy(10e6)] }), asOf)).toBe(160e6);
    expect(adjustedEbitdaOf(facts({ ...operating, MergerRelatedCosts: [fy(10e6)] }), asOf)).toBe(160e6);
    expect(adjustedEbitdaOf(facts({ ...operating, AllocatedShareBasedCompensationExpense: [fy(10e6)] }), asOf)).toBe(160e6);
  });

  it("adds restructuring, deal costs and stock compensation", () => {
    const cf = facts({ ...operating, RestructuringCharges: [fy(10e6)], BusinessCombinationAcquisitionRelatedCosts: [fy(5e6)], ShareBasedCompensation: [fy(60e6)] });
    expect(adjustedEbitdaOf(cf, asOf)).toBe(225e6);
    // Reported EBITDA stays as it was.
    expect(financialsFrom(cf, asOf)).toMatchObject({ ebitdaLtm: 150e6, adjustedEbitdaLtm: 225e6 });
  });

  it("reads stock compensation over the LTM window", () => {
    expect(adjustedEbitdaOf(facts({ ...operating, ShareBasedCompensation: [fy(60e6), h1(40e6), h1Before(30e6)] }), asOf)).toBe(150e6 + 70e6);
    // The full year when its other half is missing: a year to date with nothing to subtract would double count.
    expect(adjustedEbitdaOf(facts({ ...operating, ShareBasedCompensation: [fy(60e6), h1(40e6)] }), asOf)).toBe(150e6 + 60e6);
    // No full year: what the two halves say.
    expect(adjustedEbitdaOf(facts({ ...operating, ShareBasedCompensation: [h1(40e6), h1Before(30e6)] }), asOf)).toBe(150e6 + 10e6);
  });

  it("counts a one-off with no year-to-date tag only for the part inside the LTM (US Ecology)", () => {
    const impairment = [fy(404.9e6), h1Before(300.3e6)];
    // ltm() can't tell: with no year to date it returns the whole year.
    expect(ltm(impairment)).toBe(404.9e6);
    expect(adjustedEbitdaOf(facts({ ...operating, GoodwillImpairmentLoss: impairment }), asOf)).toBeCloseTo(150e6 + 104.6e6, -3);
  });

  it("counts a one-off tagged only this year to date, or only a year before", () => {
    expect(adjustedEbitdaOf(facts({ ...operating, RestructuringCharges: [h1(20e6)] }), asOf)).toBe(170e6);
    // In the prior half only: it left the LTM with that half, and nothing is added.
    expect(adjustedEbitdaOf(facts({ ...operating, RestructuringCharges: [h1Before(20e6)] }), asOf)).toBe(150e6);
  });

  it("takes the window from operating income or revenue, the latest either has", () => {
    const cf = facts({ OperatingIncomeLoss: [fy(100e6)], Revenues: [fy(900e6), h1(500e6), h1Before(450e6)] });
    expect(anchorOf(cf, asOf)).toMatchObject({ year: { end: "2025-12-31" }, ytd: { end: "2026-06-30" }, prior: { end: "2025-06-30" } });
    expect(anchorOf(facts({ OperatingIncomeLoss: [f("2020-01-01", "2020-12-31", 100e6)] }), asOf)).toBeNull();
  });

  it("works for a company with only pre-tax income (Solera)", () => {
    const cf = facts({
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: [fy(300e6)],
      InterestExpense: [fy(50e6)],
      DepreciationDepletionAndAmortization: [fy(100e6)],
      ShareBasedCompensation: [fy(20e6)],
    });
    expect(adjustedEbitdaOf(cf, asOf)).toBe(470e6);
  });

  it("blanks EV / EBITDA when one-offs are over 4x the rest, and keeps the reported multiple", () => {
    const small = { OperatingIncomeLoss: [fy(10e6)], DepreciationDepletionAndAmortization: [fy(10e6)] };
    expect(adjustedEbitdaOf(facts({ ...small, GoodwillImpairmentLoss: [fy(80e6)] }), asOf)).toBe(100e6);
    const cf = facts({ ...small, GoodwillImpairmentLoss: [fy(81e6)] });
    expect(adjustedEbitdaOf(cf, asOf)).toBeNull();
    const m = computeMultiples({ valueUsd: 500e6, valueKind: "enterprise", pricePerShare: null }, financialsFrom(cf, asOf));
    expect(m.evEbitda).toBeNull();
    expect(m.evEbitdaReported).toBe(25);
  });

  it("puts EV / EBITDA on adjusted EBITDA and the reported multiple beside it", () => {
    const cf = facts({ ...operating, ShareBasedCompensation: [fy(50e6)] });
    const m = computeMultiples({ valueUsd: 2e9, valueKind: "enterprise", pricePerShare: null }, financialsFrom(cf, asOf));
    expect(m.evEbitda).toBe(10);
    expect(m.evEbitdaReported).toBe(13.3);
  });

  it("leaves a loss-maker blank whatever its add-backs", () => {
    const cf = facts({ OperatingIncomeLoss: [fy(-50e6)], DepreciationDepletionAndAmortization: [fy(10e6)], GoodwillImpairmentLoss: [fy(100e6)], ShareBasedCompensation: [fy(30e6)] });
    const fin = financialsFrom(cf, asOf);
    expect(fin.ebitdaLtm).toBe(-40e6);
    expect(fin.adjustedEbitdaLtm).toBe(90e6);
    const m = computeMultiples({ valueUsd: 500e6, valueKind: "enterprise", pricePerShare: null }, fin);
    expect(m.evEbitda).toBeNull();
    expect(m.evEbitdaReported).toBeNull();
    // Zero is no better.
    expect(computeMultiples({ valueUsd: 500e6, valueKind: "enterprise", pricePerShare: null }, { ...fin, ebitdaLtm: 0 }).evEbitda).toBeNull();
  });

  it("blanks EV / EBITDA over 50x while the reported multiple keeps its 3-75x band", () => {
    const deal = { valueUsd: 1e9, valueKind: "enterprise" as const, pricePerShare: null };
    const fin = { revenueLtm: 500e6, debt: null, cash: null, sharesOutstanding: null };
    const over = computeMultiples(deal, { ...fin, ebitdaLtm: 15e6, adjustedEbitdaLtm: 18e6 });
    expect(over.evEbitda).toBeNull();
    expect(over.evEbitdaReported).toBe(66.7);
    // Right at the top of each band.
    expect(computeMultiples(deal, { ...fin, ebitdaLtm: 15e6, adjustedEbitdaLtm: 20e6 }).evEbitda).toBe(50);
    // Under 3x on the adjusted figure: blank too.
    expect(computeMultiples(deal, { ...fin, ebitdaLtm: 300e6, adjustedEbitdaLtm: 400e6 })).toMatchObject({ evEbitda: null, evEbitdaReported: 3.3 });
  });

  it("doesn't fill a blank: reported EBITDA over 75x stays blank, even when the adjusted figure fits", () => {
    const m = computeMultiples({ valueUsd: 1e9, valueKind: "enterprise", pricePerShare: null }, { revenueLtm: 500e6, ebitdaLtm: 5e6, adjustedEbitdaLtm: 40e6, debt: null, cash: null, sharesOutstanding: null });
    expect(m.evEbitda).toBeNull();
    expect(m.evEbitdaReported).toBeNull();
  });

  it("gives banks neither multiple", () => {
    const m = computeMultiples({ valueUsd: 450e6, valueKind: "equity", pricePerShare: null }, { revenueLtm: 500e6, ebitdaLtm: 100e6, adjustedEbitdaLtm: 110e6, debt: 4e9, cash: 1e8, sharesOutstanding: 50e6 }, { sic: "6022", name: "A Bank" });
    expect(m).toMatchObject({ evEbitda: null, evEbitdaReported: null });
  });
});
