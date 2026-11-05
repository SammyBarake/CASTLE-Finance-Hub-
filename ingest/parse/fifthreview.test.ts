/**
 * What the fifth review against the filings found (November 2026): advisers, stated values, the release gate, vehicles and
 * defined-term buyers. Fixtures are in each filing's wording; the deal each comes from is in its name.
 */
import { describe, expect, it } from "vitest";
import { ADVISOR_CHECK_VERSION, advisorCheckDue, announcesDeal, applyParsed, isContractExhibit, looksLikePressRelease, mergeReleaseAdvisors, releaseExhibits, releaseTerms, takesStatedValue, VALUE_CHECK_VERSION, valueCheckDue } from "../deals";
import type { FtsHit } from "../edgar";
import type { State } from "../store";
import { isPlaceholderBuyer } from "../../lib/names";
import { parseMergerItem, raisedPrice, reducedPrice } from "./eightk";
import { extractAdvisors, extractValue, parsePressRelease, type ParsedPress, buyInOf } from "./press";
import { buyerBanksInProxy } from "./proxy";
import { jointBuyers, sponsorFromText } from "./sponsor";

const ctx = { filerName: "", filerTickers: [] };
const value = (text: string) => extractValue(text)?.usd ?? null;

describe("advisers", () => {
  it("a sentence ending in Inc. doesn't run into the next subject (Novolex / Pactiv Evergreen)", () => {
    const t = "Financing is being provided by Wells Fargo Bank NA, UBS Investment Bank, Barclays, RBC Capital Markets and Morgan Stanley Senior Funding, Inc. Goldman Sachs & Co. LLC and Lazard Frères & Co. LLC are acting as financial advisors to Pactiv Evergreen. Barclays, RBC Capital Markets and Morgan Stanley & Co. LLC are also acting as financial advisors to Novolex.";
    const a = extractAdvisors(t, "Novolex", "Pactiv Evergreen Inc.", null, "PTVE");
    expect(a.targetAdvisors).toEqual(["Goldman Sachs", "Lazard"]);
    expect(a.acquirerAdvisors).toEqual(expect.arrayContaining(["Barclays", "RBC Capital Markets", "Morgan Stanley"]));
  });

  it("a list with commas after Inc. stays one list (SunTrust Robinson Humphrey)", () => {
    const a = extractAdvisors("Barclays Capital Inc., Goldman Sachs & Co. LLC and Citigroup Global Markets Inc. are acting as financial advisors to Widget Corp.", "Atlas Inc.", "Widget Corp", null, null);
    expect(a.targetAdvisors).toEqual(expect.arrayContaining(["Barclays", "Goldman Sachs", "Citigroup"]));
  });

  it("a side mandate isn't the deal's (ONEOK / Brazos); the same sentence with the arranger's role is (HGGC / Monotype)", () => {
    const a = extractAdvisors("Barclays served as sole financial advisor to ONEOK on the Brazos Midland acquisition. Lazard also served as financial advisor to ONEOK on the minority equity investment.", "ONEOK, Inc.", "Brazos Midstream", null, null);
    expect(a.acquirerAdvisors).toEqual(["Barclays"]);
    const b = extractAdvisors("Deutsche Bank Securities Inc. is serving as exclusive financial advisor to HGGC and will also be the left lead arranger on the debt financing for the transaction.", "HGGC", "Monotype Imaging Holdings Inc.", null, null);
    expect(b.acquirerAdvisors).toEqual(["Deutsche Bank"]);
  });

  it("a joint buyer's members, by name (AES; Triumph)", () => {
    const a = extractAdvisors("Goldman Sachs & Co. LLC is acting as financial advisor to GIP, CalPERS and QIA, and Citi is acting as financial advisor to EQT.", "Consortium Led by Global Infrastructure Partners and EQT", "The AES Corporation", null, null);
    expect(a.acquirerAdvisors).toContain("Citigroup");
    const b = extractAdvisors("Lazard is serving as financial advisor to Berkshire Partners.", "Warburg Pincus and Berkshire Partners", "Triumph Group, Inc.", null, null);
    expect(b.acquirerAdvisors).toEqual(["Lazard"]);
  });

  it("not a shared 'and' in one company's name (Eli Lilly and Company; Clayton, Dubilier & Rice), and not someone else (Mr. Musk)", () => {
    const a = extractAdvisors("Guggenheim Securities is serving as financial advisor to Company.", "Eli Lilly and Company", "Verve Therapeutics, Inc.", null, null);
    expect(a.acquirerAdvisors).toEqual([]);
    const b = extractAdvisors("Moelis is serving as financial advisor to Dubilier.", "Clayton, Dubilier & Rice, LLC", "Widget Corp", null, null);
    expect(b.acquirerAdvisors).toEqual([]);
    const c = extractAdvisors("Morgan Stanley is acting as financial advisor to Mr. Musk.", "X Holdings", "Twitter, Inc.", null, null);
    expect(c).toEqual({ acquirerAdvisors: [], targetAdvisors: [] });
  });

  it("a lower-case brand and the buyer's ticker name the buyer (onsemi / Synaptics; NBHC)", () => {
    const a = extractAdvisors("Morgan Stanley served as lead financial advisor to onsemi. J.P. Morgan Securities LLC also served as a financial advisor to onsemi.", "onsemi", "Synaptics Incorporated", null, null);
    expect(a.acquirerAdvisors).toEqual(["Morgan Stanley", "JPMorgan"]);
    const b = extractAdvisors("Piper Sandler & Co. served as financial advisor to NBHC.", "National Bank Holdings Corporation", "Vista Bancshares", null, null, "NBHC");
    expect(b.acquirerAdvisors).toEqual(["Piper Sandler"]);
  });

  it("legal adviser 'with' the bank as its financial adviser (HomeStreet / Mechanics Bank), not a holder named beside it (Surgery Partners' Bain)", () => {
    const a = extractAdvisors("Wachtell, Lipton, Rosen & Katz is serving as legal advisor to Mechanics Bank with J.P. Morgan Securities LLC serving as its financial advisor.", "HomeStreet, Inc.", "Mechanics Bank", null, null);
    expect(a.targetAdvisors).toEqual(["JPMorgan"]);
    const b = extractAdvisors("Kirkland & Ellis LLP is serving as legal counsel to Bain Capital with Goldman Sachs serving as its financial advisor.", "Ares Management", "Surgery Partners, Inc.", null, null);
    expect(b).toEqual({ acquirerAdvisors: [], targetAdvisors: [] });
    const c = extractAdvisors("Sullivan & Cromwell LLP served as outside legal counsel for Stryker in connection with this transaction. Barclays is serving as Sage's financial advisor and Kirkland & Ellis LLP are serving as legal counsel for Sage.", "Stryker Corporation", "Sage Products", null, null);
    expect(c.acquirerAdvisors).toEqual([]);
    expect(c.targetAdvisors).toEqual(["Barclays"]);
    // A joint release filed by the target: the sentence's "its" is the party named, not the filer (HomeStreet / Mechanics Bank).
    const d = extractAdvisors("Wachtell, Lipton Rosen & Katz is serving as legal advisor to Mechanics Bank with J.P. Morgan Securities LLC serving as its financial advisor. Sullivan & Cromwell LLP is serving as legal advisor to HomeStreet with Keefe, Bruyette & Woods, A Stifel Company , serving as its financial advisor.", "Mechanics Bank", "HomeStreet, Inc.", "target", null);
    expect(d).toEqual({ acquirerAdvisors: ["JPMorgan"], targetAdvisors: ["Stifel"] });
  });

  it("wider wordings (Masimo, Flex / EPC Power, Viatris, CBIZ, Long Lake, Jamf, Huntington / Cadence, HighPoint)", () => {
    expect(extractAdvisors("Morgan Stanley & Co. LLC also provided financial advice to Masimo.", "Danaher Corporation", "Masimo Corporation", null, null).targetAdvisors).toEqual(["Morgan Stanley"]);
    expect(extractAdvisors("BofA Securities, Citi, and PJT Partners also provided financial advice to Flex.", "Flex", "EPC Power", null, null).acquirerAdvisors).toEqual(["BofA Securities", "Citigroup", "PJT Partners"]);
    expect(extractAdvisors("Centerview Partners LLC also provided strategic and financial advice to Viatris.", "Viatris Inc.", "Pacira BioSciences, Inc.", null, null).acquirerAdvisors).toEqual(["Centerview"]);
    expect(extractAdvisors("Deutsche Bank acted as lead financial advisor for Grant Thornton Advisors and New Mountain Capital. Other financial advisors included J.P. Morgan, BMO Capital Markets and UBS.", "Grant Thornton Advisors", "CBIZ", null, null).acquirerAdvisors).toEqual(expect.arrayContaining(["JPMorgan", "BMO Capital Markets", "UBS"]));
    expect(extractAdvisors("J.P. Morgan Securities LLC and BofA Securities are also acting as advisors to Long Lake.", "Long Lake Management", "American Express Global Business Travel", null, null).acquirerAdvisors).toEqual(["JPMorgan", "BofA Securities"]);
    expect(extractAdvisors(`Jamf and Francisco Partners ("FP") today announced a definitive agreement. Goldman Sachs and Deutsche Bank are also advisors to FP.`, "Francisco Partners", "Jamf", null, null).acquirerAdvisors).toEqual(["Goldman Sachs", "Deutsche Bank"]);
    expect(extractAdvisors("BofA Securities also served as advisor to Huntington.", "Huntington Bancshares Incorporated", "Cadence Bank", null, null).acquirerAdvisors).toEqual(["BofA Securities"]);
    expect(extractAdvisors("J.P. Morgan Securities LLC also served as an advisor to HighPoint.", "Bonanza Creek", "HighPoint Resources Corporation", null, null).targetAdvisors).toEqual(["JPMorgan"]);
    expect(extractAdvisors("Leidos retained Citi as financial advisor.", "Leidos", "ENTRUST Solutions Group", null, null).acquirerAdvisors).toEqual(["Citigroup"]);
    expect(extractAdvisors("Great Plains was represented by Stephens Inc., as financial advisor.", "Third Coast", "Great Plains Bancshares, Inc.", null, null).targetAdvisors).toEqual(["Stephens"]);
  });

  it("lenders named beside the advice stay out", () => {
    const a = extractAdvisors("Citibank, N.A. is providing committed financing for the transaction. Goldman Sachs is acting as financial advisor to Atlas.", "Atlas Inc.", "Widget Corp", null, null);
    expect(a.acquirerAdvisors).toEqual(["Goldman Sachs"]);
  });

  it("the release's banks join the stored ones, and a bank on the target's list leaves the buyer's (Equity Residential / AvalonBay)", () => {
    const deal = { acquirerAdvisors: ["Morgan Stanley", "JPMorgan"], targetAdvisors: ["Goldman Sachs"] };
    expect(mergeReleaseAdvisors(deal, { acquirerAdvisors: ["Morgan Stanley", "Centerview", "BofA Securities"], targetAdvisors: ["Goldman Sachs", "JPMorgan", "Wells Fargo"] })).toBe(true);
    expect(deal).toEqual({ acquirerAdvisors: ["Morgan Stanley", "Centerview", "BofA Securities"], targetAdvisors: ["Goldman Sachs", "JPMorgan", "Wells Fargo"] });
  });

  it("a proxy's story fills an empty buyer's list (Air Lease, Akero, Inari, Globalstar), and the caller drops the target's bank", () => {
    expect(buyerBanksInProxy(`The revised non-binding indication of interest also stated that Sumitomo and SMBC AC had engaged Goldman Sachs Group, Inc. (" Goldman Sachs ") and Citigroup Global Markets Inc. (" Citi ") as their financial advisors, and that SMBC AC had engaged Davis Polk & Wardwell LLP as their external legal counsel.`, "Sumitomo Corporation")).toEqual(["Goldman Sachs", "Citigroup"]);
    expect(buyerBanksInProxy("met with Novo's financial advisor, BofA Securities, Inc., on the following day", "Novo Nordisk a S")).toEqual(["BofA Securities"]);
    expect(buyerBanksInProxy(`representatives of Citigroup Global Markets Inc. ("Citi"), Stryker's financial advisor, called`, "Stryker Corp")).toEqual(["Citigroup"]);
    expect(buyerBanksInProxy("in a meeting with Amazon, its financial advisor, Goldman Sachs & Co. LLC, and counsel", "Amazon COM Inc")).toEqual(["Goldman Sachs"]);
    expect(buyerBanksInProxy("Party B's financial advisor, Barclays, then called", "Stryker Corp")).toEqual([]);
  });
});

