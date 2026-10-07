/**
 * Derived figures shown on the hub (KPIs, momentum, medians).
 * Pure functions over HubData so they work unchanged on real data.
 */
import type { Deal, HubData, Ipo, MonthlySectorVolume, Sector, SectorValuation } from "./types";
import { SECTORS } from "./types";

export type VolumeMetric = "value" | "count";

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const pctChange = (current: number, previous: number) => (previous ? (current / previous - 1) * 100 : 0);

export interface VolumeMatrix {
  /** Sorted "YYYY-MM" keys. */
  months: string[];
  /** Per sector, aligned to `months`. Missing months are 0. */
  bySector: Record<Sector, { value: number[]; count: number[] }>;
  /** The last month when it is still in progress ("2026-10"), else null. Left out of month-on-month comparisons. */
  partial: string | null;
}

/** How many months are complete (the month in progress, if any, is the last one). */
export const completeMonths = (m: VolumeMatrix) => m.months.length - (m.partial ? 1 : 0);

/** `partialMonth`: the current month ("YYYY-MM"), marked as in progress when the data ends with it. */
export function buildVolumeMatrix(rows: MonthlySectorVolume[], partialMonth: string | null = null): VolumeMatrix {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const index = new Map(months.map((m, i) => [m, i]));
  const bySector = Object.fromEntries(
    SECTORS.map((s) => [s, { value: months.map(() => 0), count: months.map(() => 0) }]),
  ) as VolumeMatrix["bySector"];
  for (const r of rows) {
    const i = index.get(r.month)!;
    bySector[r.sector].value[i] += r.dealValueUsd;
    bySector[r.sector].count[i] += r.dealCount;
  }
  return { months, bySector, partial: partialMonth && months.at(-1) === partialMonth ? partialMonth : null };
}

export interface YtdSummary {
  year: number;
  throughMonth: string;
  /** The exact day the year to date runs through ("2026-10-07"), when known. */
  throughDay: string | null;
  value: number;
  count: number;
  valueChangePct: number;
  countChangePct: number;
  /** Monthly totals across sectors for the YTD months (sparklines). */
  monthlyValue: number[];
  monthlyCount: number[];
}

/**
 * Year-to-date totals versus the same period a year earlier. With `toDate` (computed from deal dates) that is exact,
 * through the data's day, the month in progress included. Without it, complete months only.
 */
export function ytdSummary(matrix: VolumeMatrix, toDate?: HubData["yearToDate"]): YtdSummary | null {
  const latest = toDate ? matrix.months.at(-1) : matrix.months[completeMonths(matrix) - 1];
  if (!latest) return null;
  const year = Number(latest.slice(0, 4));
  const monthTotal = (i: number, key: "value" | "count") => sum(SECTORS.map((s) => matrix.bySector[s][key][i]));

  const current: number[] = [];
  const previous: number[] = [];
  matrix.months.forEach((m, i) => {
    const [y, mm] = [Number(m.slice(0, 4)), m.slice(5)];
    if (m > latest) return;
    if (y === year) current.push(i);
    else if (y === year - 1 && mm <= latest.slice(5)) previous.push(i);
  });

  const monthlyValue = current.map((i) => monthTotal(i, "value"));
  const monthlyCount = current.map((i) => monthTotal(i, "count"));
  if (toDate && toDate.through.slice(0, 4) === String(year)) {
    return {
      year,
      throughMonth: latest,
      throughDay: toDate.through,
      value: toDate.value,
      count: toDate.count,
      valueChangePct: pctChange(toDate.value, toDate.priorValue),
      countChangePct: pctChange(toDate.count, toDate.priorCount),
      monthlyValue,
      monthlyCount,
    };
  }
  const value = sum(monthlyValue);
  const count = sum(monthlyCount);
  return {
    year,
    throughMonth: latest,
    throughDay: null,
    value,
    count,
    valueChangePct: pctChange(value, sum(previous.map((i) => monthTotal(i, "value")))),
    countChangePct: pctChange(count, sum(previous.map((i) => monthTotal(i, "count")))),
    monthlyValue,
    monthlyCount,
  };
}

