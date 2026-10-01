import { describe, expect, it } from "vitest";
import { aimsOf, individualName, isActivist, parse13DXml, parseDailyIndex, personFromConformed, purposeExcerpt } from "./thirteend";

describe("personFromConformed", () => {
  it("turns EDGAR's last-name-first person names around", () => {
    expect(personFromConformed("ICAHN CARL C")).toBe("Carl C. Icahn");
    expect(personFromConformed("Stilwell Joseph")).toBe("Joseph Stilwell");
    expect(personFromConformed("HOENE MARY JOAN")).toBe("Mary Joan Hoene");
    expect(personFromConformed("KARP JASON H.")).toBe("Jason H. Karp");
    expect(personFromConformed("MCDONALD JOHN JR")).toBe("John McDonald Jr.");
    expect(personFromConformed("O'BRIEN MARY")).toBe("Mary O'Brien");
  });

  it("individualName: the person's own signature decides the order, else an all-capitals EDGAR name is turned", () => {
    const base = { issuerCik: "1", issuerName: "X", eventDate: null, filerCik: null, purpose: "" };
    const person = (name: string) => ({ name, cik: "9", percent: 6, shares: 1, individual: true });
    // EDGAR has "Braeden Lichti" (typed in natural order); the signature confirms it.
    expect(individualName({ ...base, persons: [person("Braeden Lichti")], signatures: [{ person: "Braeden Lichti", signature: "Braeden Lichti" }] }, "9", "Braeden Lichti")).toBe("Braeden Lichti");
    expect(individualName({ ...base, persons: [person("HONIG JONATHAN")], signatures: [{ person: "HONIG JONATHAN", signature: "Jonathan Honig" }] }, "9", "HONIG JONATHAN")).toBe("Jonathan Honig");
    expect(individualName({ ...base, persons: [person("Stifano Mario")], signatures: [{ person: "Stifano Mario", signature: "mario stifano" }] }, "9", "Stifano Mario")).toBe("Mario Stifano");
    // Someone else signed (a fund's officer): only an all-capitals name is turned around.
    expect(individualName({ ...base, persons: [person("STILWELL JOSEPH")], signatures: [{ person: "Stilwell Value LLC", signature: "Megan Parisi" }] }, "9", "Stilwell Joseph")).toBe("Joseph Stilwell");
    expect(individualName({ ...base, persons: [person("Daniel Nissim")], signatures: [] }, "9", "Daniel Nissim")).toBeNull();
    expect(individualName({ ...base, persons: [{ ...person("Starboard Value LP"), individual: false }], signatures: [] }, "9", "STARBOARD VALUE LP")).toBeNull();
  });

  it("leaves entities alone", () => {
    for (const n of ["Starboard Value LP", "Saba Capital Management, L.P.", "Coliseum Capital Management, LLC", "Constellation Software Inc", "JANA Partners Management, LP", "Icahn Enterprises", "Northstrive Fund II LP"]) {
      expect(personFromConformed(n), n).toBeNull();
    }
  });
});

const INDEX = `Form Type   Company Name                                                  CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------------------------------------
SCHEDULE 13D     Graham Capital Management, L.P.                               1315421     20260924    edgar/data/1315421/0000950142-26-002581.txt
SCHEDULE 13D     Host Digital Inc.                                             1948864     20260924    edgar/data/1948864/0000950142-26-002581.txt
SCHEDULE 13D/A   Starboard Value LP                                            1517137     20260924    edgar/data/1517137/0000921895-26-001234.txt
10-K             Some Company Inc                                              12345       20260924    edgar/data/12345/0000012345-26-000001.txt
`;

