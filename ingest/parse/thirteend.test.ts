import { describe, expect, it } from "vitest";
import { aimsOf, campaignText, individualName, isActivist, parse13DXml, parseDailyIndex, personFromConformed, purposeExcerpt, stakeFigures } from "./thirteend";

describe("what a 13D states", () => {
  it("a tender buyer's holders being urged to read isn't a demand (WhiteHawk / PHX Minerals)", () => {
    expect(isActivist("WhiteHawk Income Corp", "The Reporting Person acquired the Shares in the Offer. Holders of Shares are urged to read the Schedule TO and the press release. Tax withholding applies, and holders may demand the appraisal of their Shares.", { percent: 40, issuerName: "PHX Minerals", source: "tender offer" })).toBe(false);
  });

  it("a hedged clause goes, not the campaign beside it (Radoff / Alto Ingredients), and Saba's only hedges stay out", () => {
    const radoff = "The Reporting Persons intend to vote their Shares against the reelection of all directors at the annual meeting, and may nominate a competing slate.";
    expect(isActivist("Bradley Radoff", radoff, { percent: 6, issuerName: "Alto Ingredients" })).toBe(true);
    expect(aimsOf("The Reporting Persons may make binding or non-binding shareholder proposals, or may nominate one or more individuals.")).toEqual([]);
  });

  it("an own-voice letter still outweighs how the shares were bought (Karp / Grove)", () => {
    expect(isActivist("Kevin Karp", "The Reporting Person sent a letter to the Issuer's board urging a sale of the Issuer.", { percent: 5.4, issuerName: "Grove", source: "Subscription Agreement" })).toBe(true);
  });
});

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

// Item 4 wordings from real 13Ds, cut to the sentences that decide.
const SABA =
  'The Reporting Persons acquired the Common Shares to which this Schedule 13D relates in the ordinary course of business for investment purposes because they believe that the Common Shares are undervalued and represent an attractive investment opportunity. The Reporting Persons may engage in discussions with management, the Board of Directors (the "Board"), other shareholders of the Issuer and other relevant parties, including representatives of any of the foregoing, concerning matters concerning the Issuer\'s business, operations, board appointments, governance, performance, management, capitalization and timing of any potential liquidation of the Issuer. The Reporting Persons may also propose or take one or more of the actions described in subsections (a) through (j) of Item 4 of Schedule 13D, including the solicitation of proxies. The Reporting Persons may make binding or non-binding shareholder proposals, or may nominate one or more individuals as nominees for election to the Board in connection with their investment in the Common Shares of the Issuer. The Reporting Persons intend to review their investment in the Issuer on a continuing basis. The Reporting Persons have not entered into any agreement with any third party to act together for the purpose of acquiring, holding, voting or disposing of the Common Shares reported herein.';
const SHN =
  "On September 24, 2026, S.H.N. delivered a letter to the Issuer demanding that the Issuer convene a special general meeting of shareholders. In such letter, the S.H.N. requested that the agenda of the special general meeting include proposals to (i) remove the current members of the Issuer's board of directors other than Dr. Ellen S. Baron and Augustine Lawlor and (ii) elect S.H.N.'s nominees to the Issuer's board of directors. A copy of the letter is attached hereto as Exhibit 1.";
const KARP =
  'The Reporting Persons believe the securities of the Issuer are undervalued and that the Issuer\'s board of directors (the "Board") must pursue strategic alternatives, such as a sale, merger or take-private transaction, in order to maximize shareholder value. Consistent with the foregoing, on July 8, 2025, the Reporting Persons delivered an open letter to the Board.';
const OPEN_MARKET = "The Shares were purchased with working capital in open market purchases.";
const ctx = { percent: 7, issuerName: "Widget Corp", source: OPEN_MARKET };

