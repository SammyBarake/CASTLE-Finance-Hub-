import { describe, expect, it } from "vitest";
import { leagueTable, monthlyVolume, sectorValuations, toPublicDeal } from "./aggregate";
import type { Deal } from "./types";

describe("toPublicDeal", () => {
  it("keeps the internal value type out of the browser feed", () => {
    const pub = toPublicDeal({ ...deal({}), valueKind: "equity" });
    expect("valueKind" in pub).toBe(false);
  });
});

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

  it("extends back to the first deal, up to six years", () => {
    const months = (d: string) => [...new Set(monthlyVolume([deal({ announcedDate: d })], "2026-09-25T00:00:00Z").map((r) => r.month))];
    expect(months("2021-03-10")[0]).toBe("2021-03");
    expect(months("2021-03-10")).toHaveLength(66);
    expect(months("2015-01-01")).toHaveLength(72);
  });

  it("starts where coverage really begins, not at a few stray earlier deals", () => {
    const deals = [
      deal({ announcedDate: "2020-11-03" }), // found later, when it closed
      ...Array.from({ length: 30 }, (_, i) => deal({ announcedDate: `2021-0${1 + (i % 6)}-1${i % 9}` })),
    ];
    const months = [...new Set(monthlyVolume(deals, "2026-09-25T00:00:00Z").map((r) => r.month))];
    expect(months[0]).toBe("2021-01");
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
  it("takes trailing-twelve-month medians per sector over 8 quarters", () => {
    const deals = [deal({ announcedDate: "2025-11-05", evEbitda: 10 }), deal({ announcedDate: "2026-08-05", evEbitda: 14 }), deal({ announcedDate: "2026-09-01", evEbitda: 30 })];
    const rows = sectorValuations(deals, "2026-09-25");
    expect(new Set(rows.map((r) => r.quarter)).size).toBe(8);
    // Q3 2026 LTM covers Q4 2025 – Q3 2026: all three deals; only two of them were announced in Q3 itself.
    expect(rows.find((r) => r.quarter === "2026-Q3" && r.sector === "Tech")).toMatchObject({ medianEvEbitda: 14, dealCount: 2, sample: { evEbitda: 3 } });
    // Q2 2026 LTM sees only the November deal: too few to show.
    expect(rows.find((r) => r.quarter === "2026-Q2" && r.sector === "Tech")?.medianEvEbitda).toBeNull();
    expect(rows.find((r) => r.quarter === "2026-Q3" && r.sector === "Energy")?.medianEvEbitda).toBeNull();
  });
});
