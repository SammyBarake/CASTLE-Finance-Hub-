/**
 * The last reading of a rehearsed rebuild against the filings (November 2026): parties, scope and values. Fixtures are in each
 * filing's wording; the deal each comes from is in its name.
 */
import { describe, expect, it } from "vitest";
import { isPlaceholderBuyer } from "../../lib/names";
import { applyParsed, isPrivateTargetName, listedOn, proxyStatesCurrentPrice, registrantMatches } from "../deals";
import type { FtsHit } from "../edgar";
import type { State } from "../store";
import { parseMergerItem, ownReleaseDay } from "./eightk";
import { cleanPartyName, isPlausibleName, withoutStateTag } from "./names";
import { circularAbroad, extractPrice, extractValue, isCarveOut, parsePressRelease, type ParsedPress } from "./press";
import { buyerBehindParent, jointBuyers, sponsorFromText } from "./sponsor";

const press = (text: string, filerName = "") => parsePressRelease(text, { filerName, filerTickers: [] });
const item = (text: string, filerName = "") => parseMergerItem(`Item 1.01 Entry into a Material Definitive Agreement.\n${text}`, { filerName, filerTickers: [] });

describe("EDGAR's state tags", () => {
  it("come off a registrant's name", () => {
    expect(withoutStateTag("ENTERPRISE BANCORP INC /MA/")).toBe("ENTERPRISE BANCORP INC");
    expect(withoutStateTag("HEALTH NET INC /DE/")).toBe("HEALTH NET INC");
    expect(withoutStateTag("QUALCOMM INC/DE")).toBe("QUALCOMM INC");
    expect(withoutStateTag("ONEOK INC /NEW/")).toBe("ONEOK INC");
  });
  it("a legal form with a slash isn't one", () => {
    expect(withoutStateTag("Novo Nordisk A/S")).toBe("Novo Nordisk A/S");
    expect(withoutStateTag("Ambev S/A")).toBe("Ambev S/A");
  });
  it("registrantMatches ignores them (Independent / Enterprise Bancorp, read as private for it)", () => {
    expect(registrantMatches("ENTERPRISE BANCORP INC /MA/", "Enterprise Bancorp, Inc.")).toBe(true);
    expect(registrantMatches("HEALTH NET INC /DE/", "Health Net, Inc.")).toBe(true);
  });
  it("and stays strict about extra words", () => {
    expect(registrantMatches("ENTERPRISE BANCORP INC /MA/", "Enterprise")).toBe(false);
    expect(registrantMatches("ENTERPRISE FINANCIAL SERVICES CORP /MO/", "Enterprise")).toBe(false);
    expect(registrantMatches("Fortune Brands Innovations, Inc. /DE/", "Fortune")).toBe(false);
  });
});

describe("listed then", () => {
  it("an amended Form 25 is a Form 25: RADA, on Nasdaq until Leonardo DRS bought it", () => {
    const sub = { exchanges: [], filings: { recent: { accessionNumber: ["a", "b"], filingDate: ["2022-11-28", "2022-03-24"], form: ["25-NSE/A", "20-F"], primaryDocument: ["d", "d"], items: ["", ""] }, files: [] } };
    expect(listedOn(sub as never, "2022-06-21")).toBe(true);
  });
});

