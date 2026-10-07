import { describe, expect, it } from "vitest";
import { buildVolumeMatrix, rangeSummary, sectorMomentum, ytdSummary } from "./metrics";
import type { MonthlySectorVolume } from "./types";

/** Tech only: deal value $1B per deal, `counts` per month from "2025-08". */
function rows(counts: number[]): MonthlySectorVolume[] {
  return counts.flatMap((n, i) => {
    const d = new Date(Date.UTC(2025, 7 + i, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return (["Tech", "Healthcare", "Energy", "Financials", "Industrials"] as const).map((sector) => ({
      month,
      sector,
      dealCount: sector === "Tech" ? n : 0,
      dealValueUsd: sector === "Tech" ? n * 1e9 : 0,
    }));
  });
}

// Aug 2025 … Oct 2026: 15 months, October 2026 in progress.
const counts = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 4];

describe("the month in progress", () => {
  it("is marked only when the data ends with it", () => {
    expect(buildVolumeMatrix(rows(counts), "2026-10").partial).toBe("2026-10");
    expect(buildVolumeMatrix(rows(counts), "2026-11").partial).toBeNull();
    expect(buildVolumeMatrix(rows(counts)).partial).toBeNull();
  });

  it("is left out of month-on-month changes", () => {
    const tech = (m: ReturnType<typeof buildVolumeMatrix>) => sectorMomentum(m, "count").find((x) => x.sector === "Tech")!.changePct;
    expect(tech(buildVolumeMatrix(rows(counts), "2026-10"))).toBe(100); // Sep (20) vs Aug (10), not Oct so far (4)
    expect(tech(buildVolumeMatrix(rows(counts)))).toBe(-80);
  });

  it("counts in range totals but not in the monthly average or the latest month", () => {
    const s = rangeSummary(buildVolumeMatrix(rows(counts), "2026-10"), 3);
    expect(s).toMatchObject({ count: 34, latestMonth: "2026-09", latestMonthValue: 20e9, partialMonth: "2026-10", partialValue: 4e9, partialCount: 4 });
    expect(s.monthlyAverage).toBe(15e9); // (10 + 20) / 2 complete months
  });

  it("year to date uses the exact same-period comparison when given", () => {
    const m = buildVolumeMatrix(rows(counts), "2026-10");
    const exact = ytdSummary(m, { through: "2026-10-07", value: 130e9, count: 130, priorValue: 100e9, priorCount: 100 })!;
    expect(exact).toMatchObject({ year: 2026, throughDay: "2026-10-07", value: 130e9, count: 130 });
    expect(exact.valueChangePct).toBeCloseTo(30);
    expect(exact.monthlyCount.at(-1)).toBe(4); // the sparkline ends with October so far
    // Without it: complete months only (Jan–Sep), against Jan–Sep a year earlier.
    const months = ytdSummary(m)!;
    expect(months).toMatchObject({ throughMonth: "2026-09", throughDay: null, count: 100 });
  });
});
