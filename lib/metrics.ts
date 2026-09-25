/**
 * Derived figures shown on the hub (KPIs, momentum, medians).
 * Pure functions over HubData so they work unchanged on real data.
 */
import type { Deal, Ipo, MonthlySectorVolume, Sector, SectorValuation } from "./types";
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
}

export function buildVolumeMatrix(rows: MonthlySectorVolume[]): VolumeMatrix {
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
  return { months, bySector };
}

export interface YtdSummary {
  year: number;
  throughMonth: string;
  value: number;
  count: number;
  valueChangePct: number;
  countChangePct: number;
  /** Monthly totals across sectors for the YTD months (sparklines). */
  monthlyValue: number[];
  monthlyCount: number[];
}

/** Year-to-date totals through the latest month, versus the same months a year earlier. */
export function ytdSummary(matrix: VolumeMatrix): YtdSummary | null {
  const latest = matrix.months.at(-1);
  if (!latest) return null;
  const year = Number(latest.slice(0, 4));
  const monthTotal = (i: number, key: "value" | "count") => sum(SECTORS.map((s) => matrix.bySector[s][key][i]));

  const current: number[] = [];
  const previous: number[] = [];
  matrix.months.forEach((m, i) => {
    const [y, mm] = [Number(m.slice(0, 4)), m.slice(5)];
    if (y === year) current.push(i);
    else if (y === year - 1 && mm <= latest.slice(5)) previous.push(i);
  });

  const monthlyValue = current.map((i) => monthTotal(i, "value"));
  const monthlyCount = current.map((i) => monthTotal(i, "count"));
  const value = sum(monthlyValue);
  const count = sum(monthlyCount);
  return {
    year,
    throughMonth: latest,
    value,
    count,
    valueChangePct: pctChange(value, sum(previous.map((i) => monthTotal(i, "value")))),
    countChangePct: pctChange(count, sum(previous.map((i) => monthTotal(i, "count")))),
    monthlyValue,
    monthlyCount,
  };
}

/** Latest month versus the month before, per sector. */
export function sectorMomentum(matrix: VolumeMatrix, metric: VolumeMetric) {
  return SECTORS.map((sector) => {
    const series = matrix.bySector[sector][metric];
    const n = series.length;
    return { sector, changePct: n >= 2 ? pctChange(series[n - 1], series[n - 2]) : 0 };
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
