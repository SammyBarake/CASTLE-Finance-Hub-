import { describe, expect, it } from "vitest";
import { levelChange, sectorBaselines } from "./baseline";
import { runRipple } from "./engine";
import type { SectorMonthRow } from "../history";
import { SECTORS } from "../types";

// Twelve months of 2025 and one of the quarter in progress, with an old ETF close, as a local file still has them.
const months = [...Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`), "2026-01"];
const rows = months.flatMap((month) =>
  SECTORS.map((sector) => ({ sector, month, dealCount: 2, dealValueUsd: 1e9, ipoCount: 1, etfClose: 195.75, etfReturnPct: 1 }) as unknown as SectorMonthRow),
);

describe("sectorBaselines", () => {
  it("averages per quarter over the complete quarters", () => {
    expect(sectorBaselines(rows).Tech).toEqual({ dealCount: 6, dealValueUsd: 3e9, ipoCount: 3, months: 12 });
  });

  it("works from rows with no ETF columns, as /api/what-if now reads them", () => {
    const plain = rows.map(({ sector, month, dealCount, dealValueUsd, ipoCount }) => ({ sector, month, dealCount, dealValueUsd, ipoCount }));
    expect(sectorBaselines(plain)).toEqual(sectorBaselines(rows));
  });

  it("carries no ETF price, whatever the rows hold", () => {
    expect(JSON.stringify(sectorBaselines(rows))).not.toContain("etf");
    expect(JSON.stringify(sectorBaselines(rows))).not.toContain("195.75");
  });
});

describe("levelChange", () => {
  it("gives deals and IPOs a level, and valuation none", () => {
    const result = runRipple({ sectors: { Tech: { valuation: 10 } } });
    const baselines = sectorBaselines(rows);
    expect(levelChange(result, baselines, "Tech", "valuation", 1)).toBeNull();
    expect(levelChange(result, baselines, "Tech", "dealCount", 1)?.base).toBe(6);
    expect(levelChange(result, baselines, "Tech", "ipoCount", 1)?.base).toBe(3);
  });
});
