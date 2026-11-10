/**
 * What the third review against the filings found (November 2026). Fixtures are synthetic, in each filing's wording; the deal
 * each comes from is in its name.
 */
import { describe, expect, it } from "vitest";
import { auditDeal } from "../audit-rules";
import { announcesDeal, closingNames, isPrivateTargetName, listedOn, looksLikePressRelease, takenOverAround } from "../deals";
import { isClosingFiling } from "../timeline";
import { findBanks } from "../../lib/banks";
import { displayCompanyName, isPlaceholderBuyer } from "../../lib/names";
import { nameForms, readAnnouncement, readLooseCompletion, readLooseEnd, readPastReference, readStatement, searchName } from "./completion";
import { extractMergerPrice, parseMergerItem, raisedPrice, reducedPrice } from "./eightk";
import { cleanPartyName, isDescriptionOnly, isPlausibleName, normalizeName } from "./names";
import { buyInOf, extractConsideration, extractPrice, extractPremium, extractValue, isCarveOut, isOverAnotherValue, parsePressRelease } from "./press";
import { premiumCandidates } from "./proxy";

const ctx = { filerName: "Northwind Corp", filerTickers: [] };
const merger = (filerName: string, body: string) => parseMergerItem(`Item 1.01 Entry into a Material Definitive Agreement. ${body}`, { filerName, filerTickers: [] });

describe("an amendment's price", () => {
  it("a cut (Anaplan $66.00 to $63.75)", () => {
    expect(reducedPrice(`the Merger Consideration payable in the Merger is reduced from $66.00 per share of Company Common Stock to $63.75 per share of Company Common Stock.`)).toBe(63.75);
    expect(reducedPrice(`the Termination Fee is reduced from $8,000,000 to $6,000,000.`)).toBeNull();
    const p = merger("Anaplan, Inc.", `On June 6, 2022, Anaplan, Inc. (the "Company") entered into Amendment No. 1 to the Agreement and Plan of Merger with Alpine Parent, LLC ("Parent") and Alpine Merger Sub, Inc. ("Merger Sub"), pursuant to which the Merger Consideration payable in the Merger is reduced from $66.00 per share to $63.75 per share in cash. Merger Sub will merge with and into the Company.`);
    expect(p).toMatchObject({ pricePerShare: 63.75, priceCut: true, amended: true });
  });

  it("a raise of the upfront cash, and a mixed deal's cash leg isn't one (Pfizer / Metsera, Vista Outdoor)", () => {
    expect(raisedPrice(`to increase the upfront cash consideration payable for each share from $47.50 to $65.60 in cash per share`)).toBe(65.6);
    expect(raisedPrice(`to increase the Cash Consideration from $18.00 to $21.00 per share`)).toBeNull();
  });
});

describe("the value", () => {
  it("a total with the debt in it is an enterprise value (CoreSite $10.1B, not its $7.5B)", () => {
    expect(extractValue(`The total consideration for the transaction, including the assumption and/or repayment of CoreSite's existing debt at closing, is approximately $10.1 billion.`)).toEqual({ usd: 10.1e9, kind: "enterprise" });
    expect(extractValue(`an all-equity transaction valued at approximately $4.1 billion, including Sitio's net debt of approximately $1.1 billion.`)).toEqual({ usd: 4.1e9, kind: "enterprise" });
  });

  it("not the combined company's assets (GNL / RTL)", () => {
    expect(extractValue(`The combined internally managed company, which will trade on the NYSE, is expected to own and manage over 1,350 properties and have an aggregate real estate asset value of approximately $9.6 billion.`)).toBeNull();
  });

  it("not a stake bought earlier, told as background (PENN / Barstool)", () => {
    expect(extractValue(`PENN has acquired the remaining interest in Barstool Sports for approximately $388 million. PENN first invested by acquiring 36% of Barstool Sports on February 20, 2020, for total consideration of $163 million.`)?.usd).toBe(388e6);
  });

  it("in full dollars and in USD after the number (ProSight, Angelini / Catalyst)", () => {
    expect(extractValue(`an all-cash transaction valued at approximately $586,000,000 in the aggregate.`)?.usd).toBe(586e6);
    expect(extractValue(`for a total equity value of approximately 4.1 billion USD.`)).toEqual({ usd: 4.1e9, kind: "equity" });
    expect(extractPrice(`Angelini will acquire all outstanding shares of Catalyst for 31.50 USD per share in cash.`)).toBe(31.5);
  });

  it("not a value in a wrapped 8-K's words alone: a real release still counts", () => {
    expect(looksLikePressRelease(`FOR IMMEDIATE RELEASE\nNEW YORK, June 1, 2024 - Northwind Corp today announced a definitive agreement to acquire Acme Inc. for $1.2 billion in cash. About Northwind Corp: Northwind makes things.`)).toBe(true);
  });
});

