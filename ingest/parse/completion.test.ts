import { describe, expect, it } from "vitest";
import { completedPhrases, endedPhrases, nameForms, readLooseCompletion, readLooseEnd, readPastReference, readStatement, searchName, shortName, statedDate } from "./completion";

describe("private-deal completion statements", () => {
  it("reads a plain completion with its date", () => {
    const text = "Business Combinations. On March 21, 2022, we completed the acquisition of Linode, LLC, a cloud computing provider, for $900 million in cash.";
    expect(readStatement(text, completedPhrases("Linode"))).toEqual({ found: true, date: "2022-03-21", today: false });
  });

  it("finds a completion without a stated date", () => {
    const text = "During fiscal 2025 we acquired Own Company Ltd. for approximately $1.9 billion. The purchase price was allocated as follows.";
    expect(readStatement(text, completedPhrases("Own Company"))).toEqual({ found: true, date: null, today: false });
  });

  it("ignores conditional or forward-looking wording", () => {
    const text = "If we completed the acquisition of Wolt, our results would include its revenue. The transaction is expected to close in 2022.";
    expect(readStatement(text, completedPhrases("Wolt")).found).toBe(false);
    expect(readStatement("Intel may terminate its agreement to acquire Tower Semiconductor under certain conditions.", endedPhrases("Tower Semiconductor")).found).toBe(false);
  });

  it("reads a termination", () => {
    const text = "SANTA CLARA, Calif., Aug. 16, 2023 - Intel Corporation announced today that it has terminated its agreement to acquire Tower Semiconductor, due to the inability to obtain regulatory approvals.";
    expect(readStatement(text, endedPhrases("Tower Semiconductor"))).toEqual({ found: true, date: null, today: true });
  });

  it("reads 'previously announced' wording and short names", () => {
    const text = "SANTA CLARA, Aug. 16, 2023 - Intel Corporation today announced that it has mutually agreed with Tower Semiconductor (Nasdaq: TSEM) to terminate its previously disclosed agreement to acquire Tower due to the inability to obtain regulatory approvals.";
    expect(readStatement(text, endedPhrases("Tower")).found).toBe(true);
    expect(readStatement("On July 1, 2024, the Company completed its previously announced acquisition of Ametros.", completedPhrases("Ametros"))).toEqual({ found: true, date: "2024-07-01", today: false });
    expect(shortName("Tower Semiconductor")).toBe("Tower");
    expect(shortName("Wolt")).toBeNull();
    expect(shortName("Ask Sage")).toBeNull();
  });

  it("reads a completed purchase referred to by its month, undated", () => {
    expect(readPastReference("including in the case of our May 2022 acquisition of Wolt Enterprises Oy (\"Wolt\");", "Wolt")).toEqual({ found: true, date: null, today: false });
    expect(readPastReference("our proposed acquisition of Wolt is expected to close in 2022", "Wolt").found).toBe(false);
    expect(searchName("NFP")).toBe("NFP");
    expect(searchName("Joh")).toBeNull();
  });

  it("parses stated dates and search names", () => {
    expect(statedDate("effective as of January 3, 2024, the Company closed")).toBe("2024-01-03");
    expect(statedDate("on 21 March 2022 the purchase closed")).toBe("2022-03-21");
    expect(statedDate("the acquisition closed during the quarter")).toBeNull();
    expect(searchName("Avitide Inc.")).toBe("Avitide");
    expect(searchName("Joh")).toBeNull();
    expect(searchName("Privately Held")).toBeNull();
  });
});

