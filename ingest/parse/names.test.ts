import { describe, expect, it } from "vitest";
import { cleanPartyName, isPlaceholderBuyer, isPlausibleName, titleCaseCaps } from "./names";

describe("run-on names and stock-price fragments", () => {
  it("cuts a second headline verb and rejects price phrases", () => {
    expect(cleanPartyName("Mantle Therapeutics and Announces Multiple New Strategic")).toBe("Mantle Therapeutics");
    expect(cleanPartyName("Johnson and Johnson")).toBe("Johnson and Johnson");
    expect(isPlausibleName("SoundHound Closing Stock Price")).toBe(false);
  });
  it("cuts headline verbs and leading descriptors", () => {
    expect(cleanPartyName("Abiomed Broadens MedTech")).toBe("Abiomed");
    expect(cleanPartyName("Wavedash Leading Online Ticket Marketplace Expands Global")).toBe("Wavedash");
    expect(cleanPartyName("Community Bancorporation Company Release")).toBe("Community Bancorporation");
    expect(cleanPartyName("PRIVATELY HELD TENEOBIO")).toBe("TENEOBIO");
    expect(cleanPartyName("UK-BASED CORETRAX")).toBe("CORETRAX");
    expect(cleanPartyName("Independent Bank Corp.")).toBe("Independent Bank Corp.");
    expect(cleanPartyName("Consumer Reports")).toBe("Consumer Reports");
  });
  it("title-cases all-capital names only", () => {
    expect(titleCaseCaps("CANADIAN PACIFIC")).toBe("Canadian Pacific");
    expect(titleCaseCaps("AT&T INC")).toBe("AT&T Inc");
    expect(titleCaseCaps("IBM")).toBe("IBM");
    expect(titleCaseCaps("Bank OZK")).toBe("Bank OZK");
  });
});

describe("cleanPartyName / isPlausibleName", () => {
  it("cuts trailing agreement clauses and leading entity types", () => {
    expect(cleanPartyName("AkzoNobel, that certain Joinder Agreement, dated July 13, 2026")).toBe("AkzoNobel");
    expect(cleanPartyName("Delaware corporation, American Family Mutual Insurance Company, S.I.")).toBe("American Family Mutual Insurance Company, S.I.");
  });

  it("rejects clause fragments", () => {
    expect(isPlausibleName("The board of directors of the Company")).toBe(false);
    expect(isPlausibleName("Merger On August 1, 2026")).toBe(false);
    expect(isPlausibleName("Intercontinental Exchange, Inc.")).toBe(true);
  });
});

describe("isPlaceholderBuyer", () => {
  it("flags defined terms and acquisition vehicles", () => {
    for (const n of ["Parent", "Purchaser", "Zodiac Purchaser, L.L.C.", "GT Silver BidCo", "Anchor Parent, LLC", "Everest Merger Sub Inc.", "Viking ParentCo, Inc.", "Acquiror 10VB8, LLC"]) {
      expect(isPlaceholderBuyer(n), n).toBe(true);
    }
  });

  it("keeps real company names", () => {
    for (const n of ["GSK plc", "Clayton, Dubilier & Rice, LLC", "Coursebook, Inc.", "BioMarin Pharmaceutical Inc.", "Kinderhook Industries"]) {
      expect(isPlaceholderBuyer(n), n).toBe(false);
    }
  });
});
