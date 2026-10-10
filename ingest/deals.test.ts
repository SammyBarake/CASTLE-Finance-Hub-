import { describe, expect, it } from "vitest";
import type { Company } from "../lib/types";
import { coreName, dropPrivateDuplicates, expandAbbreviation, FUND_TARGET, isPrivateTargetName, registrantMatches, releaseTerms, saysMergerTerminated, stripDateline, tidyTargetName } from "./deals";
import type { StoredDeal } from "./store";

describe("isPrivateTargetName", () => {
  it("accepts real company names", () => {
    expect(isPrivateTargetName("Kashiv Specialty Pharmaceuticals", "Amneal")).toBe(true);
    expect(isPrivateTargetName("Acme Company, Inc.", "Widget Corp")).toBe(true);
  });
  it("rejects descriptions, assets and generic words", () => {
    expect(isPrivateTargetName("Next-Gen AI Drug Discovery Company", "Nexentis")).toBe(false);
    expect(isPrivateTargetName("Land", "Nomadar")).toBe(false);
    expect(isPrivateTargetName("certain assets of Foo", "Bar")).toBe(false);
    expect(isPrivateTargetName("Pizza Hut Brand", "Bar")).toBe(false);
  });
});

describe("stripDateline", () => {
  it("drops an all-caps city glued onto a name", () => {
    expect(stripDateline("Sirius Computer Solutions LINCOLNSHIRE")).toBe("Sirius Computer Solutions");
    expect(stripDateline("Acme Robotics NEW YORK")).toBe("Acme Robotics");
    expect(stripDateline("Elon Musk SAN FRANCISCO")).toBe("Elon Musk");
  });
  it("keeps legal suffixes, short acronyms and all-caps names", () => {
    expect(stripDateline("Acme Software USA")).toBe("Acme Software USA");
    expect(stripDateline("Nexus AI")).toBe("Nexus AI");
    expect(stripDateline("Bright Health DTC")).toBe("Bright Health DTC");
    expect(stripDateline("IBM")).toBe("IBM");
  });
});

describe("dropPrivateDuplicates", () => {
  const deal = (id: string, acq: Company, target: string, date: string, privateTarget = false) =>
    ({ id, acquirer: acq, target: { name: target, ticker: null, cik: privateTarget ? null : "1" }, announcedDate: date, privateTarget }) as unknown as StoredDeal;
  it("drops a private copy of a public deal and keeps the better buyer name", () => {
    const deals = [
      deal("a", { name: "SoundHound Closing Stock Price", ticker: null, cik: null }, "Liveperson Inc", "2026-04-21"),
      deal("b", { name: "Soundhound Ai, Inc.", ticker: "SOUN", cik: "9" }, "LivePerson", "2026-09-04", true),
      deal("c", { name: "Valley National Bancorp", ticker: "VLY", cik: "8" }, "Providence", "2026-08-25", true),
      deal("d", { name: "Other Co", ticker: null, cik: "7" }, "Providence Service Corp", "2026-06-01"),
    ];
    dropPrivateDuplicates(deals);
    expect(deals.map((d) => d.id)).toEqual(["a", "c", "d"]);
    expect(deals[0].acquirer.name).toBe("Soundhound Ai, Inc.");
  });

  it("matches the same buyer's private copy written differently, within weeks", () => {
    const baxter = { name: "Baxter International Inc", ticker: "BAX", cik: "10456" };
    const blackstone = { name: "Blackstone Inc.", ticker: "BX", cik: "1393818" };
    const pub = (id: string, acq: Company, target: string, ticker: string | null, date: string) =>
      ({ id, acquirer: acq, target: { name: target, ticker, cik: "1" }, announcedDate: date }) as unknown as StoredDeal;
    const deals = [
      pub("hrc", baxter, "Hill-Rom Holdings, Inc.", "HRC", "2021-09-02"),
      deal("p1", baxter, "HILLROM", "2021-09-20", true),
      pub("psb", blackstone, "PS Business Parks, Inc.", "PSB", "2022-04-25"),
      deal("p2", blackstone, "PSB", "2022-04-25", true),
      // The same buyer buying a different company the same month stays.
      deal("p3", blackstone, "Simply Self Storage", "2022-04-26", true),
    ];
    dropPrivateDuplicates(deals);
    expect(deals.map((d) => d.id)).toEqual(["hrc", "psb", "p3"]);
  });
});