describe("the stated value", () => {
  it("wordings the main pattern missed", () => {
    expect(value("the transaction is valued at approximately $376 1 million, including debt")).toBe(376e6); // HighPoint's footnote digit
    expect(value("Capgemini will acquire WNS for $76.50 per share. The total cash consideration will amount to $3.3 billion.")).toBe(3.3e9);
    expect(value("Steel Excel will acquire all of the capital stock of SWH, Inc. for an acquisition price of $85 million less net debt")).toBe(85e6);
  });

  it("a guard reads the amount's own clause (WTS Paradigm, Kodiak, AssuredPartners, Romeo)", () => {
    expect(value(`a software solutions and services provider for the building products industry, in a cash transaction valued at approximately $450 million.`)).toBe(450e6);
    expect(value(`today announced it has completed its acquisition of Kodiak Building Partners ("Kodiak") from Court Square Capital Partners for approximately $2.25 billion, expanding QXO's addressable market to more than $200 billion.`)).toBe(2.25e9);
    expect(value("Gallagher will acquire the stock of AssuredPartners' parent company from GTCR and funds advised by Apax Partners LLP for gross consideration of $13.45 billion, representing a pro forma EBITDAC multiple of 14.3x.")).toBe(13.45e9);
    expect(value("an equity value of approximately $144 million and 4.5% pro forma ownership")).toBe(144e6);
  });

  it("the market, the combined company and a reprinted article still don't count (Cabot / Cimarex, EQT / Equitrans, EQT / Range)", () => {
    expect(value("reflects an enterprise value for the combined companies of approximately $17 billion.")).toBeNull();
    expect(value("All stock transaction with combined company enterprise value over $35 billion")).toBeNull();
    expect(value("to create America's leading natural gas company with a pro forma enterprise value over $50 billion.")).toBeNull();
    expect(value("a total addressable market valued at $200 billion")).toBeNull();
  });

  it("Lilly's aggregate in brackets (Sigilon, POINT, Verve), not the most it could pay", () => {
    expect(extractValue("Lilly will commence a tender offer to acquire all outstanding shares of Sigilon for a purchase price of $14.92 per share in cash (an aggregate of approximately $34.6 million) payable at closing, plus one non-tradeable contingent value right")).toEqual({ usd: 34.6e6, kind: "equity" });
    expect(value("for a purchase price of $12.50 per share in cash (an aggregate of approximately $1.4 billion) payable at closing")).toBe(1.4e9);
    expect(value("the merger consideration of $14.92 per share, an aggregate of up to approximately $309.6 million including the CVR")).toBeNull();
  });

  it("an upfront amount with no ceiling, under a buyer's verb (Alesta, Preventice)", () => {
    expect(value("BioMarin to Acquire Alesta Therapeutics to Gain ALE1, a Potential First Oral Therapy for Hypophosphatasia BioMarin to pay $275 million upfront, plus additional payments upon achievement of development and regulatory milestones")).toBe(275e6);
    expect(value("The transaction consists of an upfront cash payment of $925 million, and up to an additional $300 million in a potential commercial milestone payment.")).toBe(925e6);
  });

  it("not a collaboration's, a licence's, or a financing's upfront, nor one leg beside shares (Carisma, Avere, DustPhotonics, ImmPACT)", () => {
    expect(value("As part of the collaboration, Carisma received a $45 million up-front cash payment and an investment by Moderna in the form of a $35 million convertible note.")).toBeNull();
    expect(value("granting Avere ex-China rights for the development of AVR-001. In exchange, Hansoh will receive upfront payments totaling $120 million and is eligible to receive up to $2.18 billion in milestones under the license.")).toBeNull();
    expect(value("Credo will acquire DustPhotonics for upfront consideration of $750 million cash and approximately 0.92 million shares of Credo common stock.")).toBeNull();
    expect(value("Deal terms include upfront consideration payable upon closing the potential transaction of $30 million in cash, subject to certain adjustments, and 37.5 million shares of Lyell common stock")).toBeNull();
    expect(value("the private placement raised $115 million in upfront proceeds")).toBeNull();
    expect(value("As part of the transaction, GE will be paid a $2.9 billion up-front cash payment, and GE and its shareholders will receive 50.1% of the fully diluted outstanding shares of Wabtec.")).toBeNull();
  });

  it("the verb 'purchase' and the wider labels (Plasti-Fab, MUFG Union Bank, Lexington), not its agreements (U.S. Well Services) or a leg (AdRizer)", () => {
    expect(value("Under the terms of the agreement, Carlisle will purchase Plasti-Fab for $259.5 million in cash.")).toBe(259.5e6);
    expect(value("U.S. Bancorp will purchase MUFG Union Bank for approximately $8 billion, including $5.5 billion in cash")).toBe(8e9);
    expect(value("Franklin Templeton is acquiring 100% of Lexington from its current owners, for aggregate cash payments of $1.75 billion, made up of $1 billion at close")).toBe(1.75e9);
    expect(value(`such warrant holders entered into a Warrant Purchase Agreement with ProFrac pursuant to which such warrant holders will sell to ProFrac all of the Term C Loan Warrants for a total of $2.6 million.`)).toBeNull();
    expect(value("Vinco acquired AdRizer for $38 million in cash paid at closing and up to 10 million shares of common stock")).toBeNull();
  });

  it("not someone else's purchase (AT&T / Leap's spectrum, Synalloy's sale-leaseback), nor an upfront's other leg in dollars (PhosImmune, Pernix / Cypress)", () => {
    expect(value(`Leap shareholders will also receive a contingent right entitling them to the net proceeds received on the sale of Leap's 700 Mhz "A Block" spectrum in Chicago, which Leap purchased for $204 million in August 2012.`)).toBeNull();
    expect(value("the company plans to title ASTI's real estate to its sale lease-back partner, Store Capital, who will purchase ASTI's real estate for $5 million.")).toBeNull();
    expect(value("Under the terms of the agreement, Agenus paid PhosImmune's equity holders an upfront payment of $2.5 million in cash and $7.4 million in shares of Agenus common stock at closing.")).toBeNull();
    expect(value("Pernix will pay up to $102 million, including an up-front payment of $52.0 million in cash and $34.0 million in equity (approximately 4.4 million shares of the Company's common stock) at closing")).toBeNull();
    expect(value("Under the terms of the agreement, Akers is acquiring Cystron Biotech LLC for a $1 million upfront payment, 622,756 shares of common stock or common stock equivalents and a royalty on net sales.")).toBeNull();
    expect(value("Trans Ova stockholders will receive approximately $60 million in upfront cash, $30 million in Intrexon common stock, and deferred payments of up to $20 million.")).toBeNull();
    expect(value("Prior to joining Melinta, he held a lead role in the $4 billion acquisition of Gambro and oversaw the integration of their products.")).toBeNull();
    expect(value("In addition, C&F purchased from the U.S. Treasury for $3.35 million all of CVB's preferred stock and warrants.")).toBeNull();
    // An upfront paid in stock, or stated with what it's made of, is still the upfront (Agenus / 4-Antibody, Crisp, Cernostics).
    expect(value("Agenus has agreed to acquire all of the outstanding stock of 4-Antibody for an initial payment of $10 million in shares of Agenus common stock, plus additional contingent payments, payable in cash or Agenus common stock, that may exceed $40 million")).toBe(10e6);
    expect(value("The Company will pay approximately $33.0 million in upfront consideration, comprising cash and stock of $20.0 million and $13.0 million respectively (approximately 1.2 million shares valued based on a 90-day volume weighted average trading price)")).toBe(33e6);
    expect(value("At closing, Castle will pay $30 million in initial consideration to Cernostics security holders, which may consist entirely of cash or $20 million in cash and $10 million in common stock of Castle")).toBe(30e6);
    // "Under terms of the $12.5 million transaction" is this deal's (Adler Hot Oil), and "As a part of the $335 million transaction" (Packet).
    expect(value("ENSERVCO acquired Adler Hot Oil Service, LLC. Under terms of the $12.5 million transaction, ENSERVCO paid the Seller $3.7 million in cash at closing")).toBe(12.5e6);
    // What's paid at once, when the total counts the milestones.
    expect(value("Under the terms of the definitive agreement, Mirum will purchase Travere's bile acid product portfolio for $445 million, consisting of $210 million upfront and $235 million in potential sales-based milestone payments.")).toBe(210e6);
    expect(value("Under the terms of the transaction, Tutor Perini acquired 100% of Lunda's stock for $163.5 million, consisting of $141.8 million in cash at closing and $21.7 million in notes payable in five years, plus a structured earnout based on the achievement of certain profitability targets.")).toBe(163.5e6);
    // A stated deferred part stays in the total (Lexington).
    expect(value("Franklin Templeton is acquiring 100% of Lexington from its current owners, for aggregate cash payments of $1.75 billion, made up of $1 billion at close and additional payments totaling $750 million over the next three years.")).toBe(1.75e9);
  });

  it("in an Item 1.01, 'purchase' is a side agreement (Brightpoint, Waste Management / Advanced Disposal, Arc Logistics)", () => {
    const options = { agreement: true };
    expect(extractValue("granted to Intcomex a five-year option, effective upon closing of the Merger, to purchase Intcomex common stock held by the Brightpoint Shareholder for a purchase price of $3,000,000", options)).toBeNull();
    expect(extractValue("Parent will purchase from LCP LNG the Unconditioned Interest for cash consideration of $36,229,200", options)).toBeNull();
  });

  it("stated totals in other shapes (Masimo / Sound United, Anord Mardix, Advance)", () => {
    expect(value("Masimo will pay approximately $1.025 billion, subject to adjustments, for the acquisition.")).toBe(1.025e9);
    expect(value("The $540 million all-cash transaction has been unanimously approved by Flex's Board of Directors")).toBe(540e6);
    expect(value("Flex announced today it has completed its previously announced $540 million all-cash acquisition of Anord Mardix")).toBe(540e6);
    expect(value("Ecolab will pay approximately $4.75 billion in cash at the closing of the transaction, subject to customary adjustments.")).toBe(4.75e9);
  });

  it("one leg stays out of those, and so does what's not this deal's price", () => {
    expect(value("will pay approximately $200 million in cash at closing and issue 10 million shares of common stock")).toBeNull();
    // Taylor Morrison / AV Homes: the value with debt, not the highlights' equity figure.
    expect(value("Highlights: Acquisition price of approximately $490 million yields an attractive purchase multiple of 1.1x book. Taylor Morrison will acquire all of the outstanding shares in a cash and stock transaction valued (including outstanding AV Homes debt) at approximately $963 million.")).toBe(963e6);
    // Physicians Formula: what the buyer added, not the price.
    expect(value("Markwins will acquire all of the outstanding shares for $4.90 per share in cash, or approximately $74.9 million. Negotiations resulted in an increase in the aggregate merger consideration to stockholders of approximately $10 million.")).toBe(74.9e6);
    // ONEOK / EnLink: an earlier purchase the release recalls.
    expect(value("ONEOK will acquire all of the outstanding publicly held common units of EnLink for $4.3 billion in ONEOK common stock. On Oct. 15, 2024, ONEOK announced the successful completion of its acquisition of GIP's entire interest in EnLink for a total cash consideration of approximately $3.3 billion.")).toBe(4.3e9);
    // Sprint / SoftBank: what an amendment raised from.
    expect(extractValue("The Amendment increases by $4.5 billion the aggregate cash consideration payable in the SoftBank Merger to the Company's stockholders from $12.14 billion to $16.64 billion.", { agreement: true })?.usd ?? null).not.toBe(12.14e9);
  });

  it("plan shares and an amount around the words 'acquisition consideration' keep their readings (Exela, Battalion, Decibel, Entasis)", () => {
    expect(value("with shares valued at $4.98 per share and equity valuation of $585.7 million for purposes of the plan.")).toBeNull();
    expect(value("net of acquisition consideration and fees, Parent is expected to have approximately $100 million in cash")).toBeNull();
    expect(extractValue("The acquisition values Decibel at a total equity value of approximately $109 million based on the amount payable")).toEqual({ usd: 109e6, kind: "equity" });
    expect(value("The acquisition consideration values Entasis' equity at $113 million on a fully diluted basis")).toBe(113e6);
  });
});