/** Latest complete month versus the month before, per sector (a month in progress isn't compared). */
export function sectorMomentum(matrix: VolumeMatrix, metric: VolumeMetric) {
  const n = completeMonths(matrix);
  return SECTORS.map((sector) => {
    const series = matrix.bySector[sector][metric];
    return { sector, changePct: n >= 2 ? pctChange(series[n - 1], series[n - 2]) : 0 };
  });
}

/**
 * Totals across sectors for the last `range` months (deal volume page), the month in progress included. The monthly
 * average and the latest month use complete months; the month in progress is reported on its own.
 */
export function rangeSummary(matrix: VolumeMatrix, range: number) {
  const n = matrix.months.length;
  const complete = completeMonths(matrix);
  const idx = Array.from({ length: Math.min(range, n) }, (_, i) => n - Math.min(range, n) + i);
  const monthTotal = (i: number, key: "value" | "count") => sum(SECTORS.map((s) => matrix.bySector[s][key][i]));
  const value = sum(idx.map((i) => monthTotal(i, "value")));
  const count = sum(idx.map((i) => monthTotal(i, "count")));
  const full = idx.filter((i) => i < complete);
  return {
    firstMonth: matrix.months[idx[0]] ?? null,
    lastMonth: matrix.months.at(-1) ?? null,
    value,
    count,
    monthlyAverage: full.length ? sum(full.map((i) => monthTotal(i, "value"))) / full.length : 0,
    latestMonth: matrix.months[complete - 1] ?? null,
    latestMonthValue: complete ? monthTotal(complete - 1, "value") : 0,
    partialMonth: matrix.partial,
    partialValue: matrix.partial ? monthTotal(n - 1, "value") : 0,
    partialCount: matrix.partial ? monthTotal(n - 1, "count") : 0,
  };
}

/** Per-sector totals for the last `range` months. */
export function sectorBreakdown(matrix: VolumeMatrix, range: number) {
  const total = rangeSummary(matrix, range).value;
  return SECTORS.map((sector) => {
    const value = sum(matrix.bySector[sector].value.slice(-range));
    const count = sum(matrix.bySector[sector].count.slice(-range));
    return { sector, value, count, averageSize: count ? value / count : null, share: total ? (value / total) * 100 : 0 };
  });
}

export const medianPremium = (deals: Deal[]) =>
  median(deals.map((d) => d.premiumPct).filter((p): p is number => p != null));

export function ipoPipelineSummary(ipos: Ipo[]) {
  const filed = ipos.filter((i) => i.stage === "Filed");
  return { filedCount: filed.length, expectedRaiseUsd: sum(filed.map((i) => i.expectedRaiseUsd ?? 0)) };
}

export type ValuationMetric = "evEbitda" | "evRevenue" | "premium";

const VALUATION_FIELD: Record<ValuationMetric, keyof SectorValuation> = {
  evEbitda: "medianEvEbitda",
  evRevenue: "medianEvRevenue",
  premium: "medianPremiumPct",
};

export interface ValuationCard {
  sector: Sector;
  latest: number | null;
  previous: number | null;
  /** Oldest to newest, for the sparkline. */
  series: number[];
}

export function valuationCards(rows: SectorValuation[], metric: ValuationMetric) {
  const quarters = [...new Set(rows.map((r) => r.quarter))].sort();
  const field = VALUATION_FIELD[metric];
  const cards: ValuationCard[] = SECTORS.map((sector) => {
    const byQuarter = new Map(rows.filter((r) => r.sector === sector).map((r) => [r.quarter, r[field] as number | null]));
    const series = quarters.map((q) => byQuarter.get(q) ?? null).filter((v): v is number => v != null);
    return {
      sector,
      latest: byQuarter.get(quarters.at(-1) ?? "") ?? null,
      previous: byQuarter.get(quarters.at(-2) ?? "") ?? null,
      series,
    };
  });
  return { latestQuarter: quarters.at(-1) ?? null, cards };
}
