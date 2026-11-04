import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMarkets, FRED_SERIES, parseFredCsv, publicMarkets, type Markets } from "./markets";

describe("parseFredCsv", () => {
  it("reads observations and skips FRED's '.' for missing values", () => {
    const csv = "observation_date,VIXCLS\n2015-01-01,19.12\n2015-02-01,.\n2015-03-01,14.81\n";
    expect([...parseFredCsv(csv)]).toEqual([
      ["2015-01", 19.12],
      ["2015-03", 14.81],
    ]);
  });
});

// A local file's old series, as markets.json has them: the ETFs and XBI (Yahoo) and the high-yield spread (ICE).
const local = {
  fetchedAt: "2026-10-13T00:00:00.000Z",
  etf: { Tech: [{ month: "2015-01", close: 41.2, adjClose: 36.5 }] },
  fred: { vix: { "2015-01": 19 }, hySpread: { "2023-10": 4.5 } },
  index: { biotech: [{ month: "2015-01", close: 60, adjClose: 59.5 }] },
} as unknown as Markets;

describe("fetchMarkets", () => {
  afterEach(() => vi.unstubAllGlobals());

  const fred = (ok = true) => {
    const fetchMock = vi.fn(async (url: string) => {
      void url;
      return new Response(ok ? "observation_date,X\n2026-09-01,1.5\n2026-10-01,1.6\n" : "", { status: ok ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("asks only FRED, for the series on the list, and not the ICE index", async () => {
    const fetchMock = fred();
    await fetchMarkets("2010-01-01", "2026-10", null, () => {});
    const urls = fetchMock.mock.calls.map(([u]) => new URL(u));
    expect(urls.every((u) => u.hostname === "fred.stlouisfed.org")).toBe(true);
    expect(urls.map((u) => u.searchParams.get("id")).sort()).toEqual(Object.values(FRED_SERIES).sort());
    expect(Object.values(FRED_SERIES)).not.toContain("BAMLH0A0HYM2");
  });

  it("keeps a local file's old ETF, index and high-yield values for research, and refreshes the rest", async () => {
    fred();
    const { markets, failed } = await fetchMarkets("2010-01-01", "2026-10", local, () => {});
    expect(failed).toEqual([]);
    expect(markets.etf).toEqual(local.etf);
    expect(markets.index).toEqual(local.index);
    expect((markets.fred as Record<string, unknown>).hySpread).toEqual({ "2023-10": 4.5 });
    expect(markets.fred.vix).toEqual({ "2026-09": 1.5 }); // the unfinished month is left out
  });

  it("keeps a series' previous values when FRED fails", async () => {
    vi.useFakeTimers(); // fetchText waits between tries
    fred(false);
    const run = fetchMarkets("2010-01-01", "2026-10", local, () => {});
    await vi.runAllTimersAsync();
    const { markets, failed } = await run;
    vi.useRealTimers();
    expect(failed).toContain("VIXCLS");
    expect(markets.fred.vix).toEqual({ "2015-01": 19 });
  });
});

describe("publicMarkets", () => {
  it("carries the FRED series on the list and nothing else", () => {
    expect(publicMarkets(local)).toEqual({ fetchedAt: local.fetchedAt, etf: {}, fred: { vix: { "2015-01": 19 } }, index: {} });
  });
});