describe("price cuts", () => {
  it("to X from Y (iRobot, $61.00 to $51.75), not a fee", () => {
    expect(reducedPrice("have agreed to reduce the merger consideration to be paid by Amazon for each share of the Company's common stock, par value $0.01 per share (the \"Shares\") in the Merger to $51.75 in cash per Share, without interest, from $61.00 in cash per Share, without interest.")).toBe(51.75);
    expect(reducedPrice("the Termination Fee is reduced from $8,000,000 to $6,000,000.")).toBeNull();
  });

  it("a release announcing the amended agreement (Battalion, $7.00), not a rival's price in a target's letter (Vacasa)", () => {
    const b = parsePressRelease(`Battalion Oil Corporation Announces Amendment to Merger Agreement with Fury Resources, Inc.
Houston, Texas, Sept. 19, 2024 -- Battalion Oil Corporation (NYSE American: BATL) ("Battalion" or the "Company") announced today that it has entered into an amendment to the previously disclosed Agreement and Plan of Merger (as amended, the "Merger Agreement") with Fury Resources, Inc. ("Buyer" or "Parent"), pursuant to which Parent has agreed to acquire all of the outstanding shares of Common Stock of the Company (the "Common Stock") for $7.00 per share in cash, without interest (the "Merger Consideration").`, { filerName: "Battalion Oil Corp", filerTickers: ["BATL"] });
    expect(b).toMatchObject({ pricePerShare: 7, amended: true, priceCut: true, consideration: "Cash" });
    expect(b!.acquirer.name).toBe("Fury Resources, Inc.");
    const v = parsePressRelease(`Vacasa Responds to Revised Unsolicited Proposal from Davidson Kempner Capital Management
PORTLAND, Ore., April 18, 2025 - Vacasa, Inc. (Nasdaq: VCSA) today announced that its Special Committee has unanimously determined that the revised unsolicited acquisition proposal from Davidson Kempner Capital Management for $5.83 per share in cash does not constitute a superior proposal to the merger agreement with Casago, as amended, for $5.30 per share in cash.`, { filerName: "Vacasa, Inc.", filerTickers: ["VCSA"] });
    expect(v?.priceCut).toBeUndefined();
  });

  it("a raise written 'increase the cash consideration … from … to' (Janus Henderson, $49.00 to $52.00)", () => {
    expect(raisedPrice(`i. increase the cash consideration to be paid by Parent for each ordinary share, par value $1.50 per share, of the Company (collectively, the "Shares") issued and outstanding immediately prior to the Effective Time (except for shares held by Parent) from $49.00 to $52.00 per Share in cash, without interest;`)).toBe(52);
    // Vista Outdoor's mixed "Cash Consideration" is a leg.
    expect(raisedPrice("increase the Cash Consideration from $18.00 to $19.00 per share in cash, with each share also receiving one share of Revelyst")).toBeNull();
  });
});

