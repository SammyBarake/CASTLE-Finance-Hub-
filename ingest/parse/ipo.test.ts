import { describe, expect, it } from "vitest";
import { findBanks } from "../../lib/banks";
import { extractDescription, extractMaxAggregate, extractOfferPrice, extractPriceRange, extractSharesOffered, extractUnderwriters, extractUnderwritingTable, isResaleOnly, isSecondStepConversion, parseFinalProspectus, parseRegistration, prospectusDate } from "./ipo";
import { listsOnExchange, publicWithin } from "../ipos";

describe("underwriters on the bank list", () => {
  it("reads the firms IPOs name, in table order (Vogenx, Londian Wason, Ticketplus, Csquare, Jersey Mike's)", () => {
    expect(extractUnderwritingTable("UNDERWRITING Underwriters Number of Shares JonesTrading Institutional Services LLC 6,250,000 Total 6,250,000")).toEqual(["JonesTrading"]);
    expect(extractUnderwritingTable("Underwriters Number of ADSs Cantor Fitzgerald & Co. 1 Huatai Securities (USA), Inc. 1 CMB International Capital Limited 1 US Tiger Securities, Inc. 1 Fortune (HK) Securities Limited 1 BOCOM International Securities Limited 1 VC Brokerage Limited 1 Total")).toEqual([
      "Cantor Fitzgerald", "Huatai Securities", "CMB International", "US Tiger Securities", "Fortune Securities", "BOCOM International", "VC Brokerage",
    ]);
    expect(findBanks("Roth Capital Partners Bancroft Capital, LLC MDB Capital")).toEqual(["Roth Capital", "Bancroft Capital", "MDB Capital"]);
    expect(findBanks("SG Americas Securities, LLC 2,385,000 National Bank of Canada Financial Inc. 1,000,000 PNC Capital Markets LLC 500,000")).toEqual(["Société Générale", "National Bank Financial", "PNC Capital Markets"]);
    expect(findBanks("Blackstone Securities Partners L.P., an underwriter, Rabo Securities USA, Inc., Tigress Financial Partners LLC, Telsey Advisory Group LLC, WR Securities, LLC")).toEqual([
      "Blackstone Securities Partners", "Rabo Securities", "Tigress Financial Partners", "Telsey Advisory Group", "Wolfe Research",
    ]);
  });

  it("takes whole names only: buyout firms and a company called MDB aren't underwriters", () => {
    expect(findBanks("Blackstone Inc. and Brookfield Asset Management will acquire MDB Holdings; Blackstone Infrastructure Partners and MongoDB (MDB)")).toEqual([]);
    expect(findBanks("Blackstone Advisory Partners L.P. is acting as financial advisor")).toEqual(["Blackstone Advisory Partners"]);
    expect(findBanks("funds managed by Brookfield and the Titan Partners fund, with Mr. Jones trading")).toEqual([]);
  });
});

describe("prospectusDate", () => {
  it("reads each way a cover states it, up to ten days before the filing", () => {
    expect(prospectusDate("Sole Book-Running Manager LifeSci Capital Prospectus dated October 22, 2026 Table of Contents", "2026-10-23")).toBe("2026-10-22"); // Lycia
    expect(prospectusDate("Citizens Capital Markets Texas Capital Securities September 17, 2026 Table of contents Page", "2026-09-21")).toBe("2026-09-17"); // Orion180
    expect(prospectusDate("Titan Partners The date of this prospectus is October 8 , 2026. Table of Contents", "2026-10-09")).toBe("2026-10-08"); // Retension
    // The year split in the text (Braveheart, Accelevation).
    expect(prospectusDate("Joint Bookrunners Goldman Sachs & Co. LLC Jefferies TD Cowen Stifel Cantor August 5, 20 26 TABLE OF CONTENTS", "2026-08-06")).toBe("2026-08-05");
    expect(prospectusDate("Wolfe | Nomura Alliance __________________ Prospectus dated September 29, 202 6 i Table of Contents", "2026-10-01")).toBe("2026-09-29");
    expect(prospectusDate("Roth MDB Capital The date of this prospectus is August 6, 2026 TABLE OF CONTENTS", "2026-08-07")).toBe("2026-08-06"); // Ticketplus
    expect(prospectusDate("THE DATE OF THIS PROSPECTUS IS MARCH 5, 2015.", "2015-03-06")).toBe("2015-03-05");
    expect(prospectusDate("Jones Prospectus dated August 11, 2026. TABLE OF CONTENTS", "2026-08-12")).toBe("2026-08-11"); // Vogenx
  });

  it("leaves it blank when the cover states none, or the date is too far from the filing", () => {
    expect(prospectusDate("Morgan Stanley Goldman Sachs & Co. LLC Table of Contents", "2026-08-06")).toBeNull(); // Braveheart
    expect(prospectusDate("Prospectus dated June 1, 2026 Table of Contents", "2026-08-06")).toBeNull();
    expect(prospectusDate("Prospectus dated August 9, 2026 Table of Contents", "2026-08-06")).toBeNull(); // after the filing
  });

  it("doesn't read a date further in as the cover's", () => {
    const pad = " x".repeat(20_000);
    expect(prospectusDate(`Cover ends here. ${pad} Prospectus dated August 1, 2026 Table of Contents`, "2026-08-06")).toBeNull();
    // A date before a page break, with the page number between them.
    expect(prospectusDate("a reverse stock split of our common stock, which we effected on September 17, 2026. 16 Table of Contents Summary", "2026-09-28")).toBeNull();
    // A summary of another document, in lower case.
    expect(prospectusDate("the preliminary prospectus dated August 3, 2026 and the rest", "2026-08-06")).toBeNull();
  });
});

