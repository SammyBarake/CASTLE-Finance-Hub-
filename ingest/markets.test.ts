import { describe, expect, it } from "vitest";
import { parseFredCsv, parseYahooChart } from "./markets";

describe("parseYahooChart", () => {
  // Monthly bars are stamped at New York midnight on the 1st (05:00 UTC in winter, 04:00 in summer); meta.gmtoffset
  // is today's offset and must not be applied to them.
  const json = JSON.stringify({
    chart: {
      result: [
        {
          meta: { gmtoffset: -18000 },
          timestamp: [1420088400, 1422766800, 1425186000, 1427860800],
          indicators: { quote: [{ close: [41.2, 42.0, null, 43.1] }], adjclose: [{ adjclose: [36.5, 37.3, null, 38.4] }] },
        },
      ],
    },
  });

  it("keys bars by local month, skips missing closes and the unfinished month", () => {
    expect(parseYahooChart(json, "2015-04")).toEqual([
      { month: "2015-01", close: 41.2, adjClose: 36.5 },
      { month: "2015-02", close: 42, adjClose: 37.3 },
    ]);
  });

  it("throws on an empty chart", () => {
    expect(() => parseYahooChart(JSON.stringify({ chart: { result: null } }), "2015-04")).toThrow();
  });
});

describe("parseFredCsv", () => {
  it("reads observations and skips FRED's '.' for missing values", () => {
    const csv = "observation_date,VIXCLS\n2015-01-01,19.12\n2015-02-01,.\n2015-03-01,14.81\n";
    expect([...parseFredCsv(csv)]).toEqual([
      ["2015-01", 19.12],
      ["2015-03", 14.81],
    ]);
  });
});