describe("the release gate", () => {
  const forte = `argenx to Acquire Forte Biosciences, Inc., Adding First-in-Class anti-CD122 Antibody
Amsterdam, the Netherlands, July 27, 2026 - argenx SE (Euronext & Nasdaq: ARGX) and Forte Biosciences, Inc. today announced that they have entered into a definitive agreement under which argenx will acquire Forte for $77 per share in cash, representing a total equity value of approximately $2.2 billion. Conference Call argenx will host a conference call and webcast at 8:00 a.m.`;

  it("call details don't make a release a transcript (argenx / Forte)", () => {
    expect(looksLikePressRelease(forte)).toBe(true);
    expect(releaseTerms(forte, "Forte Biosciences, Inc.", "argenx BV")).toMatchObject({ valueUsd: 2.2e9, valueKind: "equity" });
  });

  it("decks, transcripts, memos and articles stay out, whatever they say (EQT's article on Range)", () => {
    expect(looksLikePressRelease("Filed pursuant to Rule 425. Investor Presentation. Merger Creates the Premier Company >$35 B Enterprise Value")).toBe(false);
    expect(looksLikePressRelease("Filed pursuant to Rule 425. Slides from the webcast. Atlas Combines with Ridge")).toBe(false);
    expect(looksLikePressRelease("The following is an article that was published in the Pittsburgh Business Times: EQT today announced it will acquire Range in the $13 billion acquisition, which has an enterprise value of $50 billion.")).toBe(false);
    expect(looksLikePressRelease("The following is a transcript of the investor call. Today announced a merger.")).toBe(false);
    expect(looksLikePressRelease("CONFIDENTIAL - DO NOT DISTRIBUTE Talking points. Enfusion today announced that Clearwater will acquire it.")).toBe(false);
  });

  it("a merger of equals announces a deal (AvalonBay / Equity Residential); a completion and results don't", () => {
    const t = `FOR IMMEDIATE RELEASE AvalonBay Communities and Equity Residential Announce Merger of Equals, Creating One of the Country's Leading Real Estate Companies`;
    expect(announcesDeal(t, "AvalonBay Communities, Inc.", "Equity Residential")).toBe(true);
    expect(announcesDeal("Atlas Completes Acquisition of Widget Corp\nAtlas to acquire Widget under the definitive agreement", "Widget Corp", "Atlas Inc")).toBe(false);
  });

  it("an exhibit's name: 99-named first, then what a release goes by, up to the cap (TreeHouse), never a contract", () => {
    expect(releaseExhibits(["ths-20251110.htm", "pressrelease-111020251.htm", "ceomessagetoemployees1.htm", "employeefaqs1.htm"], "ths-20251110.htm", 3)).toEqual(["pressrelease-111020251.htm"]);
    expect(releaseExhibits(["d1d8k.htm", "d1dex21.htm", "d1dex991.htm", "d1dex992.htm"], "d1d8k.htm", 3)).toEqual(["d1dex991.htm", "d1dex992.htm"]);
    expect(releaseExhibits(["a8k.htm", "ex2-1_mergeragreement.htm", "exhibit991.htm", "press.htm", "ex991.htm", "ex992.htm", "ex993.htm"], "a8k.htm", 3)).toEqual(["ex991.htm", "ex992.htm", "ex993.htm"]);
    expect(releaseExhibits(["a8k.htm", "ex2-1_mergeragreement.htm", "merger-agreement.htm"], "a8k.htm", 3)).toEqual([]);
    expect(isContractExhibit("EX-2.1 2 ex_912345.htm AGREEMENT AND PLAN OF MERGER by and among")).toBe(true);
    expect(isContractExhibit("EX-99.1 4 ex_912346.htm Atlas to Acquire Widget")).toBe(false);
  });
});

