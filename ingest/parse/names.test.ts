import { describe, expect, it } from "vitest";
import { cleanPartyName, isPlaceholderBuyer, isPlausibleName } from "./names";

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