describe("real deals the rehearsal lost", () => {
  it("VSE / Kellstrom: the target is cut at the headline's next verb, and the body's name takes over", () => {
    const p = press(
      `VSE CORPORATION ANNOUNCES ACQUISITION OF KELLSTROM AEROSPACE PROVIDES PRELIMINARY THIRD QUARTER 2024 RESULTS\nALEXANDRIA, VA., October 15, 2024 - VSE Corporation ("VSE" or the "Company") (NASDAQ: VSEC), a leading provider of aftermarket distribution and repair services, announced today that the Company has signed a definitive agreement to acquire Kellstrom Aerospace Group, Inc. ("Kellstrom"), a portfolio company of AE Industrial Partners, LP, for $200 million.`,
      "VSE Corp",
    );
    expect(p?.target.name).toBe("Kellstrom Aerospace Group");
    expect(p?.valueUsd).toBe(200e6);
  });
  it("Recro / IRISYS: a place of two words goes", () => {
    expect(cleanPartyName("San Diego-Based IRISYS")).toBe("IRISYS");
    expect(cleanPartyName("NEW YORK-BASED ACME")).toBe("ACME");
  });
  it("but not what isn't a place", () => {
    expect(cleanPartyName("Three Hospital-Based Branded")).toBe("Three Hospital-Based Branded");
    expect(cleanPartyName("Medicare Value-Based Care")).toBe("Medicare Value-Based Care");
    expect(cleanPartyName("Sirius Computer Solutions LINCOLNSHIRE")).toBe("Sirius Computer Solutions LINCOLNSHIRE");
  });
  it("Transcat / Martin Calibration: a count of labs is all of it, not a carve-out", () => {
    const p = press(
      `Transcat acquires Martin Calibration Inc.'s 7 labs, Expanding Midwest Service presence, including Minneapolis\nROCHESTER, NY, December 10, 2024 - Transcat, Inc. (Nasdaq: TRNS) announced that it has acquired privately-held Martin Calibration Inc. (Martin), effective December 10, 2024. The $79 million purchase price was paid in combination of $69 million in cash and $10 million in Company stock.`,
      "Transcat Inc",
    );
    expect(p?.target.name).toBe("Martin Calibration Inc.");
    expect(p?.valueUsd).toBe(79e6);
  });
  it("a legal name in the possessive is still a carve-out before a business word (Dana, Celanese)", () => {
    expect(isCarveOut("Allison to Acquire Dana Incorporated's Off-Highway Drive & Motion Systems Business", "", "Dana Incorporated's Off-Highway")).toBe(true);
  });
  it("First Internet / First Century: a shared ordinary first word isn't the same company", () => {
    expect(isPrivateTargetName("First Century Bancorp", "First Internet Bancorp")).toBe(true);
    // A self-deal stays out, by more than the first word or a distinctive first word.
    expect(isPrivateTargetName("First Internet Bank", "First Internet Bancorp")).toBe(false);
    expect(isPrivateTargetName("Merck Research", "Merck & Co")).toBe(false);
  });
  it("KindlyMD / Nakamoto: a founder and his company merging with the filer", () => {
    const p = press(
      "David Bailey and Bitcoin-Native Holding Company Nakamoto Announce Merger with KindlyMD® to Establish Bitcoin Treasury\nMIDVALE, Utah, May 12, 2025 - KindlyMD, Inc. (NASDAQ: KDLY) today announced that it has entered into a definitive merger agreement with Nakamoto Holdings Inc., a Bitcoin-native holding company.",
      "Kindly MD, Inc.",
    );
    expect(p?.acquirer.name).toBe("Kindly MD, Inc.");
    expect(p?.target.name).toMatch(/^Nakamoto/);
  });
  it("but not two firms named first", () => {
    const p = press(
      "Acme Capital and Beta Partners Announce Merger with Gamma Inc\nCHICAGO, May 12, 2025 - Gamma Inc today announced that it has entered into a definitive merger agreement with Beta Partners.",
      "Gamma Inc",
    );
    expect(p?.acquirer.name).not.toBe("Gamma Inc");
  });
});

describe("scope", () => {
  it("Tingo: a notice of a Form S-4 filing is an update, which can't create a deal", () => {
    const p = press("TINGO and MICT Announce Filing of Form S-4 Merger Registration and Joint Proxy Statement\nJuly 26, 2022 - MICT, Inc. and Tingo, Inc. (OTC Markets: TMNA) today announced the filing of a registration statement.", "MICT, Inc.");
    expect(p?.kind).toBe("update");
  });
  it("a real announcement that mentions a later S-4 in its body stays one", () => {
    const p = press("Acme to Acquire Widget Corp\nCHICAGO, May 2, 2022 - Acme Inc today announced a definitive agreement to acquire Widget Corp. Acme will file a registration statement on Form S-4 for the shares.", "Acme Inc");
    expect(p?.kind).toBe("announcement");
  });
  it("Prothena / Novo Nordisk: a programme sold is not a company", () => {
    expect(press("Prothena and Novo Nordisk Announce Acquisition Agreement for Prothena's ATTR Amyloidosis Programme\nDUBLIN, July 12, 2021 - Under the definitive agreement Novo Nordisk will develop the phase 2-ready antibody PRX004.", "Prothena Corp Public Ltd Co")).toBeNull();
  });
  it("Uranium Energy / Roughrider: a project under the adjectives read as its name", () => {
    expect(isCarveOut("Uranium Energy Corp Completes Acquisition of the World-Class Development-Stage Roughrider Uranium Project From Rio Tinto", "", "World-Class")).toBe(true);
    expect(isCarveOut("Uranium Energy Corp Acquires Burke Hollow Project in South Texas", "", "Burke Hollow")).toBe(true);
  });
  it("the company with its project, or a name with Project in it, isn't", () => {
    expect(isCarveOut("Paramount Gold Nevada Corp. Completes Acquisition of Calico Resources Corp. and its Grassy Mountain Gold Project", "", "Calico Resources Corp.")).toBe(false);
    expect(isCarveOut("Acme Acquires Alpha Project Management", "", "Alpha")).toBe(false);
  });
  it("Lucero: a circular filed with the TSX Venture Exchange is the target's only listing (Vitesse)", () => {
    const body = `Lucero intends to file an information circular and proxy statement (the "Circular") with the TSX Venture Exchange ("TSXV") and on SEDAR+ in connection with the solicitation of proxies to obtain Lucero shareholder approval of the proposed transaction.`;
    expect(circularAbroad(body, "Lucero Energy Corp.")).toBe(true);
    expect(circularAbroad(body.replace("TSX Venture Exchange", "SEC"), "Lucero Energy Corp.")).toBe(false);
    // Someone else's circular says nothing about this target.
    expect(circularAbroad(body, "Vitesse Energy, Inc.")).toBe(false);
    const p = item(
      `On December 15, 2024, Vitesse Energy, Inc., a Delaware Corporation ("Vitesse"), and Lucero Energy Corp., a corporation organized and existing under the laws of the Province of Alberta, Canada ("Lucero"), entered into an Arrangement Agreement (the "Arrangement Agreement"), pursuant to which Vitesse will acquire all of the issued and outstanding common shares of Lucero. ${body}`,
      "Vitesse Energy, Inc.",
    );
    expect(p?.target.name).toBe("Lucero Energy Corp.");
    expect(p?.targetListedAbroad).toBe(true);
  });
  it("Ra Medical / Catheter Precision: who becomes whose subsidiary decides the roles", () => {
    const p = press(
      `Ra Medical Systems Enters Into Definitive Merger Agreement with Catheter Precision\nCARLSBAD, Calif., Sept. 12, 2022 - Ra Medical Systems, Inc. (NYSE American: RMED) today announced a merger agreement with privately held Catheter Precision, Inc. ("Catheter Precision"). Under the terms of the agreement, Catheter Precision will become a wholly owned subsidiary of Ra Medical in a stock for stock reverse merger transaction.`,
      "Ra Medical Systems, Inc.",
    );
    expect(p?.acquirer.name).toMatch(/^Ra Medical/);
    expect(p?.target.name).toMatch(/^Catheter Precision/);
  });
  it("Vistra / Cogentrix: \"executed definitive agreements to acquire\", at its stated net price, not the value put on its shares", () => {
    const text = `Vistra Adds to its Industry-Leading Generation Portfolio with Acquisition of Cogentrix\nIRVING, Texas, Jan. 5, 2026 - Vistra Corp. (NYSE: VST) today announced it has executed definitive agreements to acquire Cogentrix Energy, consisting of 10 modern natural gas generation facilities. The acquisition includes three combined cycle gas turbine facilities and one cogeneration facility in ERCOT. Vistra will acquire these assets at a net purchase price of approximately $4.0 billion, which is comprised of the payment of approximately $2.3 billion of cash consideration and approximately $0.9 billion of Vistra stock consideration (5 million shares of common stock at a mutually agreed-upon value of $185 per share) to be issued to Quantum.`;
    const p = press(text, "Vistra Corp.");
    expect(p?.kind).toBe("announcement");
    expect(p?.acquirer.name).toBe("Vistra Corp.");
    expect(p?.target.name).toBe("Cogentrix Energy");
    expect(p?.announcedOn).toBe("2026-01-05");
    expect(p?.valueUsd).toBe(4e9);
    expect(p?.pricePerShare).toBeNull();
    expect(extractPrice("5 million shares of common stock at a mutually agreed-upon value of $185 per share")).toBeNull();
  });
});

