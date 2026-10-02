/**
 * Baselines from sector_monthly, to read the engine's % changes as levels: a +12% Tech IPO response on a baseline of
 * 9 IPOs a quarter is about +1 IPO a quarter.
 */
import { SECTORS, type Sector } from "../types";
import type { SectorMonthRow } from "../history";
import type { RippleResult } from "./engine";
import type { Feature } from "./links";

export interface SectorBaseline {
  /** Average per quarter over the window. */
  dealCount: number;
  dealValueUsd: number;
  ipoCount: number;
  /** Latest month-end ETF close. */
  etfClose: number | null;
  /** Months averaged. */
  months: number;
}

/** Quarterly averages over the last `quarters` complete quarters of rows (default 4). */
export function sectorBaselines(rows: SectorMonthRow[], quarters = 4): Record<Sector, SectorBaseline> {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  // Complete quarters only: end at the last March / June / September / December month present.
  const lastQuarterEnd = [...months].reverse().find((m) => ["03", "06", "09", "12"].includes(m.slice(5)));
  const end = lastQuarterEnd ? months.indexOf(lastQuarterEnd) : months.length - 1;
  const window = new Set(months.slice(Math.max(0, end + 1 - quarters * 3), end + 1));
  return Object.fromEntries(
    SECTORS.map((s) => {
      const rs = rows.filter((r) => r.sector === s && window.has(r.month));
      const perQuarter = (f: (r: SectorMonthRow) => number) => (rs.reduce((t, r) => t + f(r), 0) / Math.max(1, rs.length)) * 3;
      const latest = rows.filter((r) => r.sector === s && r.etfClose != null).sort((a, b) => b.month.localeCompare(a.month))[0];
      return [s, { dealCount: perQuarter((r) => r.dealCount), dealValueUsd: perQuarter((r) => r.dealValueUsd), ipoCount: perQuarter((r) => r.ipoCount), etfClose: latest?.etfClose ?? null, months: rs.length }];
    }),
  ) as Record<Sector, SectorBaseline>;
}

/** A % response in quarter k as a level change against the baseline (ETF price change for valuation). */
export function levelChange(result: RippleResult, baselines: Record<Sector, SectorBaseline>, sector: Sector, feature: Feature, quarter: number) {
  const b = baselines[sector];
  const base = feature === "valuation" ? b.etfClose : feature === "dealCount" ? b.dealCount : feature === "dealValue" ? b.dealValueUsd : b.ipoCount;
  if (base == null) return null;
  const r = result.quarters[quarter - 1].sectors[sector][feature];
  return { mid: (base * r.mid) / 100, low: (base * r.low) / 100, high: (base * r.high) / 100, base };
}
