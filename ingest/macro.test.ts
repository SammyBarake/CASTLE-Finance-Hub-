import { describe, expect, it } from "vitest";
import { imfValue, parseBisCsv } from "./macro";

describe("macro parsers", () => {
  it("reads IMF DataMapper values by economy and year, rounded to 0.1", () => {
    const series = { USA: { "2025": 2.08, "2026": 2.3 }, EURO: { "2026": 1.1 } };
    expect(imfValue(series, "USA", 2025)).toBe(2.1);
    expect(imfValue(series, "EURO", 2026)).toBe(1.1);
    expect(imfValue(series, "EURO", 2025)).toBeNull();
    expect(imfValue(series, "JPN", 2026)).toBeNull();
  });

  it("keeps the latest BIS policy rate per area", () => {
    const csv = ["FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE", "D,US,2026-09-21,3.625", "D,US,2026-09-22,3.875", "D,XM,2026-09-22,2.5", "D,JP,2026-09-22,"].join("\n");
    const rates = parseBisCsv(csv);
    expect(rates.get("US")).toEqual({ rate: 3.875, date: "2026-09-22" });
    expect(rates.get("XM")).toEqual({ rate: 2.5, date: "2026-09-22" });
    expect(rates.has("JP")).toBe(false);
  });
});
