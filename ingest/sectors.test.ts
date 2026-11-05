import { describe, expect, it } from "vitest";
import { enrichPrivateDeal } from "./deals";
import { sectorForBuyer, sectorForCompany, sectorForSic } from "./sectors";
import type { StoredDeal } from "./store";

describe("sectorForSic", () => {
  it("doesn't put waste in with the utilities (Stericycle 4955, US Ecology 4953, Heritage-Crystal Clean 4950)", () => {
    expect(sectorForSic("4955")).toBe("Industrials");
    expect(sectorForSic("4953")).toBe("Industrials");
    expect(sectorForSic("4950")).toBe("Industrials");
  });

  it("keeps real utilities in Energy: sewerage, water supply, electric and gas", () => {
    expect(sectorForSic("4952")).toBe("Energy");
    expect(sectorForSic("4941")).toBe("Energy");
    expect(sectorForSic("4911")).toBe("Energy");
    expect(sectorForSic("4939")).toBe("Energy");
  });

  it("separates construction machinery from oilfield machinery (Shyft, Astec 3531; ChampionX 3530)", () => {
    expect(sectorForSic("3531")).toBe("Industrials");
    expect(sectorForSic("3530")).toBe("Energy");
    expect(sectorForSic("3532")).toBe("Energy");
    expect(sectorForSic("3533")).toBe("Energy");
  });

  it("leaves wire and lab apparatus to their codes: Prysmian / General Cable isn't Tech, MKS / Newport isn't Healthcare", () => {
    expect(sectorForSic("3357")).toBe("Energy");
    expect(sectorForSic("3350")).toBe("Energy");
    expect(sectorForSic("3821")).toBe("Tech");
  });

  it("places the two by name instead: Misonix as a target, Belden's purchases as a buyer's", () => {
    expect(sectorForCompany("880432", "3821")).toBe("Healthcare");
    expect(sectorForBuyer("913142", "3357")).toBe("Tech");
  });

  it("takes franchisors and patent licensors out of finance (Franchise Group 6794), not banks or REITs", () => {
    expect(sectorForSic("6794")).toBe("Industrials");
    expect(sectorForSic("6022")).toBe("Financials");
    expect(sectorForSic("6798")).toBe("Financials");
  });

});

describe("sectorForCompany", () => {
  it("places the listed targets a SIC code can't: Coherent, Core Scientific, CDK", () => {
    expect(sectorForCompany("0000021510", "3826", "Coherent Inc")).toBe("Tech");
    expect(sectorForCompany("1839341", "6199", "Core Scientific, Inc.")).toBe("Tech");
    expect(sectorForCompany("1609702", "7389", "CDK Global, Inc.")).toBe("Tech");
  });

  it("goes by the CIK: other filers with those codes keep their sector", () => {
    expect(sectorForCompany("1000", "3826", "Other Instruments Inc")).toBe("Healthcare");
    expect(sectorForCompany("1000", "7389", "Other Services Inc")).toBe("Industrials");
    expect(sectorForCompany("1000", "6199", "Other Finance Inc")).toBe("Financials");
  });
});

describe("sectorForBuyer", () => {
  it("places what these buyers buy, where their own code misleads", () => {
    expect(sectorForBuyer("97745", "3829", "Thermo Fisher Scientific Inc.")).toBe("Healthcare"); // Clario
    expect(sectorForBuyer("66570", "3842", "MSA Safety Inc")).toBe("Industrials"); // Bacharach
    expect(sectorForBuyer("27996", "2780", "Deluxe Corp")).toBe("Tech"); // Celero Commerce
    expect(sectorForBuyer("1402057", "5961", "CDW Corp")).toBe("Tech"); // Sirius Computer Solutions
    expect(sectorForBuyer("0000932696", "5961", "Insight Enterprises Inc")).toBe("Tech"); // SADA
  });

  it("leaves a bank buying a private bank, and any other buyer, to its own code", () => {
    expect(sectorForBuyer("1000", "6022", "First Bank Corp")).toBe("Financials");
    expect(sectorForBuyer("1000", "5961", "Other Catalog Inc")).toBe("Industrials");
  });

  it("isn't used for a sale of the company itself", () => {
    expect(sectorForCompany("66570", "3842", "MSA Safety Inc")).toBe("Healthcare");
    expect(sectorForCompany("27996", "2780", "Deluxe Corp")).toBe("Industrials");
  });

  it("sets a private target's sector, and leaves its industry as the buyer's SIC description", () => {
    const sub = {
      cik: "0000027996",
      name: "DELUXE CORP",
      sic: "2780",
      sicDescription: "Blankbooks, Looseleaf Binders & Bookbindg & Relatd Work",
      tickers: ["DLX"],
      exchanges: ["NYSE"],
      stateOfIncorporation: "MN",
      filings: { recent: { accessionNumber: [], filingDate: [], form: [], primaryDocument: [], items: [] } },
    };
    const deal = {
      announcedDate: "2021-04-22",
      acquirer: { name: "Deluxe Corp", ticker: "DLX", cik: "27996" },
      target: { name: "First American Payment Systems", ticker: null, cik: null },
      privateTarget: true,
      status: "Closed",
      sector: "Industrials",
      industry: null,
    } as unknown as StoredDeal;
    enrichPrivateDeal(deal, sub, "2026-11-05");
    expect(deal.sector).toBe("Tech");
    expect(deal.industry).toBe(sub.sicDescription);
  });
});
