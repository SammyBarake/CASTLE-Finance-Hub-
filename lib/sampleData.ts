/**
 * SAMPLE DATA: the only place illustrative numbers live.
 *
 * Every company, transaction and figure here is fictional. Bank names identify
 * real institutions, but their activity and rankings here are made up.
 *
 * The shape matches lib/types.ts exactly, so replacing this with real SEC data
 * (Task 2) is a change to lib/data.ts only. Nothing in components/ imports this file.
 */
import type {
  Deal,
  HubData,
  Ipo,
  LeagueTable,
  Macro,
  MonthlySectorVolume,
  Sector,
  SectorValuation,
} from "./types";

const B = 1e9;
const M = 1e6;

const company = (name: string, ticker: string | null = null) => ({ name, ticker, cik: null });

// Fields the sample deals don't vary.
type SampleDeal = Omit<Deal, "industry" | "statusDate" | "enterpriseValueUsd" | "evEbitda" | "evRevenue">;
const withDealDefaults = (d: SampleDeal): Deal => ({
  ...d,
  industry: null,
  statusDate: null,
  enterpriseValueUsd: null,
  evEbitda: null,
  evRevenue: null,
});

// ---------------------------------------------------------------------------
// Feature 1: deal flow
// ---------------------------------------------------------------------------

const sampleDeals: SampleDeal[] = [
  {
    id: "d-2026-0924-clcd",
    announcedDate: "2026-09-24",
    acquirer: company("Asterion Systems", "ASTN"),
    target: company("ClarityCloud", "CLCD"),
    valueUsd: 8.4 * B,
    pricePerShare: 62.5,
    premiumPct: 34.2,
    consideration: "Mixed",
    sector: "Tech",
    status: "Announced",
    acquirerAdvisors: ["Goldman Sachs"],
    targetAdvisors: ["Evercore"],
    filings: [],
  },
  {
    id: "d-2026-0924-nvra",
    announcedDate: "2026-09-24",
    acquirer: company("Helix Therapeutics", "HLXT"),
    target: company("Novara Biosciences", "NVRA"),
    valueUsd: 6.75 * B,
    pricePerShare: 48.0,
    premiumPct: 42.8,
    consideration: "Cash",
    sector: "Healthcare",
    status: "Announced",
    acquirerAdvisors: ["Morgan Stanley"],
    targetAdvisors: ["Centerview"],
    filings: [],
  },
  {
    id: "d-2026-0923-cplf",
    announcedDate: "2026-09-23",
    acquirer: company("Meridian Energy", "MRDE"),
    target: company("Copperleaf Resources", "CPLF"),
    valueUsd: 4.2 * B,
    pricePerShare: 31.75,
    premiumPct: 18.6,
    consideration: "Stock",
    sector: "Energy",
    status: "Pending",
    acquirerAdvisors: ["JPMorgan"],
    targetAdvisors: ["Lazard"],
    filings: [],
  },
  {
    id: "d-2026-0922-nlbk",
    announcedDate: "2026-09-22",
    acquirer: company("Summit Financial Group", "SMFG"),
    target: company("Northline Bancorp", "NLBK"),
    valueUsd: 3.1 * B,
    pricePerShare: 41.2,
    premiumPct: 27.5,
    consideration: "Mixed",
    sector: "Financials",
    status: "Announced",
    acquirerAdvisors: ["Goldman Sachs"],
    targetAdvisors: ["PJT Partners"],
    filings: [],
  },
  {
    id: "d-2026-0921-vctr",
    announcedDate: "2026-09-21",
    acquirer: company("Atlas Industrial", "ATLI"),
    target: company("Vector Motion", "VCTR"),
    valueUsd: 2.85 * B,
    pricePerShare: 27.4,
    premiumPct: 23.1,
    consideration: "Cash",
    sector: "Industrials",
    status: "Pending",
    acquirerAdvisors: ["Evercore"],
    targetAdvisors: ["Morgan Stanley"],
    filings: [],
  },
  {
    id: "d-2026-0918-sgfg",
    announcedDate: "2026-09-18",
    acquirer: company("Vantage Networks", "VNTG"),
    target: company("SignalForge", "SGFG"),
    valueUsd: 1.9 * B,
    pricePerShare: 18.9,
    premiumPct: 31.8,
    consideration: "Mixed",
    sector: "Tech",
    status: "Announced",
    acquirerAdvisors: ["JPMorgan"],
    targetAdvisors: ["Centerview"],
    filings: [],
  },
  {
    id: "d-2026-0917-cddx",
    announcedDate: "2026-09-17",
    acquirer: company("Aurelia Health", "AURH"),
    target: company("Cedar Diagnostics", "CDDX"),
    valueUsd: 1.65 * B,
    pricePerShare: 22.15,
    premiumPct: 29.4,
    consideration: "Cash",
    sector: "Healthcare",
    status: "Pending",
    acquirerAdvisors: ["Lazard"],
    targetAdvisors: ["PJT Partners"],
    filings: [],
  },
  {
    id: "d-2026-0814-hbrp",
    announcedDate: "2026-08-14",
    acquirer: company("Sterling Capital", "STRC"),
    target: company("HarborPoint Holdings", "HBRP"),
    valueUsd: 1.25 * B,
    pricePerShare: 15.6,
    premiumPct: 21.7,
    consideration: "Cash",
    sector: "Financials",
    status: "Closed",
    acquirerAdvisors: ["Morgan Stanley"],
    targetAdvisors: ["Evercore"],
    filings: [],
  },
  {
    id: "d-2026-0730-axlg",
    announcedDate: "2026-07-30",
    acquirer: company("Westbridge Industries", "WBRI"),
    target: company("Axion Logistics", "AXLG"),
    valueUsd: 0.98 * B,
    pricePerShare: 12.3,
    premiumPct: 24.6,
    consideration: "Mixed",
    sector: "Industrials",
    status: "Closed",
    acquirerAdvisors: ["Goldman Sachs"],
    targetAdvisors: ["Lazard"],
    filings: [],
  },
];