describe("what the investor wants, in the filings' words", () => {
  it("Saba: undervalued and 'may nominate' are no demands, and it stays an activist", () => {
    expect(aimsOf(SABA)).toEqual([]);
    expect(isActivist("Saba Capital Management, L.P.", SABA, ctx)).toBe(true);
  });
  it("a reason for buying isn't a demand, the demand next to it is (Honig, JANA, Voss)", () => {
    const honig =
      'The Reporting Persons purchased the Shares based on the Reporting Persons\' belief that the Shares, when purchased, were undervalued and represented an attractive investment opportunity. On September 29, 2026, Mr. Honig issued a public letter to the Board of Directors of the Issuer (the "Board") expressing his view that the Board should take immediate steps to explore a sale of the Issuer.';
    expect(aimsOf(honig)).toEqual(["Sale or strategic review"]);
    // JANA's first Alkami 13D (April) says only this.
    expect(aimsOf("The Reporting Person acquired the Shares because it believes the Shares are undervalued and represent an attractive investment opportunity.")).toEqual([]);
    const jana =
      "The Reporting Person has had, and intends to have, discussions with the Issuer's board of directors and management regarding: (1) exploring a sale, including by engaging with multiple parties interested in a potential acquisition of the Issuer; (2) corporate governance; and (3) board leadership.";
    expect(aimsOf(jana)).toEqual(["Sale or strategic review", "Management or governance"]);
    expect(isActivist("JANA Partners Management, LP", jana, ctx)).toBe(true);
  });
  it("(i) opens a demand, (a) through (j) is the SEC's checklist (S.H.N. on PRF, Recanati on Evogene)", () => {
    expect(aimsOf(SHN)).toEqual(["Board seats"]);
    expect(isActivist("S.H.N. Financial Investments Ltd.", SHN, ctx)).toBe(true);
    expect(campaignText(SHN)).toContain("(i) remove the current members");
    const checklist = "Except as described herein, the Reporting Person does not currently have any plans or proposals that relate to or would result in any of the transactions or other matters specified in subparagraphs (a) through (j) of Item 4 of Schedule 13D.";
    expect(campaignText(checklist)).toBe("");
    expect(campaignText("The Reporting Persons have no plans under (a) through (j) to nominate anyone.")).toBe("");
  });
  it("splits at sentence ends, not at a title or a semicolon, and the month May is no hedge", () => {
    expect(campaignText("Mr. Chapek and Dr. Baron wrote to the Board; they want a sale. It is done.")).toBe("Mr. Chapek and Dr. Baron wrote to the Board; they want a sale. It is done.");
    expect(aimsOf('On May 13, 2026 the Reporting Persons sent a letter to the Board calling for a strategic review.')).toEqual(["Sale or strategic review"]);
  });
  it("a sale only when it is the demand (Star Equity on GEE; a Merger Agreement, Staar's own deal, is not)", () => {
    expect(aimsOf('On January 22, 2026, Star Equity issued a press release (the "January 22 Press Release") expressing its belief that a merger with Star Equity would significantly benefit the Issuer stockholders.')).toEqual(["Sale or strategic review"]);
    expect(aimsOf('On August 5, 2025, the Issuer announced that it had entered into a definitive merger agreement (the "Merger Agreement"), pursuant to which Alcon will acquire the Issuer.')).toEqual([]);
  });
  it("the company's announced divestiture isn't a demand, a spin-out is (Palogic on Health Catalyst, MAK on Evotec)", () => {
    expect(aimsOf("On June 22, 2026, the Palogic Value Management sent a letter to the Issuer expressing support for the Issuer's announced divestiture of VitalWare.")).toEqual([]);
    expect(aimsOf("The Reporting Persons sent a letter proposing a spin out of the Issuer's manufacturing business.")).toEqual(["Break-up or spin-off"]);
    expect(aimsOf("The Reporting Persons have had constructive discussions with Management and the Board around a significant reduction in the Issuer's corporate overhead expenses and potential divestitures of non-core assets.")).toEqual(["Break-up or spin-off"]);
  });
  it("capital return is a demand however it is written (BML on AN2)", () => {
    expect(aimsOf("On May 7, 2025, the Reporting Person sent a letter to the Issuer's Board expressing its belief that an orderly winddown, liquidation, and capital return is in the best interests of the shareholders of the Issuer.")).toEqual(["Capital return"]);
  });
});

