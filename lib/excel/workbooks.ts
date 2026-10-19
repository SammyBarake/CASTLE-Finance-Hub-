/**
 * The Excel workbook behind each page's Export menu, from the same rows the page (and its CSV) shows. Pure: `site` is
 * the address the links point to (the browser passes its own origin).
 */
import { companyHref, hasCompanyPage } from "../companies";
import { dealSize, type DcfRow } from "../precedents";
import { SECTORS } from "../sectors";
import type { Company, Deal, Economy, Ipo, LeagueTableEntry, SectorValuation } from "../types";
import type { VolumeMatrix } from "../metrics";
import { fileName, link, num, pctFrac, usdM, type CellValue, type Column, type Figure, type WorkbookSpec } from "./spec";

export interface ExportContext {
  asOf: string;
  isSample: boolean;
  /** The site's address for links back to Castle, e.g. "https://castle.example". */
  site: string;
}

const today = (ctx: ExportContext) => ctx.asOf.slice(0, 10);
const stamp = (ctx: ExportContext, ...parts: (string | null | undefined)[]) => fileName("Castle", ...parts, ctx.isSample ? "Sample" : null, today(ctx));
const companyCell = (c: Company, ctx: ExportContext): CellValue => (hasCompanyPage(c) ? link(c.name, `${ctx.site}${companyHref(c)}`) : c.name);
const filingCell = (d: { filings?: { url: string }[] }, text = "SEC filing"): CellValue => link(text, d.filings?.[0]?.url ?? null);
const yesNo = (v: boolean | null | undefined) => (v == null ? null : v ? "Yes" : "No");
const quarterLabel = (q: string) => q.replace(/^(\d{4})-Q(\d)$/, "Q$2 $1");

const DEAL_NOTES = [
  "Deal value is the headline transaction value as announced; enterprise value adds the target's net debt (none for banks, insurers and brokers).",
  "Premium is over the unaffected or last closing price only; premiums over VWAPs or 52-week highs are left out.",
];

// ---------------------------------------------------------------------------
// Deals: Hub, Deal Flow, company pages, the compare dialog
// ---------------------------------------------------------------------------

export const DEAL_COLUMNS: Column[] = [
  { header: "Announced", format: "date" },
  { header: "Acquirer", format: "text", width: 30 },
  { header: "Acquirer ticker", format: "text", width: 9 },
  { header: "Target", format: "text", width: 30 },
  { header: "Target ticker", format: "text", width: 9 },
  { header: "Target type", format: "text", width: 10 },
  { header: "Sector", format: "text", width: 12 },
  { header: "Industry", format: "text", width: 26 },
  { header: "Status", format: "text", width: 11 },
  { header: "Consideration", format: "text", width: 13 },
  { header: "Deal value ($M)", format: "usdM", summary: true },
  { header: "Enterprise value ($M)", format: "usdM", summary: true },
  { header: "Offer price ($)", format: "price" },
  { header: "Premium", format: "pct", summary: true },
  { header: "EV / Revenue", format: "multiple", summary: true },
  { header: "EV / EBITDA", format: "multiple", summary: true },
  { header: "Acquirer advisors", format: "text", width: 30 },
  { header: "Target advisors", format: "text", width: 30 },
  { header: "Source", format: "text", width: 12 },
  { header: "Castle", format: "text", width: 11 },
];

export function dealRow(d: Deal, ctx: ExportContext): CellValue[] {
  return [
    d.announcedDate,
    companyCell(d.acquirer, ctx),
    d.acquirer.ticker,
    companyCell(d.target, ctx),
    d.target.ticker,
    d.privateTarget ? "Private" : "Public",
    d.sector,
    d.industry,
    d.status,
    d.consideration,
    usdM(d.valueUsd),
    usdM(d.enterpriseValueUsd),
    num(d.pricePerShare),
    pctFrac(d.premiumPct),
    num(d.evRevenue),
    num(d.evEbitda),
    d.acquirerAdvisors.join("; ") || null,
    d.targetAdvisors.join("; ") || null,
    filingCell(d),
    link("Tear sheet", `${ctx.site}/tearsheet/deal/${encodeURIComponent(d.id)}`),
  ];
}

const dealFigures = (sheet: string): Figure[] => [
  { label: "Transactions", sheet, column: "Announced", agg: "count" },
  { label: "Total deal value ($M)", sheet, column: "Deal value ($M)", agg: "sum" },
  { label: "Median deal value ($M)", sheet, column: "Deal value ($M)", agg: "median" },
  { label: "Median premium", sheet, column: "Premium", agg: "median" },
  { label: "Median EV / EBITDA", sheet, column: "EV / EBITDA", agg: "median" },
  { label: "Median EV / Revenue", sheet, column: "EV / Revenue", agg: "median" },
];

