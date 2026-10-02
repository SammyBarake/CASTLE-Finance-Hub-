/**
 * Monthly history tables for the what-if engine: one row per sector per month (sector ETF return, deals, deal
 * value, IPOs) and one row per month of macro series. Pure functions; the ingest's history job feeds them.
 *
 * Conventions (as in lib/types.ts): money is USD, percentages are whole numbers (2.5 = 2.5%), months are "YYYY-MM".
 */
import { SECTORS, type Sector, type ValueKind } from "./types";

export type { ValueKind };

/** The deal fields the monthly table needs. */
export interface HistoryDealInput {
  announcedDate: string;
  sector: Sector;
  status: string;
  valueUsd: number | null;
  valueKind: ValueKind | null;
}

export interface HistoryIpoInput {
  pricedDate: string;
  sector: Sector;
}

export interface SectorMonthRow {
  sector: Sector;
  month: string;
  etfTicker: string;
  /** Month-end close (unadjusted). */
  etfClose: number | null;
  /** Total return for the month (dividend-adjusted), whole %. Null when either month-end is missing. */
  etfReturnPct: number | null;
  /** Deals announced this month, terminated ones excluded (as the volume chart counts them). */
  dealCount: number;
  /** The one value type `dealValueUsd` sums ("transaction" = the headline value as announced). */
  dealValueKind: ValueKind;
  /** Sum of that value type, in `cpiBaseMonth` dollars. */
  dealValueUsd: number;
  /** Deals in that sum. */
  dealValueN: number;
  /** Deals left out: no disclosed value. */
  dealValueNullN: number;
  /** Deals left out: value of another type (equity / enterprise when summing transaction values). */
  dealValueOtherKindN: number;
  /** IPOs priced this month. */
  ipoCount: number;
  /** CPI month whose dollars `dealValueUsd` is in (the latest CPI published). */
  cpiBaseMonth: string;
}

export interface MacroMonthRow {
  month: string;
  fedFundsPct: number | null;
  treasury10yPct: number | null;
  /** ICE BofA US High Yield OAS. FRED only keeps about three years of it (ICE licence). */
  hySpreadPct: number | null;
  /** Moody's Baa corporate yield minus the 10-year Treasury: the credit spread with full history. */
  baaSpreadPct: number | null;
  vix: number | null;
  /** CPI-U, seasonally adjusted (1982–84 = 100). */
  cpi: number | null;
}

export interface EtfMonthInput {
  month: string;
  close: number;
  adjClose: number;
}

/** "2015-01" .. the month before `before`, inclusive. */
export function monthsBetween(from: string, before: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key >= before) return out;
    out.push(key);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Multiplier to today's dollars: CPI of the latest published month over CPI of `month`. A month after the latest CPI
 * counts at face value (1). A gap inside the series is interpolated between its neighbours: October 2025 CPI was never
 * published (the government shutdown).
 */
export function inflationFactor(cpi: Record<string, number>, month: string): { factor: number; base: string } {
  const months = Object.keys(cpi).sort();
  const base = months.at(-1);
  if (!base) return { factor: 1, base: month };
  let then = cpi[month];
  if (then == null && month < base) {
    const before = months.filter((m) => m < month).at(-1);
    const after = months.find((m) => m > month);
    if (before && after) {
      const span = monthsBetween(before, after).length;
      const step = monthsBetween(before, month).length;
      then = cpi[before] * (cpi[after] / cpi[before]) ** (step / span);
    }
  }
  return { factor: then ? cpi[base] / then : 1, base };
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

export function buildSectorMonthly(input: {
  deals: HistoryDealInput[];
  ipos: HistoryIpoInput[];
  etf: Partial<Record<Sector, EtfMonthInput[]>>;
  etfTickers: Record<Sector, string>;
  cpi: Record<string, number>;
  from: string;
  before: string;
  valueKind?: ValueKind;
}): SectorMonthRow[] {
  const kind = input.valueKind ?? "transaction";
  const months = monthsBetween(input.from, input.before);
  const key = (sector: string, month: string) => `${sector}|${month}`;
  const rows = new Map<string, SectorMonthRow>();
  for (const sector of SECTORS) {
    const bars = new Map((input.etf[sector] ?? []).map((b) => [b.month, b]));
    for (const month of months) {
      const bar = bars.get(month);
      // Month-end to month-end: the previous calendar month's bar (the one before `from` included).
      const prev = bars.get(previousMonth(month));
      rows.set(key(sector, month), {
        sector,
        month,
        etfTicker: input.etfTickers[sector],
        etfClose: bar?.close ?? null,
        etfReturnPct: bar && prev ? round((bar.adjClose / prev.adjClose - 1) * 100, 2) : null,
        dealCount: 0,
        dealValueKind: kind,
        dealValueUsd: 0,
        dealValueN: 0,
        dealValueNullN: 0,
        dealValueOtherKindN: 0,
        ipoCount: 0,
        cpiBaseMonth: inflationFactor(input.cpi, month).base,
      });
    }
  }
  for (const d of input.deals) {
    if (d.status === "Terminated") continue;
    const month = d.announcedDate.slice(0, 7);
    const row = rows.get(key(d.sector, month));
    if (!row) continue;
    row.dealCount++;
    if (d.valueUsd == null) row.dealValueNullN++;
    else if (d.valueKind !== kind) row.dealValueOtherKindN++;
    else {
      row.dealValueUsd += d.valueUsd * inflationFactor(input.cpi, month).factor;
      row.dealValueN++;
    }
  }
  for (const i of input.ipos) {
    const row = rows.get(key(i.sector, i.pricedDate.slice(0, 7)));
    if (row) row.ipoCount++;
  }
  for (const row of rows.values()) row.dealValueUsd = Math.round(row.dealValueUsd);
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || SECTORS.indexOf(a.sector) - SECTORS.indexOf(b.sector));
}

