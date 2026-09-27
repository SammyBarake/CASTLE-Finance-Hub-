import { describe, expect, it } from "vitest";
import { monthOf, periodLabel, sortDeals } from "./explorer";
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
