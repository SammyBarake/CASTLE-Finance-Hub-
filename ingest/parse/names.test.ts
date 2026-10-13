import { describe, expect, it } from "vitest";
import { cleanPartyName, identicalNames, isPlaceholderBuyer, isPlausibleName, isTickerOf, namesCompany, namesExtend, normalizeName, privateNameMatch, sameCompany, titleCaseCaps } from "./names";

describe("descriptions, tails and fragments read as names", () => {
  it("strips a 'Leading … Provider' description, a 'via …' tail, a listing prefix and a dangling connector", () => {
    expect(cleanPartyName("Leading Loyalty Provider Punchh Inc.")).toBe("Punchh Inc.");
    expect(cleanPartyName("Leading Metal Roof Components Manufacturer LSI Group")).toBe("LSI Group");
    expect(cleanPartyName("Leading Healthcare Data and Analytics Firm Benefits Science LLC")).toBe("Benefits Science LLC");
    expect(cleanPartyName("SHUSA via an all-cash tender offer")).toBe("SHUSA");
    expect(cleanPartyName("Nasdaq-listed Gryphon Digital Mining")).toBe("Gryphon Digital Mining");
    expect(cleanPartyName("Corlieve Therapeutics and")).toBe("Corlieve Therapeutics");
    // Real names stay: "Via" capitalised is a name, "And" inside a name too.
    expect(cleanPartyName("ViaSat, Inc.")).toBe("ViaSat, Inc.");
    expect(cleanPartyName("Procter And Gamble")).toBe("Procter And Gamble");
  });

  it("rejects group structure, paperwork, places, descriptions and products", () => {
    for (const s of [
      "Cayman Islands and a wholly-owned subsidiary of the Company",
      "Parent and its subsidiaries, including the General Partner",
      "Merger by and among the Company, HyperScale Nexus Holding Corporation",
      "Leading Social Media & Technology",
      "Texas-based",
      "EnvisionTEC's Category-leading Product",
      "Non-operated Oil and Gas",
    ])
      expect(isPlausibleName(s), s).toBe(false);
    expect(isPlausibleName("U.S. Subsidiary")).toBe(false);
    // Jurisdictions and defined agreement terms read as parties by the 8-K parser.
    for (const s of ["Florida", "Nevada corporation", "North Carolina", "Luxembourg", "Delaware limited liability company", "British Columbia, Canada", "Closing", "Amendment", "Business Combination Agreement", "Patent Sale Agreement", "General Partner", "Second", "Directors of the Company", "Merger and certain related contributions"])
      expect(isPlausibleName(s), s).toBe(false);
    for (const s of ["Washington Federal, Inc.", "Texas Roadhouse", "Virginia National Financial", "First Ohio Bank"]) expect(isPlausibleName(s), s).toBe(true);
  });

  it("does not cut a name at an honorific's period", () => {
    expect(cleanPartyName("Mr. Cooper Group Inc.")).toBe("Mr. Cooper Group Inc.");
    expect(cleanPartyName("The St. Joe Company")).toBe("The St. Joe Company");
    for (const s of ["Air Products and Chemicals, Inc.", "Premier, Inc.", "Premier NYC", "Leidos Holdings, Inc."]) expect(isPlausibleName(s), s).toBe(true);
  });
});

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
    expect(cleanPartyName("Antibody and Reagent Leader BioLegend")).toBe("BioLegend");
    expect(cleanPartyName("Sports Betting Company Openbet")).toBe("Openbet");
    expect(cleanPartyName("API Media Technology Provider API")).toBe("API Media Technology Provider API");
    expect(isPlausibleName("Merger As previously reported, Ideanomics, Inc.")).toBe(false);
    expect(cleanPartyName("Ford Motor Company")).toBe("Ford Motor Company");
    expect(cleanPartyName("Kraft Heinz Company Holdings")).toBe("Kraft Heinz Company Holdings");
    expect(isPlaceholderBuyer("Oak-Eagle AcquireCo, Inc.")).toBe(true);
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

describe("namesCompany (a release's short name for a known company)", () => {
  it("accepts the same company, its first word or its initials", () => {
    expect(namesCompany("Newfield", "NEWFIELD EXPLORATION CO /DE/")).toBe(true);
    expect(namesCompany("EFI", "ELECTRONICS FOR IMAGING INC")).toBe(true);
    expect(namesCompany("WBA", "Walgreens Boots Alliance, Inc.")).toBe(true);
  });

  it("rejects other companies and initials of one-word names", () => {
    expect(namesCompany("Encana", "NEWFIELD EXPLORATION CO /DE/")).toBe(false);
    expect(namesCompany("NV", "NVIDIA CORP")).toBe(false);
    expect(namesCompany("EFX", "ELECTRONICS FOR IMAGING INC")).toBe(false);
  });
});

describe("isTickerOf", () => {
  it("matches a party written as another party's ticker", () => {
    expect(isTickerOf("UWMC", { ticker: "UWMC" })).toBe(true);
    expect(isTickerOf("uwmc ", { ticker: "UWMC" })).toBe(true);
    expect(isTickerOf("UWM Holdings Corp", { ticker: "UWMC" })).toBe(false);
    expect(isTickerOf("UWMC", { ticker: null })).toBe(false);
  });
});