const deals = sampleDeals.map(withDealDefaults);

// ---------------------------------------------------------------------------
// Feature 2: deal volume. 24 months, Sep 2024 – Aug 2026.
// Compact per-sector series below are expanded into MonthlySectorVolume rows.
// ---------------------------------------------------------------------------

const VOLUME_START = { year: 2024, month: 9 };

const volumeSeries: Record<Sector, { valueB: number[]; count: number[] }> = {
  Tech: {
    valueB: [28, 34, 31, 42, 37, 35, 46, 41, 44, 38, 47, 43, 45, 50, 46, 55, 48, 51, 57, 52, 60, 55, 54, 64],
    count: [36, 40, 38, 46, 42, 41, 48, 45, 47, 44, 50, 47, 50, 54, 52, 61, 55, 59, 65, 61, 66, 62, 60, 68],
  },
  Healthcare: {
    valueB: [20, 22, 19, 26, 24, 21, 29, 25, 28, 23, 30, 27, 29, 32, 28, 34, 31, 30, 35, 32, 38, 34, 33, 36],
    count: [27, 29, 26, 32, 30, 28, 35, 31, 34, 29, 36, 33, 34, 37, 33, 40, 36, 35, 41, 38, 43, 39, 37, 40],
  },
  Energy: {
    valueB: [18, 16, 22, 20, 25, 23, 19, 26, 21, 27, 24, 22, 25, 28, 23, 27, 25, 22, 28, 24, 26, 23, 24, 21],
    count: [21, 19, 25, 23, 27, 26, 22, 28, 24, 29, 26, 24, 28, 30, 26, 29, 27, 24, 30, 27, 28, 25, 26, 23],
  },
  Financials: {
    valueB: [15, 18, 16, 21, 18, 17, 23, 20, 22, 19, 24, 22, 24, 27, 23, 29, 26, 24, 30, 28, 31, 29, 28, 32],
    count: [23, 25, 23, 29, 26, 25, 31, 28, 30, 27, 33, 31, 32, 36, 32, 38, 35, 33, 39, 37, 41, 38, 37, 42],
  },
  Industrials: {
    valueB: [23, 25, 22, 29, 26, 24, 31, 27, 30, 26, 32, 29, 31, 34, 30, 36, 33, 31, 37, 34, 39, 36, 37, 35],
    count: [29, 32, 28, 36, 33, 31, 38, 34, 37, 32, 39, 36, 38, 42, 37, 44, 41, 39, 46, 42, 47, 44, 43, 41],
  },
};

