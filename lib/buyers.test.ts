import { describe, expect, it } from "vitest";
import { buyerGroups, buyerInsights, buyerType } from "./buyers";
import type { Company, Deal } from "./types";

const co = (name: string, cik: string | null = null, ticker: string | null = null): Company => ({ name, cik, ticker });
const deal = (acquirer: Company, over: Partial<Deal> = {}): Deal => ({
  id: Math.random().toString(36),
  announcedDate: "2026-05-10",
  acquirer,
  target: co("T", "1"),
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

describe("buyerType", () => {
  it("recognises sponsors, fund names and buyout vehicles", () => {
    expect(buyerType(deal(co("KKR")))).toBe("Private equity");
    expect(buyerType(deal(co("Thoma Bravo, L.P.")))).toBe("Private equity");
    expect(buyerType(deal(co("Bernhard Capital Partners")))).toBe("Private equity");
    expect(buyerType(deal(co("Madison Parent Inc.")))).toBe("Private equity");
    expect(buyerType(deal(co("The Investor Group")))).toBe("Private equity");
  });

  it("treats operating companies as strategic, even with 'Holdings' or 'Capital' in the name", () => {
    expect(buyerType(deal(co("Union Pacific Corp", "100885", "UNP")))).toBe("Strategic");
    expect(buyerType(deal(co("Capital One Financial Corp", "927628", "COF")))).toBe("Strategic");
    expect(buyerType(deal(co("Sanofi")))).toBe("Strategic");
    expect(buyerType(deal(co("Western Midstream Partners, LP")))).toBe("Strategic");
    expect(buyerType(deal(co("3G Capital")))).toBe("Private equity");
  });
});

describe("buyerGroups / insights", () => {
  const deals = [
    deal(co("Pfizer Inc", "78003", "PFE"), { premiumPct: 60, consideration: "Mixed" }),
    deal(co("Pfizer Inc", "78003", "PFE"), { premiumPct: 50 }),
    deal(co("Novartis AG"), { premiumPct: 40 }),
    deal(co("KKR"), { premiumPct: 30 }),
    deal(co("Blackstone Inc."), { premiumPct: 20, status: "Terminated" }),
  ];
  const [st, pe] = buyerGroups(deals);

  it("splits deals and compares premiums, ignoring terminated deals", () => {
    expect(st).toMatchObject({ type: "Strategic", count: 3, sharePct: 75, medianPremium: 50, cashPct: 67 });
    expect(pe).toMatchObject({ type: "Private equity", count: 1, sharePct: 25, medianPremium: 30, cashPct: 100 });
    expect(st.topBuyers[0]).toMatchObject({ name: "Pfizer Inc", count: 2 });
  });

  it("explains the difference", () => {
    const text = buyerInsights([st, pe]).join(" ");
    expect(text).toContain("All-cash:");
    expect(text).toContain("Strategic buyers paid the higher median premium (50% strategic vs 30% private equity)");
  });
});
