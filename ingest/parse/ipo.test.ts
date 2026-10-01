import { describe, expect, it } from "vitest";
import { extractMaxAggregate, extractOfferPrice, extractUnderwriters, isResaleOnly, parseFinalProspectus, parseRegistration } from "./ipo";

describe("isResaleOnly", () => {
  it("flags registrations where only selling holders sell", () => {
    expect(isResaleOnly(`PRELIMINARY PROSPECTUS SECURITIZE CORP. Up to 151,568,524 Shares of Common Stock The selling stockholders named in this prospectus may offer and sell from time to time. We will not receive any of the proceeds from such sales.`)).toBe(true);
    expect(isResaleOnly(`PROSPECTUS 94,046,357 Shares of Common Stock Advasa Holdings, Inc. This prospectus relates to the resale by the Registered Stockholders in connection with the listing of our common stock (the "Direct Listing") on the Nasdaq Global Market.`)).toBe(true);
    expect(isResaleOnly(`SUNCRETE, INC. 52,299,704 Shares of Class A Common Stock. On April 8, 2026, Suncrete, Inc. consummated its previously announced business combination. The selling holders are offering these shares.`)).toBe(true);
  });

  it("keeps IPOs, including ones with selling stockholders alongside", () => {
    expect(isResaleOnly(`This is the initial public offering of Acme, Inc. We are offering 8,000,000 shares and the selling stockholders are offering 2,000,000 shares. We will not receive any proceeds from the sale of shares by the selling stockholders.`)).toBe(false);
    expect(isResaleOnly(`Hometown Financial Group, Inc. is offering shares of its common stock for sale in an initial public offering in connection with the conversion of Hometown Financial Group, MHC.`)).toBe(false);
    expect(isResaleOnly(`PROSPECTUS 5,000,000 Shares. We are selling 5,000,000 shares of common stock. We will not receive any proceeds from shares sold by the selling stockholder.`)).toBe(false);
    expect(isResaleOnly(`We and the Selling Shareholders (as defined herein) are offering, on a firm commitment engagement basis, 3,000,000 Class A Ordinary Shares and 2,900,000 Class A Ordinary Shares, respectively. We will not receive any proceeds from the sale of the Ordinary Shares to be sold by the Selling Shareholders.`)).toBe(false);
    expect(isResaleOnly(`30,000,000 Shares. This is the initial public offering of Accelevation Holdings Corp. Accelevation Holdings Corp. is offering 10,000,000 shares, and the selling stockholders are offering 20,000,000 shares.`)).toBe(false);
  });

  it("keeps an underwritten IPO sold entirely by an existing holder, drops direct listings even with advisers", () => {
    const innio = `90,000,000 Common Shares INNIO N.V. This is the initial public offering. AI Alpine (our "selling shareholder") is selling 90,000,000 common shares. We will not receive any proceeds from the sale of the common shares by the selling shareholder.`;
    expect(isResaleOnly(innio, ["Goldman Sachs", "JPMorgan"])).toBe(false);
    expect(isResaleOnly(innio, [])).toBe(true);
    expect(isResaleOnly(`The selling stockholders may sell from time to time. The resale is not being underwritten on a firm-commitment basis. We will not receive any proceeds.`)).toBe(true);
    expect(isResaleOnly(`This prospectus relates to the resale by the Registered Stockholders of up to 10,800,164 shares pursuant to a direct listing on the Nasdaq Global Select Market.`, ["JPMorgan"])).toBe(true);
  });
});

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