describe("a holder buying the rest", () => {
  it("the share when stated, else that it's part (Avangrid, Tribune, Whole Earth, National Holdings)", () => {
    expect(buyInOf("Iberdrola will acquire the remaining 18.4% of Avangrid's shares for $35.75 per share.")).toBe(18.4);
    expect(buyInOf("Alden will acquire all of the outstanding shares of Tribune common stock not currently owned by Alden for $17.25 per share.")).toBe(true);
    expect(buyInOf("Sweet Oak will acquire all of the outstanding shares of the Company's common stock that it does not already own in an all-cash transaction.")).toBe(true);
    expect(buyInOf("B. Riley to purchase remaining shares of National Holdings at $3.25 per share.")).toBe(true);
  });

  it("not the second step of a tender, nor a vote of the minority (Sigilon, Radius, Geneve)", () => {
    expect(buyInOf("Following the successful closing of the tender offer, Lilly will acquire any shares of Sigilon it does not already own through a second-step merger.")).toBeNull();
    expect(buyInOf("Upon the successful completion of the tender offer, the subsidiary will be merged into Radius, and any remaining shares will be converted.")).toBeNull();
    expect(buyInOf("The closing is subject to approval by the holders of a majority of the shares not owned by Geneve and its affiliates.")).toBeNull();
    expect(buyInOf("Northwind will acquire all outstanding shares of Acme for $20 per share in cash.")).toBeNull();
  });
});

describe("the price", () => {
  it("a tender at a price, in either order (Castlight $2.05, Great Lakes $17.00)", () => {
    expect(extractMergerPrice(`an offer to purchase all outstanding shares at a price of $2.05 per Share (the "Offer Price"), net to the seller in cash`)).toBe(2.05);
    expect(extractMergerPrice(`an offer to purchase all shares at a price per share of Company Common Stock of $17.00 (the "Offer Price"), net to the seller in cash`)).toBe(17);
  });

  it("what a holder electing cash gets, not a par value or a rejected proposal (DoorDash / Instacart, FLIC, Mobix)", () => {
    expect(extractMergerPrice(`each share will be converted into the right to receive (i) if a cash election has been properly made with respect to such share, $65.00 in cash, or (ii) if a stock election has been made, 0.25 shares of Parent Common Stock`)).toBe(65);
    expect(extractMergerPrice(`for each share of FLIC's common stock, par value $0.10 per share, 0.5175 shares of Connect common stock`)).toBeNull();
    expect(extractPrice(`Davidson Kempner's proposed purchase price of $5.83 per share was not accepted by the special committee.`)).toBeNull();
  });
});

describe("the premium", () => {
  it("one a release ties to an average elsewhere isn't a premium over the close (Citrix, whose sub-headline shortened it)", () => {
    const text = `Represents a 30% premium to Citrix's unaffected price.\nThe price represents a premium of 30 percent over the Company's unaffected 5-day VWAP and a 24% premium to the closing price on December 7, 2021.`;
    expect(extractPremium(text)).toBe(24);
  });

  it("not over the price under a rival's agreement (RR Donnelley / Chatham)", () => {
    expect(isOverAnotherValue(`a premium of 4.8% over $10.35, the price per share of RRD common stock under the Amended Atlas Merger Agreement`)).toBe(true);
  });

  it("not a risk-adjusted value in a proxy's list", () => {
    const list = premiumCandidates(`The total consideration, on a risk-adjusted basis, represents a premium of approximately 84% over the closing price on the last trading day before the announcement.`);
    expect(list.every((c) => c.score < 0)).toBe(true);
  });
});

describe("cash, stock or both", () => {
  it("an enterprise value made of both (Aon / NFP)", () => {
    expect(extractConsideration(`Aon will acquire NFP for an enterprise value of $13.0 billion, including $7.0 billion cash and assumed liabilities as well as $6.0 billion in equity in the form of 19.0 million Aon shares.`)).toBe("Mixed");
  });
});

describe("names", () => {
  it("a name made of suffix words keeps them (Enterprise Bancorp)", () => {
    expect(normalizeName("Enterprise Bancorp, Inc.")).not.toBe("");
    expect(normalizeName("Enterprise Bancorp, Inc.")).toBe(normalizeName("Enterprise Bancorp"));
  });

  it("legal words and places aren't parties (Janus Henderson's \"Law 1991\")", () => {
    for (const n of ["Law 1991", "Wales", "Holding", "Limited", "N.A.", "Incentive Plan"]) expect(isPlausibleName(n)).toBe(false);
    expect(isPlausibleName("Trian Fund Management, L.P.")).toBe(true);
  });

  it("a legal form stays with its name (\"Jupiter Company Limited\")", () => {
    expect(cleanPartyName("Jupiter Company Limited")).toBe("Jupiter Company Limited");
  });

  it("a description of a technology isn't a company (GE's generator)", () => {
    expect(isDescriptionOnly("Revolutionary Hydrogen Technology")).toBe(true);
  });

  it("vehicles and a bare legal form are placeholders (Air Lease's Gladiatora, Verso's \"AB\")", () => {
    expect(isPlaceholderBuyer("Gladiatora Designated Activity Company")).toBe(true);
    expect(isPlaceholderBuyer("AB")).toBe(true);
    expect(isPlaceholderBuyer("BillerudKorsnäs AB")).toBe(false);
  });

  it("two names in capitals (Iberdrola, Prysmian)", () => {
    expect(displayCompanyName("IBERDROLA")).toBe("Iberdrola");
    expect(displayCompanyName("PRYSMIAN")).toBe("Prysmian");
  });

  it("more banks", () => {
    expect(findBanks("BDT & MSD Partners served as financial advisor")).toContain("BDT & MSD Partners");
    expect(findBanks("TSB Capital Advisors served as financial advisor")).toContain("TSB Capital Advisors");
  });
});

