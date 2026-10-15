import { describe, expect, it } from "vitest";
import { isPlaceholderBuyer } from "./names";
import { sponsorFromText } from "./sponsor";

// Synthetic text in the style of announcement releases and merger proxies.
describe("sponsorFromText (the firm behind an acquisition vehicle)", () => {
  it("reads a release headline and a proxy's description of Parent", () => {
    expect(sponsorFromText("Lattice Web Enters into Definitive Agreement to Be Acquired by Permira for $6.9 Billion", "Lattice Web, Inc.", "Spaceship Purchaser, Inc.")).toBe("Permira");
    expect(
      sponsorFromText(
        'Parent and Merger Sub are affiliates of investment funds managed by Thoma Bravo, L.P. ("Thoma Bravo"). Upon completion of the merger, the Company will be a privately held company.',
        "Olo Inc.",
        "Project Hospitality Parent, LLC",
      ),
    ).toBe("Thoma Bravo, L.P.");
    expect(sponsorFromText("Ribeye Parent, LLC is a newly formed entity controlled by BDT Capital Partners, LLC (together with its affiliates, \"BDT\").", "Weber Inc.", "Ribeye Parent, LLC")).toBe("BDT Capital Partners, LLC");
    // An Irish scheme's Rule 2.7 announcement names the bidder company, then its owner.
    expect(sponsorFromText("RECOMMENDED CASH OFFER for LAKESIDE THERAPEUTICS PLC by Birchwood Limited, a newly formed private limited company wholly owned by Amgen Inc. to be implemented by way of a scheme of arrangement", "Lakeside Therapeutics plc", "Acquirer Sub")).toBe("Amgen Inc");
    // Consortiums and firm descriptions before the names.
    expect(sponsorFromText("Corvid Health has entered into a definitive agreement to be acquired by a consortium of private investment firms composed of Elliott Investment Management, Patient Square Capital, and Veritas Capital for $43.00 per share.", "Corvid Health, Inc.", "Star Parent, Inc.")).toBe("Elliott Investment Management, Patient Square Capital, and Veritas Capital");
    expect(sponsorFromText("Lumen Bio today announced that it has entered into a definitive agreement to be acquired by funds managed by global investment firms Carlyle (NASDAQ: CG) and SK Capital Partners, LP.", "Lumen Bio, Inc.", "Beacon Parent Holdings, L.P.")).toBe("Carlyle");
  });

  it("cuts descriptions and keeps initials in personal names", () => {
    expect(sponsorFromText("Denali to be acquired by Clearlake Capital Group, one of the world's leading investment firms, in a deal valued at $7.7 billion.", "Dun & Bradstreet Holdings, Inc.", "Denali Intermediate Holdings, Inc.")).toBe("Clearlake Capital Group");
    expect(sponsorFromText("Parent is an entity controlled by Himanshu H. Shah. The Merger is expected to close in 2025.", "Emeren Group Ltd", "Parent")).toBe("Himanshu H. Shah");
  });

  it("rejects defined terms, clauses, the target and the vehicle itself", () => {
    expect(sponsorFromText("Parent is a Delaware corporation and an affiliate of Parent that was formed solely for the purpose of the Merger.", "Switch, Inc.", "Sunshine Bidco Inc.")).toBeNull();
    expect(sponsorFromText("The Company agreed to be acquired by Spaceship Purchaser, Inc.", "Lattice Web, Inc.", "Spaceship Purchaser, Inc.")).toBeNull();
    expect(sponsorFromText("Weber Inc. will be acquired by Weber Inc. affiliates.", "Weber Inc.", "Ribeye Parent, LLC")).toBeNull();
  });
});

describe("isPlaceholderBuyer: more vehicle shapes", () => {
  it("flags intermediate holdcos, fincos, parent holdings and project names", () => {
    for (const n of ["Denali Intermediate Holdings, Inc.", "Bullseye FinCo, Inc.", "Beacon Parent Holdings, L.P.", "Eclipse Parent Acquisitions, LLC", "Project Hospitality Parent, LLC", "Buyer Group Led by Evercel", "Acquirer Sub", "Acquiror Holdings LLC"]) {
      expect(isPlaceholderBuyer(n), n).toBe(true);
    }
    for (const n of ["Intercontinental Exchange, Inc.", "Permira", "Project Management Institute"]) expect(isPlaceholderBuyer(n), n).toBe(n === "Project Management Institute");
  });
});