describe("who is an activist, in the filings' words", () => {
  it("words that only look like a campaign", () => {
    // KMJ on Katapult: shares from a merger, and a registration agreement's demand rights.
    const katapult = 'The Registration Rights Agreement also provides specified demand rights to certain "Primary Holders" (subject to customary conditions, including a minimum offering size and underwriter cutbacks) and piggyback registration rights for all holders of registrable securities.';
    expect(isActivist("KMJ Group Holdings, LLC", katapult, ctx)).toBe(false);
    expect(aimsOf(katapult)).toEqual([]);
    // Koch on Ibotta.
    const ibotta =
      "The Public Shares were not acquired and are not held for the purpose of or with the effect of changing or influencing the control of the Issuer and were not acquired and are not held in connection with or as a participant in any transaction having that purpose or effect, other than activities solely in connection with a nomination under 240.14a-11. The Reporting Persons view themselves as passive investors.";
    expect(isActivist("KDT Ibotta Holdings, LLC", ibotta, ctx)).toBe(false);
    // Jeffery on Vireo.
    expect(isActivist("Christopher Jeffery", "Mr. Jeffery is the Chief Demand Officer of the Issuer. As such, he participates in the management of the Issuer.", ctx)).toBe(false);
    // Assia on eToro: his own company's board committee.
    expect(isActivist("Jonathan Alexander Assia", "Also, subject to applicable approvals from the Compensation, Nominating and Governance Committee of the Board of Directors, the Reporting Person will receive additional securities.", ctx)).toBe(false);
  });
  it("a director backing his own board isn't a dissident (Recanati on Evogene)", () => {
    const recanati =
      'The Reporting Person serves as a member of the board of directors of the Issuer. In connection with the Issuer\'s 2026 annual general meeting of shareholders, scheduled for September 4, 2026 (the "AGM"), at which there will be a contested director election, the Reporting Person intends to vote all Ordinary Shares beneficially owned by him in favor of the slate of director nominees nominated by the Issuer\'s current board of directors, and to disregard the slate of directors nominated by the dissident shareholders.';
    expect(isActivist("Leon Recanati", recanati, ctx)).toBe(false);
  });
  it("shares bought from the company, read from Item 3 (Suvretta on Avalyn), or under a purchase agreement (cbdMD, DNA X, KLX)", () => {
    const suvretta = "In April 2025, David Friedman, M.D., was appointed to the Board. Dr. Friedman serves as a Managing Director and Senior Analyst at Suvretta Capital. The Reporting Persons recommended him to the Board.";
    expect(isActivist("Suvretta Capital Management, LLC", suvretta, ctx)).toBe(true);
    expect(isActivist("Suvretta Capital Management, LLC", suvretta, { ...ctx, source: "In April 2025, the Funds entered into a Series D Preferred Stock Purchase Agreement with the Issuer and certain other stockholders." })).toBe(false);
    expect(isActivist("Akretive Holdings LLC", "The Reporting Person acquired all of his securities pursuant to an Asset Purchase Agreement dated September 1, 2026, which provides the Reporting Person with the right to nominate a director for the Nominating and Corporate Governance Committee of the Issuer to consider.", ctx)).toBe(false);
    expect(isActivist("DNA Holdings Venture Inc.", "Pursuant to the Membership Interest Purchase Agreement, DNA Holdings will have the right to designate one officer and one nominee for election to the Issuer's board of directors.", ctx)).toBe(false);
    expect(isActivist("Whitebox Advisors LLC", 'On August 6, 2026, the Company entered into a Rights Offering Backstop Agreement (the "Backstop Agreement") with the holders of the 2030 Notes. Each Designating Holder will have the right to have its Designated Director nominated for election as a director at each subsequent annual meeting.', ctx)).toBe(false);
  });
  it("a known fund's shares from a deal or a note exchange are no campaign (Elliott on Uniti, D. E. Shaw on Gossamer)", () => {
    const uniti = 'Pre-Closing Reorganization of Windstream and Merger of Old Uniti and Windstream into Wholly-Owned Subsidiary of the Issuer. At the closing of the Pre-Closing Reorganization, the Elliott Funds received (i) 52,910,291 shares of Common Stock.';
    expect(isActivist("Elliott Investment Management L.P.", uniti, ctx)).toBe(false);
    const gossamer = 'On May 18, 2026, the Issuer commenced an exchange offer (the "Exchange Offer") to exchange any and all of its 5.00% Convertible Senior Notes due 2027.';
    expect(isActivist("D. E. Shaw & CO, L.P.", gossamer, ctx)).toBe(false);
    // A known fund's private placement alone is still that fund's stake (Caligan on Verrica, Sachem Head on Ionic Digital).
    const caligan = 'On November 23, 2025, the Caligan Fund and Caligan Accounts and certain other institutional investors entered into a Securities Purchase Agreement with the Issuer (the "Purchase Agreement"), pursuant to which the Issuer agreed to sell and issue to the Caligan Fund and Caligan Accounts in a private placement transaction.';
    expect(isActivist("Caligan Partners LP", caligan, ctx)).toBe(true);
  });
  it("only hedged wants leave (Spruce House, Sit on Eaton Vance); a stated letter stays (Sit on the MFS funds)", () => {
    const spruce =
      "The Reporting Persons are evaluating various strategic options with respect to their investment in the Issuer. In connection with the evaluation of strategic options with respect to their investment in the Issuer, the Reporting Persons may explore or make proposals (whether preliminary or final) with respect to, among other things, the composition of the Board of Directors of the Issuer (the \"Board\") (including by nominating candidates for election to the Board).";
    expect(isActivist("Spruce House Investment Management LLC", spruce, ctx)).toBe(false);
    const sitEaton = "The Sit Entities may make binding and non-binding shareholder proposals, or may nominate one or more individuals as nominees for election to the Board.";
    expect(isActivist("SIT Investment Associates Inc", sitEaton, ctx)).toBe(false);
    const sitMfs = "On February 24, 2026 the Sit Entities sent a letter to the Board of Trustees stating the Sit Entities' opposition to the proposed Reorganization, a copy of which is attached as Exhibit C and is incorporated by reference herein.";
    expect(isActivist("SIT Investment Associates Inc", sitMfs, ctx)).toBe(true);
  });
  it("what must stay", () => {
    // Karp on Grove: Item 3 says Subscription Agreement, and the open letter outweighs it.
    expect(isActivist("Jason H. Karp", KARP, { ...ctx, source: "The shares reported herein were acquired pursuant to that certain Subscription Agreement, dated as of November 10, 2022." })).toBe(true);
    expect(aimsOf(KARP)).toEqual(["Sale or strategic review"]);
    // Constellation on Sabre: a governance agreement, and no fund name on the list.
    const sabre = 'On March 5, 2026 (the "Effective Date"), certain of the Reporting Persons and the Issuer entered into a strategic governance agreement (the "Agreement") pursuant to which the Issuer agreed to appoint Damian McKay as a member of the Issuer\'s board of directors. In addition, the Issuer agreed to nominate the New Director for election at the 2026 Annual Meeting.';
    expect(isActivist("Constellation Software Inc", sabre, ctx)).toBe(true);
    expect(aimsOf(sabre)).toEqual(["Board seats", "Management or governance"]);
    // Oasis on Vail.
    const vail = 'On September 10, 2026, the Oasis Fund delivered to the Issuer a notice (the "Nomination Notice") of its intention to nominate Mr. Chapek, Mr. Hudson, Mr. Roberts, and Ms. Street for election to the Board.';
    expect(isActivist("Oasis Management Co Ltd.", vail, ctx)).toBe(true);
    expect(aimsOf(vail)).toEqual(["Board seats"]);
    // Starboard on BILL, Stilwell on CSB, Icahn, Voss, Blackwells: known funds, in the market.
    const bill = 'The Reporting Persons intend to nominate a slate of highly qualified director candidates for election to the Issuer\'s Board of Directors (the "Board") at the Issuer\'s 2025 Annual Meeting of Stockholders.';
    expect(isActivist("Starboard Value LP", bill, ctx)).toBe(true);
    expect(aimsOf(bill)).toEqual(["Board seats"]);
    expect(isActivist("Joseph Stilwell", "Since 2000, members or affiliates of the Group have taken an 'activist position' in 80 other publicly-traded companies.", ctx)).toBe(true);
    expect(isActivist("Carl C. Icahn", "The Reporting Persons acquired their positions for investment purposes in the belief that such shares of the Common Stock are undervalued.", ctx)).toBe(true);
    expect(isActivist("Voss Capital, LP", 'On March 4, 2026, the Reporting Persons issued an open letter (the "March 4th Letter") to the Issuer\'s board of directors (the "Board").', ctx)).toBe(true);
    expect(isActivist("Blackwells Capital LLC", 'Braemar Hotels & Resorts Inc. (the "Issuer") entered into a Cooperation Agreement with Blackwells Capital and certain other parties thereto regarding the withdrawal of the Blackwells Capital proxy campaign.', ctx)).toBe(true);
    // Poplar Point on RGP: recommended a director to the board.
    expect(isActivist("Poplar Point Capital Management LLC", "The Reporting Person did recommend Filip Gyde to the Board of RGP and he joined the Board as announced by the company.", ctx)).toBe(true);
    expect(aimsOf("At this time, the Reporting Persons do not have the specific intent to make changes to the Board. The Reporting Person did recommend Filip Gyde to the Board of RGP and he joined the Board as announced by the company.")).toEqual([]);
  });
  it("a dissident who says what is wrong needs no letter (Moalem on Nano-X, Russell on Abeona)", () => {
    const nanox =
      "The Reporting Person is dissatisfied with the Issuer's performance and the resulting impact on shareholder value. In particular, the Reporting Person opposes the proposed increase in the Issuer's authorized share capital from 150,000,000 to 450,000,000 Ordinary Shares. As of the date hereof, has not identified any particular candidates for nomination to the Board.";
    expect(isActivist("Moshe Moalem", nanox, { ...ctx, source: "The Ordinary Shares beneficially owned by the Reporting Person were acquired prior to and following the Issuer's initial public offering, using personal funds or through other transactions." })).toBe(true);
    const abeona =
      'Beginning in May 2026, the Reporting Persons communicated their concerns (as a shareholder in an informal manner), to the Issuer\'s management and board of directors (the "Board"). At that meeting, Mr. Russell presented a summary of his concerns, including the Board should consider adding additional independent directors, and expressed his view that a change in the Issuer\'s executive leadership should be explored.';
    expect(isActivist("James Russell Revocable Trust", abeona, ctx)).toBe(true);
  });
});