describe("8-K parties", () => {
  it("\"of\" inside a name stays (Spirit of Texas Bancshares, Bank of Commerce Holdings)", () => {
    const p = merger("Spirit of Texas Bancshares, Inc.", `On November 18, 2021, Simmons First National Corporation ("Simmons") and Spirit of Texas Bancshares, Inc. ("Spirit") entered into an Agreement and Plan of Merger, pursuant to which Spirit will merge with and into Simmons.`);
    expect(p?.target.name).toBe("Spirit of Texas Bancshares, Inc.");
    expect(p?.acquirer.name).toBe("Simmons First National Corporation");
  });

  it("a new holding company: the side swapping one for one is the buyer (Marvell / Inphi)", () => {
    const p = merger("Marvell Technology Group Ltd.", `On October 29, 2020, Marvell Technology Group Ltd. ("Marvell") and Inphi Corporation ("Inphi") entered into an Agreement and Plan of Merger with Maui HoldCo, Inc. ("HoldCo"), Maui Acquisition Company Ltd ("Bermuda Merger Sub") and Indigo Acquisition Corp. ("Delaware Merger Sub"). Bermuda Merger Sub will merge with and into Marvell, and Delaware Merger Sub will merge with and into Inphi. All issued and outstanding common shares of Marvell will be cancelled and converted into the right to receive one share of common stock of HoldCo. Each share of Inphi common stock will be converted into the right to receive $66.00 in cash and 2.323 shares of HoldCo common stock.`);
    expect(p?.acquirer.name).toMatch(/^Marvell/);
    expect(p?.target.name).toMatch(/^Inphi/);
  });

  it("not the seller: a sole stockholder (Paltalk / NTS)", () => {
    const p = merger("Paltalk, Inc.", `On June 19, 2024, Paltalk, Inc. (the "Company") entered into a Stock Purchase Agreement with NewtekOne, Inc., a Maryland corporation and the sole stockholder of Newtek Technology Solutions, Inc. ("NTS"), pursuant to which the Company will acquire NTS for $4.5 million.`);
    expect(p?.acquirer.name).not.toBe("NewtekOne, Inc.");
  });

  it("the filer can buy a company sharing its first word (First Internet / First Century)", () => {
    const p = merger("First Internet Bancorp", `On June 21, 2021, First Internet Bancorp (the "Company") and First Century Bancorp ("First Century") entered into an Agreement and Plan of Merger with FC Subsidiary, Inc. ("FC Subsidiary"), pursuant to which FC Subsidiary will merge with and into First Century.`);
    expect(p?.acquirer.name).toBe("First Internet Bancorp");
    expect(p?.target.name).toBe("First Century Bancorp");
  });

  it("meetings and plans aren't parties, and a filer's whole name stands (\"(the \"Meeting\")\", Infrastructure and Energy Alternatives)", () => {
    const p = merger("Infrastructure and Energy Alternatives, Inc.", `On July 24, 2022, Infrastructure and Energy Alternatives, Inc. (the "Company") entered into an Agreement and Plan of Merger with MasTec, Inc. ("Parent") and Indigo Acquisition I Corp. ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company. The merger requires approval at a special meeting (the "Meeting").`);
    expect(p?.target.name).toBe("Infrastructure and Energy Alternatives, Inc.");
    expect(p?.acquirer.name).toBe("MasTec, Inc.");
  });

  it("a seller stands in the target's own description, not near it (Qorvo's merger subs, Starz becoming a subsidiary)", () => {
    const qorvo = merger("Qorvo, Inc.", `On October 27, 2025, Qorvo, Inc., a Delaware corporation (" Qorvo "), entered into an Agreement and Plan of Merger (the " Merger Agreement "), by and among Skyworks Solutions, Inc., a Delaware Corporation (" Skyworks "), Qorvo, Inc., Comet Acquisition Corp., a Delaware corporation and a wholly owned subsidiary of Skyworks (" Merger Sub I "), and Comet Acquisition II, LLC, a Delaware limited liability company and a wholly owned subsidiary of Skyworks (" Merger Sub II "). Merger Sub I will merge with and into Qorvo (the " First Merger "), with Qorvo surviving the First Merger as a wholly owned subsidiary of Skyworks.`);
    expect(qorvo?.acquirer.name).toBe("Skyworks Solutions, Inc.");
    const starz = merger("Starz", `On June 30, 2016, Starz, a Delaware corporation (" Starz ") entered into an Agreement and Plan of Merger (the " Merger Agreement ") with Lions Gate Entertainment Corp., a corporation organized and existing under the corporate laws of British Columbia (" Lions Gate "), and Orion Arm Acquisition Inc., a Delaware corporation and an indirect wholly-owned subsidiary of Lions Gate (" Merger Sub "). The Merger Agreement provides that Merger Sub will merge with and into Starz, with Starz continuing as the surviving corporation and becoming an indirect wholly-owned subsidiary of Lions Gate (the " Merger ").`);
    expect(starz?.acquirer.name).toBe("Lions Gate Entertainment Corp.");
  });

  it("the banks' own merger after the holding companies' isn't the deal (Seacoast / Grand Bankshares)", () => {
    const p = merger("Seacoast Banking Corporation of Florida", `On March 25, 2015, Seacoast Banking Corporation of Florida, a Florida corporation ("Seacoast" or the "Company") and Seacoast's wholly-owned subsidiary, Seacoast National Bank, a national banking association ("SNB") entered into an Agreement and Plan of Merger (the "Merger Agreement") with Grand Bankshares, Inc., a Florida corporation ("Grand"), and Grand's wholly-owned subsidiary, Grand Bank & Trust of Florida, a Florida bank (the "Bank"). The Merger Agreement provides that Grand will merge with and into Seacoast, with Seacoast continuing as the surviving corporation (the "Merger"). Following the Merger, the Bank will merge with and into SNB, with SNB surviving the merger.`);
    expect(p?.target.name).toBe("Grand Bankshares, Inc.");
    expect(p?.acquirer.name).toBe("Seacoast Banking Corporation of Florida");
  });

  it("nor when the bank has a name the parser didn't take as a party (Seacoast / BANKshares)", () => {
    const p = merger("Seacoast Banking Corporation of Florida", `On April 24, 2014, Seacoast Banking Corporation of Florida, a Florida corporation ("Seacoast" or the "Company") and Seacoast's wholly-owned subsidiary, Seacoast National Bank, a national banking association ("SNB") entered into an Agreement and Plan of Merger (the "Merger Agreement") with The BANKshares, Inc., a Florida corporation ("BANKshares"), and BANKshares' wholly-owned subsidiary, The BankFIRST, a Florida bank ("BankFIRST"). The Merger Agreement provides that BANKshares will merge with and into Seacoast, with Seacoast continuing as the surviving corporation (the "Merger"). Following the Merger, BankFIRST will merge with and into SNB, with SNB surviving the merger.`);
    expect(p?.target.name).toBe("The BANKshares, Inc.");
    expect(p?.acquirer.name).toBe("Seacoast Banking Corporation of Florida");
  });

  it("a party's own bank isn't the buyer (Cordia / First-Citizens)", () => {
    const p = merger("Cordia Bancorp Inc.", `On May 19, 2016, Cordia Bancorp Inc., a Virginia corporation (the "Company"), and its wholly owned subsidiary, Bank of Virginia (the "Bank"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with First-Citizens Bank & Trust Company ("First-Citizens") and its wholly owned subsidiary, FC Merger Subsidiary I, Inc. ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company with the Company as the surviving entity.`);
    expect(p?.acquirer.name).toBe("First-Citizens Bank & Trust Company");
  });

  it("a scheme of arrangement marks a foreign listing (Newmont / Newcrest)", () => {
    const p = merger("Newmont Corporation", `On May 15, 2023, Newmont Corporation, a Delaware corporation ("Newmont" or the "Company"), entered into a scheme implementation deed (the "Scheme Implementation Deed") with Newmont Overseas Holdings Pty Ltd, an Australian proprietary company limited by shares and an indirect wholly owned subsidiary of Newmont ("Newmont Sub") and Newcrest Mining Limited, an Australian public company limited by shares ("Newcrest"), pursuant to which Newmont Sub will acquire all of the issued and outstanding ordinary shares of Newcrest pursuant to a court-approved scheme of arrangement.`);
    expect(p?.targetListedAbroad).toBe(true);
  });
});