describe("headlines", () => {
  it("a lower-case brand (argenx, onsemi, bluebird bio) the text writes as a name, not an ordinary word", () => {
    expect(parsePressRelease(`onsemi to Acquire Synaptics to Enable the Next Generation of Intelligent Systems
PHOENIX, June 1, 2026 - onsemi (Nasdaq: ON) today announced a definitive agreement to acquire Synaptics Incorporated (Nasdaq: SYNA).`, ctx)?.acquirer.name).toBe("onsemi");
    expect(parsePressRelease(`Carlyle to Acquire bluebird bio
BOSTON, Feb. 21, 2025 - bluebird bio, Inc. (Nasdaq: BLUE) and Carlyle today announced a definitive agreement.`, ctx)?.target.name).toMatch(/^bluebird bio/);
    expect(parsePressRelease(`certain assets to Acquire Widget
BOSTON, Feb. 21, 2025 - today announced a definitive agreement under which certain assets go.`, ctx)).toBeNull();
  });

  it("a lower-case plc belongs to the name (Janus Henderson, Noble), and a raise isn't two companies merging", () => {
    const p = parsePressRelease(`Janus Henderson Group plc to be Acquired by Trian Fund Management and General Catalyst for $7.4 Billion
London, December 22, 2025 - Janus Henderson Group plc (NYSE: JHG) today announced a definitive agreement. Holders will receive $49.00 per share in cash.`, { filerName: "Janus Henderson Group plc", filerTickers: ["JHG"] });
    expect(p).toMatchObject({ target: { name: "Janus Henderson Group plc" }, acquirer: { name: "Trian Fund Management and General Catalyst" }, valueUsd: 7.4e9 });
    expect(parsePressRelease(`Trian and General Catalyst Agree to Increase Merger Consideration to $52.00 per Share in Cash for Janus Henderson Group plc
London, March 24, 2026 - today announced the amended agreement.`, ctx)).toBeNull();
  });

  it("the body says which of two names is sold (TreeHouse / Investindustrial, Anaplan / Thoma Bravo)", () => {
    const p = parsePressRelease(`TreeHouse Foods and Investindustrial Announce Definitive Acquisition Agreement for a Total Enterprise Value of $2.9 Billion
OAK BROOK, Ill., November 10, 2025 - TreeHouse Foods, Inc. (NYSE: THS) and Industrial F&B Investments III Inc. ("Investindustrial") today announced that they have entered into a definitive agreement under which TreeHouse Foods will be acquired by Investindustrial in an all-cash transaction for a total Enterprise Value of $2.9 billion.`, { filerName: "TreeHouse Foods, Inc.", filerTickers: ["THS"] });
    expect(p).toMatchObject({ acquirer: { name: "Investindustrial" }, valueUsd: 2.9e9, valueKind: "enterprise" });
    expect(p!.target.name).toMatch(/^TreeHouse Foods/);
  });

  it("a release's body naming only the defined term (Ossen, China Customer Relations, Newater)", () => {
    const body = (buyer: string) => `Ossen Innovation Enters into Definitive Merger Agreement for Going Private Transaction
SHANGHAI, December 17, 2020 /PRNewswire/ - Ossen Innovation Co., Ltd. (the "Company") (Nasdaq: OSN) today announced that it has entered into a definitive Agreement and Plan of Merger (the "Merger Agreement") with ${buyer}, and New Ossen Innovation Limited, a wholly-owned Subsidiary of Parent ("Merger Sub"), pursuant to which the Parent will acquire the Company for US$1.70 in cash per ordinary share of the Company.`;
    expect(parsePressRelease(body(`New Ossen Group Limited, an exempted company with limited liability incorporated under the Law of the British Virgin Islands (the "Parent")`), { filerName: "Ossen Innovation Co. Ltd.", filerTickers: ["OSN"] })?.acquirer.name).toBe("New Ossen Group Limited");
    expect(parsePressRelease(body(`Taiying Group Ltd. ("Parent")`), { filerName: "Ossen Innovation Co. Ltd.", filerTickers: ["OSN"] })?.acquirer.name).toBe("Taiying Group Ltd.");
    expect(parsePressRelease(body(`a newly formed entity`), { filerName: "Ossen Innovation Co. Ltd.", filerTickers: ["OSN"] })?.acquirer.name).toBe("Parent");
  });
});

