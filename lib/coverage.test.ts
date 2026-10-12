import { describe, expect, it } from "vitest";
import { coverage, coverageTakeaways, PRIVATE_FIELDS, privateDeals, PUBLIC_FIELDS, publicDeals } from "./coverage";
import type { Deal } from "./types";

const deal = (over: Partial<Deal>): Deal =>
  ({
    id: Math.random().toString(36).slice(2),
    announcedDate: "2024-03-01",
    status: "Closed",
    valueUsd: null,
    pricePerShare: null,
    premiumPct: null,
    evEbitda: null,
    evRevenue: null,
    acquirerAdvisors: [],
    targetAdvisors: [],
    ...over,
  }) as Deal;

describe("coverage", () => {
  const deals = [
    deal({ announcedDate: "2023-05-01", valueUsd: 1e9, premiumPct: 30, targetAdvisors: ["Goldman Sachs"] }),
    deal({ announcedDate: "2024-02-01", valueUsd: 2e9 }),
    deal({ announcedDate: "2024-06-01" }),
    deal({ announcedDate: "2024-07-01", status: "Terminated", valueUsd: 3e9 }),
    deal({ announcedDate: "2024-08-01", privateTarget: true, valueUsd: 5e7 }),
    deal({ announcedDate: "2020-08-01", valueUsd: 1e9 }),
  ];

  it("counts each field's share overall and by year, public targets from the start and not terminated", () => {
    const pub = publicDeals(deals, "2021-01-01");
    expect(pub).toHaveLength(3);
    const c = coverage(pub, PUBLIC_FIELDS, (d) => d.announcedDate.slice(0, 4));
    expect(c.years).toEqual(["2023", "2024"]);
    expect(c.totalByYear).toEqual({ 2023: 1, 2024: 2 });
    const value = c.rows.find((r) => r.key === "value")!;
    expect(value.all).toEqual({ n: 2, of: 3, pct: (2 / 3) * 100 });
    expect(value.byYear["2024"]).toEqual({ n: 1, of: 2, pct: 50 });
  });

  it("writes number-led takeaways", () => {
    const pub = coverage(publicDeals(deals, "2021-01-01"), PUBLIC_FIELDS, (d) => d.announcedDate.slice(0, 4));
    const priv = coverage(privateDeals(deals, "2021-01-01"), PRIVATE_FIELDS, (d) => d.announcedDate.slice(0, 4));
    const t = coverageTakeaways(pub, priv);
    expect(t[0]).toBe("67% of public-target deals have a deal value and 33% a premium over the unaffected price.");
    expect(t.at(-1)).toBe("1 private-company purchases; 100% disclose a price.");
  });
});