export function dealsWorkbook(
  deals: Deal[],
  ctx: ExportContext,
  opts: { title: string; subtitle: string; sheet?: string; file: string; selection?: string[]; summary?: boolean },
): WorkbookSpec {
  const sheet = opts.sheet ?? "Deals";
  return {
    fileName: stamp(ctx, opts.file),
    title: opts.title,
    subtitle: opts.subtitle,
    asOf: ctx.asOf,
    isSample: ctx.isSample,
    selection: opts.selection,
    figures: dealFigures(sheet),
    sheets: [
      {
        name: sheet,
        title: opts.title,
        subtitle: `${deals.length.toLocaleString("en-US")} transactions · in the order shown on Castle`,
        columns: DEAL_COLUMNS,
        rows: deals.map((d) => dealRow(d, ctx)),
        summary: opts.summary,
      },
    ],
    notes: DEAL_NOTES,
  };
}

// ---------------------------------------------------------------------------
// Precedent transactions: the comps sheet, with summary formulas, and the banks' DCFs
// ---------------------------------------------------------------------------

export function precedentsWorkbook(deals: Deal[], dcf: DcfRow[], ctx: ExportContext, opts: { subtitle: string; selection: string[]; sector: string }): WorkbookSpec {
  const comps: Column[] = [
    { header: "Announced", format: "date" },
    { header: "Target", format: "text", width: 30 },
    { header: "Acquirer", format: "text", width: 28 },
    { header: "Sector", format: "text", width: 12 },
    { header: "Industry", format: "text", width: 26 },
    { header: "Status", format: "text", width: 10 },
    { header: "Consideration", format: "text", width: 12 },
    { header: "Deal size ($M)", format: "usdM", summary: true },
    { header: "EV / Revenue", format: "multiple", summary: true },
    { header: "EV / EBITDA", format: "multiple", summary: true },
    { header: "Premium", format: "pct", summary: true },
    { header: "Offer price ($)", format: "price" },
    { header: "Source", format: "text", width: 12 },
  ];
  const sheets: WorkbookSpec["sheets"] = [
    {
      name: "Precedents",
      title: "Precedent Transactions",
      subtitle: opts.subtitle,
      columns: comps,
      rows: deals.map((d) => [
        d.announcedDate,
        companyCell(d.target, ctx),
        companyCell(d.acquirer, ctx),
        d.sector,
        d.industry,
        d.status,
        d.consideration,
        usdM(dealSize(d)),
        num(d.evRevenue),
        num(d.evEbitda),
        pctFrac(d.premiumPct),
        num(d.pricePerShare),
        filingCell(d),
      ]),
      summary: true,
      notes: ["Deal size is enterprise value where known, else the headline deal value. Delete a row to drop an outlier: the summary rows recalculate."],
    },
  ];
  if (dcf.length)
    sheets.push({
      name: "Bank DCFs",
      title: "What the target banks' DCFs said",
      subtitle: "The target-side fairness opinion's discounted cash flow range per share, against the offer",
      columns: [
        { header: "Announced", format: "date" },
        { header: "Target", format: "text", width: 30 },
        { header: "Bank", format: "text", width: 24 },
        { header: "Offer price ($)", format: "price" },
        { header: "DCF low ($)", format: "price" },
        { header: "DCF high ($)", format: "price" },
        { header: "DCF midpoint ($)", format: "price" },
        { header: "Offer vs. midpoint", format: "pct", summary: true },
        { header: "Discount rate (mid)", format: "pct", summary: true },
        { header: "Terminal growth (mid)", format: "pct", summary: true },
      ],
      rows: dcf.map((r) => [
        r.deal.announcedDate,
        companyCell(r.deal.target, ctx),
        r.dcf.bank,
        num(r.deal.pricePerShare),
        r.dcf.low,
        r.dcf.high,
        (r.dcf.low + r.dcf.high) / 2,
        pctFrac(r.vsMid),
        pctFrac(r.discountMid),
        pctFrac(r.growthMid),
      ]),
      summary: true,
      notes: ["From each target's merger proxy (the bank's opinion section). Discount rate and terminal growth are the midpoints of the ranges the bank used."],
    });
  return {
    fileName: stamp(ctx, "Precedents", opts.sector === "all" ? null : opts.sector),
    title: "Precedent Transactions",
    subtitle: opts.subtitle,
    asOf: ctx.asOf,
    isSample: ctx.isSample,
    selection: [...opts.selection, `Precedents: ${deals.length}`],
    figures: [
      { label: "Precedents", sheet: "Precedents", column: "Announced", agg: "count" },
      { label: "Median deal size ($M)", sheet: "Precedents", column: "Deal size ($M)", agg: "median" },
      { label: "Median EV / Revenue", sheet: "Precedents", column: "EV / Revenue", agg: "median" },
      { label: "Median EV / EBITDA", sheet: "Precedents", column: "EV / EBITDA", agg: "median" },
      { label: "Median premium", sheet: "Precedents", column: "Premium", agg: "median" },
    ],
    sheets,
    notes: DEAL_NOTES,
  };
}