describe("Vistra / Cogentrix through applyParsed", () => {
  it("the January release dates the deal and its closing joins it", () => {
    const hit = (fileDate: string, adsh: string): FtsHit => ({ id: `${adsh}:doc.htm`, adsh, file: "doc.htm", form: "8-K", rootForm: "8-K", fileType: "EX-99.1", fileDate, ciks: ["1692819"], displayNames: ["Vistra Corp.  (VST)  (CIK 0001692819)"], sics: [], items: [] });
    const state: State = { deals: [], ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] };
    const none = { cik: null, ticker: null, listedInUs: false };
    const buyer = { cik: "1692819", ticker: "VST", listedInUs: true };
    const january = press("Vistra Adds to its Industry-Leading Generation Portfolio with Acquisition of Cogentrix\nIRVING, Texas, Jan. 5, 2026 - Vistra Corp. (NYSE: VST) today announced it has executed definitive agreements to acquire Cogentrix Energy, consisting of 10 modern natural gas generation facilities.", "Vistra Corp.")!;
    const closing = press("Vistra Completes Acquisition of Cogentrix Energy, Expanding Diverse Generation Fleet\nIRVING, Texas, Oct. 30, 2026 - Vistra Corp. (NYSE: VST) today announced it has completed the acquisition of Cogentrix Energy.", "Vistra Corp.")!;
    applyParsed(state, january, hit("2026-01-05", "a"), none, buyer, true);
    applyParsed(state, closing, hit("2026-11-05", "b"), none, buyer, true);
    expect(state.deals).toHaveLength(1);
    expect(state.deals[0].announcedDate).toBe("2026-01-05");
  });
});

