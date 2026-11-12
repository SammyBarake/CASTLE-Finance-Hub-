import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "./build";
import { colLetter, pctFrac, percentileInc, sheetName, summaryResult, usdM, type WorkbookSpec } from "./spec";
import { bookWorkbook, companyWorkbook, dealRow, DEAL_COLUMNS, economiesWorkbook, precedentsWorkbook, valuationsWorkbook } from "./workbooks";
import { ADJ_EBITDA_DEFINITION, REPORTED_EBITDA_DEFINITION } from "../metrics";
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
    expect(usdM(1_234_567)).toBe(1.234567);
    expect(usdM(250_000)).toBe(0.25);
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
    const deals = [deal({ evEbitda: 10, evEbitdaReported: 69.5 }), deal({ id: "b", evEbitda: 14, premiumPct: 40 }), deal({ id: "c", evEbitda: null, premiumPct: 20 })];
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
    const ev = 10; // "EV / Adj. EBITDA" is the comps sheet's 10th column (J), "EV / Reported EBITDA" the 11th (K)
    expect(ws.getCell(4, ev).value).toBe("EV / Adj. EBITDA");
    expect(ws.getCell(5, ev).numFmt).toBe('0.0"x"');
    expect(ws.getCell(4, ev + 1).value).toBe("EV / Reported EBITDA");
    expect(ws.getCell(5, ev + 1).value).toBe(69.5);
    expect(ws.getCell(5, ev + 1).numFmt).toBe('0.0"x"');
    expect(ws.getCell(6, ev + 1).value).toBeNull(); // a deal without one stays an empty cell
    expect(ws.getCell("L6").value).toBeCloseTo(0.4);
    expect(ws.getCell("L6").numFmt).toBe("0.0%");
    expect(ws.getCell("B5").value).toMatchObject({ text: "Widget Inc", hyperlink: "https://castle.test/company/2" });
    // Summary rows two below the last data row (7): High at 9, Median at 12, with formulas and cached results.
    expect(ws.getCell("A12").value).toBe("Median");
    expect(ws.getCell("J12").value).toMatchObject({ formula: 'IFERROR(MEDIAN(J5:J7),"")', result: 12 });
    expect(ws.getCell("J10").value).toMatchObject({ formula: 'IFERROR(_xlfn.PERCENTILE.INC(J5:J7,0.75),"")', result: 13 });
    // Every function in the file is one Excel 2007 knows, or carries the _xlfn. prefix newer ones need in the file
    // (without it Excel reads #NAME?, which IFERROR hid as a blank 25th / 75th percentile row).
    const OLD = new Set(["IFERROR", "MAX", "MIN", "AVERAGE", "MEDIAN", "SUM", "ROWS", "COUNT"]);
    for (const sheet of back.worksheets)
      sheet.eachRow((row) =>
        row.eachCell((c) => {
          const f = (c.value as { formula?: string } | null)?.formula;
          for (const [, name] of f?.matchAll(/(?<![\w.])([A-Z][A-Z0-9.]*)\(/g) ?? []) expect(OLD.has(name), `${name} in ${f}`).toBe(true);
        }),
      );
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 4 });

    const cover = back.getWorksheet("Summary")!;
    const cells = cover.getSheetValues().flat(2).filter(Boolean);
    expect(cells).toContain("KEY FIGURES");
    const median = cover.getColumn(3).values.find((v) => typeof v === "object" && v !== null && "formula" in v && /EV \/ Adj\. EBITDA|J5:J7/.test(String((v as { formula: string }).formula)));
    expect(median).toMatchObject({ formula: "IFERROR(MEDIAN('Precedents'!J5:J7),\"\")", result: 12 });
    expect(cells).toContain("Median EV / Adj. EBITDA");
    // The one definition, under the table and among the cover's notes.
    expect(cells).toContain(ADJ_EBITDA_DEFINITION);
    expect(ws.getSheetValues().flat(2)).toEqual(expect.arrayContaining([ADJ_EBITDA_DEFINITION, REPORTED_EBITDA_DEFINITION]));
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
      expect(result(row, "L")).toBeCloseTo(page.premium[key]! / 100, 6);
    });
  });

  it("exports a deal book with its thesis on the cover and the author's comments", async () => {
    const rows = [
      { item: { dealId: "1-2026-01-05", note: "Anchor comp", label: "Acme Corp → Widget Inc", date: "2026-01-05" }, deal: deal({ evEbitda: 16 }) },
      { item: { dealId: "gone", note: "", label: "Old Buyer → Old Target", date: "2024-02-01" }, deal: null },
    ];
    const spec = bookWorkbook({ title: "Software take-privates", thesis: "Sponsors paid up.\nRecurring revenue drove it.", byline: "J. Analyst" }, rows, ctx);
    expect(spec.fileName).toBe("Castle_Deal_book_Software_take-privates_2026-10-19");
    expect(spec.subtitle).toBe("Deal book by J. Analyst · 2 deals");
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await buildWorkbook(ExcelJS, spec, { origin: "https://castle.test" }).xlsx.writeBuffer());
    const cover = back.getWorksheet("Summary")!.getSheetValues().flat(2).filter((v) => typeof v === "string");
    expect(cover).toEqual(expect.arrayContaining(["THESIS", "Sponsors paid up.", "Recurring revenue drove it."]));
    const ws = back.getWorksheet("Deals")!;
    const comment = (ws.getRow(4).values as unknown[]).indexOf("Comment");
    expect(ws.getRow(5).getCell(comment).value).toBe("Anchor comp");
    expect(ws.getRow(6).getCell(2).value).toBe("Old Buyer → Old Target");
    expect(ws.getRow(6).getCell(5).value).toBe("Not in Castle's data");
  });

  it("puts a company's purchases and its own sale on separate sheets, the cover's figures over purchases only", async () => {
    const spec = companyWorkbook(
      "Acme Corp",
      "ACME · Tech",
      [
        { deal: deal({ id: "p1", valueUsd: 1e9, premiumPct: 30 }), role: "Acquirer" },
        { deal: deal({ id: "p2", valueUsd: 3e9, premiumPct: 50 }), role: "Acquirer" },
        { deal: deal({ id: "s1", valueUsd: 55e9, premiumPct: 25 }), role: "Target" },
      ],
      ctx,
    );
    expect(spec.sheets.map((s) => [s.name, s.rows.length])).toEqual([["Acquisitions", 2], ["As target", 1]]);
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await buildWorkbook(ExcelJS, spec, { origin: "https://castle.test" }).xlsx.writeBuffer());
    const cover = back.getWorksheet("Summary")!;
    const figure = (label: string) => {
      let out: unknown;
      cover.eachRow((r) => r.getCell(2).value === label && (out = (r.getCell(3).value as { result: unknown }).result));
      return out;
    };
    expect(figure("Disclosed value of acquisitions ($M)")).toBe(4000); // not 59,000 with its own sale
    expect(figure("Median premium paid")).toBeCloseTo(0.4);
    expect(figure("Deals as the target")).toBe(1);
  });

  it("labels a private target's industry as the buyer's", () => {
    const at = (d: Deal) => dealRow(d, ctx)[DEAL_COLUMNS.findIndex((c) => c.header === "Industry")];
    expect(at(deal({ industry: "Prepackaged Software" }))).toBe("Prepackaged Software");
    expect(at(deal({ industry: "Prepackaged Software", privateTarget: true }))).toBe("Buyer's: Prepackaged Software");
  });

  it("marks the quarter in progress on the valuation sheets", () => {
    const v = { sector: "Tech", quarter: "2026-Q4", medianEvEbitda: 12, medianEvRevenue: 3, medianPremiumPct: 30, sample: { evEbitda: 5, evRevenue: 6, premium: 7 } } as never;
    const spec = valuationsWorkbook([v], ["2026-Q3", "2026-Q4"], { ...ctx, asOf: "2026-11-12T03:00:00Z" });
    expect(spec.sheets[0].columns.map((c) => c.header)).toEqual(["Sector", "Q3 2026", "Q4 2026 (to date)", "Deals stating it (latest)"]);
    expect(spec.sheets[0].subtitle).toMatch(/Q4 2026 runs to Nov 11$/); // New York's day: 22:00 on the 11th
    const done = valuationsWorkbook([v], ["2026-Q3", "2026-Q4"], { ...ctx, asOf: "2026-12-31T20:00:00Z" });
    expect(done.sheets[0].columns[2].header).toBe("Q4 2026");
  });

  it("gives the economies workbook its own sources, not SEC filings, and the Fed's midpoint to three decimals", async () => {
    const e = { code: "US", name: "United States", region: "Americas", gdpGrowth: 2, gdpGrowthPrior: 2.8, inflation: 3, inflationPrior: 2.9, policyRate: 3.875, policyRateDate: "2026-10-30" } as never;
    const spec = economiesWorkbook([e], 2026, ctx, { selection: [] });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await buildWorkbook(ExcelJS, spec, { origin: "https://castle.test" }).xlsx.writeBuffer());
    const ws = back.getWorksheet("Economies")!;
    expect(String(ws.getCell("H2").value)).toMatch(/^IMF WEO · BIS · as of/);
    expect(ws.getCell("G5").value).toBeCloseTo(0.03875);
    expect(ws.getCell("G5").numFmt).toBe("0.00#%");
    const text = back.getWorksheet("Summary")!.getSheetValues().flat(2).filter((v) => typeof v === "string").join(" ");
    expect(text).not.toMatch(/SEC|filings|\$M/);
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