describe("isPlausibleName: deal moments", () => {
  it("rejects a name run into 'at the Closing'", () => {
    expect(isPlausibleName("Tenax at the Closing")).toBe(false);
    expect(isPlausibleName("Tenax Aerospace Acquisition, LLC")).toBe(true);
  });
});

describe("cleanPartyName: two buyers' headline verb", () => {
  it("cuts 'Complete Transaction' after a pair of buyers", () => {
    expect(cleanPartyName("SD Biosensor and SJL Partners Complete Transaction")).toBe("SD Biosensor and SJL Partners");
    expect(cleanPartyName("Amryt Successfully Completes Acquisition of Chiasma")).toBe("Amryt");
  });
});

describe("namesExtend and descriptions", () => {
  it("matches a name shortened word by word", () => {
    expect(namesExtend("Rotron Aero", "Rotron Aerospace Ltd.")).toBe(true);
    expect(namesExtend("Radisson Hotel Americas", "Radisson Hotels Americas")).toBe(true);
    expect(namesExtend("Data Foundry", "Data Center Product Manufacturer Central Steel Fabricators")).toBe(false);
    expect(namesExtend("Rotron", "Rotron Aerospace")).toBe(false);
  });
  it("drops a description in front of a one-word name, and a listing run into the name", () => {
    expect(cleanPartyName("Brazilian Gelatin and Collagen Producer Gelnex")).toBe("Gelnex");
    expect(cleanPartyName("Mobile Game Creator Playdemic")).toBe("Playdemic");
    expect(cleanPartyName("ROTRON AERO NASDAQ")).toBe("ROTRON AERO");
  });
});

describe("cleanPartyName keeps names with description-like words", () => {
  it("keeps Pacific Premier and e.l.f.", () => {
    expect(cleanPartyName("Pacific Premier Bancorp Inc")).toBe("Pacific Premier Bancorp Inc");
    expect(cleanPartyName("e.l.f. Beauty, Inc.")).toBe("e.l.f. Beauty, Inc.");
    expect(cleanPartyName("Punchh Inc., a Premier Loyalty Platform")).toBe("Punchh Inc.");
  });
});

describe("isPlausibleName: documents and headings", () => {
  it("rejects a document or a heading read as a party", () => {
    expect(isPlausibleName("Definitive Proxy Statement on Schedule 14A")).toBe(false);
    expect(isPlausibleName("Transaction Details F5")).toBe(false);
    expect(isPlausibleName("F5 Networks, Inc.")).toBe(true);
  });
});

describe("cleanPartyName: longer descriptions", () => {
  it("keeps the name after a description, and leaves names that end in the role word", () => {
    expect(cleanPartyName("U.K. Firefighter Turnout Gear Manufacturer Bristol Uniforms")).toBe("Bristol Uniforms");
    expect(cleanPartyName("Specialist M&A Advisor Portico Capital Advisors")).toBe("Portico Capital Advisors");
    expect(cleanPartyName("Existing Strategic Partner Adlumin")).toBe("Adlumin");
    expect(cleanPartyName("Marks Paneth LLP NYC Accounting Firm")).toBe("Marks Paneth LLP");
    expect(cleanPartyName("Hunter Fan Company")).toBe("Hunter Fan Company");
    expect(cleanPartyName("Browser Company of New York")).toBe("Browser Company of New York");
    expect(cleanPartyName("Carlisle Management Company SCA")).toBe("Carlisle Management Company SCA");
    expect(cleanPartyName("Thoma Bravo Fund XV, L.P.")).toBe("Thoma Bravo");
    expect(cleanPartyName("American Industrial Partners Capital Fund VII, L.P.")).toBe("American Industrial Partners");
  });
});

describe("privateNameMatch", () => {
  it("matches spellings of one private company and picks the name to keep", () => {
    expect(privateNameMatch("AdoreMe", "Adore Me")).toBe("Adore Me");
    expect(privateNameMatch("CNAPP Vendor Ermetic", "Ermetic")).toBe("Ermetic");
    expect(privateNameMatch("UDF IV", "United Development Funding IV")).toBe("United Development Funding IV");
    expect(privateNameMatch("TMRC", "Texas Mineral Resources Corp")).toBe("Texas Mineral Resources Corp");
    expect(privateNameMatch("Jackson Hole Incorporated", "Bancshares of Jackson Hole Incorporated")).toBe("Bancshares of Jackson Hole Incorporated");
  });
  it("leaves different companies apart", () => {
    expect(privateNameMatch("Proofread Anywhere", "SEOButler")).toBeNull();
    expect(privateNameMatch("Codecademy", "Ryzac, Inc.")).toBeNull();
    expect(privateNameMatch("Group", "Acme Group")).toBeNull();
    expect(privateNameMatch("Bank of Jackson", "Jackson Hole Incorporated")).toBeNull();
  });
});