describe("press releases", () => {
  it("a transcript filed as an exhibit isn't a release (Kaleyra's \"mGage Conference Call\")", () => {
    expect(parsePressRelease(`Kaleyra to Acquire mGage Conference Call\nCORPORATE PARTICIPANTS\nDario Calogero\nOperator Good morning and welcome to the call. Kaleyra will acquire mGage for $215 million.`, ctx)).toBeNull();
  });

  it("a target quoted over the counter is marked (Kineta)", () => {
    const p = parsePressRelease(`TuHURA Biosciences to Acquire Kineta\nTAMPA, Fla., Dec. 12, 2024 - TuHURA Biosciences, Inc. (Nasdaq: HURA) today announced a definitive merger agreement to acquire Kineta, Inc. (OTC Pink: KANT) for $20 million.`, { filerName: "TuHURA Biosciences, Inc.", filerTickers: ["HURA"] });
    expect(p?.targetOnOtc).toBe(true);
  });

  it("a place before the name goes (Miami, Florida-based Sudsies)", () => {
    const p = parsePressRelease(`EVI Industries Acquires Commercial Laundry Business\nMIAMI, Oct. 1, 2021 - EVI Industries, Inc. (NYSE American: EVI) today announced that it has acquired Miami, Florida-based Sudsies, Inc. for an undisclosed amount.`, { filerName: "EVI Industries, Inc.", filerTickers: ["EVI"] });
    if (p) expect(p.target.name).toMatch(/^Sudsies/);
  });

  it("a company's legal name in the possessive is a carve-out, and so are assets told in the text (Dana, Lennar's SunStreet)", () => {
    expect(isCarveOut(`Allison Transmission to Acquire Dana Incorporated's Off-Highway Drive & Motion Systems Business`, "", "Dana Incorporated's Off-Highway Drive")).toBe(true);
    expect(isCarveOut(`Sunnova to Acquire SunStreet`, `Sunnova has agreed to acquire Lennar's residential solar platform SunStreet.`, "Lennar")).toBe(true);
  });

  it("a revised offer with no agreement is a proposal (\"raises its offer\")", () => {
    expect(parsePressRelease(`Bidder Corp Raises Its Offer for Northwind Corp\nNEW YORK, June 1, 2024 - Bidder Corp today increased its unsolicited proposal for Northwind Corp to $25.00 per share in cash.`, ctx)).toBeNull();
  });
});