describe("closing wordings from the open-deal triage (November 2026)", () => {
  it("reads a release's noun form, a bank merger and a headline", () => {
    expect(readStatement("Stran today announced the completion of its previously announced acquisition of GAP Promo in an asset purchase.", completedPhrases("GAP Promo"))).toMatchObject({ found: true, today: true });
    expect(readStatement("Effective April 1, 2024, the Company completed the merger of Lone Star State Bancshares, Inc. into the Company.", completedPhrases("Lone Star")).found).toBe(true);
    expect(readLooseCompletion("Arcosa, Inc. Announces Completion of StonePoint Materials Acquisition and Issuance of Notes", "StonePoint Materials").found).toBe(true);
    expect(readLooseCompletion("Arcosa announces the expected closing of StonePoint Materials acquisition next month", "StonePoint Materials").found).toBe(false);
  });
  it("searches a brand's short form, a spaced initialism written as one word and a three-character name with a digit", () => {
    expect(shortName("StonePoint Materials")).toBe("StonePoint");
    expect(nameForms("PH Precision Med")).toContain("PHPrecisionMed");
    expect(nameForms("Tower Semiconductor")).not.toContain("TowerSemiconductor");
    expect(searchName("RE2")).toBe("RE2");
    expect(searchName("Joh")).toBeNull();
  });
});

describe("ends a report states (November 2026)", () => {
  it("reads a glossary row's d/b/a short name and 'termination of our previous agreement to acquire'", () => {
    const text = "Glossary SPI SPI LLC d/b/a Specialty Products & Insulation Term Facility Two. On April 22, 2024, we agreed to a mutual termination of our previous agreement to acquire SPI.";
    expect(readLooseEnd(text, "Specialty Products & Insulation")).toMatchObject({ found: true, date: "2024-04-22" });
  });
  it("reads 'the terminated acquisition of X', undated, and not a defined term in risk factors", () => {
    expect(readLooseEnd("Expenses were incurred primarily in connection with the terminated acquisition of Knowmadics.", "Knowmadics").found).toBe(true);
    expect(readLooseEnd("Great Plains Energy, Inc. (\"Great Plains\"). Either party may have the right to terminate the merger agreement with Great Plains.", "Great Plains Energy").found).toBe(false);
  });
  it("gives a closing release its 'today'", () => {
    expect(readLooseCompletion("Stran today announced the completion of its previously announced acquisition of GAP Promotions, LLC (\"GAP Promo\").", "GAP Promo")).toMatchObject({ found: true, today: true });
  });
});

describe("closings about something else, and ends by 'termination of the acquisition of' (November 10 2026)", () => {
  it("doesn't take efforts involving the company, or other assets bought from it, as its closing", () => {
    expect(readLooseCompletion('During the second quarter of 2026, the Company completed a series of transactions related to its previously announced acquisition efforts involving W3C Corp. ("W3C").', "W3C Corp").found).toBe(false);
    expect(readLooseCompletion('On May 1, 2026, Exodus completed its acquisition of Baanx US Corp. ("Baanx US"), and agreed to acquire certain other assets from W3C Corp. ("W3C").', "W3C Corp").found).toBe(false);
  });
  it("reads 'the previously announced termination of the acquisition of X', not a contract's 'in the event of'", () => {
    expect(readLooseEnd("In July 2026, following the previously announced termination of the acquisition of W3C Corp., the Company entered into two novation agreements.", "W3C Corp").found).toBe(true);
    expect(readLooseEnd("The Delayed Draw Facility becomes payable in the event of termination of the acquisition of W3C Corp. for a breach.", "W3C Corp").found).toBe(false);
  });
  it("prefers the release's 'today' sentence over its headline", () => {
    const t = 'Stran & Company Announces Closing of GAP Promo Acquisition; Adds Over $7 Million in Revenue. QUINCY, MA / February 1, 2022 / Stran & Company, Inc. (NASDAQ: SWAG) ("Stran" or the "Company"), an outsourced marketing solutions provider, today announced the completion of its previously announced acquisition of GAP Promotions, LLC ("GAP Promo") in an asset purchase transaction.';
    expect(readLooseCompletion(t, "GAP Promo")).toMatchObject({ found: true, today: true });
  });
});