describe("the quote", () => {
  it("leads with what the investor wants, not why it bought (CAS on Hilton Grand Vacations)", () => {
    const cas =
      "The shares of Common Stock of the Issuer covered by this statement were originally acquired in the ordinary course of business solely for investment purposes and not for the purposes of participating in or influencing the management of the Issuer. The shares of Common Stock of the Issuer covered by this statement were previously reported on Schedule 13G, originally filed by the Reporting Persons on February 14, 2022. The Reporting Persons are filing this Schedule 13D to report that they have initiated communications and intend to continue to engage in conversations with the Issuer's management and board of directors regarding the composition of the board of directors of the Issuer.";
    expect(purposeExcerpt(cas)).toMatch(/^The Reporting Persons are filing this Schedule 13D to report/);
  });
  it("reads whole past a title, and keeps the words the tagger ignores", () => {
    expect(purposeExcerpt(SHN)).toContain("other than Dr. Ellen S. Baron and Augustine Lawlor and (ii) elect");
    const abeona = "On October 14, 2026, Mr. Russell met electronically with two members of the Board: Faith L. Charles, Interim Chair of the Board and Chair of the Board's Nominating and Corporate Governance Committee, and Keith A. Goldan.";
    expect(purposeExcerpt(abeona)).toContain("Nominating and Corporate Governance Committee");
    expect(campaignText(abeona)).not.toContain("Nominating");
  });
  it("falls back on the whole text when too little is left, as with Saba's: thin but true", () => {
    expect(purposeExcerpt(SABA)).toMatch(/^The Reporting Persons intend to review their investment/);
    expect(purposeExcerpt("The Reporting Persons acquired the Shares for investment purposes.")).toBe("The Reporting Persons acquired the Shares for investment purposes.");
  });
});