describe("the checks that read releases again", () => {
  const base = { valueUsd: null as number | null, valueCheck: VALUE_CHECK_VERSION - 1, status: "Closed" as const };

  it("a value: none yet, or only price × shares, once per version, not on a terminated deal", () => {
    expect(valueCheckDue({ ...base })).toBe(true);
    expect(valueCheckDue({ ...base, valueUsd: 1.07e9, valueImplied: true })).toBe(true); // Forte
    expect(valueCheckDue({ ...base, valueUsd: 1.07e9 })).toBe(false); // a stated one stands
    expect(valueCheckDue({ ...base, valueCheck: VALUE_CHECK_VERSION })).toBe(false);
    expect(valueCheckDue({ ...base, status: "Terminated" })).toBe(false);
    // CIRCOR raised to $56 in two steps: its first release's $1.6B is the $49 offer's.
    expect(valueCheckDue({ ...base, valueUsd: 1.14e9, valueImplied: true, termsAmended: true })).toBe(false);
  });

  it("over price × shares, a release at the deal's price only", () => {
    expect(takesStatedValue({ valueUsd: 1.07e9, pricePerShare: 77 }, { pricePerShare: 77 })).toBe(true);
    expect(takesStatedValue({ valueUsd: 1.14e9, pricePerShare: 56 }, { pricePerShare: 51 })).toBe(false);
    expect(takesStatedValue({ valueUsd: null, pricePerShare: 56 }, { pricePerShare: 51 })).toBe(true);
    expect(takesStatedValue({ valueUsd: 1.14e9, pricePerShare: 56 }, { pricePerShare: null })).toBe(true);
  });

  it("the banks: a side empty, or no release among the documents (AvalonBay, TreeHouse)", () => {
    const d = { advisorCheck: ADVISOR_CHECK_VERSION - 1, acquirerAdvisors: ["Morgan Stanley"], targetAdvisors: ["Goldman Sachs"], sources: ["0001:tm2615292d1_8k.htm"] };
    expect(advisorCheckDue(d)).toBe(true);
    expect(advisorCheckDue({ ...d, sources: ["0001:tm2615292d1_ex99-1.htm"] })).toBe(false);
    expect(advisorCheckDue({ ...d, sources: ["0001:tm2615292d1_ex99-1.htm"], targetAdvisors: [] })).toBe(true);
    expect(advisorCheckDue({ ...d, advisorCheck: ADVISOR_CHECK_VERSION })).toBe(false);
  });
});