// ---------------------------------------------------------------------------
// League table, IPO pipeline, deal terms
// ---------------------------------------------------------------------------

export function leagueWorkbook(rows: { e: LeagueTableEntry; rank: number }[], ctx: ExportContext, opts: { period: string; by: "value" | "deals"; selection: string[] }): WorkbookSpec {
  return {
    fileName: stamp(ctx, "League_Table"),
    title: "M&A League Table",
    subtitle: `U.S. M&A financial advisors · ${opts.period} · ranked by ${opts.by === "value" ? "deal value" : "deal count"}`,
    asOf: ctx.asOf,
    isSample: ctx.isSample,
    selection: opts.selection,
    figures: [
      { label: "Advisors", sheet: "League table", column: "Advisor", agg: "count" },
      { label: "Advisory mandates", sheet: "League table", column: "Deals advised", agg: "sum" },
      { label: "Gross advised value ($M)", sheet: "League table", column: "Deal value ($M)", agg: "sum" },
    ],
    sheets: [
      {
        name: "League table",
        title: "M&A League Table",
        subtitle: `${opts.period} · ranked by ${opts.by === "value" ? "deal value" : "deal count"} · rank change vs. the prior quarter end`,
        columns: [
          { header: "Rank", format: "int", width: 7 },
          { header: "Rank change", format: "change", width: 9 },
          { header: "Advisor", format: "text", width: 28 },
          { header: "Deals advised", format: "int", width: 11 },
          { header: "Deal value ($M)", format: "usdM" },
          { header: "Average deal ($M)", format: "usdM" },
        ],
        rows: rows.map(({ e, rank }) => [
          rank,
          (opts.by === "value" ? e.rankChange : e.dealCountRankChange) ?? 0,
          e.advisor.name,
          e.dealCount,
          usdM(e.dealValueUsd),
          e.dealCount ? usdM(e.dealValueUsd / e.dealCount) : null,
        ]),
      },
    ],
    notes: ["Every named financial advisor is credited with the full deal value, so totals include shared mandates and don't add up to market volume."],
  };
}

export function iposWorkbook(ipos: Ipo[], ctx: ExportContext, opts: { selection: string[] }): WorkbookSpec {
  return {
    fileName: stamp(ctx, "IPO_Pipeline"),
    title: "IPO Pipeline",
    subtitle: "U.S. initial public offerings from SEC registration statements and final prospectuses",
    asOf: ctx.asOf,
    isSample: ctx.isSample,
    selection: opts.selection,
    figures: [
      { label: "Companies", sheet: "IPO pipeline", column: "Company", agg: "count" },
      { label: "Expected raise ($M)", sheet: "IPO pipeline", column: "Expected raise ($M)", agg: "sum" },
      { label: "Median raise ($M)", sheet: "IPO pipeline", column: "Expected raise ($M)", agg: "median" },
    ],
    sheets: [
      {
        name: "IPO pipeline",
        title: "IPO Pipeline",
        subtitle: `${ipos.length} companies · in the order shown on Castle`,
        columns: [
          { header: "Company", format: "text", width: 32 },
          { header: "Ticker", format: "text", width: 9 },
          { header: "Sector", format: "text", width: 12 },
          { header: "Industry", format: "text", width: 26 },
          { header: "Stage", format: "text", width: 9 },
          { header: "Filed", format: "date" },
          { header: "Priced", format: "date" },
          { header: "Offer price ($)", format: "price" },
          { header: "Expected raise ($M)", format: "usdM" },
          { header: "Underwriters", format: "text", width: 40 },
          { header: "Latest filing", format: "text", width: 13 },
        ],
        rows: ipos.map((i) => [
          companyCell(i.company, ctx),
          i.company.ticker,
          i.sector,
          i.industry,
          i.stage,
          i.filedDate,
          i.pricedDate,
          num(i.offerPrice),
          usdM(i.expectedRaiseUsd),
          i.underwriters.join("; ") || null,
          link("SEC filing", i.filings.at(-1)?.url ?? null),
        ]),
      },
    ],
    notes: ["Expected raise is the offer price times the shares offered (the base deal, without the over-allotment); before pricing, the registration's estimate."],
  };
}

