/** Closing days, announcement days and the words around them, in the filings' own wording (the last review against the filings, November 2026). */
import { describe, expect, it } from "vitest";
import { completedSigningOn, readLooseCompletion, readLooseEnd, readStatement, completedPhrases, statedClosingDay } from "./completion";
import { ownReleaseDay } from "./eightk";
import { datelinesOf, parsePressRelease } from "./press";

describe("the closing day a buyer's 8-K states", () => {
  it("in the Introductory Note, not the filing date (Kaleyra / mGage)", () => {
    const text = `Introductory Note On June 1, 2021, Kaleyra Inc., a Delaware corporation (the " Company " or " Parent ") completed its acquisition (the " Acquisition ") of Vivial Inc. (" Vivial "), and the business owned by Vivial known as mGage. Item 2.01 Acquisition or Disposition of Assets The information set forth in the Introductory Note above is incorporated by reference in response to this Item 2.01. As a result of the Acquisition, the Company acquired Vivial and the business known as mGage on June 1, 2021.`;
    expect(statedClosingDay(text, /\bmGage\b/i, "2021-02-19", "2021-06-07")).toBe("2021-06-01");
  });

  it("past an agreement's date in the note, \"Effective on\" (Mid Penn / 1st Colonial)", () => {
    const text = `Introductory Note. This Current Report on Form 8-K is being filed in connection with the transactions contemplated by that certain Agreement and Plan of Merger, dated as of September 24, 2025 (the " Merger Agreement "), by and between Mid Penn Bancorp, Inc., a Pennsylvania corporation (" Mid Penn "), and 1st Colonial Bancorp, Inc., a Pennsylvania corporation (" 1st Colonial "). Effective on February 27, 2026 (the " Closing Date "), Mid Penn completed its previously announced acquisition of 1st Colonial (the " Closing "). Item 2.01 Completion of Acquisition or Disposition of Assets. The information in the Introductory Note is incorporated.`;
    expect(statedClosingDay(text, /\b1st Colonial Bancorp\b/i, "2025-09-24", "2026-03-02")).toBe("2026-02-27");
  });

  it("in Item 2.01, under the term the deal goes by (Contango / Dolly Varden, Lixte / NOMAD)", () => {
    expect(statedClosingDay("Item 2.01. Completion of Acquisition or Disposition of Assets. On March 26, 2026, the Company completed the Arrangement pursuant to the terms of the Arrangement Agreement. Under the terms of the Arrangement Agreement, at the effective time. Item 9.01 Financial Statements.", /\bDolly Varden Silver\b/i, "2025-12-11", "2026-03-27")).toBe("2026-03-26");
    expect(statedClosingDay(`Item 2.01 Completion of Acquisition or Disposition of Assets. On July 1, 2026, the Merger was consummated by the filing of a Certificate of Merger filed with the Secretary of State of the State of Delaware (the "Effective Time"). Item 9.01 Financial Statements.`, /\bNomad Transportable Power Systems\b/i, "2026-06-16", "2026-07-02")).toBe("2026-07-01");
  });

  it("through Item 2.01's pointer to Item 1.01 (BurgerFi / Anthony's)", () => {
    const text = `Item 1.01 Entry into a Material Definitive Agreement. As previously announced, on October 8, 2021, BurgerFi International, Inc. entered into a Stock Purchase Agreement pursuant to which the Company agreed to acquire (the " Stock Acquisition ") 100% of the outstanding shares of Hot Air, Inc., under the name "Anthony's Coal Fired Pizza & Wings". On November 3, 2021, the Company, the Target and the Seller entered into an Amended and Restated Stock Purchase Agreement. On November 3, 2021, the Company completed the Stock Acquisition. In consideration for the Shares, the Company paid to the Seller $87,055,480. Item 2.01. Completion of Acquisition or Disposition of Assets. The disclosure set forth above in Item 1.01 of this Current Report on Form 8-K is incorporated by reference herein. Item 2.03. Creation of a Direct Financial Obligation.`;
    expect(statedClosingDay(text, /\bAnthony's Coal Fired Pizza\b/i, "2021-10-14", "2021-11-05")).toBe("2021-11-03");
  });

  it("never an agreement's date, whatever its place: the filing date stands", () => {
    expect(statedClosingDay("Item 2.01 Completion of Acquisition. The Company completed the acquisition of Acme Inc. pursuant to the Merger Agreement, dated as of May 30, 2026. Item 9.01 Exhibits.", /\bAcme\b/, "2026-03-01", "2026-06-03")).toBeNull();
    expect(statedClosingDay("Item 2.01 Completion of Acquisition. The Company completed the acquisition of Acme Inc. under the Merger Agreement entered into on May 30, 2026. Item 9.01 Exhibits.", /\bAcme\b/, "2026-03-01", "2026-06-03")).toBeNull();
    // Not before the announcement, not after the filing, not a day long before an 8-K due within days.
    expect(statedClosingDay("Item 2.01 Completion of Acquisition. On February 1, 2026, the Company completed the acquisition of Acme Inc. Item 9.01 Exhibits.", /\bAcme\b/, "2026-03-01", "2026-06-03")).toBeNull();
    expect(statedClosingDay("Item 2.01 Completion of Acquisition. On June 9, 2026, the Company completed the acquisition of Acme Inc. Item 9.01 Exhibits.", /\bAcme\b/, "2026-03-01", "2026-06-03")).toBeNull();
    expect(statedClosingDay("Item 2.01 Completion of Acquisition. On April 1, 2026, the Company completed the acquisition of Acme Inc. Item 9.01 Exhibits.", /\bAcme\b/, "2026-03-01", "2026-06-03")).toBeNull();
    // Not what will happen, nor what else was signed.
    expect(statedClosingDay("Item 2.01 Completion of Acquisition. The Company expects that on June 2, 2026 the acquisition of Acme Inc. will be completed. Item 9.01 Exhibits.", /\bAcme\b/, "2026-03-01", "2026-06-03")).toBeNull();
    expect(statedClosingDay(`Item 1.01 Entry into a Material Definitive Agreement. On June 2, 2026, the parties entered into the Termination Agreement, and the merger with Acme Inc. closed nothing. Item 2.01 Completion of Acquisition. See Item 1.01, incorporated here. Item 9.01 Exhibits.`, /\bAcme\b/, "2026-03-01", "2026-06-03")).toBeNull();
  });

  it("Item 1.01's other business isn't the deal, with an Item 2.01 of its own (Lions Gate's notes, Petrohawk's credit facility)", () => {
    const text = `Item 1.01. Entry into a Material Definitive Agreement. Lions Gate Senior Notes On May 27, 2026, FinanceCo completed an offering of $520,000,000 of notes, a transaction used in connection with the Merger. Item 2.01. Completion of Acquisition or Disposition of Assets. The information provided in the Introduction section of this Current Report, at some length so that this is no mere pointer to another section of the report on Form 8-K, is incorporated by reference herein. At the effective time of the merger with Acme Inc., each share was converted into the right to receive the merger consideration as set forth in the merger agreement and more particularly described in the proxy statement that was mailed to holders in the spring of this year. Item 9.01 Exhibits.`;
    expect(statedClosingDay(text, /\bStarz\b/, "2026-03-01", "2026-06-03")).toBeNull();
  });
});

describe("iSun: the 10-K dates it instead", () => {
  it("reads \"we acquired\" with its day", () => {
    const tenK = `On January 19, 2021, we completed a business combination (the "Merger Agreement") pursuant to which we acquired iSun Energy LLC ("iSun Energy, LLC").`;
    expect(readStatement(tenK, completedPhrases("iSun Energy"))).toEqual({ found: true, date: "2021-01-19", today: false });
    expect(readLooseCompletion(tenK, "iSun Energy").date).toBe("2021-01-19");
  });
});

describe("a target's own 8-K saying the deal closed", () => {
  it("the transactions of the agreement this deal signed (Senti)", () => {
    const text = `Introductory Note On October 21, 2026, Senti Biosciences Holdings, Inc., a Delaware corporation (the "Company"), completed the transactions contemplated by the Agreement and Plan of Merger, dated as of July 14, 2026 (the "Merger Agreement"), by and among the Company, Senti Holdings, Inc., a wholly owned subsidiary of the Company ("Midco"), ST NewCo Limited (f/k/a Celadon Partners SPV 35 Limited), ("Parent"), and Senti Merger Sub, Inc. ("Merger Sub"). Item 1.01 Entry into a Material Definitive Agreement. CVR Agreement On October 21, 2026 (the "Closing Date"), in connection with the closing, Midco entered into a Contingent Value Rights Agreement.`;
    expect(completedSigningOn(text, "2026-07-15", "2026-10-26")).toBe("2026-10-21");
  });

  it("a sale, in an Introduction (Sonim)", () => {
    const text = `Introduction This Current Report on Form 8-K is being filed in connection with the completion on January 23, 2026 (the " Closing Date ") of the previously announced sale (the " Asset Sale ") of substantially all of its assets by DNA X, Inc. (formerly, Sonim Technologies, Inc.), a Delaware corporation (the " Company "), to Pace Car Acquisition LLC, (the " Buyer "), other than (i) liabilities, as further describe in the Asset Purchase Agreement (as defined below), and (iv) the Company's Indian subsidiary, pursuant to the terms of the Asset Purchase Agreement, dated July 17, 2025, by and among the Company, the Buyer and Social Mobile Technology Holdings LLC. Item 1.01 Entry into a Material Definitive Agreement.`;
    expect(completedSigningOn(text, "2025-07-18", "2026-01-27")).toBe("2026-01-23");
  });

  it("not the company's own purchase between signing and closing, nor another buyer's agreement", () => {
    const own = `Item 2.01 Completion of Acquisition or Disposition of Assets. On December 15, 2025, the Company completed the purchase of 100% of the membership interests in DNA X LLC under a Membership Interest Purchase Agreement, dated December 15, 2025. Item 9.01 Exhibits.`;
    expect(completedSigningOn(own, "2025-07-18", "2025-12-18")).toBeNull();
    // Atlas's record, when Chatham's merger closes: another signing.
    const winner = `Introductory Note On March 28, 2022, the Company completed the merger contemplated by the Agreement and Plan of Merger, dated as of December 14, 2021, with Chatham Delta Parent, Inc. Item 2.01 Completion of Acquisition. See above.`;
    expect(completedSigningOn(winner, "2021-11-03", "2022-03-28")).toBeNull();
    expect(completedSigningOn(winner, "2021-12-14", "2022-03-28")).toBe("2022-03-28");
  });

  it("not a closing to come, nor the words of a covenant", () => {
    const text = `Introductory Note The Merger will be completed on or about October 21, 2026 under the Agreement and Plan of Merger, dated as of July 14, 2026. Item 8.01 Other Events.`;
    expect(completedSigningOn(text, "2026-07-15", "2026-10-26")).toBeNull();
  });
});

describe("the day a release says it went out", () => {
  it("an exhibit's dateline, days before the 8-K (Greif / Ipackchem, Earthstone / Independence)", () => {
    expect(ownReleaseDay("EX-99.1 2 gef2023projectarmoripackch.htm EX-99.1\nExhibit 99.1\nGreif Plans to Acquire IPACKCHEM\nDELAWARE, Ohio, Oct. 31, 2023 (GLOBE NEWSWIRE) -- In a release issued under the same headline earlier today by Greif, Inc.", "2023-11-06")).toBe("2023-10-31");
    expect(ownReleaseDay("Earthstone Energy Announces Significant Midland Basin Acquisition\nThe Woodlands, Texas, December 17, 2020 - Earthstone Energy, Inc. (NYSE: ESTE) today announced that it has entered into a definitive agreement to acquire Independence Resources Management, LLC.", "2020-12-22")).toBe("2020-12-17");
  });

  it("in brackets, and in the exhibit's header (NerdWallet / On The Barrelhead, PGT / Anlin)", () => {
    expect(datelinesOf("NerdWallet To Acquire On The Barrelhead\nSAN FRANCISCO (June 23, 2022) NerdWallet, Inc. today announced")).toContain("2022-06-23");
    expect(ownReleaseDay("NerdWallet To Acquire On The Barrelhead\nSAN FRANCISCO (June 23, 2022) NerdWallet, Inc. today announced", "2022-06-24")).toBe("2022-06-23");
    expect(ownReleaseDay("EX-99.1 3 pgti-ex991_6.htm PRESS RELEASE DATED 09/02/2021 EXHIBIT 99.1 PGT Innovations to acquire Anlin Windows & Doors NORTH VENICE, Fla. - PGT Innovations", "2021-09-03")).toBe("2021-09-02");
  });

  it("what the 8-K's body says went out (Greif, DraftKings)", () => {
    expect(ownReleaseDay("Item 7.01 Regulation FD Disclosure. On October 31, 2023, the Company issued a press release to announce its plans to acquire Ipackchem. A copy of the press release is attached.", "2023-11-06")).toBe("2023-10-31");
  });

  it("the filing day itself stays (Firehouse Subs, Express / Bonobos)", () => {
    expect(ownReleaseDay("Restaurant Brands International Inc. to Acquire Firehouse Subs\nTORONTO, Nov. 15, 2021 /CNW/ - Restaurant Brands today announced", "2021-11-15")).toBe("2021-11-15");
    expect(ownReleaseDay("Express, Inc. and WHP Global to Acquire BONOBOS\nCOLUMBUS, Ohio, April 13, 2023 - Express today announced", "2023-04-13")).toBe("2023-04-13");
  });

  it("nothing from a results paragraph, or over ten days back, or none at all", () => {
    expect(ownReleaseDay("Item 2.02 Results of Operations. On November 1, 2023, the Company issued a press release announcing its financial results for the quarter ended September 30, 2023.", "2023-11-06")).toBeUndefined();
    expect(ownReleaseDay("Greif Plans to Acquire IPACKCHEM\nDELAWARE, Ohio, Oct. 1, 2023 (GLOBE NEWSWIRE) -- Greif today announced", "2023-11-06")).toBeUndefined();
    expect(ownReleaseDay("Greif Plans to Acquire IPACKCHEM. Greif today announced a definitive agreement.", "2023-11-06")).toBeUndefined();
  });
});

describe("a purchase called off, in a report", () => {
  it("a covenant's words are no ending (Blackboxstocks / Evtec)", () => {
    for (const text of [
      "Until the closing or earlier termination of the Share Exchange Agreement, the Company will operate in the ordinary course, as agreed with Evtec.",
      "Prior to the termination of the merger agreement with Evtec, the Company may not solicit other proposals.",
      "Evtec may not, on any termination of the Share Exchange Agreement, retain the deposit.",
      "Upon termination of the merger agreement with Evtec, the deposit is returned.",
      "After such termination of the purchase agreement, Evtec has no claim.",
    ]) expect(readLooseEnd(text, "Evtec").found, text).toBe(false);
  });

  it("the real thing still reads (Votaw)", () => {
    expect(readLooseEnd("On March 31, 2024, we terminated the Stock Purchase Agreement to buy Votaw Precision Technologies.", "Votaw")).toEqual({ found: true, date: "2024-03-31", today: false });
    expect(readLooseEnd("The termination of the Stock Purchase Agreement with Votaw became effective in the quarter.", "Votaw").found).toBe(true);
  });
});

describe("\"previously announced\" about the deal", () => {
  const flags = (text: string, filerName = "La Rosa Holdings Corp.") => {
    const p = parsePressRelease(text, { filerName, filerTickers: [] });
    return { kind: p?.kind, earlier: p?.announcedEarlier, on: p?.announcedOn };
  };

  it("not another plan the buyer announced (La Rosa / BF Prime)", () => {
    const text = `La Rosa Holdings Acquires Its Twelfth Real Estate Brokerage Franchisee\nCelebration, FL / August 21, 2024 / - La Rosa Holdings Corp. (Nasdaq: LRHC) today announced that it has acquired a 100% interest in the Company's franchisee - BF Prime LLC. The acquisition comes as part of La Rosa's strategic expansion plan and brings its previously announced La Rosa's Ultimate Plan to Puerto Rico.`;
    expect(flags(text).kind).toBe("completion");
    expect(flags(text).earlier).toBeUndefined();
  });

  it("nor an offering, a buyback or a refinancing beside the closing (LightPath, Encana, Patheon)", () => {
    const text = `LightPath Technologies Completes Acquisition of ISP Optics Corporation\nORLANDO, Fla., Dec. 21, 2016 - LightPath Technologies today announced that it has completed the acquisition of ISP Optics Corporation. LightPath also announced today that it has completed the previously announced underwritten public offering of 8,000,000 shares.`;
    expect(flags(text, "LightPath Technologies, Inc.").earlier).toBeUndefined();
  });

  it("the deal, in the ways releases say it", () => {
    for (const body of [
      "Deluxe today announced it has completed the previously announced acquisition of Widget Corp for $960 million in cash.",
      "US Foods today announced it has successfully completed the previously announced $970 million all cash acquisition of Widget Corp.",
      "Today Northwind completed its acquisition of Widget Corp. The transaction, previously announced in November 2025, was approved by the board.",
      "Northwind has completed its acquisition of Widget Corp. As previously announced, the purchase price was $50 million.",
      "Northwind has completed the acquisition of Widget Corp, for a purchase price of $455 million in cash, as previously announced.",
      "Northwind has completed the acquisition of Widget Corp. Northwind previously announced plans on November 19, 2012 to acquire Widget.",
      "Northwind has completed the acquisition of Widget Corp. A definitive agreement to acquire the company was previously announced in May 2016.",
      "Northwind has completed the acquisition of Widget Corp. The company previously announced that it had signed a definitive agreement in connection with the acquisition.",
      "Northwind has completed the acquisition of Widget Corp, previously announced in June.",
      "Northwind has completed the acquisition of Widget Corp. Consistent with terms previously reported, it paid $400 million at closing.",
      "Northwind has completed the acquisition of Widget Corp. As previously reported, this strategic acquisition expands its portfolio.",
      "Northwind has completed the acquisition of Widget Corp by way of the previously announced plan of arrangement.",
    ]) {
      const f = flags(`Northwind Completes Acquisition of Widget Corp\nDENVER, June 1, 2021 - ${body}`, "Northwind Inc.");
      expect(f.kind, body).toBe("completion");
      expect(f.earlier, body).toBe(true);
    }
  });

  it("the agreement's date the release gives (Legacy Education / Contra Costa), never a closing's", () => {
    const contra = `Legacy Education Inc. Completes Acquisition of Contra Costa Medical Career College\nLancaster, California, December 18, 2024 /PRNewswire/ - Legacy Education Inc. ("Legacy Education" or the "Company") (NYSE American: LGCY), a leader in career-focused educational services, is proud to announce the successful completion of its acquisition of Contra Costa Medical Career College ("CCMCC"), located in Antioch, California, pursuant to the execution of its previously announced asset purchase agreement on October 30, 2024 for a purchase price of $8,000,000.`;
    const f = flags(contra, "Legacy Education Inc.");
    expect(f.kind).toBe("completion");
    expect(f.on).toBe("2024-10-30");
    expect(f.earlier).toBeUndefined();
    const closing = `Northwind Completes Acquisition of Widget Corp\nDENVER, March 2, 2024 - Northwind today announced it completed the acquisition of Widget Corp under its previously announced merger agreement on March 1, 2024.`;
    expect(flags(closing, "Northwind Inc.").on).toBeUndefined();
    expect(flags(closing, "Northwind Inc.").earlier).toBe(true);
  });
});
