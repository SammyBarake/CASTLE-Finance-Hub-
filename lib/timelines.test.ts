import { describe, expect, it } from "vitest";
import { dealTimeline, months, timelineInsights, timelineStats } from "./timelines";
import type { Deal, DealMilestones } from "./types";

const ms = (over: Partial<DealMilestones>): DealMilestones => ({ path: "vote", firstFiling: null, definitiveProxy: null, closed: null, terminated: null, ...over });
const deal = (over: Partial<Deal>): Deal => ({
  id: Math.random().toString(36),
  announcedDate: "2026-01-01",
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

const ASOF = "2026-09-01T00:00:00Z";

describe("dealTimeline", () => {
  it("measures closed, open and terminated deals", () => {
    expect(dealTimeline(deal({ milestones: ms({ closed: "2026-03-02", firstFiling: { form: "PREM14A", date: "2026-01-31" } }) }), ASOF)).toMatchObject({ outcome: "closed", daysToClose: 60, daysToFirstFiling: 30 });
    expect(dealTimeline(deal({ milestones: ms({}) }), ASOF)).toMatchObject({ outcome: "open", daysElapsed: 243 });
    expect(dealTimeline(deal({ milestones: ms({ terminated: "2026-02-01" }) }), ASOF)).toMatchObject({ outcome: "terminated", daysElapsed: 31 });
    expect(dealTimeline(deal({}), ASOF)).toBeNull();
  });
});

describe("timelineStats", () => {
  const deals = [
    deal({ milestones: ms({ path: "tender", closed: "2026-02-15" }) }), // 45
    deal({ milestones: ms({ path: "tender", closed: "2026-02-10" }) }), // 40
    deal({ milestones: ms({ path: "tender", closed: "2026-02-20" }) }), // 50
    deal({ milestones: ms({ closed: "2026-05-01" }), consideration: "Stock", sector: "Energy" }), // 120
    deal({ milestones: ms({ closed: "2026-06-01" }), consideration: "Stock", sector: "Energy" }), // 151
    deal({ milestones: ms({ closed: "2026-07-01" }), consideration: "Mixed", sector: "Energy" }), // 181
    deal({ announcedDate: "2026-06-01", milestones: ms({}) }),
    deal({ milestones: ms({ terminated: "2026-03-01" }) }),
    deal({ milestones: ms({ closed: "2026-01-02" }) }), // seen only at completion
    deal({ announcedDate: "2024-01-01", milestones: ms({}) }), // open 20 months: a data gap
  ];
  const s = timelineStats(deals, ASOF);

  it("computes medians, groups and the histogram", () => {
    expect(s.closed).toHaveLength(6);
    expect(s.excluded).toEqual({ seenAtCompletion: 1, stale: 1 });
    expect(s.medianDaysToClose).toBe(85);
    expect(s.byPath.tender).toEqual({ median: 45, n: 3 });
    expect(s.byPath.vote).toEqual({ median: 151, n: 3 });
    expect(s.bySector.find((x) => x.sector === "Energy")).toEqual({ sector: "Energy", median: 151, n: 3 });
    expect(s.histogram.reduce((a, b) => a + b.count, 0)).toBe(6);
    expect(s.histogram.find((b) => b.label === "1–2 mo")!.count).toBe(3);
    expect(s.terminationPct).toBe(14);
  });

  it("measures open deals against the sector's typical time", () => {
    expect(s.open).toHaveLength(1);
    expect(s.open[0]).toMatchObject({ daysElapsed: 92, expectedDays: 45 });
    expect(s.open[0].progressPct).toBe(204);
  });

  it("explains the patterns", () => {
    const text = timelineInsights(s).join(" ");
    expect(text).toContain("Tender offers closed in 1.5 months vs 5.0 months with a shareholder vote");
    expect(text).toContain("Deals paid in stock took longer");
    expect(months(20)).toBe("20 days");
  });
});