describe("listing and takeover evidence", () => {
  const sub = (forms: [string, string][], exchanges: string[] = []) => ({
    exchanges,
    filings: { recent: { form: forms.map((f) => f[0]), filingDate: forms.map((f) => f[1]), items: forms.map(() => ""), accessionNumber: forms.map((_, i) => `a${i}`), primaryDocument: forms.map(() => "d.htm") }, files: [] },
  });

  it("a Form 25 weeks before the deal means off the exchange at signing (Agile, 23 days), and days before covers a record dated at its closing", () => {
    expect(listedOn(sub([["10-K", "2023-03-01"], ["25", "2024-01-10"]]) as never, "2024-02-02")).toBe(false);
    expect(listedOn(sub([["10-K", "2023-03-01"], ["25", "2024-01-28"]]) as never, "2024-02-02")).toBe(true);
  });

  it("a DEFA14A alone proves nothing once a proxy would have followed (Citizens, Inc. for \"Citizens\"), only for a deal under 120 days old", () => {
    const s = sub([["DEFA14A", "2024-03-01"]]) as never;
    expect(takenOverAround(s, "2024-02-01", "2024-03-15")).toBe(true);
    expect(takenOverAround(s, "2024-02-01", "2024-12-01")).toBe(false);
    expect(takenOverAround(sub([["DEFM14A", "2024-03-01"]]) as never, "2024-02-01", "2024-12-01")).toBe(true);
  });

  it("private names that are a headline's verb, a place or a site", () => {
    for (const n of ["Kellstrom Aerospace Provides Preliminary", "San Diego-Based", "East Texas Bolt-On", "DreamWorks Animation Campus", "Certain Assets", "Control of Acme"]) expect(isPrivateTargetName(n, "Northwind Corp")).toBe(false);
    expect(isPrivateTargetName("Kellstrom Aerospace", "Northwind Corp")).toBe(true);
  });

  it("a release names its parties by their own short forms (\"U. S. Steel\", \"TD\")", () => {
    const steel = `Nippon Steel Corporation to Acquire U. S. Steel\nTOKYO and PITTSBURGH, Dec. 18, 2023 - Nippon Steel Corporation and United States Steel Corporation (NYSE: X) today announced a definitive agreement under which Nippon Steel will acquire U. S. Steel for $55.00 per share.`;
    expect(announcesDeal(steel, "United States Steel Corporation", "Nippon Steel Corporation")).toBe(true);
    const td = `TD to Acquire First Horizon\nTORONTO, Feb. 28, 2022 - TD Bank Group and First Horizon Corporation (NYSE: FHN) today announced a definitive agreement for TD to acquire First Horizon for $25.00 per share.`;
    expect(announcesDeal(td, "First Horizon Corporation", "The Toronto-Dominion Bank")).toBe(true);
  });
});