describe("names and fragments", () => {
  it("the Arrangement and \"as of the Closing\" are no parties", () => {
    expect(isPlausibleName("Arrangement")).toBe(false);
    expect(isPlausibleName("Company as of the Closing")).toBe(false);
    // Buyers on the live site: Adamis's "Proposal", SharpLink's "Reorganization"; StoneMor's "Company and".
    for (const s of ["Proposal", "Reorganization", "Company and"]) expect(isPlausibleName(s)).toBe(false);
    expect(isPlausibleName("Proposal Software Inc.")).toBe(true);
  });
  it("names that only contain the word are", () => {
    expect(isPlausibleName("Arrangement Partners LLC")).toBe(true);
    expect(isPlausibleName("Closing Costs Inc")).toBe(true);
  });
  it("Digital Ally / Clover Leaf: no buyer left, no record", () => {
    const p = item(
      `Digital Ally, Inc. (the "Company Stockholder"), and the sole stockholder of the Company, entered into an Agreement and Plan of Merger with Clover Leaf Capital Corp. Merger Sub will merge with and into the Company. The Merger Consideration will be (i) $125 million, minus (ii) the estimated consolidated indebtedness of the Company as of the Closing ("Closing Indebtedness").`,
      "Digital Ally, Inc.",
    );
    expect(p?.acquirer.name ?? "").not.toBe("Company as of the Closing");
  });
  it("Covetrus: Clayton, Dubilier & Rice stays whole in a headline", () => {
    const p = press("Covetrus to Be Acquired by Clayton, Dubilier & Rice and TPG at an Enterprise Valuation of Approximately $4 Billion\nPORTLAND, Maine, May 25, 2022 - Covetrus, Inc. (NASDAQ: CVET) today announced a definitive agreement.", "Covetrus, Inc.");
    expect(p?.acquirer.name).toBe("Clayton, Dubilier & Rice and TPG");
    const q = press("Clayton, Dubilier & Rice, LLC to Acquire Widget Corp\nNEW YORK, May 25, 2022 - Clayton, Dubilier & Rice, LLC today announced a definitive agreement to acquire Widget Corp.", "Widget Corp");
    expect(q?.acquirer.name).toBe("Clayton, Dubilier & Rice, LLC");
  });
  it("Peoples / Citizens: the full name of a one-word target the release defines", () => {
    const p = press(`Peoples Bancorp Inc. to Acquire Citizens\nMARIETTA, Ohio, April 21, 2026 - Peoples Bancorp Inc. (NASDAQ: PEBO) and Citizens National Corporation ("Citizens") (OTCPK: CZNL) today announced a definitive agreement under which Peoples Bancorp Inc. will acquire Citizens.`, "Peoples Bancorp Inc");
    expect(p?.target.name).toBe("Citizens National Corporation");
    // Written with no definition it stays.
    const q = press("Peoples Bancorp Inc. to Acquire Citizens\nMARIETTA, Ohio, April 21, 2026 - Peoples Bancorp Inc. today announced a definitive agreement under which Peoples Bancorp Inc. will acquire Citizens.", "Peoples Bancorp Inc");
    expect(q?.target.name).toBe("Citizens");
  });
  it("the carve-out checks still read the text's own short form (Sunnova / Lennar's SunStreet)", () => {
    const p = press(`Sunnova to Acquire Lennar\nHOUSTON, Feb. 25, 2021 - Sunnova entered into a definitive merger agreement to acquire Lennar's residential solar platform SunStreet from Lennar Corporation ("Lennar").`, "Sunnova Energy International Inc.");
    expect(p).toBeNull();
  });
});

describe("vehicles", () => {
  it("Borrower, Aggregation and Acquisition LP are vehicle words", () => {
    expect(isPlaceholderBuyer("GTCR Everest Borrower, LLC")).toBe(true);
    expect(isPlaceholderBuyer("TPG Cannes Aggregation, L.P.")).toBe(true);
    expect(isPlaceholderBuyer("AC Residential Acquisition LP")).toBe(true);
  });
  it("real companies aren't", () => {
    expect(isPlaceholderBuyer("Borrowers Bank")).toBe(false);
    expect(isPlaceholderBuyer("Data Aggregation Services")).toBe(false);
    expect(isPlaceholderBuyer("Acquisition Finance Partners")).toBe(false);
    expect(isPlaceholderBuyer("Sumitomo Corporation")).toBe(false);
  });
});

describe("a list of defined terms", () => {
  it("TMRC: the target is the full name the list defines", () => {
    const p = item(`On March 4, 2026, Texas Mineral Resources Corp. ("TMRC", the "Company", "we", "us" or "our") entered into an Agreement and Plan of Merger (the "Merger Agreement") with USA Rare Earth, Inc. ("USAR"), Hamer Merger Sub, Inc., a wholly owned subsidiary of USAR ("Merger Sub 1"). Pursuant to the Merger Agreement, Merger Sub 1 will merge with and into TMRC, with TMRC surviving as a wholly owned subsidiary of USAR.`, "TEXAS MINERAL RESOURCES CORP.");
    expect(p?.target.name).toBe("Texas Mineral Resources Corp.");
    expect(p?.acquirer.name).toBe("USA Rare Earth, Inc.");
  });
  it("Tempus: a warrant's \"tender or exchange offer\" boilerplate is no offer for the filer", () => {
    expect(
      item(`Securities Purchase Agreement On August 14, 2015, Tempus Applied Solutions Holdings, Inc. (the "Company", "Tempus Holdings", "we" or "us") entered into a Securities Purchase Agreement with Chart Acquisition Group LLC ("CAG"), under which the Investors acquired from the Company, for an aggregate purchase price of $1 million, 250,000 shares and warrants. The warrants adjust upon a merger, a purchase, tender or exchange offer, or a scheme of arrangement.`, "Tempus Applied Solutions Holdings, Inc."),
    ).toBeNull();
  });
  it("Dana: a Reverse Morris Trust is a spun-off business combining with the filer, not Eaton buying Dana", () => {
    expect(
      item(`On June 10, 2026, Dana Incorporated, a Delaware corporation ("Dana"), entered into definitive agreements with Eaton Corporation plc, an Irish public limited company ("Eaton"), Mobility (USA) Corporation, a Delaware corporation and a wholly owned subsidiary of Eaton ("SpinCo"), and Atlas Mobility Sub, Inc., a Delaware corporation and a wholly owned subsidiary of SpinCo ("Merger Sub"), with respect to a Reverse Morris Trust transaction. Pursuant to the Agreement and Plan of Merger (the "Merger Agreement"), Merger Sub will merge with and into Dana, with Dana surviving as a wholly owned subsidiary of SpinCo.`, "DANA INC"),
    ).toBeNull();
  });
  it("an offer the 8-K makes still reads", () => {
    const p = item(`On May 1, 2024, Acme Therapeutics, Inc. (the "Company") entered into an Agreement and Plan of Merger (the "Merger Agreement") with Big Pharma Inc. ("Parent") and Bolt Sub, Inc. ("Merger Sub"). Merger Sub will commence a cash tender offer (the "Offer") for all of the outstanding shares of the Company's common stock at $12.00 per share.`, "Acme Therapeutics, Inc.");
    expect(p?.target.name).toBe("Acme Therapeutics, Inc.");
  });
});

