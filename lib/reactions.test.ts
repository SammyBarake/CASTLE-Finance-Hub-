import { describe, expect, it } from "vitest";
import { reactionInsights, reactionSummary } from "./reactions";
import type { Deal } from "./types";

const deal = (id: string, day: number, opts: Partial<Deal> = {}, six: number | null = null): Deal =>
  ({
    id,
    status: "Closed",
    consideration: "Cash",
    privateTarget: false,
    valueUsd: 2e9,
    enterpriseValueUsd: null,
    reaction: { announcementPct: day, announcementVsMarketPct: day, m6VsMarketPct: six, y1VsMarketPct: null },
    ...opts,
  }) as Deal;

describe("reactionSummary", () => {
  const deals = [
    deal("a", -3, { consideration: "Stock" }, -8),
    deal("b", -2, { consideration: "Stock" }, -4),
    deal("c", -4, { consideration: "Stock" }, 1),
    deal("d", -1, { consideration: "Stock" }, -2),
    deal("e", -6, { consideration: "Stock", valueUsd: 20e9 }, -5),
    deal("f", 1),
    deal("g", 2),
    deal("h", 0.5),
    deal("i", -0.5),
    deal("j", 3, { valueUsd: 50e6, privateTarget: true }),
    deal("k", 9, { status: "Terminated" }),
    { ...deal("l", 0), reaction: undefined } as Deal,
  ];
  const s = reactionSummary(deals);

  it("takes medians per group, leaving small groups blank", () => {
    expect(s.all.count).toBe(10); // terminated and unknown left out
    expect(s.all.announcement).toBe(-0.7); // -0.75, to one decimal
    expect(s.all.beatPct).toBe(40);
    const [cash, stock, mixed] = s.groups[0].rows;
    expect(stock.announcement).toBe(-3);
    expect(cash.announcement).toBe(1);
    expect(mixed.count).toBe(0);
    expect(mixed.announcement).toBeNull();
    expect(s.all.sixMonths).toBe(-4);
    expect(s.all.sixMonthsCount).toBe(5);
  });

  it("lists the big deals the market liked most and least", () => {
    expect(s.best.map((d) => d.id)).toEqual(["g", "f", "h"]);
    expect(s.worst.map((d) => d.id)).toEqual(["e", "c", "a", "b"]);
  });

  it("writes number-led takeaways", () => {
    const notes = reactionInsights(s);
    expect(notes[0]).toBe("The median buyer moved −0.7% against the S&P 500 in the two days after announcing; 40% beat it.");
    expect(notes[1]).toMatch(/^Paying in stock: −3\.0%/);
  });
});
