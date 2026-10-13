import { describe, expect, it } from "vitest";
import { completedPhrases, endedPhrases, readStatement, searchName, shortName, statedDate } from "./completion";

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

  it("parses stated dates and search names", () => {
    expect(statedDate("effective as of January 3, 2024, the Company closed")).toBe("2024-01-03");
    expect(statedDate("on 21 March 2022 the purchase closed")).toBe("2022-03-21");
    expect(statedDate("the acquisition closed during the quarter")).toBeNull();
    expect(searchName("Avitide Inc.")).toBe("Avitide");
    expect(searchName("Joh")).toBeNull();
    expect(searchName("Privately Held")).toBeNull();
  });
});