describe("through applyParsed", () => {
  const hit = (fileDate: string, adsh: string): FtsHit => ({ id: `${adsh}:doc.htm`, adsh, file: "doc.htm", form: "8-K", rootForm: "8-K", fileType: "8-K", fileDate, ciks: ["1274173"], displayNames: ["Janus Henderson Group plc (JHG) (CIK 0001274173)"], sics: ["6282"], items: [] });
  const target = { cik: "1274173", ticker: "JHG", listedInUs: true };
  const buyer = { cik: null, ticker: null, listedInUs: false };
  const doc = (name: string, kind: ParsedPress["kind"], over: Partial<ParsedPress>): ParsedPress => ({ kind, headline: "", acquirer: { name, ticker: null, exchange: null }, target: { name: "Janus Henderson Group plc", ticker: null, exchange: null }, pricePerShare: null, premiumPct: null, valueUsd: null, valueKind: null, consideration: "Cash", acquirerAdvisors: [], targetAdvisors: [], ...over });

  it("Janus Henderson: the 8-K's joint buyers keep their name, its release's banks and value join, and the raise blanks the old value", () => {
    const state: State = { deals: [], ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] };
    applyParsed(state, doc("Trian and General Catalyst", "announcement", { pricePerShare: 49, item101: true }), hit("2025-12-22", "a"), target, buyer, false);
    applyParsed(state, doc("Trian Fund Management and General Catalyst", "announcement", { pricePerShare: 49, valueUsd: 7.4e9, valueKind: "equity", acquirerAdvisors: ["Jefferies", "Citigroup"], targetAdvisors: ["Goldman Sachs"] }), hit("2025-12-22", "b"), target, buyer, false);
    expect(state.deals[0]).toMatchObject({ acquirer: { name: "Trian and General Catalyst" }, valueUsd: 7.4e9, acquirerAdvisors: ["Jefferies", "Citigroup"], targetAdvisors: ["Goldman Sachs"] });
    applyParsed(state, doc("Jupiter Company Limited", "update", { pricePerShare: 52, amended: true, item101: true }), hit("2026-03-24", "c"), target, buyer, false);
    expect(state.deals).toHaveLength(1);
    expect(state.deals[0]).toMatchObject({ acquirer: { name: "Trian and General Catalyst" }, pricePerShare: 52, valueUsd: null, termsAmended: true });
  });

  it("Battalion: a release's cut lowers the price, a rival's lower figure from another buyer doesn't", () => {
    const state: State = { deals: [], ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] };
    applyParsed(state, doc("Fury Resources, Inc.", "announcement", { pricePerShare: 9.8, valueUsd: 450e6, valueKind: "transaction" }), hit("2023-12-18", "a"), target, buyer, false);
    applyParsed(state, doc("Davidson Kempner", "update", { pricePerShare: 5.83, amended: true }), hit("2024-05-18", "b"), target, buyer, false);
    expect(state.deals[0].pricePerShare).toBe(9.8);
    applyParsed(state, doc("Fury Resources, Inc.", "update", { pricePerShare: 7, amended: true, priceCut: true }), hit("2024-09-19", "c"), target, buyer, false);
    expect(state.deals[0]).toMatchObject({ pricePerShare: 7, valueUsd: null });
  });
});