describe("closings", () => {
  const closing = (body: string) => `Item 2.01 Completion of Acquisition or Disposition of Assets. ${body} Item 9.01 Financial Statements and Exhibits.`;

  it("by the term the 8-K defines (NOMAD)", () => {
    const text = closing(`On July 1, 2026, the Company completed its purchase of Nomad Transportable Power Systems, Inc. ("NOMAD"). The purchase of NOMAD closed on that date.`);
    expect(closingNames(text, /Nomad Transportable Power Systems/i)).toBe(true);
  });

  it("through Item 2.01's pointer to Item 1.01's closing sentence (BurgerFi / Anthony's)", () => {
    const text = `Item 1.01 Entry into a Material Definitive Agreement. On November 3, 2021, BurgerFi International, Inc. completed the acquisition of Anthony's Coal Fired Pizza under the agreement described above (the "Stock Acquisition"). Item 2.01 Completion of Acquisition or Disposition of Assets. The information in Item 1.01 is incorporated herein by reference.`;
    expect(closingNames(text, /Anthony['’]s Coal Fired Pizza/i)).toBe(true);
  });

  it("never at a signing", () => {
    const text = `Item 1.01 Entry into a Material Definitive Agreement. On March 1, 2026, Northwind Corp entered into an agreement to acquire Acme Inc. The closing of the acquisition of Acme Inc. is expected in the third quarter. Item 2.01 Completion of Acquisition or Disposition of Assets. On March 1, 2026, Northwind Corp completed the spin-off of Grafiti Holding. Item 9.01 Financial Statements and Exhibits.`;
    expect(closingNames(text, /Acme Inc/i)).toBe(false);
  });

  it("the company's own merger proxy coming later: this delisted a preferred series, unless an Item 2.01 says closed (Urstadt Biddle; Dawson's tender)", () => {
    const form25 = { form: "25", date: "2023-02-01", items: "", adsh: "x", doc: "d" };
    const eightK = { form: "8-K", date: "2023-02-01", items: "5.01", adsh: "y", doc: "d" };
    const proxy = { form: "DEFM14A", date: "2023-06-01", items: "", adsh: "z", doc: "d" };
    expect(isClosingFiling([eightK, proxy], eightK)).toBe(false);
    const withClosing = { ...eightK, items: "2.01,5.01" };
    expect(isClosingFiling([withClosing, proxy, form25], withClosing)).toBe(true);
  });

  it("a brand may start in lower case, never a plain word (mGage, \"the company\")", () => {
    expect(searchName("mGage")).toBe("mGage");
    expect(searchName("the Company")).toBeNull();
    expect(searchName("an Affiliate")).toBeNull();
  });

  it("\"today\" counts before the phrase, not after it (Kaltura)", () => {
    expect(readStatement(`Northwind today announced that it has completed the acquisition of Acme Inc.`, ["completed the acquisition of Acme"]).today).toBe(true);
    expect(readStatement(`Northwind has completed the acquisition of Acme Inc. as reported earlier today.`, ["completed the acquisition of Acme"]).today).toBe(false);
  });

  it("a report's looser past tense: a stake, all the stock, a day, the deal done (Teraco, Own, Flex, Westchester)", () => {
    expect(readLooseCompletion("On August 1, 2022, we completed the acquisition of a 55% interest in Teraco Data Environments.", "Teraco")).toEqual({ found: true, date: "2022-08-01", today: false });
    expect(readLooseCompletion("In November 2024, the Company acquired all outstanding stock of Own Data Company Ltd.", "Own Data Company").found).toBe(true);
    expect(readLooseCompletion("On October 1, 2024, Flex acquired Crown Technical Systems for $325 million.", "Crown Technical Systems").found).toBe(true);
    expect(readLooseCompletion("The acquisition of Westchester was completed on December 1, 2021.", "Westchester").date).toBe("2021-12-01");
    expect(readLooseCompletion("The Teraco acquisition was completed in the third quarter.", "Teraco").found).toBe(true);
    expect(readLooseCompletion("It includes the acquisition of Harris Tea, which we completed in the first quarter.", "Harris Tea").found).toBe(true);
  });

  it("the month isn't the word may, in the exact phrases too (United / ANB, Twin Disc / Katsa)", () => {
    expect(readStatement("On May 1, 2025, United completed the previously announced acquisition of ANB Holdings, Inc.", ["completed the previously announced acquisition of ANB Holdings"]).found).toBe(true);
    expect(readStatement("The Company may have completed the acquisition of ANB Holdings.", ["completed the acquisition of ANB Holdings"]).found).toBe(false);
    expect(readLooseCompletion("On May 31, 2024, the Company completed the acquisition of 100% of the outstanding common stock of Katsa Oy.", "Katsa")).toEqual({ found: true, date: "2024-05-31", today: false });
  });

  it("the wordings in buyers' reports", () => {
    const done = (text: string, name: string) => readLooseCompletion(text, name).found;
    expect(done(`On January 2, 2025, the Company completed the acquisition of certain subsidiaries that operate the private brand tea business of Harris Freeman & Co, Inc. ("Harris Tea"), a leading manufacturer.`, "Harris Tea")).toBe(true);
    expect(done(`On April 1, 2024, the Company acquired 100 % ownership of Superior Controls, LLC ("RedViking"), a privately held automation system integrator.`, "RedViking")).toBe(true);
    expect(done("On November 1, 2021, the Company, along with certain of our domestic and international subsidiaries, acquired E&I Engineering Ireland Limited, a private company.", "E&I Engineering Group")).toBe(true);
    expect(done("On June 17, 2025, NXP announced the acquisition of 100% of TTTech Auto for $766 million in cash ($679 million net of cash acquired).", "TTTech Auto")).toBe(true);
    expect(done("This was driven by $0.3 billion of cash paid for the acquisitions of Crown Technical Systems and JETCOOL Technologies Inc. in November 2024, net of cash acquired.", "Crown Technical Systems")).toBe(true);
    expect(done("We completed our previously announced business acquisitions of Beacon and Enfusion on April 30 and April 21, 2025, respectively.", "Beacon and Blackstone's Bistro")).toBe(true);
    expect(done("Subsequent to March 27, 2021, we acquired 30 retail tire and automotive repair stores located in California from Mountain View Tire & Service, Inc. on April 25, 2021.", "Mountain View Tire & Service")).toBe(true);
    expect(done("During the year we acquired Turbine Controls, Inc. on April 24, 2024 and Kellstrom Aerospace Group, Inc. on December 3, 2024.", "Kellstrom Aerospace")).toBe(true);
    expect(done("Management excluded internal control at Bank of Commerce Holdings, which was acquired on October 1, 2021.", "Bank of Commerce Holdings")).toBe(true);
    expect(done("On November 28, 2022, the Company announced the successful completion of the all-stock merger between Leonardo DRS and RADA Electronic Industries Ltd.", "RADA Electronic Industries")).toBe(true);
    // By the term the report defines for it.
    expect(done(`All American Medical Group ("AAMG") is a medical group. On October 31, 2022, AP-AMH 2, a VIE of the Company, acquired 100% of the equity interest in AAMG.`, "All American Medical Group")).toBe(true);
    // And "Inc. " inside a sentence isn't its end.
    expect(readLooseCompletion("On February 1, 2022, the Company completed its acquisition of Pacific Enterprise Bancorp, Inc. and its wholly owned subsidiary.", "Pacific Enterprise Bancorp, Irvine, California").date).toBe("2022-02-01");
  });

  it("a balance sheet's date in the text before isn't the closing's (Flex / Crown)", () => {
    expect(readLooseCompletion("Inventories As of December 31, 2024 were as follows and this was primarily driven by $0.3 billion of cash paid for the acquisitions of Crown Technical Systems and JETCOOL Technologies Inc. in November 2024, net of cash acquired.", "Crown Technical Systems")).toEqual({ found: true, date: null, today: false });
  });

  it("a brand written with other capitals, and \"&\" written out (IPG / cleanLASER, TopBuild / SPI)", () => {
    expect(readLooseCompletion("On December 2, 2024, we completed the acquisition of cleanLASER.", "CleanLASER").found).toBe(true);
    expect(readLooseCompletion("We completed the acquisition of Specialty Products and Insulation Co.", "Specialty Products & Insulation").found).toBe(true);
    // Never an ordinary word.
    expect(readLooseCompletion("We completed the acquisition of our own company stores.", "Own").found).toBe(false);
  });

  it("a purchase called off in a report", () => {
    expect(readLooseEnd("On March 31, 2024, we terminated the Stock Purchase Agreement to buy Votaw Precision Technologies.", "Votaw").found).toBe(true);
    expect(readLooseEnd("We terminated the transition services agreement with Votaw.", "Votaw").found).toBe(false);
    expect(readLooseEnd("The buyer may be paid a fee if the merger agreement with Votaw is terminated.", "Votaw").found).toBe(false);
  });

  it("the forms of a stored name", () => {
    expect(nameForms("E&I Engineering Group")).toContain("E&I Engineering");
    expect(nameForms("Park Holidays UK")).toContain("Park Holidays");
    expect(nameForms("Tug Hill and XcL Midstream")).toContain("Tug Hill");
    expect(nameForms("Pacific Enterprise Bancorp, Irvine, California")).toContain("Pacific Enterprise Bancorp");
    expect(nameForms("GHOST Lifestyle")).toContain("GHOST");
    expect(nameForms("Teraco")).toEqual(["Teraco"]);
  });

  it("never an agreement, a plan, pro forma or another deal in the sentence", () => {
    for (const text of [
      "We expect to complete the acquisition of Teraco in the third quarter.",
      "We entered into an agreement to acquire Teraco, and the acquisition of Teraco is expected to close in 2022.",
      "Pro forma results are presented as if we had completed the acquisition of Teraco on January 1, 2021.",
      "The results assume we completed the acquisition of Teraco on January 1, 2021.",
      "We have not completed the acquisition of Teraco.",
      "Upon the closing of the acquisition of Teraco, we will issue shares.",
      "We completed the sale of our data centers to a joint venture with Teraco.",
      "We completed the acquisition of Interxion in 2020, and we also invested alongside other investors in a new venture named after Teraco in a separate transaction with partners that year.",
      "The Company also holds a note receivable from Teraco.",
    ]) expect(readLooseCompletion(text, "Teraco").found, text).toBe(false);
  });

  it("a completion release calling the deal previously announced, with no date, is marked (Deluxe / First American)", () => {
    const flag = (body: string) => parsePressRelease(body, { filerName: "Deluxe Corporation", filerTickers: ["DLX"] });
    const undated = flag("Deluxe Completes Acquisition of First American Payment Systems\nATLANTA, June 1, 2021 - Deluxe (NYSE: DLX) announced today it has completed the previously announced acquisition of First American Payment Systems for $960 million in cash.");
    expect(undated?.kind).toBe("completion");
    expect(undated?.announcedEarlier).toBe(true);
    const signAndClose = flag("Deluxe Acquires First American Payment Systems\nATLANTA, June 1, 2021 - Deluxe (NYSE: DLX) today announced that it has completed the acquisition of First American Payment Systems for $960 million in cash.");
    expect(signAndClose?.announcedEarlier).toBeUndefined();
  });

  it("an 8-K announcing the purchase of a named company (CURO / First Heritage, Planet Fitness / Sunshine)", () => {
    expect(readAnnouncement("CURO Group to Acquire First Heritage Credit. GREENVILLE, S.C., May 2022 - CURO announced it has signed an agreement.", "First Heritage Credit")).toBe(true);
    expect(readAnnouncement("Planet Fitness has entered into a definitive agreement to acquire Sunshine Fitness, its largest franchisee.", "Sunshine Fitness")).toBe(true);
    expect(readAnnouncement("Acme Inc. to be acquired by Northwind Corp for $40 per share.", "Acme Inc.")).toBe(true);
  });

  it("not one saying it closed, was announced before, or naming the company in passing", () => {
    for (const text of [
      "CURO completed its acquisition of First Heritage Credit.",
      "CURO previously announced an agreement to acquire First Heritage Credit.",
      "CURO's earnings include a partnership with First Heritage Credit.",
      "Our marketing agreement with First Heritage Credit was extended, and revenue grew.",
      "CURO has signed a non-binding letter of intent to acquire First Heritage Credit.",
      "In connection with the purchase agreement relating to the First Heritage Credit acquisition, CURO obtained a commitment.",
    ]) expect(readAnnouncement(text, "First Heritage Credit"), text).toBe(false);
  });

  it("a past reference in the buyer's filings still reads", () => {
    expect(readPastReference(`Our May 2022 acquisition of Wolt contributed to revenue.`, "Wolt").found).toBe(true);
  });
});

describe("the audit", () => {
  const base = { id: "x", acquirer: { name: "Northwind Corp", ticker: "NW", cik: "1" }, target: { name: "Acme Inc.", ticker: "ACM", cik: "2" }, valueUsd: 1e9, pricePerShare: null, premiumPct: null, enterpriseValueUsd: null, evEbitda: null, evRevenue: null, statusDate: null, acquirerAdvisors: [], targetAdvisors: [] };
  const rules = (over: object) => auditDeal({ ...base, ...over } as never, "2026-11-05T00:00:00Z").map((f) => f.rule);

  it("a listed target that filed nothing four months on", () => {
    expect(rules({ announcedDate: "2026-01-01", status: "Announced" })).toContain("public-target-filed-nothing");
    expect(rules({ announcedDate: "2026-10-01", status: "Announced" })).not.toContain("public-target-filed-nothing");
    expect(rules({ announcedDate: "2026-01-01", status: "Pending", milestones: { firstFiling: { form: "DEFM14A", date: "2026-02-01" } } })).not.toContain("public-target-filed-nothing");
    expect(rules({ announcedDate: "2026-01-01", status: "Terminated" })).not.toContain("public-target-filed-nothing");
  });

  it("a private purchase open two years on", () => {
    expect(rules({ privateTarget: true, announcedDate: "2024-01-01", status: "Announced" })).toContain("private-open-two-years");
    expect(rules({ privateTarget: true, announcedDate: "2025-01-01", status: "Announced" })).not.toContain("private-open-two-years");
    expect(rules({ privateTarget: true, announcedDate: "2024-01-01", status: "Closed" })).not.toContain("private-open-two-years");
  });
});

describe("the audit's value and name rules (November 2026)", () => {
  const base = { id: "x", acquirer: { name: "Northwind Corp", ticker: "NW", cik: "1" }, target: { name: "Acme Inc.", ticker: "ACM", cik: "2" }, announcedDate: "2026-09-01", status: "Pending", pricePerShare: 10, premiumPct: null, evEbitda: null, evRevenue: null, statusDate: null, acquirerAdvisors: [], targetAdvisors: [], milestones: { firstFiling: { form: "DEFM14A", date: "2026-10-01" } } };
  const rules = (over: object) => auditDeal({ ...base, ...over } as never, "2026-11-10T00:00:00Z").map((f) => f.rule);
  it("compares a buy-in with its share of the EV, and passes cash shells and small indebted targets", () => {
    expect(rules({ valueUsd: 4.58e9, enterpriseValueUsd: 32.7e9, buyIn: 17 })).not.toContain("value-vs-ev-mismatch");
    expect(rules({ valueUsd: 4.58e9, enterpriseValueUsd: 32.7e9, buyIn: true })).toContain("value-vs-ev-mismatch");
    expect(rules({ valueUsd: 50e6, enterpriseValueUsd: 1.2e6 })).not.toContain("value-vs-ev-mismatch");
    expect(rules({ valueUsd: 5e9, enterpriseValueUsd: 0.2e9 })).toContain("value-vs-ev-mismatch");
    expect(rules({ valueUsd: 50e6, enterpriseValueUsd: 350e6 })).not.toContain("value-vs-ev-mismatch");
    expect(rules({ valueUsd: 500e6, enterpriseValueUsd: 3.5e9 })).toContain("value-vs-ev-mismatch");
  });
  it("lets joint buyers named in full be long, not a description", () => {
    expect(rules({ acquirer: { name: "Elliott Investment Management, Patient Square Capital and Veritas Capital", cik: null } })).not.toContain("name-too-long");
    expect(rules({ acquirer: { name: "Joint Venture Backed by Kemmons Wilson Hospitality Partners and Ascendant Capital Partners", cik: null } })).toContain("name-too-long");
  });
});