describe("registrant name matching", () => {
  it("ignores spacing and trailing descriptors", () => {
    expect(registrantMatches("Hill-Rom Holdings, Inc.", "HILLROM")).toBe(true);
    expect(registrantMatches("Enable Midstream Partners, LP", "Enable Midstream")).toBe(true);
    expect(registrantMatches("INTERPUBLIC GROUP OF COMPANIES, INC.", "Interpublic")).toBe(true);
    expect(registrantMatches("Fortune Brands Innovations, Inc.", "Fortune")).toBe(false);
    expect(registrantMatches("First American Financial Corp", "First American")).toBe(false);
    expect(coreName("ENABLE MIDSTREAM Energy")).toBe("ENABLE MIDSTREAM");
    expect(coreName("Aerie Pharmaceuticals")).toBe("Aerie Pharmaceuticals");
  });
});

describe("isPrivateTargetName rejects counts, sites and divisions", () => {
  it.each([
    "Two Toyota and Two Lexus Dealerships",
    "Sixth Real Estate Brokerage",
    "FOUR DOMINANT ENCLOSED REGIONAL MALLS",
    "A GEORGIA COMMUNITY",
    "MONTICELLO LAND",
    "RF Business of Wolfspeed",
    "Microlab RF Business Unit of Wireless Telecom Group",
    "ALLIANCE HEALTHCARE BUSINESSES",
  ])("%s", (name) => expect(isPrivateTargetName(name, "Buyer Inc")).toBe(false));
  it("keeps real names", () => {
    for (const n of ["First Watch Partners", "Rosewood Communities", "Kodiak Building Partners", "Teton Financial Services"]) expect(isPrivateTargetName(n, "Buyer Inc")).toBe(true);
  });
});

describe("tidyTargetName", () => {
  it("cuts the acquirer's brand, title-cases capitals, strips datelines", () => {
    expect(tidyTargetName("Ginop Sales Alta CE", "Alta Equipment Group Inc.")).toBe("Ginop Sales");
    expect(tidyTargetName("Crestwood Energy Partners", "Energy Transfer LP")).toBe("Crestwood Energy Partners");
    expect(tidyTargetName("TETON FINANCIAL SERVICES", "First Western Financial")).toBe("Teton Financial Services");
    expect(tidyTargetName("WTG MIDSTREAM", "Energy Transfer LP")).toBe("WTG Midstream");
    expect(tidyTargetName("COMPUTERSHARE MORTGAGE SERVICES INC", "Rithm Capital")).toBe("Computershare Mortgage Services Inc");
    expect(tidyTargetName("Sirius Computer Solutions LINCOLNSHIRE", "CDW")).toBe("Sirius Computer Solutions");
  });
});

describe("out-of-scope targets", () => {
  it("treats investment funds as out of scope, REITs as in", () => {
    expect(FUND_TARGET.test("Aberdeen Multi-Market Income Fund")).toBe(true);
    expect(FUND_TARGET.test("National Storage Affiliates Trust")).toBe(false);
    expect(FUND_TARGET.test("Fundamental Research Corp")).toBe(false);
  });
  it("rejects divisions named with a possessive and bare generic words", () => {
    expect(isPrivateTargetName("LEHIGH HANSON'S WEST REGION BUSINESS Upstream Materials-Led Geographic", "Martin Marietta")).toBe(false);
    expect(isPrivateTargetName("Operating", "Peakstone Realty Trust")).toBe(false);
    expect(isPrivateTargetName("Ruth's Hospitality Group", "Darden")).toBe(true);
  });
});

describe("isPrivateTargetName rejects drugs", () => {
  it("drops programme names", () => {
    expect(isPrivateTargetName("ST-920 Fabry Disease Gene Therapy", "PTC Therapeutics")).toBe(false);
    expect(isPrivateTargetName("Actio Biosciences", "Jazz")).toBe(true);
  });
});

