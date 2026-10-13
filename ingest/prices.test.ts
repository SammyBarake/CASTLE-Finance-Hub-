import { describe, expect, it } from "vitest";
import { onUsExchange, parseDailyChart, reactionFrom, sameIssuer, spreadPct, type Bar } from "./prices";

describe("prices", () => {
  it("parses Yahoo's daily chart", () => {
    const json = JSON.stringify({
      chart: {
        result: [
          {
            meta: { longName: "Warner Bros. Discovery, Inc.", gmtoffset: -14400, regularMarketPrice: 30.95, regularMarketTime: 1791230401 },
            timestamp: [1791000000, 1791086400],
            indicators: { quote: [{ close: [30.5, 30.95] }], adjclose: [{ adjclose: [30.5, 30.95] }] },
          },
        ],
      },
    });
    const c = parseDailyChart(json);
    expect(c.name).toBe("Warner Bros. Discovery, Inc.");
    expect(c.bars).toHaveLength(2);
    expect(c.price).toBe(30.95);
    expect(c.priceDate).toMatch(/^2026-/);
  });

  it("checks the issuer and computes the spread", () => {
    expect(sameIssuer("Warner Bros. Discovery, Inc.", "Warner Bros. Discovery")).toBe(true);
    expect(sameIssuer("Venture Global, Inc.", "Vonage Holdings Corp")).toBe(false);
    expect(spreadPct(31, 30.38)).toBeCloseTo(2.04, 1);
  });

  it("takes quotes from US exchanges only", () => {
    expect(onUsExchange({ exchange: "NasdaqGS" })).toBe(true);
    expect(onUsExchange({ exchange: "NYSE" })).toBe(true);
    expect(onUsExchange({ exchange: "Cboe US" })).toBe(true);
    expect(onUsExchange({ exchange: "OTC Markets OTCPK" })).toBe(false);
    expect(onUsExchange({ exchange: "" })).toBe(false);
  });

  it("measures the buyer's reaction against the market", () => {
    const days = (prices: number[], start = 1) => prices.map((p, i): Bar => ({ date: `2024-03-${String(start + i).padStart(2, "0")}`, close: p, adjClose: p }));
    // Announced March 4: the close on the 3rd (100) to the 5th (95) is -5%; SPY +1% over the same days.
    const stock = days([100, 100, 100, 98, 95, 96]);
    const spy = days([400, 400, 400, 402, 404, 404]);
    const r = reactionFrom(stock, spy, "2024-03-04")!;
    expect(r.announcementPct).toBe(-5);
    expect(r.announcementVsMarketPct).toBe(-6);
    expect(r.m6VsMarketPct).toBeNull();
    expect(reactionFrom(stock.slice(0, 3), spy, "2024-03-04")).toBeNull();
  });
});
