import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "./build";
import { colLetter, pctFrac, percentileInc, sheetName, summaryResult, usdM, type WorkbookSpec } from "./spec";
import { dealRow, DEAL_COLUMNS, precedentsWorkbook } from "./workbooks";
import { SUMMARY_ROWS, summarizeComps } from "../precedents";
import type { Deal } from "../types";

describe("spreadsheet helpers", () => {
  it("names columns and tabs the way Excel does", () => {
    expect([1, 26, 27, 52, 53, 702, 703].map(colLetter)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
    const taken = new Set<string>();
    expect(sheetName("Deals: Tech [2026]", taken)).toBe("Deals Tech 2026");
    expect(sheetName("Deals Tech 2026", taken)).toBe("Deals Tech 2026 2");
    expect(sheetName("A".repeat(40))).toHaveLength(31);
  });

  it("stores money in $M, percentages as fractions, and summary results like Excel", () => {
    expect(usdM(59_500_000_000)).toBe(59_500);
    expect(usdM(1_234_567)).toBe(1.2);
    expect(usdM(null)).toBeNull();
    expect(pctFrac(34.2)).toBeCloseTo(0.342);
    // PERCENTILE.INC on 1..5: 25th = 2, 75th = 4; on 1, 2, 10: median 2, 75th 6.
    expect(percentileInc([5, 1, 3, 2, 4], 0.25)).toBe(2);
    expect(summaryResult("p75", [1, 2, 10])).toBe(6);
    expect(summaryResult("mean", [1, 2, 3])).toBe(2);
    expect(summaryResult("median", [])).toBeNull();
  });
});

const deal = (over: Partial<Deal>): Deal =>
  ({
    id: "1-2026-01-05",
    announcedDate: "2026-01-05",
    acquirer: { name: "Acme Corp", ticker: "ACME", cik: "1" },
    target: { name: "Widget Inc", ticker: "WDGT", cik: "2" },
    valueUsd: 2_000_000_000,
    pricePerShare: 25,
    premiumPct: 30,
    consideration: "Cash",
    sector: "Tech",
    industry: "Software",
    status: "Closed",
    statusDate: null,
    enterpriseValueUsd: 2_500_000_000,
    evEbitda: 12.5,
    evRevenue: 3.1,
    acquirerAdvisors: ["Goldman Sachs"],
    targetAdvisors: ["Morgan Stanley"],
    filings: [{ form: "8-K", filedDate: "2026-01-05", url: "https://www.sec.gov/Archives/edgar/data/2/x.htm" }],
    targetFeeUsd: null,
    reverseFeeUsd: null,
    goShop: null,
    goShopDays: null,
    ...over,
  }) as Deal;

const ctx = { asOf: "2026-10-19T12:00:00Z", isSample: false, site: "https://castle.test" };

describe("deal rows", () => {
  it("line up with the columns, in spreadsheet units, with links back to the filing and Castle", () => {
    const row = dealRow(deal({}), ctx);
    expect(row).toHaveLength(DEAL_COLUMNS.length);
    const at = (header: string) => row[DEAL_COLUMNS.findIndex((c) => c.header === header)];
    expect(at("Deal value ($M)")).toBe(2000);
    expect(at("Premium")).toBeCloseTo(0.3);
    expect(at("Target")).toEqual({ text: "Widget Inc", link: "https://castle.test/company/2" });
    expect(at("Source")).toEqual({ text: "SEC filing", link: "https://www.sec.gov/Archives/edgar/data/2/x.htm" });
    expect(at("Castle")).toEqual({ text: "Tear sheet", link: "https://castle.test/tearsheet/deal/1-2026-01-05" });
  });
});

describe("buildWorkbook", () => {
  it("writes a cover, a styled comps table and live summary formulas that Excel can read back", async () => {
    const deals = [deal({ evEbitda: 10 }), deal({ id: "b", evEbitda: 14, premiumPct: 40 }), deal({ id: "c", evEbitda: null, premiumPct: 20 })];
    const spec: WorkbookSpec = precedentsWorkbook(deals, [], ctx, { subtitle: "Tech · last 3 years", selection: ["Sector: Tech"], sector: "Tech" });
    const wb = buildWorkbook(ExcelJS, spec, { origin: "https://castle.test" });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());

    expect(back.worksheets.map((w) => w.name)).toEqual(["Summary", "Precedents"]);
    const ws = back.getWorksheet("Precedents")!;
    // Title band, header row 4, data from row 5.
    expect(ws.getCell("A1").value).toBe("Precedent Transactions");
    expect(ws.getCell("A4").value).toBe("Announced");
    expect(ws.getCell("A5").value).toBeInstanceOf(Date);
    expect((ws.getCell("A5").value as Date).toISOString().slice(0, 10)).toBe("2026-01-05");
    const ev = 10; // "EV / EBITDA" is the comps sheet's 10th column (J)
    expect(ws.getCell(4, ev).value).toBe("EV / EBITDA");
    expect(ws.getCell(5, ev).numFmt).toBe('0.0"x"');
    expect(ws.getCell("K6").value).toBeCloseTo(0.4);
    expect(ws.getCell("K6").numFmt).toBe("0.0%");
    expect(ws.getCell("B5").value).toMatchObject({ text: "Widget Inc", hyperlink: "https://castle.test/company/2" });
    // Summary rows two below the last data row (7): High at 9, Median at 12, with formulas and cached results.
    expect(ws.getCell("A12").value).toBe("Median");
    expect(ws.getCell("J12").value).toMatchObject({ formula: 'IFERROR(MEDIAN(J5:J7),"")', result: 12 });
    expect(ws.getCell("J10").value).toMatchObject({ formula: 'IFERROR(PERCENTILE.INC(J5:J7,0.75),"")', result: 13 });
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 4 });

    const cover = back.getWorksheet("Summary")!;
    const cells = cover.getSheetValues().flat(2).filter(Boolean);
    expect(cells).toContain("KEY FIGURES");
    const median = cover.getColumn(3).values.find((v) => typeof v === "object" && v !== null && "formula" in v && /EV \/ EBITDA|J5:J7/.test(String((v as { formula: string }).formula)));
    expect(median).toMatchObject({ formula: "IFERROR(MEDIAN('Precedents'!J5:J7),\"\")", result: 12 });
  });

  it("gives the same summary figures as the Precedents page", async () => {
    const deals = [
      deal({ id: "a", enterpriseValueUsd: 900_000_000, evEbitda: 8.2, evRevenue: 1.4, premiumPct: 22.5 }),
      deal({ id: "b", enterpriseValueUsd: 4_100_000_000, evEbitda: 19.6, evRevenue: 6.3, premiumPct: 61 }),
      deal({ id: "c", enterpriseValueUsd: 1_750_000_000, evEbitda: null, evRevenue: 2.9, premiumPct: null }),
      deal({ id: "d", enterpriseValueUsd: 12_000_000_000, evEbitda: 14.1, evRevenue: 4.4, premiumPct: 35.8 }),
      deal({ id: "e", enterpriseValueUsd: null, valueUsd: 300_000_000, evEbitda: 11, evRevenue: null, premiumPct: 18 }),
    ];
    const wb = buildWorkbook(ExcelJS, precedentsWorkbook(deals, [], ctx, { subtitle: "x", selection: [], sector: "all" }), { origin: "https://castle.test" });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());
    const ws = back.getWorksheet("Precedents")!;
    const page = summarizeComps(deals);
    const result = (row: number, col: string) => (ws.getCell(`${col}${row}`).value as { result: number }).result;
    // Data rows 5–9, then High at 11 … Low at 16, in the page's order.
    SUMMARY_ROWS.forEach(({ key, label }, i) => {
      const row = 11 + i;
      expect(ws.getCell(`A${row}`).value).toBe(label);
      expect(result(row, "H")).toBeCloseTo(page.size[key]! / 1e6, 0);
      expect(result(row, "I")).toBeCloseTo(page.evRevenue[key]!, 6);
      expect(result(row, "J")).toBeCloseTo(page.evEbitda[key]!, 6);
      expect(result(row, "K")).toBeCloseTo(page.premium[key]! / 100, 6);
    });
  });

  it("marks sample data on the cover", async () => {
    const spec = precedentsWorkbook([deal({})], [], { ...ctx, isSample: true }, { subtitle: "x", selection: [], sector: "all" });
    const wb = buildWorkbook(ExcelJS, spec, { origin: "https://castle.test" });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());
    const text = back.getWorksheet("Summary")!.getSheetValues().flat(2).filter((v) => typeof v === "string").join(" ");
    expect(text).toMatch(/SAMPLE DATA/);
    expect(spec.fileName).toMatch(/^Castle_Precedents_Sample_2026-10-19$/);
  });
});