describe("expandAbbreviation", () => {
  it("finds the full name a release defines", () => {
    expect(expandAbbreviation("MMT", 'Perimeter Solutions has agreed to acquire Medical Manufacturing Technologies, LLC ("MMT") for $685 million.')).toBe("Medical Manufacturing Technologies, LLC");
    expect(expandAbbreviation("WBD", "Paramount to acquire WBD (NASDAQ: WBD).")).toBeNull();
  });
});

describe("saysMergerTerminated (an 8-K Item 1.02 ending the deal)", () => {
  it("reads the merger agreement itself being terminated", () => {
    expect(saysMergerTerminated("On March 4, 2026, JetBlue and Spirit terminated the Agreement and Plan of Merger, dated July 28, 2022.")).toBe(true);
    expect(saysMergerTerminated("On March 4, 2026, the parties mutually agreed to terminate the Merger Agreement.")).toBe(true);
    expect(saysMergerTerminated("The Merger Agreement was terminated effective as of May 21, 2026.")).toBe(true);
  });
  it("ignores agreements ended at the closing and rights to terminate", () => {
    expect(saysMergerTerminated("In connection with the consummation of the Merger pursuant to the Merger Agreement, the Company terminated its Credit Agreement.")).toBe(false);
    expect(saysMergerTerminated("Item 1.02. On the Closing Date, in connection with the Merger Agreement, all commitments under the Credit Agreement were terminated.")).toBe(false);
    expect(saysMergerTerminated("Parent has the right to terminate the Merger Agreement if the closing has not occurred.")).toBe(false);
    expect(saysMergerTerminated("The Note becomes due and payable if the Merger Agreement is terminated in accordance with its terms.")).toBe(false);
    expect(saysMergerTerminated("Item 1.02. The Company repaid its Credit Agreement. Forward-Looking Statements: risks include any event that could give rise to the right of Greenhill or Mizuho to terminate the Merger Agreement.")).toBe(false);
    // A termination described under Item 1.01, with Item 1.02 pointing to it.
    expect(saysMergerTerminated("Item 1.01. On March 4, 2026, the parties entered into a Termination Agreement, pursuant to which they agreed to terminate the Merger Agreement, effective immediately. Item 1.02. The information in Item 1.01 is incorporated by reference.")).toBe(true);
  });
});

describe("releaseTerms (the value of a deal from its announcement release)", () => {
  const release = `News Release FOR IMMEDIATE RELEASE OCTOBER 11, 2026
Atlas Oil Announces Merger with Ridge Natural Resources in an All-Stock Transaction
• Transforms Atlas's upstream portfolio
SPRING, Texas - Atlas Oil Corporation (NYSE: ATL) and Ridge Natural Resources (NYSE: RDG) jointly announced a definitive agreement for Atlas to acquire Ridge. The merger is an all-stock transaction valued at $59.5 billion, or $253 per share, based on Atlas's closing price on October 5, 2026, an implied premium of 18% to Ridge's unaffected price.`;

  it("reads the value of a release the full parser can't read (\"Announces Merger with\")", () => {
    const t = releaseTerms(release, "Ridge Natural Resources Co", "Atlas Oil Corporation")!;
    expect(t.valueUsd).toBe(59.5e9);
    expect(t.valueKind).toBe("transaction");
    expect(t.consideration).toBe("Stock");
  });

  it("needs both companies named, a signed agreement, and no completion or termination", () => {
    expect(releaseTerms(release, "Ridge Natural Resources Co", "Summit Energy Inc.")).toBeNull();
    expect(releaseTerms(release.replace("Announces Merger with", "Completes Merger with"), "Ridge Natural Resources Co", "Atlas Oil Corporation")).toBeNull();
    expect(releaseTerms("Atlas Oil and Ridge Natural Resources announce record quarterly results. Revenue was $5.1 billion.", "Ridge Natural Resources Co", "Atlas Oil Corporation")).toBeNull();
    // A shell buyer no release names: the target alone is enough.
    expect(releaseTerms(release, "Ridge Natural Resources Co", "Bullseye Merger Sub, Inc.")?.valueUsd).toBe(59.5e9);
  });
});
