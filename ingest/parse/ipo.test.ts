import { describe, expect, it } from "vitest";
import { extractMaxAggregate, extractOfferPrice, extractUnderwriters, extractUnderwritingTable, isResaleOnly, parseFinalProspectus, parseRegistration } from "./ipo";
import { listsOnExchange, publicWithin } from "../ipos";

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

describe("final prospectus wordings", () => {
  it("reads the offer price however the cover states it", () => {
    expect(extractOfferPrice(`Prior to this offering, there has been no public market for our Class A common stock. The initial public offering price per share of our Class A common stock is $ 33.00 . We have been approved to list`)).toBe(33);
    expect(extractOfferPrice(`under the symbol "SAIL." PRICE $23.00 A SHARE Price to Public Underwriting Discounts and Commissions`)).toBe(23);
  });

  it("reads share counts with a class or 'Ordinary' between the number and 'Shares'", () => {
    const klarna = `424B4 Registration No. 333-285826 34,311,274 Ordinary Shares Klarna Group plc This is the initial public offering. The initial public offering price per ordinary share is $40.00.`;
    expect(parseFinalProspectus(klarna).expectedRaiseUsd).toBe(34_311_274 * 40);
  });

  it("reads US$ prices and takes the raise from the cover table's total", () => {
    // ADSs worth a tenth of a share each: the cover counts shares, the price is per ADS.
    const adr = `PROSPECTUS 17,790,000 Common Shares Represented by American Depositary Shares Hanseong Chips Inc. We are offering 177,900,000 ADSs. The initial public offering price of the ADSs is US$149.00 per ADS. Per ADS Total Public offering price US$ 149.0000 US$ 26,507,100,000 Underwriting discount and commissions US$ 1.4477`;
    expect(parseFinalProspectus(adr)).toMatchObject({ offerPrice: 149, expectedRaiseUsd: 26_507_100_000 });
    expect(extractOfferPrice(`The initial public offering price per ADS is US$22.00. We have been approved for listing`)).toBe(22);
    // A best-efforts minimum / maximum table: keep price × the cover's (maximum) share count.
    const minMax = `PROSPECTUS 15,000,000 Shares of Common Stock Acme Corp Per Share Total Minimum Offering Total Maximum Offering Public offering price $ 4.00 $ 50,000,000 $ 60,000,000 Underwriting commissions`;
    expect(parseFinalProspectus(minMax).expectedRaiseUsd).toBe(60_000_000);
  });

  it("takes every bank from the underwriting table, skipping compensation tables", () => {
    const text = `Cover with logos only. RBC Capital Markets TABLE OF CONTENTS ${"x".repeat(3000)} Name Number of Shares Underlying RSUs Number of Shares Underlying Options Jane Director 69,638 ${"y".repeat(500)} Total 1,000 ${"z".repeat(3000)} Underwriting Name Number of Shares Morgan Stanley & Co. LLC 10,434,725 Goldman Sachs & Co. LLC 10,434,725 RBC Capital Markets, LLC 1,200,000 Total 22,069,450`;
    expect(extractUnderwritingTable(text)).toEqual(["Morgan Stanley", "Goldman Sachs", "RBC Capital Markets"]);
    expect(parseFinalProspectus(text).underwriters).toEqual(["Morgan Stanley", "Goldman Sachs", "RBC Capital Markets"]);
  });
});

describe("IPO rules", () => {
  it("lists on an exchange, or says it won't", () => {
    expect(listsOnExchange(`Our Class A common stock has been approved for listing on the New York Stock Exchange under the symbol "GEMI".`)).toBe(true);
    expect(listsOnExchange(`There is no public market for our shares and we do not intend to list our shares on the New York Stock Exchange or any other exchange.`)).toBe(false);
  });

  it("counts a re-IPO after years without reports", () => {
    expect(publicWithin([{ form: "10-K", date: "2013-06-20" }, { form: "S-1", date: "2024-12-01" }], "2025-01-29")).toBe(false);
    expect(publicWithin([{ form: "10-Q", date: "2024-11-05" }], "2025-01-29")).toBe(true);
  });
});