describe("isSecondStepConversion", () => {
  // Columbia Financial's S-1, March 2026.
  const columbia =
    'Columbia Financial, Inc., is offering common stock for sale in connection with the conversion of Columbia Bank MHC from the mutual holding company form of organization to the stock form of organization. The "second-step" conversion process that we are now undertaking involves a series of transactions. We are conducting the conversion and offering under the terms of our plan of conversion and reorganization that we adopted on January 31, 2026. The [●] shares of Columbia Financial currently owned by the public will be exchanged for between 1.8729 shares and 2.5340 shares of common stock of Columbia Financial, Inc. Columbia Financial\'s common stock is currently listed on the Nasdaq Global Select Market under the trading symbol "CLBK."';

  it("drops a listed company re-registering on a new CIK (Columbia Financial)", () => {
    expect(isSecondStepConversion(columbia)).toBe(true);
    expect(isSecondStepConversion(columbia.replace(/ Columbia Financial's common stock is currently listed.*$/, ""))).toBe(true);
    expect(isSecondStepConversion(columbia.replace(/The \[●\] shares.*Columbia Financial, Inc\. /, ""))).toBe(true);
  });

  it("keeps a first-time conversion (Hometown Financial's S-1)", () => {
    expect(
      isSecondStepConversion(
        'Hometown Financial Group, Inc. is offering its common stock for sale in an initial public offering (the "IPO") in connection with the conversion of Hometown Financial Group, MHC, the mutual holding company of TruNorth Bank, from a mutual holding company to a stock holding company. There is no current public or private market for the Hometown Financial common stock. The Hometown Financial common stock is expected to be listed on the Nasdaq Stock Market under the symbol "HFG." The purchase priorities are set forth in the Plan of Conversion of Hometown Financial Group, MHC.',
      ),
    ).toBe(false);
  });

  it("keeps a first-step offering that only mentions a later second step, and an ordinary IPO", () => {
    expect(isSecondStepConversion("Sunrise Bancorp is selling a minority of its shares. Our mutual holding company could in the future undertake a second-step conversion. There is no public market for our common stock.")).toBe(false);
    expect(isSecondStepConversion("We are offering 10,000,000 shares of common stock. This is our initial public offering. We have applied to list on the Nasdaq Global Select Market.")).toBe(false);
  });
});

describe("extractDescription", () => {
  const overview = (sentence: string) => `Prospectus summary\nOverview\n${sentence}\nMore text.`;

  it("doesn't stop at a title or a company's legal form", () => {
    // TFP Group's F-1 and Cortigent's S-1/A.
    expect(extractDescription(overview("Our predecessor company, Fidelis Insurance, was founded in 2014 by Mr. Brindle as a specialty (re)insurance business and commenced underwriting in 2015. Mr. Brindle served as Chairman and CEO of Fidelis Insurance from founding until January 2023."))).toBe(
      "Our predecessor company, Fidelis Insurance, was founded in 2014 by Mr. Brindle as a specialty (re)insurance business and commenced underwriting in 2015.",
    );
    expect(extractDescription(overview('Cortigent, through its predecessor Second Sight Medical Products, Inc. ("Second Sight"), is a pioneer in developing precision targeted neurostimulation systems to help patients recover critical body functions. Our technology combines advanced neuroscience with proprietary microelectronics.'))).toBe(
      'Cortigent, through its predecessor Second Sight Medical Products, Inc. ("Second Sight"), is a pioneer in developing precision targeted neurostimulation systems to help patients recover critical body functions.',
    );
    expect(extractDescription(overview("Our predecessor, Second Sight Medical Products, Inc. has developed implants that restore vision. We were formed in 2021."))).toBe(
      "Our predecessor, Second Sight Medical Products, Inc. has developed implants that restore vision.",
    );
  });

  it("still ends a sentence that ends in a company's name, and an ordinary one", () => {
    expect(extractDescription(overview("AMATUHI HOLDINGS, Inc., was incorporated on June 24, 2025 in Delaware to act as the holding company of AMATUHI Inc. We operate restaurants in Japan and elsewhere."))).toBe(
      "AMATUHI HOLDINGS, Inc., was incorporated on June 24, 2025 in Delaware to act as the holding company of AMATUHI Inc.",
    );
    expect(extractDescription(overview("We are a clinical-stage biotechnology company focused on degraders for use in cancer care. Our lead program is in phase 2."))).toBe(
      "We are a clinical-stage biotechnology company focused on degraders for use in cancer care.",
    );
  });
});

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
  it("reads the fee table total and treats a round placeholder as unknown", () => {
    const fee = "Security Type Equity Proposed Maximum Aggregate Offering Price (1) $ 250,000,000.00 Fee Rate 0.0001531 Amount of Registration Fee $ 38,275";
    expect(extractMaxAggregate(fee)).toBe(250e6);
    expect(parseRegistration("", "Maximum Aggregate Offering Price $100,000,000").expectedRaiseUsd).toBeNull();
    // Round figures are placeholders whatever their size; a real figure is shares × price.
    expect(parseRegistration("", "Maximum Aggregate Offering Price $1,000,000,000").expectedRaiseUsd).toBeNull();
    // The fee table's maximum (over-allotment at the top of the range) is never the expected raise, only a size test.
    expect(parseRegistration("", "Maximum Aggregate Offering Price $270,500,000").expectedRaiseUsd).toBeNull();
    expect(parseRegistration("", "Maximum Aggregate Offering Price $270,500,000").registeredMaxUsd).toBe(270.5e6);
    expect(parseRegistration("", "Maximum Aggregate Offering Price $15,000,000").registeredMaxUsd).toBe(15e6);
    expect(parseRegistration("", "Maximum Aggregate Offering Price $100,000,000").registeredMaxUsd).toBeNull();
  });

  it("reads the range in its other wordings and the base shares, not a resale prospectus's (live pipeline, November 2026)", () => {
    // vVARDIS: the unit after "per" has words before it.
    expect(extractPriceRange("We expect that the initial public offering price will be between $21.00 and $24.00 per Class A ordinary share.")).toEqual({ low: 21, high: 24 });
    // Green Solar: US$; Neucleus: "Offering Price: $4 to $5"; MediaOn: draft brackets; a plain "in the range of".
    expect(extractPriceRange("the initial public offering price of our Class A Shares to be between US$4.00 and US$6.00 per Class A ordinary share")).toEqual({ low: 4, high: 6 });
    expect(extractPriceRange("Offering Price: $4 to $5 per Class A Ordinary Share")).toEqual({ low: 4, high: 5 });
    expect(extractPriceRange("the initial public offering price of the shares will be between US$[4] and US$[6] per share")).toEqual({ low: 4, high: 6 });
    expect(extractPriceRange("We expect the initial public offering price will be in the range of $4.00 to $5.00 per Ordinary Share.")).toEqual({ low: 4, high: 5 });
    // A dilution sentence is no range.
    expect(extractPriceRange("our net tangible book value would increase from $4.10 to $4.35 per share")).toBeNull();
    const sinLianSeng = `This registration statement contains two prospectuses. ● The Public Offering Prospectus. ● The Resale Prospectus. A prospectus to be used for the resale by Selling Shareholders of 1,470,000 ordinary shares. 6,250,000 Ordinary Shares Sin Lian Seng Construction Limited. We currently estimate that the initial public offering price will be between US$4.00 and US$5.00 per Ordinary Share.`;
    expect(extractSharesOffered(sinLianSeng)).toBe(6_250_000);
    expect(parseRegistration(sinLianSeng, "Maximum Aggregate Offering Price $35,937,500").expectedRaiseUsd).toBe(28_125_000);
  });

  it("takes a conversion's appraisal midpoint and its selling agent (Hometown Financial)", () => {
    const text = `Price: $10.00 per Share Minimum Midpoint Maximum Adjusted Maximum Number of shares 51,000,000 60,000,000 69,000,000 79,350,000 Gross offering proceeds $ 510,000,000 $ 600,000,000 $ 690,000,000 $ 793,500,000 (1) See "The Conversion and Stock Offering - Plan of Distribution; Selling Agent and Underwriter Compensation" for a discussion of Keefe, Bruyette & Woods, Inc.'s compensation for the stock offering`;
    const terms = parseRegistration(text, "Maximum Aggregate Offering Price $825,240,000");
    expect(terms.expectedRaiseUsd).toBe(600e6);
    expect(terms.underwriters).toEqual(["Stifel"]);
  });

  it("reads a registration's own underwriting table, every bank to the Total row", () => {
    const counsel = "Copies to: Fox Rothschild LLP 2001 Market Street; Faegre Drinker Biddle & Reath LLP 2200 Wells Fargo Center";
    const table = "UNDERWRITING Underwriter Number of shares Sentinel Brokers Company, Inc. Revere Securities LLC Total 5,000,000";
    expect(parseRegistration(`${counsel} PROSPECTUS TABLE OF CONTENTS ${table}`, null).underwriters).toEqual(["Sentinel Brokers", "Revere Securities"]);
    expect(parseRegistration(`PROSPECTUS ${counsel} Sole Bookrunner Titan Partners Co-Manager Northland Capital Markets TABLE OF CONTENTS`, null).underwriters).toEqual(["Titan Partners", "Northland Capital Markets"]);
    const filler = " Inc.".repeat(700);
    const sb = `Name Number of Shares J.P. Morgan Securities LLC Goldman Sachs & Co. LLC${filler} BNP Paribas Securities Corp. Natixis Securities Americas LLC WR Securities, LLC Huntington Securities, Inc. ING Financial Markets LLC ABN AMRO Capital Markets (USA) LLC Compass Point Research & Trading, LLC DNB Carnegie, Inc. SEB Securities, Inc. S G Americas Securities, LLC Total`;
    expect(extractUnderwritingTable(sb)).toEqual(["JPMorgan", "Goldman Sachs", "BNP Paribas", "Natixis", "Wolfe Research", "Huntington Securities", "ING", "ABN AMRO", "Compass Point", "DNB Carnegie", "SEB", "Société Générale"]);
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

describe("one expected price and other share wordings (live pipeline, November 2026)", () => {
  it("reads a single expected price as the raise's price, never a range's first figure", () => {
    expect(extractPriceRange("We anticipate that the initial public offering price of our shares will be $10.00 per share.")).toEqual({ low: 10, high: 10 });
    expect(extractPriceRange("It is currently estimated that the initial public offering price per share will be US$4. We intend to list")).toEqual({ low: 4, high: 4 });
    expect(extractPriceRange("based on an assumed initial public offering price per share of $4.00, representing the low end of the initial public offering price range of $4.00 and $5.00")).toEqual({ low: 4, high: 5 });
    expect(extractPriceRange("We expect that the initial public offering price will be between $[●] and $[●] per share.")).toBeNull();
    expect(extractSharesOffered("A prospectus to be used for the public offering of 3,750,000 Class A Shares of the Registrant")).toBe(3_750_000);
    expect(parseRegistration("1,500,000 Shares Common Stock Cortigent, Inc. We anticipate that the initial public offering price of our shares will be $10.00 per share.", null).expectedRaiseUsd).toBe(15e6);
  });
});

describe("the rest of the second check (Devonian, MediaOn, Wella)", () => {
  it("reads units priced in USD$, a combined offering, and every dealer in a long table", () => {
    const devonian = "We are offering up to 3,070,000 common units (each a \"Common Unit\"). The estimated offering price for the Common Units is expected to be between USD$6.00 and USD$8.00 per Common Unit.";
    expect(parseRegistration(devonian, null).expectedRaiseUsd).toBe(21_490_000);
    const mediaon = "We and the Selling Shareholders named in this prospectus are offering, on a firm commitment engagement basis, 3,000,000 Class A Ordinary Shares and 2,900,000 Class A Ordinary Shares, respectively. We anticipate that the initial public offering price of the shares will be between US$[4] and US$[6] per share.";
    expect(parseRegistration(mediaon, null).expectedRaiseUsd).toBe(29_500_000);
    expect(extractUnderwritingTable("Underwriter Number of Shares Goldman Sachs & Co. LLC KKR Capital Markets LLC BBVA Securities Inc. Commerz Markets LLC Intesa Sanpaolo IMI Securities Corp. UniCredit Capital Markets LLC RB International Markets (USA) LLC Daiwa Capital Markets America Inc. Newmark Securities, LLC Robinhood Securities, LLC Total")).toEqual(["Goldman Sachs", "KKR Capital Markets", "BBVA", "Commerzbank", "Intesa Sanpaolo", "UniCredit", "Raiffeisen Bank International", "Daiwa Capital Markets", "Newmark Securities", "Robinhood Securities"]);
  });
});
