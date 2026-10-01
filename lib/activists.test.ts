import { describe, expect, it } from "vitest";
import { activistInsights, activistStats, laterDeal } from "./activists";
import type { ActivistStake, Deal } from "./types";

const stake = (over: Partial<ActivistStake>): ActivistStake => ({
  id: Math.random().toString(36),
  filedDate: "2026-03-01",
  eventDate: null,
  investor: { name: "Starboard Value LP", cik: "1" },
  company: { name: "Widget Corp", ticker: "WDGT", cik: "0000100" },
  percent: 6,
  shares: null,
  aims: ["Board seats"],
  purpose: "",
  activist: true,
  amendments: 0,
  lastAmended: null,
  url: "",
  ...over,
});
const deal = (targetCik: string, announcedDate: string): Deal => ({
  id: Math.random().toString(36),
  announcedDate,
  acquirer: { name: "Buyer", ticker: null, cik: null },
  target: { name: "Widget Corp", ticker: "WDGT", cik: targetCik },
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
});

describe("activists", () => {
  it("links a stake to a later deal for the same company", () => {
    expect(laterDeal(stake({}), [deal("100", "2026-02-01"), deal("100", "2026-07-01")])!.announcedDate).toBe("2026-07-01");
    expect(laterDeal(stake({}), [deal("200", "2026-07-01")])).toBeNull();
  });

  it("summarises stakes, asks and investors", () => {
    const stakes = [
      stake({ aims: ["Board seats", "Capital return"], percent: 5 }),
      stake({ aims: ["Board seats"], percent: 9, company: { name: "Gadget Inc", ticker: null, cik: "300" } }),
      stake({ investor: { name: "Elliott Investment Management", cik: "2" }, aims: ["Sale or strategic review"], percent: 7, filedDate: "2026-01-15" }),
    ];
    const s = activistStats(stakes, [deal("100", "2026-06-01")]);
    expect(s).toMatchObject({ count: 3, companies: 2, since: "2026-01-15", medianPercent: 7 });
    expect(s.aims[0]).toEqual({ aim: "Board seats", count: 2 });
    expect(s.investors[0]).toMatchObject({ name: "Starboard Value LP", count: 2, companies: ["Widget Corp", "Gadget Inc"] });
    expect(s.sold).toHaveLength(2);
    const text = activistInsights(s).join(" ");
    expect(text).toContain("Most common demand: board seats (2 of 3 stakes)");
    expect(text).toContain("Most active: Starboard Value LP (2 stakes)");
    expect(text).toContain("2 targeted companies later agreed to be acquired");
  });
});