export function termsWorkbook(
  rows: { deal: Deal; targetFeePct: number | null; reverseFeePct: number | null }[],
  ctx: ExportContext,
  opts: { selection: string[] },
): WorkbookSpec {
  return {
    fileName: stamp(ctx, "Deal_Terms"),
    title: "Deal Terms",
    subtitle: "Break fees, go-shops and financing in U.S. public-target M&A",
    asOf: ctx.asOf,
    isSample: ctx.isSample,
    selection: opts.selection,
    figures: [
      { label: "Deals", sheet: "Deal terms", column: "Announced", agg: "count" },
      { label: "Median break fee (% of value)", sheet: "Deal terms", column: "Break fee (% of value)", agg: "median" },
      { label: "Median reverse fee (% of value)", sheet: "Deal terms", column: "Reverse fee (% of value)", agg: "median" },
    ],
    sheets: [
      {
        name: "Deal terms",
        title: "Deal Terms",
        subtitle: `${rows.length} deals · from merger 8-Ks and merger proxies`,
        columns: [
          { header: "Announced", format: "date" },
          { header: "Target", format: "text", width: 30 },
          { header: "Acquirer", format: "text", width: 28 },
          { header: "Deal value ($M)", format: "usdM" },
          { header: "Break fee ($M)", format: "usdM" },
          { header: "Break fee (% of value)", format: "pct", summary: true },
          { header: "Reverse fee ($M)", format: "usdM" },
          { header: "Reverse fee (% of value)", format: "pct", summary: true },
          { header: "Go-shop", format: "text", width: 9 },
          { header: "Go-shop days", format: "int", width: 9 },
          { header: "Financing condition", format: "text", width: 11 },
          { header: "Financing banks", format: "text", width: 34 },
          { header: "Source", format: "text", width: 12 },
        ],
        rows: rows.map(({ deal: d, targetFeePct, reverseFeePct }) => [
          d.announcedDate,
          companyCell(d.target, ctx),
          companyCell(d.acquirer, ctx),
          usdM(d.valueUsd),
          usdM(d.terms?.targetFeeUsd),
          pctFrac(targetFeePct),
          usdM(d.terms?.reverseFeeUsd),
          pctFrac(reverseFeePct),
          yesNo(d.terms?.goShop),
          num(d.terms?.goShopDays),
          yesNo(d.terms?.financingCondition),
          d.terms?.financingBanks.join("; ") || null,
          filingCell(d),
        ]),
        summary: true,
      },
    ],
    notes: ["Break fee: what the target pays, e.g. if it takes a better offer. Reverse fee: what the buyer pays, e.g. if financing or approval fails."],
  };
}

// ---------------------------------------------------------------------------
// Valuation medians, monthly volume, world economies
// ---------------------------------------------------------------------------

export function valuationsWorkbook(valuations: SectorValuation[], quarters: string[], ctx: ExportContext): WorkbookSpec {
  const metric = (title: string, name: string, pick: (v: SectorValuation) => number | null, format: "multiple" | "pct", sample: (v: SectorValuation) => number) => ({
    name,
    title,
    subtitle: "Trailing-twelve-month median of the deals announced in each quarter and the three before · blank under 3 deals",
    columns: [{ header: "Sector", format: "text" as const, width: 14 }, ...quarters.map((q) => ({ header: quarterLabel(q), format, width: 10 })), { header: "Deals behind latest", format: "int" as const, width: 11 }],
    rows: SECTORS.map((s) => {
      const at = (q: string) => valuations.find((v) => v.sector === s && v.quarter === q);
      const latest = at(quarters.at(-1) ?? "");
      return [s, ...quarters.map((q) => {
        const v = at(q);
        const x = v ? pick(v) : null;
        return format === "pct" ? pctFrac(x) : num(x);
      }), latest ? sample(latest) : null];
    }),
  });
  return {
    fileName: stamp(ctx, "Valuations"),
    title: "Transaction Valuations",
    subtitle: "Median EV / EBITDA, EV / Revenue and premium paid by sector, quarter by quarter",
    asOf: ctx.asOf,
    isSample: ctx.isSample,
    sheets: [
      metric("Median EV / EBITDA", "EV-EBITDA", (v) => v.medianEvEbitda, "multiple", (v) => v.sample.evEbitda),
      metric("Median EV / Revenue", "EV-Revenue", (v) => v.medianEvRevenue, "multiple", (v) => v.sample.evRevenue),
      metric("Median premium paid", "Premium", (v) => v.medianPremiumPct, "pct", (v) => v.sample.premium),
    ],
    notes: ["Multiples cover public targets with EV and LTM financials; none for banks and insurers, or loss-making targets (EV / EBITDA)."],
  };
}

