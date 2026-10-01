import { describe, expect, it } from "vitest";
import { cleanPartyName, identicalNames, isPlaceholderBuyer, isPlausibleName, normalizeName, sameCompany, titleCaseCaps } from "./names";

describe("headline and press-release debris", () => {
  it("cuts signing verbs, release labels, owner-of tails and joint-venture wording", () => {
    expect(cleanPartyName("Smart for Life Executes Definitive Agreement")).toBe("Smart for Life");
    expect(cleanPartyName("Motiv Electric Trucks Executed Definitive Agreement")).toBe("Motiv Electric Trucks");
    expect(cleanPartyName("Media & Investor Release Roche")).toBe("Roche");
    expect(cleanPartyName("Joint News Release Mechanics Bank")).toBe("Mechanics Bank");
    expect(cleanPartyName("Ceautamed Worldwide the Owner of Greens First")).toBe("Ceautamed Worldwide");
    expect(cleanPartyName("Sculptor Capital Management Together")).toBe("Sculptor Capital Management");
    expect(cleanPartyName("A Joint Venture Between Affiliates Of Highgate And Cerberus Capital Management")).toBe("Highgate and Cerberus Capital Management");
    expect(cleanPartyName("Procter And Gamble")).toBe("Procter And Gamble");
  });

  it("rejects deal paperwork as a party", () => {
    expect(cleanPartyName("BioLife Solutions Exhibit 99.2")).toBe("BioLife Solutions");
    for (const n of ["Definitive Agreement", "Entry into a Material Definitive Agreement", "Company through a reverse triangular merger or other similar structure", "Members of Company Management", "Item 1.01", "HoldCo", "Controlling", "Delaware General Corporation Law", "During the five-year period following the Closing"]) {
      expect(isPlausibleName(n), n).toBe(false);
    }
  });
});

describe("name matching", () => {
  it("matches a sponsor's short form", () => {
    expect(sameCompany("H&F", "Hellman & Friedman")).toBe(true);
    expect(normalizeName("KKR & Co. Inc.")).toBe("kkr");
  });

  it("identicalNames is stricter than sameCompany", () => {
    // A target renamed after its buyer looks identical until the old name is restored.
    expect(identicalNames("Teledyne Technologies Inc", "Teledyne FLIR, LLC")).toBe(true);
    expect(identicalNames("Teledyne Technologies Inc", "FLIR Systems Inc")).toBe(false);
    expect(identicalNames("Lucid Group, Inc.", "Lucid Motors")).toBe(true);
    expect(identicalNames("Dianthus Therapeutics, Inc.", "Dianthus Therapeutics")).toBe(true);
    // Real deals between companies sharing a first word.
    expect(identicalNames("Global Payments Inc.", "Global Blue Group")).toBe(false);
    expect(sameCompany("Global Payments Inc.", "Global Blue Group")).toBe(true);
  });
});

describe("run-on names and stock-price fragments", () => {
  it("cuts a second headline verb and rejects price phrases", () => {
    expect(cleanPartyName("Mantle Therapeutics and Announces Multiple New Strategic")).toBe("Mantle Therapeutics");
    expect(cleanPartyName("Johnson and Johnson")).toBe("Johnson and Johnson");
    expect(isPlausibleName("SoundHound Closing Stock Price")).toBe(false);
  });
  it("rejects securities and bare transaction words; trims deal-type tails", () => {
    expect(isPlausibleName("RTB's preferred stock")).toBe(false);
    expect(isPlausibleName("Merger")).toBe(false);
    expect(cleanPartyName("Blackstone Real Estate Income Trust All-Cash Transaction")).toBe("Blackstone Real Estate Income Trust");
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