const XML = `<?xml version="1.0"?><edgarSubmission><headerData><filerInfo><filer><filerCredentials><!-- Field: Name; Data: Acme Activist LP --><cik>0001517137</cik><ccc>X</ccc></filerCredentials></filer></filerInfo></headerData>
<formData><coverPageHeader><dateOfEvent>09/17/2026</dateOfEvent><issuerInfo><issuerCIK>0000012345</issuerCIK><issuerName>Widget Corp &amp; Co.</issuerName></issuerInfo></coverPageHeader>
<reportingPersons><reportingPersonInfo><reportingPersonCIK>0001517137</reportingPersonCIK><reportingPersonName>Starboard Value LP</reportingPersonName><aggregateAmountOwned>2598680.00</aggregateAmountOwned><percentOfClass>9.99</percentOfClass></reportingPersonInfo>
<reportingPersonInfo><reportingPersonNoCIK>Y</reportingPersonNoCIK><reportingPersonName>Jeffrey C. Smith</reportingPersonName><aggregateAmountOwned>2598680.00</aggregateAmountOwned><percentOfClass>9.99</percentOfClass><typeOfReportingPerson>IN</typeOfReportingPerson></reportingPersonInfo></reportingPersons>
<items1To7><item4><transactionPurpose>The Reporting Persons believe the Shares are undervalued. They intend to nominate directors for election at the 2027 annual meeting and may urge the Board to explore strategic alternatives, including a sale of the Company.</transactionPurpose></item4></items1To7></formData></edgarSubmission>`;

describe("parseDailyIndex", () => {
  it("reads 13D rows and skips other forms", () => {
    const rows = parseDailyIndex(INDEX, /^SCHEDULE 13D/);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ form: "SCHEDULE 13D", company: "Graham Capital Management, L.P.", cik: "1315421", date: "2026-09-24", adsh: "0000950142-26-002581" });
    expect(rows[2].form).toBe("SCHEDULE 13D/A");
  });
});

describe("parse13DXml", () => {
  it("reads the issuer, the stakes and Item 4", () => {
    const p = parse13DXml(XML)!;
    expect(p.issuerCik).toBe("12345");
    expect(p.issuerName).toBe("Widget Corp & Co.");
    expect(p.eventDate).toBe("2026-09-17");
    expect(p.filerCik).toBe("1517137");
    expect(p.persons[0]).toEqual({ name: "Starboard Value LP", cik: "1517137", percent: 9.99, shares: 2598680, individual: false });
    expect(p.persons[1].cik).toBeNull();
    expect(p.persons[1].individual).toBe(true);
    expect(p.purpose).toContain("nominate directors");
  });
  it("returns null without an issuer", () => {
    expect(parse13DXml("<edgarSubmission></edgarSubmission>")).toBeNull();
  });
});

describe("aims / activist", () => {
  it("tags what the investor wants", () => {
    expect(aimsOf("They intend to nominate directors and urge a sale of the Company and share repurchases.")).toEqual(["Board seats", "Sale or strategic review", "Capital return"]);
  });
  it("flags campaigns but not founders, placements, boilerplate or control holders", () => {
    const ctx = { percent: 7, issuerName: "Widget Corp" };
    expect(isActivist("Starboard Value LP", "Investment purposes.", ctx)).toBe(true);
    expect(isActivist("E.J. Elliott Family Limited Partnership", "Investment purposes.", ctx)).toBe(false);
    const campaign = "The Reporting Persons intend to nominate directors at the annual meeting. On May 1 they sent a letter to the Board urging a sale.";
    expect(isActivist("Small Fund LP", campaign, ctx)).toBe(true);
    const founder = "Mr. Smith is a co-founder and serves as Chairman of the Issuer. The Reporting Person intends to nominate directors under the investor rights agreement.";
    expect(isActivist("Smith John", founder, ctx)).toBe(false);
    const placement = "The shares were acquired pursuant to a Securities Purchase Agreement with the Issuer, which gives the investor board representation.";
    expect(isActivist("Growth Fund LP", placement, ctx)).toBe(false);
    const boilerplate =
      "The Reporting Persons acquired the Shares for investment purposes. The Reporting Persons may, from time to time, engage in discussions with management regarding (a) an extraordinary transaction, (d) changes to the board, and (e) the dividend policy.";
    expect(isActivist("Quiet Fund LP", boilerplate, ctx)).toBe(false);
    expect(aimsOf(boilerplate)).toEqual([]);
    expect(isActivist("Takeover Time LLC", campaign, { percent: 62, issuerName: "Widget Corp" })).toBe(false);
    expect(isActivist("Irenic Sponsor, LLC", campaign, { percent: 20, issuerName: "Irenic Acquisition Corp." })).toBe(false);
  });
  it("makes a readable excerpt", () => {
    expect(purposeExcerpt("Item 4. Purpose of Transaction. Short.")).toBe("Short.");
    const long = "First sentence here. ".repeat(40);
    expect(purposeExcerpt(long, 100).endsWith("…")).toBe(true);
  });
});