describe("vehicles", () => {
  it("a one-word Company Limited is a shell (Janus Henderson's Jupiter); a name with its own words isn't", () => {
    expect(isPlaceholderBuyer("Jupiter Company Limited")).toBe(true);
    expect(isPlaceholderBuyer("Gladiatora Designated Activity Company")).toBe(true);
    for (const n of ["Shiseido Company, Limited", "Takeda Pharmaceutical Company Limited", "TOMY Company, Ltd.", "Eli Lilly and Company"]) expect(isPlaceholderBuyer(n), n).toBe(false);
  });

  it("the investor group behind it (Trian and General Catalyst on Janus Henderson)", () => {
    const p = parseMergerItem(`Item 1.01 Entry into a Material Definitive Agreement. On December 21, 2025, Janus Henderson Group plc (the "Company"), Jupiter Company Limited, a company incorporated in Jersey ("Parent"), and Jupiter Merger Sub Limited, a company incorporated in Jersey ("Merger Sub"), entered into an Agreement and Plan of Merger (the "Merger Agreement") providing for the acquisition of the Company by Parent. Merger Sub will merge with and into the Company (the "Merger") in accordance with the Companies (Jersey) Law 1991. Each ordinary share will be converted into the right to receive $49.00 per Share in cash. Funds and investment vehicles that are part of an investor group led by Trian Fund Management, L.P. and General Catalyst Group Management, LLC have provided the Company with limited guarantees that, collectively, guarantee the payment of the Parent termination fee.`, { filerName: "JANUS HENDERSON GROUP PLC", filerTickers: [] });
    expect(p).toMatchObject({ acquirer: { name: "Trian and General Catalyst" }, target: { name: "Janus Henderson Group plc" }, pricePerShare: 49 });
    expect(jointBuyers("Trian Fund Management, L.P. and General Catalyst Group Management, LLC have provided")).toBe("Trian and General Catalyst");
    expect(sponsorFromText("Funds that are part of an investor group led by Trian Fund Management, L.P. and General Catalyst Group Management, LLC have provided the Company with limited guarantees", "Janus Henderson Group plc", "Jupiter Company Limited")).toBe("Trian and General Catalyst");
  });

  it("Clayton, Dubilier & Rice stays one firm, and Elliott keeps its name", () => {
    expect(jointBuyers("Clayton, Dubilier & Rice, LLC and Elliott Investment Management L.P. have committed")).toBe("Clayton, Dubilier & Rice and Elliott Investment Management");
  });
});

describe("values the review read as wrong", () => {
  it("the Treasury's preferred, a combined company's equity, a royalty someone may buy, land bought alongside, a ceiling", () => {
    expect(extractValue("Cadence will purchase the preferred stock held by the U.S. Treasury for $38 million.")).toBeNull();
    expect(extractValue("First Cash and Cash America will merge, with a pro-forma market value of equity of approximately $2.4 billion.")).toBeNull();
    expect(extractValue("Stillwater holds a royalty that may be purchased by Peregrine for $1 million.")).toBeNull();
    expect(extractValue("Construction Partners will also purchase from the sellers certain real property for $30 million.")).toBeNull();
    expect(extractValue("The maximum aggregate consideration of $75 million includes an initial payment of $20.4 million.")?.usd).not.toBe(75e6);
  });

  it("still reads a plain purchase and a stated total (Plasti-Fab, CoreSite)", () => {
    expect(extractValue("Northwind will purchase Plasti-Fab for $259.5 million in cash.")?.usd).toBe(259.5e6);
    expect(extractValue("The total consideration for the transaction, including the assumption of debt, is approximately $10.1 billion.")?.usd).toBe(10.1e9);
  });
});

describe("from reading the last rehearsal", () => {
  it("a combined company's value after U.S. isn't the price (Marvell / Inphi)", () => {
    expect(extractValue("Marvell to Acquire Inphi ■ Creates U.S. semiconductor powerhouse with an enterprise value of approximately $40 billion ■ Positions Marvell for leadership in cloud")).toBeNull();
  });

  it("a holder's tender, from what it says it owns (Continental / the Hamm Family)", () => {
    expect(buyInOf(`Mr. Hamm, certain of his family members and their affiliated entities (collectively, the "Hamm Family") own approximately 83% of the outstanding shares of the Company's common stock. Merger Sub will commence a tender offer to purchase any and all of the outstanding shares of Company Common Stock, other than (i) shares of Company Common Stock owned by the Hamm Family and (ii) shares underlying unvested equity awards.`)).toBe(17);
  });

  it("a vehicle named with its owner beside it is the owner (Mural Oncology / XOMA Royalty)", () => {
    const p = parsePressRelease(`XOMA Royalty to Acquire Mural Oncology\nDATE: 20 August 2025 Announcement regarding the Company's entry into an agreement for the Company to be acquired by XRA 5 Corp ("Sub"), a wholly owned subsidiary of XOMA Royalty Corporation. Mural Oncology plc entered into a definitive agreement with XOMA Royalty Corporation (Nasdaq: XOMA).`, { filerName: "Mural Oncology plc", filerTickers: [] });
    expect(p?.acquirer.name).toMatch(/^XOMA Royalty/);
  });
});