describe("the XML's other parts", () => {
  const withItems = (item3: string, item5: string, persons = "") =>
    XML.replace("<item4>", `<item3><fundsSource>${item3}</fundsSource></item3><item4>`).replace("</item4>", `</item4><item5>${item5}</item5>`).replace("</reportingPersons>", `${persons}</reportingPersons>`);

  it("reads numeric entities: BML's letter sat in one run-on with the hedged text", () => {
    const xml = XML.replace("They intend to nominate directors", "The Shares were bought in the ordinary course.&#13;&#13; They intend to nominate directors").replace("Widget Corp &amp; Co.", "Widget Corp &amp; Co&#46;");
    const p = parse13DXml(xml)!;
    expect(p.purpose).not.toContain("&#");
    expect(p.purpose).toContain("ordinary course. They intend");
    expect(p.issuerName).toBe("Widget Corp & Co.");
  });
  it("reads Item 3", () => {
    const p = parse13DXml(withItems("Series D Preferred Stock Purchase Agreement &amp; more.", "Not applicable."))!;
    expect(p.source).toBe("Series D Preferred Stock Purchase Agreement & more.");
    expect(p.groupTotal).toBeNull();
  });
  it("a group's stated total stands over the largest member (Karp and Berman on Grove)", () => {
    const item5 =
      "As of the date hereof, the Reporting Persons beneficially own an aggregate of 2,188,109 shares of Class A Common Stock, representing approximately 5.4% of the outstanding shares of Class A Common Stock (based upon 40,254,806 shares). (3) Jason H. Karp Number of shares: 1,631,110 Percentage of shares: 4.1%";
    const p = parse13DXml(withItems("Personal funds.", item5))!;
    expect(p.groupTotal).toEqual({ shares: 2188109, percent: 5.4 });
    expect(stakeFigures({ persons: [{ name: "Jason H. Karp", cik: "1", percent: 4.1, shares: 1631110, individual: true }], groupTotal: p.groupTotal })).toEqual({ percent: 5.4, shares: 2188109 });
  });
  it("other wordings keep the largest member (Appaloosa's event-date figure, Phoenix's own holding)", () => {
    const appaloosa = "As a result of the foregoing, for purposes of Reg. Section 240.13d-3, as of the Event Date, each of ACI, ALP and Mr. Tepper may be deemed to beneficially own the 3,735,655 shares of Common Stock of the Issuer held in the aggregate by the Funds, for an aggregate beneficial ownership percentage of approximately 5.8%.";
    expect(parse13DXml(withItems("Funds.", appaloosa))!.groupTotal).toBeNull();
    const phoenix = "As of the date on the cover page of this Schedule 13D, Phoenix Financial may be deemed to be the beneficial owner of the 2,574,926.52 Ordinary Shares, which represent approximately 5.72% of the number of Ordinary Shares outstanding.";
    expect(parse13DXml(withItems("Funds.", phoenix))!.groupTotal).toBeNull();
    const persons = [{ name: "A", cik: "1", percent: 4.9, shares: 3190207, individual: false }];
    expect(stakeFigures({ persons, groupTotal: null })).toEqual({ percent: 4.9, shares: 3190207 });
    // A total under the largest member is a misread.
    expect(stakeFigures({ persons, groupTotal: { shares: 100, percent: 1 } })).toEqual({ percent: 4.9, shares: 3190207 });
  });
  it("a figure under 1% is no 13D's stake", () => {
    expect(stakeFigures({ persons: [{ name: "A", cik: "1", percent: 0.4, shares: 10, individual: false }], groupTotal: null })).toEqual({ percent: null, shares: 10 });
  });
});
