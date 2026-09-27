import { describe, expect, it } from "vitest";
import { companyHref, companyId, findCompany, nameKey, searchCompanies } from "./companies";
import type { Deal, Ipo } from "./types";

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
  industry: "Services-Prepackaged Software",
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

const ipo = (over: Partial<Ipo>): Ipo => ({
  id: "i1",
  company: { name: "Newco Inc.", ticker: "NEW", cik: "77" },
  sector: "Tech",
  industry: null,
  stage: "Filed",
  filedDate: "2026-03-01",
  pricedDate: null,
  expectedRaiseUsd: 5e8,
  offerPrice: null,
  underwriters: ["Goldman Sachs", "Morgan Stanley"],
  description: "",
  filings: [{ form: "S-1", filedDate: "2026-03-01", url: "https://sec.gov/s1" }],
  ...over,
});

describe("company ids", () => {
  it("uses the CIK when known and a name key otherwise", () => {
    expect(companyId({ name: "Copart, Inc.", ticker: "CPRT", cik: "0000900075" })).toBe("900075");
    expect(companyId({ name: "Thoma Bravo, L.P.", ticker: null, cik: null })).toBe("n-thoma-bravo");
    expect(nameKey("COPART INC")).toBe(nameKey("Copart, Inc."));
    expect(companyHref({ name: "H.I.G. Capital", ticker: null, cik: null })).toBe("/company/n-h-i-g-capital");
  });
});

describe("findCompany", () => {
  const copart = { name: "Copart Inc", ticker: "CPRT", cik: "900075" };
  const deals = [
    deal({ id: "d1", announcedDate: "2026-09-10", acquirer: copart, target: { name: "ACV Auctions Inc.", ticker: "ACVA", cik: "5" }, acquirerAdvisors: ["Goldman Sachs"], valueUsd: 2e9 }),
    // Same buyer, recorded by name only.
    deal({ id: "d2", announcedDate: "2025-01-10", acquirer: { name: "Copart, Inc.", ticker: null, cik: null }, target: { name: "Other Co", ticker: "OTH", cik: "6" }, acquirerAdvisors: ["Goldman Sachs", "Lazard"], valueUsd: null }),
    deal({ id: "d3", acquirer: { name: "Zeta", ticker: null, cik: null } }),
  ];

  it("gathers a buyer's deals across CIK and name-only records", () => {
    const p = findCompany({ deals, ipos: [] }, "900075")!;
    expect(p.deals.map((d) => d.deal.id)).toEqual(["d1", "d2"]);
    expect(p.deals.every((d) => d.role === "Acquirer")).toBe(true);
    expect(p.acquiredValueUsd).toBe(2e9);
    expect(p.banks[0]).toMatchObject({ name: "Goldman Sachs", buySide: 2 });
    expect(p.company.ticker).toBe("CPRT");
    expect(p.saleStatus).toBeNull();
  });

  it("builds a target's profile with sector, sale status and sell-side banks", () => {
    const p = findCompany({ deals: [deal({ target: { name: "T", ticker: "T", cik: "1" }, targetAdvisors: ["Centerview"], status: "Pending" })], ipos: [] }, "1")!;
    expect(p.sector).toBe("Tech");
    expect(p.industry).toBe("Services-Prepackaged Software");
    expect(p.saleStatus).toBe("Pending");
    expect(p.banks).toEqual([{ name: "Centerview", buySide: 0, sellSide: 1, ipo: 0 }]);
  });

  it("includes IPOs, underwriters and filings", () => {
    const p = findCompany({ deals: [], ipos: [ipo({})] }, "77")!;
    expect(p.ipos).toHaveLength(1);
    expect(p.banks.map((b) => b.name)).toEqual(["Goldman Sachs", "Morgan Stanley"]);
    expect(p.filings[0].form).toBe("S-1");
    expect(p.latestActivity).toEqual({ date: "2026-03-01", label: "IPO · Filed" });
  });

  it("gives generic buyer descriptions no page", () => {
    const generic = [deal({ acquirer: { name: "The Investor Group", ticker: null, cik: null } }), deal({ acquirer: { name: "Investor Group", ticker: null, cik: null } })];
    expect(findCompany({ deals: generic, ipos: [] }, "n-investor-group")).toBeNull();
    expect(searchCompanies({ deals: generic, ipos: [] }, "investor")).toEqual([]);
  });

  it("returns null for unknown companies", () => {
    expect(findCompany({ deals, ipos: [] }, "n-nobody")).toBeNull();
    expect(findCompany({ deals, ipos: [] }, "123")).toBeNull();
  });
});

describe("searchCompanies", () => {
  it("finds companies by name or ticker, most active first", () => {
    const deals = [
      deal({ acquirer: { name: "Copart Inc", ticker: "CPRT", cik: "9" } }),
      deal({ acquirer: { name: "Copart Inc", ticker: "CPRT", cik: "9" }, target: { name: "Copper Co", ticker: "CU", cik: "8" } }),
    ];
    expect(searchCompanies({ deals, ipos: [] }, "cop").map((r) => r.company.name)).toEqual(["Copart Inc", "Copper Co"]);
    expect(searchCompanies({ deals, ipos: [] }, "cprt")[0].count).toBe(2);
  });
});