function monthKey(offset: number): string {
  const d = new Date(Date.UTC(VOLUME_START.year, VOLUME_START.month - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const monthlyVolume: MonthlySectorVolume[] = Object.entries(volumeSeries).flatMap(([sector, s]) =>
  s.valueB.map((v, i) => ({
    month: monthKey(i),
    sector: sector as Sector,
    dealValueUsd: v * B,
    dealCount: s.count[i],
  })),
);

// ---------------------------------------------------------------------------
// Feature 3: IPO pipeline
// ---------------------------------------------------------------------------

const sampleIpos: Omit<Ipo, "industry">[] = [
  {
    id: "ipo-lmna",
    company: company("Lumina Data", "LMNA"),
    sector: "Tech",
    stage: "Filed",
    filedDate: "2026-09-23",
    pricedDate: null,
    expectedRaiseUsd: 850 * M,
    offerPrice: null,
    underwriters: ["Goldman Sachs", "Morgan Stanley"],
    description: "Cloud-native data infrastructure and enterprise analytics.",
    filings: [],
  },
  {
    id: "ipo-vrdn",
    company: company("Veridian Therapeutics", "VRDN"),
    sector: "Healthcare",
    stage: "Filed",
    filedDate: "2026-09-21",
    pricedDate: null,
    expectedRaiseUsd: 425 * M,
    offerPrice: null,
    underwriters: ["JPMorgan", "Goldman Sachs"],
    description: "A clinical-stage platform developing precision therapies.",
    filings: [],
  },
  {
    id: "ipo-nsgd",
    company: company("Northstar Grid", "NSGD"),
    sector: "Energy",
    stage: "Filed",
    filedDate: "2026-09-18",
    pricedDate: null,
    expectedRaiseUsd: 620 * M,
    offerPrice: null,
    underwriters: ["Morgan Stanley", "Barclays"],
    description: "Grid-scale storage systems and power infrastructure.",
    filings: [],
  },
  {
    id: "ipo-frma",
    company: company("Forma Financial", "FRMA"),
    sector: "Financials",
    stage: "Priced",
    filedDate: "2026-09-14",
    pricedDate: "2026-09-24",
    expectedRaiseUsd: 1100 * M,
    offerPrice: 24.0,
    underwriters: ["JPMorgan", "Citigroup"],
    description: "Digital payments, treasury management and business banking.",
    filings: [],
  },
  {
    id: "ipo-kntc",
    company: company("Kinetic Automation", "KNTC"),
    sector: "Industrials",
    stage: "Filed",
    filedDate: "2026-09-10",
    pricedDate: null,
    expectedRaiseUsd: 540 * M,
    offerPrice: null,
    underwriters: ["Goldman Sachs", "Barclays"],
    description: "Industrial robotics and intelligent factory systems.",
    filings: [],
  },
  {
    id: "ipo-prln",
    company: company("Parallel Networks", "PRLN"),
    sector: "Tech",
    stage: "Trading",
    filedDate: "2026-08-27",
    pricedDate: "2026-09-17",
    expectedRaiseUsd: 780 * M,
    offerPrice: 19.0,
    underwriters: ["Morgan Stanley", "JPMorgan"],
    description: "Enterprise networking, edge computing and connectivity.",
    filings: [],
  },
];

const ipos: Ipo[] = sampleIpos.map((i) => ({ ...i, industry: null }));

// ---------------------------------------------------------------------------
// Feature 4: who's advising
// ---------------------------------------------------------------------------

const leagueTable: LeagueTable = {
  period: "2026 YTD",
  entries: [
    { advisor: { name: "Goldman Sachs", shortName: "GS" }, dealCount: 94, dealValueUsd: 286.4 * B, rankChange: 1 },
    { advisor: { name: "Morgan Stanley", shortName: "MS" }, dealCount: 86, dealValueUsd: 248.7 * B, rankChange: -1 },
    { advisor: { name: "JPMorgan", shortName: "JPM" }, dealCount: 91, dealValueUsd: 231.2 * B, rankChange: 0 },
    { advisor: { name: "Evercore", shortName: "EVR" }, dealCount: 57, dealValueUsd: 174.8 * B, rankChange: 2 },
    { advisor: { name: "Centerview", shortName: "CVP" }, dealCount: 38, dealValueUsd: 156.3 * B, rankChange: 2 },
    { advisor: { name: "Lazard", shortName: "LAZ" }, dealCount: 62, dealValueUsd: 142.6 * B, rankChange: -2 },
    { advisor: { name: "PJT Partners", shortName: "PJT" }, dealCount: 34, dealValueUsd: 98.5 * B, rankChange: -2 },
  ],
};

// ---------------------------------------------------------------------------
// Feature 5: valuation moves. 8 quarters, Q4 2024 – Q3 2026.
// ---------------------------------------------------------------------------

const QUARTERS = ["2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"];

const valuationSeries: Record<Sector, { evEbitda: number[]; evRevenue: number[]; premium: number[]; deals: number[] }> = {
  Tech: {
    evEbitda: [14.8, 15.2, 15.0, 16.2, 15.9, 16.9, 17.2, 18.4],
    evRevenue: [5.6, 5.8, 5.7, 6.1, 6.0, 6.3, 6.4, 6.8],
    premium: [30.1, 31.4, 30.8, 32.6, 31.9, 33.5, 33.0, 34.2],
    deals: [114, 131, 140, 141, 156, 168, 181, 124],
  },
  Healthcare: {
    evEbitda: [12.3, 12.8, 12.5, 13.2, 12.9, 13.7, 13.6, 14.2],
    evRevenue: [3.9, 4.0, 3.9, 4.2, 4.1, 4.3, 4.3, 4.5],
    premium: [38.2, 39.0, 38.5, 40.3, 39.7, 41.6, 41.2, 42.8],
    deals: [82, 91, 94, 98, 104, 112, 120, 77],
  },
  Energy: {
    evEbitda: [8.7, 8.4, 8.7, 8.1, 8.5, 8.0, 8.2, 7.8],
    evRevenue: [1.9, 1.8, 1.9, 1.7, 1.8, 1.7, 1.8, 1.6],
    premium: [21.4, 20.8, 21.1, 19.9, 20.3, 19.6, 19.2, 18.6],
    deals: [67, 76, 81, 79, 84, 81, 79, 49],
  },
  Financials: {
    evEbitda: [9.7, 10.1, 10.5, 10.2, 10.8, 11.3, 11.1, 11.6],
    evRevenue: [2.8, 2.9, 3.0, 2.9, 3.1, 3.2, 3.2, 3.3],
    premium: [24.0, 24.6, 25.1, 24.8, 25.9, 26.7, 26.4, 27.5],
    deals: [75, 82, 85, 91, 100, 106, 116, 79],
  },
  Industrials: {
    evEbitda: [10.8, 10.4, 10.6, 10.2, 10.7, 10.4, 10.5, 10.3],
    evRevenue: [1.9, 1.8, 1.9, 1.8, 1.9, 1.8, 1.9, 1.8],
    premium: [22.8, 22.1, 22.6, 21.9, 23.0, 22.4, 23.4, 23.1],
    deals: [96, 103, 108, 107, 117, 126, 133, 84],
  },
};

const valuations: SectorValuation[] = Object.entries(valuationSeries).flatMap(([sector, s]) =>
  QUARTERS.map((quarter, i) => ({
    quarter,
    sector: sector as Sector,
    medianEvEbitda: s.evEbitda[i],
    medianEvRevenue: s.evRevenue[i],
    medianPremiumPct: s.premium[i],
    dealCount: s.deals[i],
  })),
);

// ---------------------------------------------------------------------------
// World Economies (illustrative)
// ---------------------------------------------------------------------------

const macro: Macro = {
  asOf: "2026-09-24T22:00:00Z",
  forecastYear: 2026,
  economies: [
    { code: "US", name: "United States", region: "Americas", gdpGrowth: 2.1, gdpGrowthPrior: 2.4, inflation: 2.6, inflationPrior: 2.9, policyRate: 4.0, policyRateDate: "2026-09-24" },
    { code: "CA", name: "Canada", region: "Americas", gdpGrowth: 1.7, gdpGrowthPrior: 1.4, inflation: 2.2, inflationPrior: 2.4, policyRate: 2.75, policyRateDate: "2026-09-24" },
    { code: "EA", name: "Euro area", region: "Europe", gdpGrowth: 1.3, gdpGrowthPrior: 0.9, inflation: 2.1, inflationPrior: 2.4, policyRate: 2.25, policyRateDate: "2026-09-24" },
    { code: "UK", name: "United Kingdom", region: "Europe", gdpGrowth: 1.5, gdpGrowthPrior: 1.1, inflation: 2.8, inflationPrior: 3.3, policyRate: 3.75, policyRateDate: "2026-09-24" },
    { code: "JP", name: "Japan", region: "Asia-Pacific", gdpGrowth: 0.9, gdpGrowthPrior: 1.0, inflation: 2.3, inflationPrior: 2.7, policyRate: 0.75, policyRateDate: "2026-09-24" },
    { code: "CN", name: "China", region: "Asia-Pacific", gdpGrowth: 4.4, gdpGrowthPrior: 4.8, inflation: 1.1, inflationPrior: 0.4, policyRate: 3.0, policyRateDate: "2026-09-24" },
  ],
};

// ---------------------------------------------------------------------------

export const sampleHubData: HubData = {
  asOf: "2026-09-24T22:00:00Z",
  isSample: true,
  totalDeals: deals.length,
  deals,
  monthlyVolume,
  ipos,
  leagueTable,
  valuations,
  macro,
};
