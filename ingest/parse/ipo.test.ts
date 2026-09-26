import { describe, expect, it } from "vitest";
import { extractMaxAggregate, extractOfferPrice, extractUnderwriters, parseFinalProspectus, parseRegistration } from "./ipo";

describe("IPO parsers", () => {
  it("reads the fee table total and treats the $100M default as unknown", () => {
    const fee = "Security Type Equity Proposed Maximum Aggregate Offering Price (1) $ 250,000,000.00 Fee Rate 0.0001531 Amount of Registration Fee $ 38,275";
    expect(extractMaxAggregate(fee)).toBe(250e6);
    expect(parseRegistration("", "Maximum Aggregate Offering Price $100,000,000").expectedRaiseUsd).toBeNull();
  });

  it("prefers the price-range midpoint over the fee table", () => {
    const main = `PROSPECTUS 12,500,000 Shares Common Stock
We anticipate that the initial public offering price will be between $17.00 and $19.00 per share.
Goldman Sachs & Co. LLC Morgan Stanley J.P. Morgan
TABLE OF CONTENTS`;
    const terms = parseRegistration(main, "Maximum Aggregate Offering Price $ 270,000,000");
    expect(terms.expectedRaiseUsd).toBe(18 * 12_500_000);
    expect(terms.underwriters).toEqual(["Goldman Sachs", "Morgan Stanley", "JPMorgan"]);
  });

  it("reads the final offer price and gross proceeds", () => {
    const text = `Filed Pursuant to Rule 424(b)(4) 20,000,000 Shares Class A Common Stock
This is the initial public offering of our Class A common stock. The initial public offering price is $23.00 per share.
BofA Securities Jefferies
Table of Contents`;
    expect(extractOfferPrice(text)).toBe(23);
    expect(parseFinalProspectus(text)).toMatchObject({ offerPrice: 23, expectedRaiseUsd: 460e6, underwriters: ["BofA Securities", "Jefferies"] });
  });

  it("only reads underwriters from the cover", () => {
    const text = `Cover page ${"x".repeat(2000)} Citigroup TABLE OF CONTENTS ... later, Barclays appears in the underwriting section.`;
    expect(extractUnderwriters(text)).toEqual(["Citigroup"]);
  });
});
