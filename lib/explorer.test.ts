import { describe, expect, it } from "vitest";
import { insights, monthOf, periodLabel, selectionStats, sortDeals } from "./explorer";
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

describe("explorer helpers", () => {
  it("labels months", () => {
    expect(monthOf("2026-05-10")).toBe("2026-05");
    expect(periodLabel("2026-05")).toBe("May 2026");
  });

  it("sorts newest first, or largest first with unknowns last", () => {
    const deals = [deal({ id: "a", announcedDate: "2026-01-01", valueUsd: 5e9 }), deal({ id: "b", announcedDate: "2026-03-01", valueUsd: null }), deal({ id: "c", announcedDate: "2026-02-01", valueUsd: 2e9 })];
    expect(sortDeals(deals, "date").map((d) => d.id)).toEqual(["b", "c", "a"]);
    expect(sortDeals(deals, "value").map((d) => d.id)).toEqual(["a", "c", "b"]);
  });
});

describe("selectionStats / insights", () => {
  const deals = [
    deal({ acquirer: { name: "MegaCorp", ticker: null, cik: null }, target: { name: "Giant", ticker: null, cik: "2" }, valueUsd: 50e9, premiumPct: 40, sector: "Healthcare" }),
    deal({ acquirer: { name: "KKR", ticker: null, cik: null }, valueUsd: 1e9, premiumPct: 30, consideration: "Stock" }),
    deal({ acquirer: { name: "KKR", ticker: null, cik: null }, valueUsd: 2e9, premiumPct: 50 }),
    deal({ acquirer: { name: "The Investor Group", ticker: null, cik: null }, valueUsd: 1.5e9 }),
    deal({ valueUsd: null }),
  ];
  const s = selectionStats(deals);

  it("summarises the selection", () => {
    expect(s.count).toBe(5);
    expect(s.totalUsd).toBe(54.5e9);
    expect(s.withValue).toBe(4);
    expect(s.medianPremium).toBe(40);
    expect(s.cashPct).toBe(80);
    expect(s.biggest[0].target.name).toBe("Giant");
    expect(s.sectors.map((x) => x.sector)).toEqual(["Tech", "Healthcare"]);
    expect(s.buyers[0]).toMatchObject({ name: "KKR", count: 2, valueUsd: 3e9 });
    expect(s.buyers.some((b) => b.name === "The Investor Group")).toBe(false);
  });

  it("explains what's going on in plain English", () => {
    const text = insights(s).join(" ");
    expect(text).toContain("MegaCorp buying Giant for $50.0B");
    expect(text).toContain("92% of all the money");
    expect(text).toContain("a few mega-deals pull the total up");
    expect(text).toContain("median 40% above");
    expect(insights(selectionStats([]))).toEqual([]);
  });
});
