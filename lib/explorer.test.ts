import { describe, expect, it } from "vitest";
import { explorerSeries, filterDeals, leaders, metricOf, monthRange, periodKey, periodLabel, periods, sortDeals, type ExplorerFilters } from "./explorer";
import type { Deal } from "./types";

const deal = (over: Partial<Deal>): Deal => ({
  id: Math.random().toString(36),
  announcedDate: "2026-05-10",
  acquirer: { name: "A", ticker: null, cik: null },
  target: { name: "T", ticker: "T", cik: "1" },
  valueUsd: 1e9,
  pricePerShare: null,
  premiumPct: null,
  consideration: "Cash",
  sector: "Tech",
  industry: null,
  status: "Announced",
  statusDate: null,
  enterpriseValueUsd: null,
  evEbitda: null,
  evRevenue: null,
  acquirerAdvisors: [],
  targetAdvisors: [],
  filings: [],
  ...over,
});

const F: ExplorerFilters = { from: "2026-01", to: "2026-06", sectors: ["Tech", "Healthcare", "Financials", "Energy", "Industrials"], status: "active", consideration: "all", min: "", max: "", query: "" };

describe("periods", () => {
  it("builds month and quarter keys", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(periodKey("2026-05", "quarter")).toBe("2026-Q2");
    expect(periods(F, "quarter")).toEqual(["2026-Q1", "2026-Q2"]);
    expect(periodLabel("2026-Q2")).toBe("Q2 2026");
    expect(periodLabel("2026-05")).toBe("May 2026");
  });
});

describe("filterDeals", () => {
  const deals = [
    deal({ id: "a" }),
    deal({ id: "b", status: "Terminated" }),
    deal({ id: "c", sector: "Energy", valueUsd: 5e9, acquirerAdvisors: ["Lazard"] }),
    deal({ id: "d", announcedDate: "2025-12-01" }),
  ];
  it("applies window, status, size and text filters", () => {
    expect(filterDeals(deals, F).map((d) => d.id)).toEqual(["a", "c"]);
    expect(filterDeals(deals, { ...F, status: "all" }).map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(filterDeals(deals, { ...F, min: "2" }).map((d) => d.id)).toEqual(["c"]);
    expect(filterDeals(deals, { ...F, query: "lazard" }).map((d) => d.id)).toEqual(["c"]);
    expect(filterDeals(deals, { ...F, sectors: ["Tech"] }).map((d) => d.id)).toEqual(["a"]);
  });
});

describe("metrics and series", () => {
  const deals = [
    deal({ announcedDate: "2026-01-05", valueUsd: 2e9, premiumPct: 30, evEbitda: 10 }),
    deal({ announcedDate: "2026-01-20", valueUsd: null, premiumPct: 50, evEbitda: 14 }),
    deal({ announcedDate: "2026-03-02", sector: "Energy", valueUsd: 4e9 }),
  ];
  it("computes each metric, ignoring undisclosed values", () => {
    const jan = deals.slice(0, 2);
    expect(metricOf(jan, "value")).toBe(2);
    expect(metricOf(jan, "count")).toBe(2);
    expect(metricOf(jan, "avgSize")).toBe(2);
    expect(metricOf(jan, "medianPremium")).toBe(40);
    expect(metricOf(jan, "medianEvEbitda")).toBe(12);
  });

  it("zero-fills sums but leaves medians unknown in empty periods", () => {
    const s = explorerSeries(deals, F, "value", "month", false);
    expect(s.keys).toHaveLength(6);
    expect(s.series.find((x) => x.label === "Tech")!.data).toEqual([2, 0, 0, 0, 0, 0]);
    const p = explorerSeries(deals, F, "medianPremium", "month", true);
    expect(p.series).toHaveLength(1);
    expect(p.series[0].data).toEqual([40, null, null, null, null, null]);
    expect(explorerSeries(deals, F, "count", "quarter", true).series[0].data).toEqual([3, 0]);
  });
});

describe("sortDeals / leaders", () => {
  it("sorts with unknowns last and ranks names", () => {
    const deals = [deal({ id: "x", valueUsd: null, acquirerAdvisors: ["GS"] }), deal({ id: "y", valueUsd: 3e9, acquirerAdvisors: ["GS", "MS"] })];
    expect(sortDeals(deals, "value").map((d) => d.id)).toEqual(["y", "x"]);
    expect(leaders(deals, (d) => d.acquirerAdvisors)).toEqual([
      { name: "GS", count: 2, valueUsd: 3e9 },
      { name: "MS", count: 1, valueUsd: 3e9 },
    ]);
  });
});