/** Coverage check for one year: merger-proxy / tender filers (PREM14A, DEFM14A, SC 14D9, SC 13E3) and how many have a deal. */
export interface YearCoverage {
  filers: number;
  matched: number;
  /** The same by the filer's sector (from its SIC code). */
  sectors?: Partial<Record<Sector, { filers: number; matched: number }>>;
}

export interface CoverageFlag {
  year: string;
  /** Recall against merger-proxy filers, whole % (null when not checked or too few filers). */
  recall: number | null;
  publicDeals: number;
  weak: boolean;
  reason: string | null;
}

/** Fewer filers than this in a sector-year and its recall says too little; the deal-count test is used instead. */
const MIN_SECTOR_FILERS = 5;

/**
 * Weak years and sector-years of the deal history. The live data (2021 to last year) is the reference; only earlier
 * years can be weak. A year is weak when its public-target deals fall under 70% of the reference median or its recall
 * under 80% of the reference recall. A sector-year is weak when its year is, when its own recall falls under 80% of
 * the sector's reference recall, or (with too few filers to judge recall) when its public-target deals fall under 50%
 * of the sector's reference median.
 */
export function coverageFlags(input: {
  coverage: Record<string, YearCoverage>;
  /** Public-target deals (terminated excluded) per year and sector. */
  publicDeals: Record<string, Partial<Record<Sector, number>>>;
  years: string[];
  currentYear: string;
}): { years: CoverageFlag[]; sectorYears: (CoverageFlag & { sector: Sector })[] } {
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  const pct = (c: { filers: number; matched: number } | undefined, min = 1) => (c && c.filers >= min ? Math.round((c.matched / c.filers) * 100) : null);
  const total = (y: string) => SECTORS.reduce((t, s) => t + (input.publicDeals[y]?.[s] ?? 0), 0);
  const refYears = input.years.filter((y) => y >= "2021" && y < input.currentYear);
  const ref = { pub: median(refYears.map(total)), recall: median(refYears.map((y) => pct(input.coverage[y])).filter((r): r is number => r != null)) };
  const checked = (y: string) => y < "2021" && y !== input.currentYear;

  const years = input.years.map((year): CoverageFlag => {
    const recall = pct(input.coverage[year]);
    const publicDeals = total(year);
    const reason = !checked(year)
      ? null
      : publicDeals < 0.7 * ref.pub
        ? `${publicDeals} public-target deals vs a reference of ${ref.pub}`
        : recall != null && ref.recall && recall < 0.8 * ref.recall
          ? `recall ${recall}% vs a reference of ${ref.recall}%`
          : null;
    return { year, recall, publicDeals, weak: reason != null, reason };
  });

  const sectorYears = SECTORS.flatMap((sector) => {
    const sref = {
      pub: median(refYears.map((y) => input.publicDeals[y]?.[sector] ?? 0)),
      recall: median(refYears.map((y) => pct(input.coverage[y]?.sectors?.[sector], MIN_SECTOR_FILERS)).filter((r): r is number => r != null)),
    };
    return years.map((y) => {
      const recall = pct(input.coverage[y.year]?.sectors?.[sector], MIN_SECTOR_FILERS);
      const publicDeals = input.publicDeals[y.year]?.[sector] ?? 0;
      const reason = !checked(y.year)
        ? null
        : y.weak
          ? `the whole year is weak (${y.reason})`
          : recall != null && sref.recall
            ? recall < 0.8 * sref.recall
              ? `recall ${recall}% vs a sector reference of ${sref.recall}%`
              : null
            : publicDeals < 0.5 * sref.pub
              ? `${publicDeals} public-target deals vs a sector reference of ${sref.pub}`
              : null;
      return { year: y.year, sector, recall, publicDeals, weak: reason != null, reason };
    });
  });
  return { years, sectorYears };
}

export function buildMacroMonthly(fred: Partial<Record<"fedFunds" | "treasury10y" | "hySpread" | "baaSpread" | "vix" | "cpi", Record<string, number>>>, from: string, before: string): MacroMonthRow[] {
  const get = (k: keyof typeof fred, m: string) => fred[k]?.[m] ?? null;
  return monthsBetween(from, before).map((month) => ({
    month,
    fedFundsPct: get("fedFunds", month),
    treasury10yPct: get("treasury10y", month),
    hySpreadPct: get("hySpread", month),
    baaSpreadPct: get("baaSpread", month),
    vix: get("vix", month),
    cpi: get("cpi", month),
  }));
}