export function volumeWorkbook(matrix: VolumeMatrix, range: number, ctx: ExportContext): WorkbookSpec {
  const months = matrix.months.slice(-range);
  const at = (s: (typeof SECTORS)[number], key: "value" | "count", i: number) => matrix.bySector[s][key].slice(-range)[i] ?? 0;
  const sheet = (key: "value" | "count") => ({
    name: key === "value" ? "Deal value" : "Deal count",
    title: key === "value" ? "Announced M&A value by sector ($M)" : "Announced M&A transactions by sector",
    subtitle: `${months[0] ?? ""} to ${months.at(-1) ?? ""} · terminated deals excluded${matrix.partial && months.includes(matrix.partial) ? ` · ${matrix.partial} is the month to date` : ""}`,
    columns: [
      { header: "Month", format: "date" as const },
      ...SECTORS.map((s) => ({ header: s, format: key === "value" ? ("usdM" as const) : ("int" as const), width: 12 })),
      { header: "Total", format: key === "value" ? ("usdM" as const) : ("int" as const), width: 12 },
    ],
    rows: months.map((m, i) => {
      const vals = SECTORS.map((s) => (key === "value" ? usdM(at(s, key, i)) ?? 0 : at(s, key, i)));
      const total = vals.reduce((a, b) => a + b, 0);
      return [`${m}-01`, ...vals, key === "value" ? Math.round(total * 10) / 10 : total];
    }),
  });
  return {
    fileName: stamp(ctx, "Deal_Volume"),
    title: "Deal Volume",
    subtitle: "Monthly announced U.S. M&A by target sector",
    asOf: ctx.asOf,
    isSample: ctx.isSample,
    figures: [
      { label: "Total value ($M)", sheet: "Deal value", column: "Total", agg: "sum" },
      { label: "Transactions", sheet: "Deal count", column: "Total", agg: "sum" },
      { label: "Monthly average value ($M)", sheet: "Deal value", column: "Total", agg: "average" },
    ],
    sheets: [sheet("value"), sheet("count")],
    notes: ["Each deal counts in the month it was announced, in its target's sector; value is the headline transaction value."],
  };
}

export function economiesWorkbook(rows: Economy[], year: number, ctx: ExportContext, opts: { selection: string[] }): WorkbookSpec {
  return {
    fileName: stamp(ctx, "World_Economies"),
    title: "World Economies",
    subtitle: "GDP growth, inflation and central-bank policy rates",
    asOf: ctx.asOf,
    isSample: ctx.isSample,
    selection: opts.selection,
    sheets: [
      {
        name: "Economies",
        title: "World Economies",
        subtitle: `IMF World Economic Outlook (${year} is an estimate) · BIS policy rates`,
        columns: [
          { header: "Economy", format: "text", width: 18 },
          { header: "Region", format: "text", width: 13 },
          { header: `GDP growth ${year - 1}`, format: "pct" },
          { header: `GDP growth ${year} (est.)`, format: "pct" },
          { header: `Inflation ${year - 1}`, format: "pct" },
          { header: `Inflation ${year} (est.)`, format: "pct" },
          { header: "Policy rate", format: "pct2" },
          { header: "Policy rate as of", format: "date" },
        ],
        rows: rows.map((e) => [e.name, e.region, pctFrac(e.gdpGrowthPrior), pctFrac(e.gdpGrowth), pctFrac(e.inflationPrior), pctFrac(e.inflation), e.policyRate == null ? null : e.policyRate / 100, e.policyRateDate]),
      },
    ],
    notes: ["Sources: International Monetary Fund, World Economic Outlook (DataMapper); Bank for International Settlements, central bank policy rates."],
  };
}
