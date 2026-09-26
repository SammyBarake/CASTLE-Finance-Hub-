import { describe, expect, it } from "vitest";
import { leagueTable, monthlyVolume, sectorValuations } from "./aggregate";
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

describe("monthlyVolume", () => {
  it("zero-fills 24 complete months before the as-of month and skips terminated deals", () => {
    const rows = monthlyVolume([deal({ announcedDate: "2026-08-03" }), deal({ announcedDate: "2026-08-20", status: "Terminated" })], "2026-09-25T00:00:00Z");
    const months = [...new Set(rows.map((r) => r.month))];
    expect(months).toHaveLength(24);
    expect(months[0]).toBe("2024-09");
    expect(months.at(-1)).toBe("2026-08");
    expect(rows.find((r) => r.month === "2026-08" && r.sector === "Tech")).toMatchObject({ dealCount: 1, dealValueUsd: 1e9 });
  });
});

describe("leagueTable", () => {
  it("ranks YTD by value and compares with the prior quarter end", () => {
    const deals = [
      deal({ announcedDate: "2026-02-01", valueUsd: 5e9, targetAdvisors: ["Lazard"] }),
      deal({ announcedDate: "2026-03-01", valueUsd: 3e9, acquirerAdvisors: ["Goldman Sachs"] }),
      deal({ announcedDate: "2026-08-01", valueUsd: 4e9, acquirerAdvisors: ["Goldman Sachs"] }),
      deal({ announcedDate: "2025-12-01", valueUsd: 9e9, acquirerAdvisors: ["Evercore"] }),
    ];
    const t = leagueTable(deals, "2026-09-25", (n) => n.slice(0, 2).toUpperCase());
    expect(t.period).toBe("2026 YTD");
    expect(t.entries.map((e) => e.advisor.name)).toEqual(["Goldman Sachs", "Lazard"]);
    expect(t.entries[0]).toMatchObject({ dealCount: 2, dealValueUsd: 7e9, rankChange: 1 });
    expect(t.entries[1].rankChange).toBe(-1);
  });
});

describe("sectorValuations", () => {
  it("takes medians per sector-quarter over 8 quarters", () => {
    const deals = [deal({ announcedDate: "2026-07-05", evEbitda: 10 }), deal({ announcedDate: "2026-08-05", evEbitda: 14 }), deal({ announcedDate: "2026-09-01", evEbitda: 30 })];
    const rows = sectorValuations(deals, "2026-09-25");
    expect(new Set(rows.map((r) => r.quarter)).size).toBe(8);
    expect(rows.find((r) => r.quarter === "2026-Q3" && r.sector === "Tech")).toMatchObject({ medianEvEbitda: 14, dealCount: 3 });
    expect(rows.find((r) => r.quarter === "2026-Q3" && r.sector === "Energy")?.medianEvEbitda).toBeNull();
  });
});