describe("who is behind the Parent", () => {
  const t = "Target Co";
  it("South Jersey: the fund, without its description", () => {
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of the Infrastructure Investments Fund, a private investment vehicle focused on investing in critical infrastructure assets ("IIF"). On the terms`, "South Jersey Industries, Inc.")).toBe("Infrastructure Investments Fund");
  });
  it("Quotient: the firm", () => {
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of Charlesbank Capital Partners LLC ("Charlesbank"). Quotient's Board of Directors`, "Quotient Technology Inc.")).toBe("Charlesbank Capital Partners");
  });
  it("Convey: one step along the chain", () => {
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of TPG Cannes Aggregation, L.P., an affiliate of TPG Global, LLC and the holder of a majority of the outstanding capital stock of the Company (the "TPG Stockholder"). A special committee`, "Convey Health")).toBe("TPG");
  });
  it("Agiliti: an initial is no sentence end", () => {
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of THL Agiliti LLC, an affiliate of Thomas H. Lee Partners, L.P. ("THL") and the holder of a majority of the outstanding capital stock`, "Agiliti, Inc.")).toBe("Thomas H. Lee Partners");
  });
  it("Thoughtworks: the holder's words between the links", () => {
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of Turing EquityCo II L.P. (the "Significant Company Stockholder"), the holder of a majority of the issued and outstanding shares of common stock, par value $0.001, of the Company ("Company Common Stock") and an affiliate of certain investment funds advised by Apax Partners LLP. A special committee`, "Thoughtworks Holding, Inc.")).toBe("Apax Partners LLP");
  });
  it("ZeroFox and UserTesting: a fund's manager", () => {
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of Haveli Investments Software Fund I, L.P., a private equity fund managed by Haveli Investments L.P. (together with its affiliated funds, the "Haveli Funds"). Subject`, t)).toBe("Haveli Investments");
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of Thoma Bravo Discover Fund III, L.P., a Delaware limited partnership, and Thoma Bravo Discover Fund IV, L.P., a Delaware limited partnership (the "Thoma Bravo Funds"), and are managed by Thoma Bravo, L.P. ("Thoma Bravo"). The`, t)).toBe("Thoma Bravo");
  });
  it("a numbered fund is its firm", () => {
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of Carlyle Partners V, L.P. ("Carlyle"). The Merger`, t)).toBe("Carlyle Partners");
  });
  it("NGM: a firm named \"The … Group\" keeps its whole name", () => {
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of The Column Group, LP (together with certain of its affiliates, "TCG"), which is the Company's largest stockholder`, "NGM Biopharmaceuticals, Inc.")).toBe("The Column Group");
    // A sponsor known by its one word stays that word.
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of The Blackstone Group Inc. ("Blackstone"). The Merger`, "Target Co")).toBe("Blackstone");
  });
  it("StoneMor: the going-private sense of affiliate is no owner, and a later sentence still counts", () => {
    const boiler = `Under the SEC rules governing "going-private" transactions, the holders of Axar Shares and Parent and Merger Sub are affiliates of the Company and, therefore, are required to express their purposes and reasons for the merger.`;
    expect(buyerBehindParent(boiler, "StoneMor Inc.")).toBeNull();
    expect(buyerBehindParent(`${boiler} Parent and Merger Sub are affiliates of Charlesbank Capital Partners LLC ("Charlesbank").`, "StoneMor Inc.")).toBe("Charlesbank Capital Partners");
  });
  it("Nordstrom: the family and the company, from the proxy and from the 8-K", () => {
    const proxy = `Parent and Acquisition Sub are affiliated with certain members of the Nordstrom family and related trusts and family -controlled investment vehicles (the " Family Group ") and El Puerto de Liverpool S.A.B. de C.V., a Mexican publicly traded corporation`;
    const eightK = `the shares to be contributed to Parent by El Puerto de Liverpool S.A.B. de C.V. (" Liverpool ") and certain members of the Nordstrom family and related trusts and investment vehicles (the " Family Group ") pursuant to the Rollover and Support Agreements`;
    expect(buyerBehindParent(proxy, "Nordstrom Inc")).toBe("El Puerto de Liverpool and the Nordstrom family");
    expect(buyerBehindParent(eightK, "Nordstrom Inc")).toBe("El Puerto de Liverpool and the Nordstrom family");
    expect(sponsorFromText(proxy, "Nordstrom Inc", "Norse Holdings, Inc.")).toBe("El Puerto de Liverpool and the Nordstrom family");
  });
  it("Quipt: its 8-K's buyer, with no Parent and an Arrangement defined", () => {
    const p = item(
      `On December 14, 2025, Quipt Home Medical Corp., a British Columbia corporation ("Quipt" or the "Company"), entered into an Arrangement Agreement (the "Arrangement Agreement") to be acquired by 1567208 B.C. LTD, a company existing under the laws of British Columbia ("B.C. Purchaser"), and REM Aggregator, LLC, a Delaware limited liability company (individually, "REM Aggregator", and collectively with B.C. Purchaser ("Purchaser" or "Purchasers"). Purchaser are entities affiliated with Kingswood Capital Management, LP (together with its affiliates, "Kingswood"). Under the terms of the Arrangement Agreement, Purchaser will acquire all of the issued and outstanding common shares of the Company (the "Shares") pursuant to a Plan of Arrangement (the "Arrangement") for US$3.65 per Share.`,
      "Quipt Home Medical Corp.",
    );
    expect(p?.acquirer.name).toBe("Kingswood Capital");
    expect(p?.target.name).toBe("Quipt Home Medical Corp.");
  });
  it("a defined term, a holder's bank or the target itself is no answer", () => {
    expect(buyerBehindParent(`Parent is an affiliate of the Company. The Merger`, "Target Co")).toBeNull();
    expect(buyerBehindParent(`Parent and Merger Sub are affiliates of Target Co (the "Holder"). The Merger`, "Target Co")).toBeNull();
    expect(buyerBehindParent(`Parent has obtained debt financing commitments from Goldman Sachs Bank USA.`, "Target Co")).toBeNull();
  });
  it("a sentence that only repeats the buyer's own name leaves it (Tekelec, an operating Parent)", () => {
    const p = item(
      `On May 1, 2020, Tekelec (the "Company") entered into an Agreement and Plan of Merger with Siris Capital Group, LLC ("Parent") and Sub Inc. ("Merger Sub"). Merger Sub will merge with and into the Company. Parent is an affiliate of Siris Capital Group, LLC ("Siris").`,
      "Tekelec",
    );
    expect(p?.acquirer.name).toBe("Siris Capital Group, LLC");
  });
  it("Guess: a defined term is expanded to the name it stands for", () => {
    const text = `On August 20, 2025, Guess?, Inc., a Delaware corporation (the " Company "), entered into an Agreement and Plan of Merger (the " Merger Agreement ") with Authentic Brands Group LLC, a Delaware limited liability company (" Authentic "), Glow Holdco 1, Inc., a Delaware corporation and, as of the date of the Merger Agreement and until the Parent Equity Transfer (as defined below) is consummated, a wholly-owned subsidiary of Authentic (" Parent "), and Glow Merger Sub 1, Inc., a Delaware corporation and a wholly-owned subsidiary of Parent (" Merger Sub ").`;
    expect(sponsorFromText(text, "Guess Inc", "Glow Holdco 1, Inc.")).toBe("Authentic Brands Group LLC");
  });
  it("Air Lease: the owners, with a description between each name and its term", () => {
    const list = `Sumitomo Corporation, a Japanese corporation ("Sumitomo"), SMBC Aviation Capital Limited, a company incorporated with limited liability in Ireland ("SMBC AC" and, together with Sumitomo, the "Guarantors"), Apollo Capital Management, L.P. ("Apollo") and Brookfield Asset Management Ltd. ("Brookfield" and, together with Apollo, the "Investors"). The Merger`;
    expect(jointBuyers(list)).toBe("Sumitomo, SMBC Aviation Capital, Apollo Capital and Brookfield Asset Management");
  });
  it("TPC Group: the list ends at the verb, its \"and\" too", () => {
    expect(jointBuyers(`First Reserve Corporation ("First Reserve") and SK Capital Partners ("SK Capital") and were formed by First Reserve and SK Capital in order to acquire the Company.`)).toBe("First Reserve and SK Capital Partners");
  });
});

describe("values", () => {
  it("Poseida: the ceiling restated is the ceiling, in its own release", () => {
    const own = `Poseida stockholders to receive up to $13.00 per share in cash, comprised of $9.00 per share in cash at closing and a non-tradeable contingent value right (CVR) to receive up to an aggregate of $4.00 per share in cash; transaction represents total equity value of up to $1.5 billion. This corresponds to a total equity value of approximately $1.5 billion on a fully diluted basis.`;
    expect(extractValue(own)).toBeNull();
  });
  it("Roche's says what's paid at closing", () => {
    const roche = `representing a total equity value of approximately US $1.0 billion at closing and representing a total deal value of up to US $1.5 billion.`;
    expect(extractValue(roche)).toEqual({ usd: 1e9, kind: "equity" });
  });
  it("Bristol Myers / Mirati: a different total after a ceiling still counts", () => {
    const text = `CVRs valued at up to $1 billion. Bristol Myers Squibb has agreed to acquire Mirati for $58.00 per share in cash, for a total equity value of $4.8 billion.`;
    expect(extractValue(text)).toEqual({ usd: 4.8e9, kind: "equity" });
  });
  it("At Home's closing release: \"that valued the company at\", and a transaction in which H&F acquired it isn't a firm's record", () => {
    const text = `Funds affiliated with Hellman & Friedman ("H&F") and At Home Group Inc. today announced that they have completed a transaction in which H&F has acquired At Home in an all-cash transaction that valued the company at $2.8 billion, including the assumption of debt.`;
    expect(extractValue(text)).toEqual({ usd: 2.8e9, kind: "enterprise" });
  });
  it("Catalyst: the same amount labelled equity value further on", () => {
    const text = `• a total consideration of approximately $4.1 billion. Angelini will acquire Catalyst for $31.50 per share in cash, for a total equity value of approximately $4.1 billion.`;
    expect(extractValue(text)).toEqual({ usd: 4.1e9, kind: "equity" });
  });
  it("a different equity value doesn't relabel the amount (AES)", () => {
    const text = `a transaction valued at approximately $33.4 billion, with an equity value of approximately $10.7 billion.`;
    expect(extractValue(text)?.kind).not.toBe("equity");
    expect(extractValue(text)?.usd).toBe(33.4e9);
  });
  it("nor does \"all-equity\" (Sitio)", () => {
    expect(extractValue("an all-equity transaction valued at approximately $4.1 billion, and an all-equity value of $4.1 billion")?.kind).not.toBe("equity");
  });
});

describe("a proxy's premium beside an amended price", () => {
  it("Anaplan, Squarespace, Janus: a proxy filed before the amendment states the older price's", () => {
    expect(proxyStatesCurrentPrice({ termsAmended: true, termsAmendedOn: "2022-06-06" }, "2022-04-22")).toBe(false);
    expect(proxyStatesCurrentPrice({ termsAmended: true, termsAmendedOn: "2024-09-09" }, "2024-08-20")).toBe(false);
  });
  it("Circor, Hill, Battalion: a proxy filed on or after it is right", () => {
    expect(proxyStatesCurrentPrice({ termsAmended: true, termsAmendedOn: "2023-06-23" }, "2023-07-20")).toBe(true);
    expect(proxyStatesCurrentPrice({ termsAmended: true, termsAmendedOn: "2022-09-01" }, "2022-09-01")).toBe(true);
  });
  it("no amendment, no question", () => {
    expect(proxyStatesCurrentPrice({}, "2022-04-22")).toBe(true);
  });
  it("the raise records its filing date, and its own release's premium stays (At Home, 21%)", () => {
    const hit = (fileDate: string, adsh: string): FtsHit => ({ id: `${adsh}:doc.htm`, adsh, file: "doc.htm", form: "8-K", rootForm: "8-K", fileType: "8-K", fileDate, ciks: ["1646228"], displayNames: ["At Home Group Inc. (HOME) (CIK 0001646228)"], sics: [], items: [] });
    const doc = (over: Partial<ParsedPress>): ParsedPress => ({ kind: "announcement", headline: "", acquirer: { name: "Hellman & Friedman", ticker: null, exchange: null }, target: { name: "At Home Group Inc.", ticker: null, exchange: null }, pricePerShare: null, premiumPct: null, valueUsd: null, valueKind: null, consideration: "Cash", acquirerAdvisors: [], targetAdvisors: [], privateTarget: false, ...over }) as ParsedPress;
    const state: State = { deals: [], ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] };
    const target = { cik: "1646228", ticker: "HOME", listedInUs: true };
    const buyer = { cik: null, ticker: null, listedInUs: false };
    applyParsed(state, doc({ pricePerShare: 36, premiumPct: 17, valueUsd: 2.8e9, valueKind: "transaction" }), hit("2021-05-06", "a"), target, buyer, false);
    applyParsed(state, doc({ kind: "update", pricePerShare: 37, premiumPct: 21, amended: true }), hit("2021-06-16", "b"), target, buyer, false);
    expect(state.deals[0]).toMatchObject({ pricePerShare: 37, premiumPct: 21, termsAmended: true, termsAmendedOn: "2021-06-16" });
  });
});

describe("from the last review", () => {
  it("an 8-K's cover date isn't a release's (Overland Storage: the signing)", () => {
    expect(ownReleaseDay("UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 8-K CURRENT REPORT Date of Report (Date of earliest event reported): May 15, 2014 (May 15, 2014) Item 1.01 Entry into a Material Definitive Agreement.", "2014-05-19")).toBeUndefined();
    expect(ownReleaseDay("UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 8-K Date of Report: November 6, 2023 Item 7.01 Regulation FD Disclosure. On October 31, 2023, the Company issued a press release to announce its plans to acquire Ipackchem.", "2023-11-06")).toBe("2023-10-31");
  });

  it("a carve-out with a footnote digit or a long unit name (UL Solutions / Eurofins, VIAVI / Spirent)", () => {
    expect(parsePressRelease("UL Solutions to Acquire Eurofins Scientific's Electrical & Electronics Business 1\nNORTHBROOK, Ill., Jan. 5, 2026 - UL Solutions Inc. (NYSE: ULS) today announced a definitive agreement to acquire the Electrical & Electronics business of Eurofins Scientific SE for $670 million.", { filerName: "UL Solutions Inc.", filerTickers: ["ULS"] })).toBeNull();
    expect(parsePressRelease("VIAVI to Acquire Spirent Communications plc's High-Speed Ethernet and Network Security Testing Business\nCHANDLER, Ariz., March 28, 2024 - VIAVI Solutions Inc. (NASDAQ: VIAV) today announced an agreement to acquire the business for $410 million.", { filerName: "VIAVI Solutions Inc.", filerTickers: ["VIAV"] })).toBeNull();
    // The buyer's segment after a whole-company target is no carve-out (the review's cases), nor is a REIT's unit.
    expect(parsePressRelease("Stryker To Acquire Wright Medical; Wright Medical To Join Stryker's Trauma And Extremities Business\nKALAMAZOO, Mich., Nov. 4, 2019 - Stryker Corporation (NYSE: SYK) and Wright Medical Group N.V. (NASDAQ: WMGI) today announced a definitive agreement under which Stryker will acquire all of the issued and outstanding ordinary shares of Wright Medical for $30.75 per share in cash, for a total equity value of approximately $4.0 billion.", { filerName: "Stryker Corporation", filerTickers: ["SYK"] })?.target.name).toMatch(/^Wright Medical/);
    for (const h of ["Hubbell To Acquire Target To Expand Hubbell's Utility Solutions Segment", "Hubbell to Acquire Target; Target Will Join Hubbell's Water Solutions Segment", "Hubbell Agrees To Acquire Target To Strengthen Hubbell's Electrical Solutions Business"])
      expect(parsePressRelease(`${h}\nSHELTON, Conn., May 1, 2024 - Hubbell Incorporated (NYSE: HUBB) and Target Holdings, Inc. (NASDAQ: TGTH) today announced a definitive merger agreement under which Hubbell will acquire Target for $12.00 per share in cash, or approximately $600 million.`, { filerName: "Hubbell Incorporated", filerTickers: ["HUBB"] })?.target.name, h).toMatch(/^Target/);
    // A unit sold by a listed company, named by the headline's short form.
    expect(parsePressRelease("Intercontinental Exchange and Black Knight Announce Agreement to Sell Black Knight's Optimal Blue Business to Constellation\nATLANTA, March 7, 2023 - Intercontinental Exchange, Inc. (NYSE: ICE) and Black Knight, Inc. (NYSE: BKI) today announced a definitive agreement to sell Black Knight's Optimal Blue business to Constellation Software Inc. for $700 million.", { filerName: "Black Knight, Inc.", filerTickers: ["BKI"] })).toBeNull();
    expect(isCarveOut("Apple REIT Six Signs a Definitive Merger Agreement", "Apple REIT Six, Inc. today announced it has entered into a definitive merger agreement to be acquired by BRE Select Hotels Corp. Each issued and outstanding Unit (Common Share and related Series A Preferred Share) of Apple REIT Six, Inc. will be converted into the right to receive $11.10.", "Apple REIT Six, Inc.")).toBe(false);
    // UL Solutions' own release: the body names the business with parentheses before "of Eurofins Scientific SE".
    expect(parsePressRelease(`UL Solutions Inc. Broadens Portfolio with Agreement to Acquire Eurofins Scientific's Electrical & Electronics Business 1\nNORTHBROOK, Ill. - (BUSINESS WIRE) - April 13, 2026 - UL Solutions Inc. (NYSE: ULS), a global leader in applied safety science, today announced it has entered into a definitive agreement to acquire the electrical and electronics (E&E) business (inclusive of the MET Labs certification mark) of Eurofins Scientific SE ("Eurofins"). Purchase price represents an enterprise value of approximately $670 million.`, { filerName: "UL Solutions Inc.", filerTickers: ["ULS"] })).toBeNull();
    // Its closing release: a list, and the hyphen spaced out by the HTML.
    expect(parsePressRelease("VIAVI Closes Acquisition of Spirent Communications plc's High - Speed Ethernet, Network Security and Channel Emulation Testing Business\nChandler, Ariz., October 16, 2025 - VIAVI Solutions Inc. (NASDAQ: VIAV) today announced that it has completed the acquisition of the business from Keysight Technologies, Inc.", { filerName: "VIAVI Solutions Inc.", filerTickers: ["VIAV"] })).toBeNull();
  });
});
