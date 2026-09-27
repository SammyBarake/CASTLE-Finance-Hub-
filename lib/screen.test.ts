import { describe, expect, it } from "vitest";
import { activeFilters, dateCutoff, DEFAULT_SCREEN, screenDeals } from "./screen";
import type { Deal } from "./types";

const deal = (over: Partial<Deal>): Deal => ({
  id: Math.random().toString(36).slice(2),
  announcedDate: "2026-09-10",
  acquirer: { name: "Acme", ticker: null, cik: null },
  target: { name: "Target Co", ticker: "TGT", cik: "1" },
  valueUsd: 1e9,
  pricePerShare: null,
  premiumPct: 30,
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

const ctx = { asOf: "2026-09-25T12:00:00Z", isWatched: () => false };

describe("screenDeals", () => {
  const deals = [
    deal({ id: "a", valueUsd: 5e9, premiumPct: 20, targetAdvisors: ["Lazard"], announcedDate: "2026-09-20" }),
    deal({ id: "b", valueUsd: 0.5e9, premiumPct: 60, consideration: "Stock", announcedDate: "2026-06-01" }),
    deal({ id: "c", valueUsd: null, premiumPct: null, sector: "Energy", announcedDate: "2026-09-24" }),
  ];

  it("filters by value range, premium, advisor and consideration", () => {
    expect(screenDeals(deals, { ...DEFAULT_SCREEN, min: "3" }, ctx).map((d) => d.id)).toEqual(["a"]);
    expect(screenDeals(deals, { ...DEFAULT_SCREEN, premium: "50" }, ctx).map((d) => d.id)).toEqual(["b"]);
    expect(screenDeals(deals, { ...DEFAULT_SCREEN, advisor: "Lazard" }, ctx).map((d) => d.id)).toEqual(["a"]);
    expect(screenDeals(deals, { ...DEFAULT_SCREEN, consideration: "Stock" }, ctx).map((d) => d.id)).toEqual(["b"]);
  });

  it("filters public vs private targets", () => {
    const mixed = [...deals, deal({ id: "p", privateTarget: true, target: { name: "Widget LLC", ticker: null, cik: null }, premiumPct: null })];
    expect(screenDeals(mixed, { ...DEFAULT_SCREEN, targetType: "private" }, ctx).map((d) => d.id)).toEqual(["p"]);
    expect(screenDeals(mixed, { ...DEFAULT_SCREEN, targetType: "public" }, ctx)).toHaveLength(3);
    expect(activeFilters({ ...DEFAULT_SCREEN, targetType: "private" })).toContainEqual({ key: "targetType", label: "Private targets" });
  });

  it("applies date windows relative to the data date", () => {
    expect(dateCutoff("week", ctx.asOf)).toBe("2026-09-18");
    expect(dateCutoff("quarter", ctx.asOf)).toBe("2026-07-01");
    expect(screenDeals(deals, { ...DEFAULT_SCREEN, date: "week" }, ctx).map((d) => d.id)).toEqual(["c", "a"]);
  });

  it("sorts with unknown values last and supports watchlist-only", () => {
    expect(screenDeals(deals, { ...DEFAULT_SCREEN, sort: "value" }, ctx).map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(screenDeals(deals, { ...DEFAULT_SCREEN, watchOnly: true }, { ...ctx, isWatched: (id) => id === "b" }).map((d) => d.id)).toEqual(["b"]);
  });

  it("lists active filters as chips", () => {
    expect(activeFilters({ ...DEFAULT_SCREEN, sector: "Tech", min: "3", sort: "value" }).map((f) => f.label)).toEqual(["Tech", "Min $3B"]);
    expect(activeFilters({ ...DEFAULT_SCREEN, min: "abc" })).toEqual([]);
  });
});
