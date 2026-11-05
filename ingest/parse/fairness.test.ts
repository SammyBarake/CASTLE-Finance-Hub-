import { describe, expect, it } from "vitest";
import { findBanks } from "../../lib/banks";
import { bankFee, methodFor, parseFairness } from "./fairness";

// Synthetic proxy excerpts in the style of real DEFM14A / 14D-9 filings.
const PROXY = `
Background of the Merger
On March 3, 2026, Party A submitted a proposal that indicated a price between $40.00 and $44.00 per share.
The Merger Agreement requires the Company to pay Parent a termination fee of $85 million in certain circumstances.

Opinion of Goldman Sachs & Co. LLC (page 50)

Opinion of Goldman Sachs & Co. LLC
Goldman Sachs delivered its opinion to the Board that the $52.00 in cash per Share was fair. The following is a summary of the material financial analyses.
Summary of Financial Analyses
Illustrative Discounted Cash Flow Analysis. Using the Forecasts, Goldman Sachs applied discount rates ranging from 9.5% to 11.0% and perpetuity growth rates ranging from 2.0% to 3.0% to derive a range of illustrative equity values per Share of $44.10 to $58.35.
Selected Companies Analysis
Goldman Sachs reviewed multiples of selected public companies.
Company A 12.1x
Company B 10.4x
Based on this review, Goldman Sachs applied EV/EBITDA multiples which resulted in a range of implied equity values per Share of $38.00 to $49.50.
Premiums Paid Analysis. Goldman Sachs applied a premium range of 25% to 45% to the unaffected price, which resulted in a range of implied values per Share of $45.00 to $52.20.
Analyst Price Targets. Goldman Sachs reviewed price targets which indicated low and high price targets ranging from $36.00 to $55.00 per share.
Exchange ratio table: resulted in implied values per Share of $51.10 to $51.40.
General
The Company has agreed to pay Goldman Sachs a transaction fee of approximately $42 million, $5 million of which became payable upon delivery of its opinion.

Opinion of Evercore Group L.L.C., Parent's Financial Advisor
Summary of Financial Analyses
Discounted Cash Flow Analysis. Evercore calculated a range of implied equity values per share of Parent common stock of $120.00 to $150.00.
Certain Unaudited Prospective Financial Information
The projections resulted in values per share of $1.00 to $2.00.
`;

describe("parseFairness", () => {
  const ops = parseFairness(PROXY, { acquirerName: "Buyer Holdings, Inc.", offerPrice: 52 });
  const gs = ops.find((o) => o.bank === "Goldman Sachs")!;

  it("reads each analysis range with its method", () => {
    expect(gs.side).toBe("target");
    expect(gs.ranges).toEqual([
      { method: "Discounted cash flow", low: 44.1, high: 58.35 },
      { method: "Trading comparables", low: 38, high: 49.5 },
      { method: "Premiums paid", low: 45, high: 52.2 },
      { method: "Analyst price targets", low: 36, high: 55 },
    ]);
  });

  it("reads DCF assumptions and the bank's fee, not the termination fee", () => {
    expect(gs.discountRatePct).toEqual([9.5, 11]);
    expect(gs.perpetuityGrowthPct).toEqual([2, 3]);
    expect(gs.feeUsd).toBe(42e6);
  });

  it("ignores bids in the background section and cross-reference headings", () => {
    expect(ops.flatMap((o) => o.ranges).some((r) => r.low === 40)).toBe(false);
  });

  it("marks the buyer's advisor and stops at the next major heading", () => {
    const ev = ops.find((o) => o.bank === "Evercore")!;
    expect(ev.side).toBe("acquirer");
    expect(ev.ranges).toEqual([{ method: "Discounted cash flow", low: 120, high: 150 }]);
  });

  it("finds nothing in a document without fairness opinions", () => {
    expect(parseFairness("The Company entered into a credit agreement. Values of $1.00 to $2.00 per share.", { acquirerName: "X", offerPrice: null })).toEqual([]);
  });
});

describe("bankFee", () => {
  it("reads the adviser's fee but not the target's fee income", () => {
    expect(bankFee("Pursuant to its engagement letter, the Company has agreed to pay Barclays a fee of approximately $28 million, of which $3 million became payable on delivery.")).toBe(28e6);
    expect(bankFee("For services rendered in connection with the merger, the Company has agreed to pay J.P. Morgan an estimated fee of approximately $30 million.")).toBe(30e6);
    expect(bankFee("Barclays applied the multiples to fee-related earnings (excluding $5.6 million of one-time catch-up fees) for its fiscal year 2026 of $132 million.")).toBeNull();
    expect(bankFee("The Company must pay Parent a termination fee of $85 million.")).toBeNull();
    expect(bankFee("Management fees for the year of $40 million were received from the funds.")).toBeNull();
  });
});

describe("bankFee: the fee for this deal", () => {
  it("reads Goldman's estimated wording, Guggenheim's and full dollars", () => {
    expect(bankFee("The engagement letter between FLIR and Goldman Sachs provides for a transaction fee that is estimated, based on the information available as of the date of the announcement of the transaction, at approximately $40 million, $5 million of which became payable at announcement of the transaction.", "Goldman Sachs")).toBe(40e6);
    expect(bankFee("Diamond Offshore has agreed to pay Guggenheim Securities a cash transaction fee (based on a percentage of the aggregate value associated with the mergers) upon consummation of the mergers, which cash transaction fee currently is estimated to be $11 million.", "Guggenheim")).toBe(11e6);
    expect(bankFee("the Company has agreed to pay Deutsche Bank a fee estimated to be approximately $29,000,000 for its services as financial advisor to the Company in connection with the Merger, of which $2,000,000 became payable upon delivery of its opinion", "Deutsche Bank")).toBe(29e6);
    expect(bankFee("Hawaiian paid Barclays a fee of $3 million upon the delivery of Barclays' opinion (which is referred to as the \"Opinion Fee\"). The Opinion Fee was not contingent. Additional compensation of approximately $25 million will be payable on completion of merger against which the amounts paid for the opinion will be credited.", "Barclays")).toBe(25e6);
  });

  it("takes the total, not the part paid for the opinion or on a milestone (QTS, Nuance, Signify, Continental, Essential Utilities)", () => {
    expect(bankFee("we have agreed to pay Morgan Stanley a fee of $1.5 million, which was payable upon delivery of Morgan Stanley's opinion to our board of directors, and an aggregate fee equal to $25 million (against which the opinion fee will be credited), payable upon the closing of the mergers.", "Morgan Stanley")).toBe(25e6);
    expect(bankFee("The Company has agreed to pay Jefferies a fee of $1.5 million, which was payable upon delivery of Jefferies' opinion to our board of directors, and an aggregate fee (to which the foregoing fee will be credited) equal to $25 million, payable upon the closing of the mergers.", "Jefferies")).toBe(25e6);
    expect(bankFee("Nuance has agreed to pay Evercore a fee for its services that is estimated as of the date of the Merger Agreement to be approximately $70 million, of which $7 million was paid upon delivery of Evercore's opinion, and the balance of which will be payable", "Evercore")).toBe(70e6);
    expect(bankFee("Signify has agreed to pay to Deutsche Bank the following fees:\n\n• an opinion fee of $2,500,000, which became payable upon Deutsche Bank's delivery of its written opinion, dated as of September 2, 2022, to Signify;\n\n• a transaction fee contingent on the consummation of the Merger of approximately $24 million, equal to 0.3% of the value of the aggregate consideration", "Deutsche Bank")).toBe(24e6);
    expect(bankFee("the Company has agreed to pay Evercore a fee of $2,500,000 upon rendering its opinion (regardless of the conclusion reached in its opinion), fully creditable against any success fee. Evercore also became entitled to receive an initial fee of $1,000,000 upon execution of the engagement letter. Evercore would be entitled to a success fee equal to $7,170,000 (against which the $2,500,000 opinion fee and the $1,000,000 initial fee would be credited).", "Evercore")).toBe(7_170_000);
    expect(bankFee("Essential agreed to pay Moelis certain fees for its services, including (i) an opinion fee of $4 million, payable upon delivery of its opinion (regardless of the conclusion reached in that opinion), (ii) an announcement fee of $8 million, payable upon the public announcement of the merger, (iii) a shareholder approval fee of $13 million, payable upon shareholder approval by Essential's shareholders of the merger and (iv) a transaction fee of $60 million, payable upon consummation of the merger.", "Moelis")).toBe(60e6);
    expect(bankFee("Avid agreed to pay Moelis certain fees, comprised of (i) a retainer fee of $500,000, (ii) an opinion fee of $3,000,000, which became payable upon Moelis' having substantially completed its work in connection with the delivery of its opinion, and (iii) a transaction fee, which shall become payable upon consummation of the Merger. The transaction fee is calculated by reference to the fully diluted enterprise value of Avid implied by the Merger and is currently estimated to be approximately $25,800,000.", "Moelis")).toBe(25_800_000);
  });

  it("falls back to an opinion fee when the section states no other (Spirit AeroSystems)", () => {
    expect(bankFee("Moelis was engaged by Spirit to render its opinion and earned a fee of $5.0 million upon delivery of its opinion, which fee was not contingent upon either the conclusion expressed in", "Moelis")).toBe(5e6);
    expect(bankFee("Guggenheim Securities received an opinion fee of $2.0 million upon rendering its opinion.", "Guggenheim")).toBe(2e6);
  });

  it("keeps a total with its parts after it (must not break)", () => {
    expect(bankFee("Union Pacific agreed to pay Morgan Stanley a fee of approximately $52.5 million, $7.5 million of which became payable upon announcement.", "Morgan Stanley")).toBe(52.5e6);
    expect(bankFee("Urstadt has agreed to pay Eastdil Secured for its financial advisory services in connection with the mergers an aggregate fee currently estimated to be approximately $7 million, a portion of which was payable upon delivery of its opinion and approximately $6.25 million of which is contingent", "Eastdil Secured")).toBe(7e6);
    expect(bankFee("In connection with Lazard's services, WestRock agreed to pay Lazard a fee for such services of $70 million, $5 million of which was payable upon Lazard rendering its opinion.", "Lazard")).toBe(70e6);
  });

  it("not past work or a fee from another party (Citrix, Zendesk, Udemy, KCS, Callon, New Relic)", () => {
    expect(bankFee("no material relationship existed between Qatalyst Partners or any of its affiliates and Citrix, Elliott, Vista, Parent or TIBCO pursuant to which compensation was received by Qatalyst Partners or its affiliates, other than a fee of approximately $5 million received by an affiliate of Qatalyst Partners in connection with acting as financial advisor to Delta Topco, Inc.", "Qatalyst")).toBeNull();
    expect(bankFee("Qatalyst Partners has provided financial advisory services to Permira and received a fee of $15 million in connection with such services.", "Qatalyst")).toBeNull();
    expect(bankFee("Qatalyst Partners has provided financial advisory services to Recorded Future, a then-majority-owned portfolio company of Insight Partners, for which Qatalyst Partners received an aggregate fee of approximately $42 million,", "Qatalyst")).toBeNull();
    expect(bankFee("In the two years prior to the date of its opinion, Morgan Stanley or its affiliates have provided financial advisory and financing services to KCS and its affiliates and have received aggregate fees of approximately $5 million to $15 million in connection with such services", "Morgan Stanley")).toBeNull();
    expect(bankFee("In the two years prior to the date of Morgan Stanley's opinion, Morgan Stanley and its affiliates provided financing services for APA and received fees of approximately $2.5 million and $5.0 million for such services.", "Morgan Stanley")).toBeNull();
    // What it may earn later isn't this deal's either (Infinera's $36.6 million is the fee).
    expect(bankFee("Centerview has received between $5 million and $10 million in compensation for such services, and in the future expects to receive additional compensation of up to $10 million for such services. In connection with Centerview's services as the financial adviser to the Infinera Board, Infinera has agreed to pay Centerview an aggregate fee estimated (as of July 31, 2024) at approximately $36.6 million, $5 million of which was payable upon the rendering of Centerview's opinion", "Centerview")).toBe(36.6e6);
  });

  it("not another firm's fee in the section (Guggenheim on IAA, Canaccord on Leaf Group, Houlihan Lokey on Adams)", () => {
    expect(bankFee("Pursuant to RBA's engagement letter with Evercore, RBA has agreed to (i) pay Evercore a fee of $2.5 million (subject to an additional discretionary amount in RBA's sole discretion), which fee is contingent", "Guggenheim")).toBeNull();
    expect(bankFee("As compensation for its services in connection with a proposed transaction, the Company has agreed to pay Moorgate a cash fee equal to $5,579,070 contingent upon the consummation of the merger.", "Canaccord Genuity")).toBeNull();
    expect(bankFee("at the effective time of the Merger and conditional thereon, GulfStar will be entitled to a success fee of one percent (1%) of the consideration to be paid by Parent in the Merger, or approximately $1.0 million.", "Houlihan Lokey")).toBeNull();
    // A short form of the bank's own name is the bank (Penumbra's Perella Weinberg, Patrick's J.P. Morgan, Manitex's BGL).
    expect(bankFee("Penumbra has agreed to pay Perella a fee of approximately $109.6 million, contingent upon closing.", "Perella Weinberg")).toBe(109.6e6);
    expect(bankFee("Patrick has agreed to pay J.P. Morgan a fee of $20 million, $5 million of which became payable", "JPMorgan")).toBe(20e6);
    expect(bankFee("the Company has agreed to pay BGL a fee of approximately $3.1 million, contingent upon closing.", "Brown Gibbons Lang")).toBe(3.1e6);
  });

  it("not a limit, a range or parts with no total (TopBuild, Safehold, VOXX), though a floor is a figure (IAA's Guggenheim)", () => {
    expect(bankFee("Based on the remaining undrawn amount of such proceeds, potential fees payable to Goldman Sachs would be less than $3.5 million. The engagement letter between TopBuild and Goldman Sachs provides for a transaction fee that is estimated, based on the information available as of the date of announcement, at approximately $70 million,", "Goldman Sachs")).toBe(70e6);
    expect(bankFee("STAR agreed to pay Lazard an aggregate fee of between $15 million and $20 million depending on the transaction value at the time of closing. Of the aggregate fee, up to an aggregate of $1.75 million is payable as quarterly retainer fees", "Lazard")).toBeNull();
    expect(bankFee("The engagement letter provides for a transaction fee that is estimated, based on the information available as of the date of announcement of the Merger Agreement, to consist of (i) $2.0 million, which was payable upon the delivery by Solomon Partners of its opinion; and (ii) approximately $2.4 million, which is contingent upon the closing of the Merger.", "Solomon Partners")).toBeNull();
    expect(bankFee("RBA has agreed to pay Guggenheim Securities a total cash fee of no less than $10 million, $2.0 million of which became payable upon the rendering of the original opinion", "Guggenheim")).toBe(10e6);
  });

  it("not break fees or expense caps, and not directors' pay when a section runs on (Datto, Pacific Mercantile)", () => {
    expect(bankFee("Datto will have the right to terminate the Merger Agreement and Parent will be obligated to pay Datto a fee of $371,330,950 as described under \"The Merger Agreement - Termination Fees and Expenses\"")).toBeNull();
    expect(bankFee("During 2020, the nine non-employee directors of BOC and BOC Bank received aggregate total compensation of $1,507,766.", "Stifel")).toBeNull();
    expect(bankFee("Solicitation: Sodali will be paid a solicitation fee of approximately $30,000 and will be reimbursed.")).toBeNull();
  });

  it("stores whole dollars (Air Lease's $66.6 million came out 66599999.99999999)", () => {
    expect(bankFee("The Company has agreed to pay J.P. Morgan a transaction fee of approximately $66.6 million.", "JPMorgan")).toBe(66_600_000);
  });
});

describe("whose adviser", () => {
  const section = (heading: string, bank: string, subject: string) => `${heading}\n${bank} performed financial analyses.\nDiscounted Cash Flow Analysis. ${bank} calculated a range of implied equity values per share of ${subject} common stock of $40.00 to $60.00.\n`;
  const sideOf = (doc: string, acquirerName: string, targetName: string) =>
    Object.fromEntries(parseFairness(doc, { acquirerName, targetName, offerPrice: 50, consideration: "Mixed" }).map((o) => [o.bank, o.side]));

  it("takes the nearest parent heading naming a party (Union Pacific / Norfolk Southern)", () => {
    const doc = `Opinions of Union Pacific's Financial Advisors\n${section("Opinion of Morgan Stanley", "Morgan Stanley", "Norfolk Southern")}${section("Opinion of Wells Fargo Securities", "Wells Fargo", "Norfolk Southern")}${section("Opinion of Norfolk Southern's Financial Advisor", "BofA Securities", "Norfolk Southern")}`;
    expect(sideOf(doc, "Union Pacific Corp", "Norfolk Southern Corp")).toEqual({ "Morgan Stanley": "acquirer", "Wells Fargo": "acquirer", "BofA Securities": "target" });
  });

  it("reads a bare apostrophe (Skyworks' advisers on Qorvo)", () => {
    const doc = `Opinions of Skyworks' Financial Advisors\n${section("Opinion of Goldman Sachs", "Goldman Sachs", "Qorvo")}${section("Opinion of Qorvo's Financial Advisor", "Centerview", "Qorvo")}`;
    expect(sideOf(doc, "Skyworks Solutions, Inc.", "Qorvo, Inc.")).toEqual({ "Goldman Sachs": "acquirer", Centerview: "target" });
  });

  it("reads 'Financial Advisor to the X Special Committee' for either side (EchoStar / DISH, Crescent / SilverBow)", () => {
    const doc = section("Opinion of J.P. Morgan Securities LLC, Financial Advisor to the DISH Network Special Committee", "J.P. Morgan", "DISH Network") + section("Opinion of Evercore Group L.L.C., Financial Advisor to the EchoStar Special Committee", "Evercore", "DISH Network");
    expect(sideOf(doc, "EchoStar CORP", "DISH Network CORP")).toEqual({ JPMorgan: "target", Evercore: "acquirer" });
    expect(sideOf(section("Opinion of Intrepid Partners, LLC, Crescent Special Committee's Financial Advisor", "Intrepid Partners", "SilverBow"), "Crescent Energy Co", "Silverbow Resources, Inc.")).toEqual({ "Intrepid Partners": "acquirer" });
  });

  it("knows two-word aliases and the proxy's defined term (Diamond S, K-C)", () => {
    const seaways = section("Opinion of Diamond S's Financial Advisor", "Moelis", "Diamond S") + section("Opinion of International Seaways' Financial Advisor", "Jefferies", "Diamond S");
    expect(sideOf(seaways, "International Seaways, Inc.", "Diamond S Shipping Inc.")).toEqual({ Moelis: "target", Jefferies: "acquirer" });
    const kc = `Kimberly-Clark Corporation ("K-C") and Kenvue Inc. ("Kenvue")\nOpinions of K-C's Financial Advisors\n${section("Opinion of J.P. Morgan", "J.P. Morgan", "Kenvue")}`;
    expect(sideOf(kc, "Kimberly Clark Corp", "Kenvue Inc.")).toEqual({ JPMorgan: "acquirer" });
  });

  it("a buyer whose name holds 'Company' keeps its adviser (not the generic 'the Company')", () => {
    const doc = section("Opinion of The Walt Disney Company's Financial Advisor", "Goldman Sachs", "Twenty-First Century Fox");
    expect(sideOf(doc, "The Walt Disney Company", "Twenty-First Century Fox, Inc.")).toEqual({ "Goldman Sachs": "acquirer" });
  });

  it("single-side proxies stay the target's (must not break: KCS, Anaplan, the Company's adviser)", () => {
    const kcs = `Opinions of Kansas City Southern's Financial Advisors\n${section("Opinion of BofA Securities, Inc.", "BofA Securities", "KCS")}`;
    expect(sideOf(kcs, "Canadian Pacific Railway Ltd", "Kansas City Southern")).toEqual({ "BofA Securities": "target" });
    expect(sideOf(section("Opinion of Qatalyst Partners", "Qatalyst Partners", "Anaplan"), "Thoma Bravo", "Anaplan, Inc.")).toEqual({ Qatalyst: "target" });
    expect(sideOf(section("Opinion of the Company's Financial Advisor", "Goldman Sachs", "Anaplan"), "Thoma Bravo", "Anaplan, Inc.")).toEqual({ "Goldman Sachs": "target" });
  });
});

describe("whose shares a range values", () => {
  const ranges = (body: string, acquirerName: string, targetName: string, consideration = "Stock") =>
    parseFairness(`Opinion of Goldman Sachs & Co. LLC\nSummary of Financial Analyses\n${body}\n`, { acquirerName, targetName, offerPrice: null, consideration })[0]?.ranges.map((r) => `${r.low}-${r.high}`) ?? [];

  it("skips the buyer's after the range, before it, and the combined company's (IHS Markit, AvalonBay, Dominion)", () => {
    expect(ranges("Goldman Sachs applied a range which resulted in implied values of $368 to $431 per share of S&P Global common stock.", "S&P Global Inc.", "IHS Markit Ltd.")).toEqual([]);
    expect(ranges("Discounted Cash Flow Analysis\nThis analysis indicated an implied per share equity value reference range for Equity Residential of $70.57 to $92.64. This analysis indicated an implied per share equity value reference range for AvalonBay of $171.63 to $209.67.", "Equity Residential", "Avalonbay Communities Inc")).toEqual(["171.63-209.67"]);
    expect(ranges("Discounted Cash Flow Analysis\nGoldman Sachs derived a range of illustrative present values per share of Dominion Energy common stock of $68.64 to $87.66. Goldman Sachs derived a range of illustrative present values per share of NextEra Energy common stock of $91.25 to $139.50.", "Nextera Energy Inc", "Dominion Energy, Inc")).toEqual(["68.64-87.66"]);
    expect(ranges("This analysis resulted in a range of implied values per share for the combined company of $20.00 to $30.00.", "Buyer Inc.", "Target Inc.")).toEqual([]);
  });

  it("cuts the clause at 'and', so the target's figure stays (Arch)", () => {
    expect(ranges("This resulted in implied per share value ranges of $181 to $213 per share of Arch common stock and $129 to $155 per share of CONSOL common stock.", "CONSOL Energy Inc.", "Arch Resources, Inc.")).toEqual(["181-213"]);
  });

  it("reads KBW's dividend discount model of the buyer as the buyer's (Altabancorp / Glacier)", () => {
    expect(ranges("Dividend Discount Model\nThis dividend discount model analysis resulted in a range of implied values per share of Glacier common stock of $40.70 to $55.69.", "Glacier Bancorp, Inc.", "Altabancorp")).toEqual([]);
  });

  it("whose forecast is not whose shares (Valaris on Transocean's projections)", () => {
    expect(ranges("Selected Companies Analysis\nImplied per share equity value reference range for Valaris: EV / '26E EBITDA (Transocean Projections) $55.07 - $62.86", "Transocean Ltd.", "Valaris Limited")).toEqual(["55.07-62.86"]);
  });

  it("not on an all-cash deal, where the buyer's name is only the deal", () => {
    const text = "Goldman Sachs compared what Merck will pay with a range of illustrative equity values per share of $100.85 to $120.67.";
    expect(ranges(text, "Merck & Co., Inc.", "Cidara Therapeutics, Inc.", "Cash")).toEqual(["100.85-120.67"]);
    expect(ranges(text, "Merck & Co., Inc.", "Cidara Therapeutics, Inc.", "Stock")).toEqual([]);
  });

  it("keeps an opinion whose ranges were all dropped, so its fee survives (Skyworks' Goldman Sachs)", () => {
    const ops = parseFairness("Opinions of Skyworks' Financial Advisors\nOpinion of Goldman Sachs\nFinancial Analyses\nThis analysis resulted in a range of implied present values per share of Skyworks common stock of $89.16 to $123.97.\nSkyworks has agreed to pay Goldman Sachs a transaction fee of approximately $11 million, all of which is contingent upon consummation.\n", { acquirerName: "Skyworks Solutions, Inc.", targetName: "Qorvo, Inc.", offerPrice: null, consideration: "Mixed" });
    expect(ops).toEqual([expect.objectContaining({ bank: "Goldman Sachs", side: "acquirer", ranges: [], feeUsd: 11e6 })]);
  });

  it("a section whose only figures fail the older checks stays out, so nothing new appears", () => {
    const doc = "Opinion of Barclays Capital Inc.\nFinancial Analyses\nThe Board discussed a proposal that indicated a price per share of $40.00 to $44.00.\n";
    expect(parseFairness(doc, { acquirerName: "Buyer Inc.", targetName: "Target Inc.", offerPrice: null, consideration: "Stock" })).toEqual([]);
  });

  it("reads invisible direction marks out, so Aerojet's fee is found", () => {
    const mark = String.fromCharCode(0x202c);
    const ops = parseFairness(`Opinion of Citigroup Global Markets Inc.\nFinancial Analyses\nDiscounted Cash Flow Analysis. This analysis indicated an illustrative range of prices per share of Aerojet Rocketdyne Common Stock of $51.00 to $59.50.\nAerojet Rocketdyne has agreed to pay Citi for its services in connection with the Merger an aggregate fee of $35.8${mark} million, $2.5 million of which became payable upon delivery of Citi's opinion.\n`, { acquirerName: "Lockheed Martin Corp", targetName: "Aerojet Rocketdyne Holdings, Inc.", offerPrice: 56, consideration: "Cash" });
    expect(ops[0].feeUsd).toBe(35.8e6);
  });
});

describe("what is a range", () => {
  const ranges = (body: string, ctx = {}) => parseFairness(`Opinion of J.P. Morgan Securities LLC\nFinancial Analyses\n${body}\n`, { acquirerName: "Buyer Inc.", offerPrice: null, ...ctx })[0]?.ranges.map((r) => `${r.low}-${r.high}`) ?? [];

  it("'and' only after 'between', never with 'respectively' (Blue Apron, Diamond Offshore)", () => {
    expect(ranges("the discounted cash flow analysis indicated an implied equity value per share between $7.75 and $10.00, and between $9.75 and $12.25.")).toEqual(["7.75-10", "9.75-12.25"]);
    expect(ranges("the implied equity values per share based on the three cases were $6.46, $7.56 and $9.41, respectively.")).toEqual([]);
    expect(ranges("These reference ranges were compared to the closing share price and 30-day VWAP implied per share as of June 7, 2024 of $42.60 and $45.53 per share, respectively.")).toEqual([]);
    expect(ranges("implied values per share between the low and high cases of $1.00 and $2.60, respectively.")).toEqual([]);
  });

  it("an enterprise-value column in $ millions isn't per share (Emcore); two per-share columns stay (Dominion's BofA)", () => {
    expect(ranges("Implied Enterprise Value Reference Range* Implied Per Share Reference Range\nEV / Revenue $7.0 - $16.6 $0.90 - $1.85\n* Dollars in millions")).toEqual(["0.9-1.85"]);
    expect(ranges("Implied Per Share Equity Value Reference Ranges\nEV / EBITDA $65.25 - $88.25 $64.25 - $81.25")).toEqual(["65.25-88.25", "64.25-81.25"]);
  });

  it("four figures are an equity-value column, not a share (NexTier's Moelis, Essential Utilities)", () => {
    expect(ranges("Implied Equity Value ($ in millions) Implied Share Price ($ per share)\nNexTier $ 2,674 - $3,479 $ 15.23 - $19.70")).toEqual(["15.23-19.7"]);
  });
});

describe("the DCF's assumptions", () => {
  const opinion = (body: string) => parseFairness(`Opinion of BofA Securities, Inc.\nFinancial Analyses\n${body}\n`, { acquirerName: "Astrazeneca PLC", targetName: "Alexion Pharmaceuticals, Inc.", offerPrice: 175, consideration: "Mixed" })[0];
  const alexion = "Discounted Cash Flow Analysis. The cash flows were discounted to present value as of September 30, 2020, using a discount rate range of 7.0% to 9.5%, which was based on an estimate of Alexion's weighted average cost of capital, and resulted in a range of implied equity values per share of Alexion common stock of $164.00 to $199.00.";
  const astra = "Discounted Cash Flow Analysis. The cash flows were discounted using discount rates ranging from 6.0% to 7.5%, which were based on an estimate of AstraZeneca's weighted average cost of capital, and resulted in a range of implied equity values per share of AstraZeneca common stock of $110.00 to $130.00.";

  it("takes the target's rate, not the first in the section (Alexion, not AstraZeneca)", () => {
    expect(opinion(`${alexion}\n${astra}`).discountRatePct).toEqual([7, 9.5]);
    expect(opinion(`${astra}\n${alexion}`).discountRatePct).toEqual([7, 9.5]);
  });

  it("reads wider wording, and a rate stated below the range when none is above it", () => {
    expect(opinion("Discounted Cash Flow Analysis. This resulted in a range of implied equity values per share of $164.00 to $199.00. Citi applied discount rates of 10.25% to 17.25%.").discountRatePct).toEqual([10.25, 17.25]);
    expect(opinion("Discounted Cash Flow Analysis. Using a cost of equity range of 12.1% to 13.5%, this resulted in a range of implied equity values per share of $164.00 to $199.00.").discountRatePct).toEqual([12.1, 13.5]);
  });

  it("skips a segment's rate (Lazard's Corporate segment)", () => {
    expect(opinion("Sum of the Parts. For the Corporate segment Lazard applied discount rates ranging from 3.5% to 4.5%.\nDiscounted Cash Flow Analysis. Lazard applied discount rates ranging from 5.0% to 6.0%, which resulted in a range of implied equity values per share of $164.00 to $199.00.").discountRatePct).toEqual([5, 6]);
  });
});

describe("methodFor", () => {
  it("prefers the sentence, then the paragraph's run-in heading, then the heading above", () => {
    expect(methodFor("Discounted Cash Flow Analysis\nsome text", "indicated price targets ranging from")).toBe("Analyst price targets");
    expect(methodFor("Discounted Cash Flow Analysis\nPrecedent Premia Paid Analysis. Centerview applied a range which resulted in", "which resulted in")).toBe("Premiums paid");
    expect(methodFor("Selected Precedent Transactions Analysis\n47\n​The results were applied, which resulted in", "which resulted in")).toBe("Precedent transactions");
  });

  it("a cross-reference to the DCF isn't a DCF (Qatalyst on Splunk), and its real DCF keeps the label (Anaplan)", () => {
    const sentence = "Based on the fully diluted shares of Splunk common stock outstanding as of September 18, 2023 (calculated utilizing the same methodology as used in the above discounted cash flow analysis) as provided by management of the Company, this analysis implied a range of values";
    expect(methodFor(`Selected Transactions Analysis\n${sentence}`, sentence)).toBe("Precedent transactions");
    expect(methodFor("Illustrative Discounted Cash Flow Analysis\nBased on the calculations set forth above, this analysis implied a range of values for Anaplan common stock of approximately", "Based on the calculations set forth above, this analysis implied a range of values for Anaplan common stock of approximately")).toBe("Discounted cash flow");
  });

  it("the second figure of a selected-companies sentence isn't cut off from the cross-reference (Slack)", () => {
    const doc = "Opinion of Qatalyst Partners\nFinancial Analyses\nSelected Companies Analysis\nBased on an analysis of the CY2021E revenue multiples for the selected companies and the application of its professional judgment, Qatalyst Partners selected a representative range of 15.0x to 33.0x. Based on the same fully diluted share count as used in the above discounted cash flow analysis, this analysis implied a range of per share values of approximately $30.02 to $63.75 per share of Slack Class A common stock based on the Management Projections and approximately $28.64 to $60.84 per share of Slack Class A common stock based on the analyst projections.\n";
    const ops = parseFairness(doc, { acquirerName: "SALESFORCE.COM, Inc.", targetName: "Slack Technologies, Inc.", offerPrice: null, consideration: "Mixed" });
    expect(ops[0].ranges.map((r) => r.method)).toEqual(["Trading comparables", "Trading comparables"]);
  });

  it("reads a run-in heading with a space before its period", () => {
    expect(methodFor("Selected Companies Analysis\nDiscounted Cash Flow Analysis . Citi performed an analysis which resulted in", "which resulted in")).toBe("Discounted cash flow");
  });

  it("a passing mention doesn't outrank the heading above (EA's DCF), though it still helps with no heading", () => {
    const paragraph = "Using the Financial Forecasts, Goldman Sachs performed an analysis. Goldman Sachs applied terminal multiples derived from the selected companies. Goldman Sachs then divided the equity values to derive a range of illustrative present values per share";
    expect(methodFor(`Illustrative Discounted Cash Flow Analysis\n${paragraph}`, "Goldman Sachs then divided the equity values to derive a range of illustrative present values per share")).toBe("Discounted cash flow");
    expect(methodFor(paragraph, "Goldman Sachs then divided the equity values to derive a range of illustrative present values per share")).toBe("Trading comparables");
  });

  it("'had traded in a range' is the trading range", () => {
    expect(methodFor("", "the Company's common stock generally had traded in a range of")).toBe("52-week trading range");
  });
});

describe("last review: another company's shares", () => {
  const read = (body: string, acquirerName: string, targetName: string, consideration = "Stock") =>
    parseFairness(`Opinion of Goldman Sachs & Co. LLC\nSummary of Financial Analyses\n${body}\n`, { acquirerName, targetName, offerPrice: null, consideration })[0]?.ranges.map((r) => `${r.low}-${r.high}`) ?? [];

  it("the target's forecast owner doesn't make it the target's (Kansas City Southern on CP's shares)", () => {
    const body = "Implied Equity Value Per CPRL Common Share\n2022E AV/EBITDA Ratio (KCS management unaudited CPRL projections) 12.0x - 14.5x $ 60.00-$74.00\n2022E P/E Ratio (KCS management unaudited CPRL projections) 18.5x - 22.5x $ 68.00-$82.00";
    const doc = `Canadian Pacific Railway Limited (which we refer to as "CPRL") and Kansas City Southern (which we refer to as "KCS")\n${body}`;
    expect(read(doc, "Canadian Pacific Railway Ltd", "Kansas City Southern")).toEqual([]);
    // Must not break: the buyer's forecast of the target stays.
    expect(read("Selected Companies Analysis\nImplied per share equity value reference range for Valaris: EV / '26E EBITDA (Transocean Projections) $55.07 - $62.86", "Transocean Ltd.", "Valaris Limited")).toEqual(["55.07-62.86"]);
  });

  it("a possessive and a final s are one name: Brink's and 'Brinks Co' (NCR Atleos)", () => {
    const doc = `The Brink's Board retained Morgan Stanley & Co. LLC. Brink's Common Stock trades in New York.\nOpinion of Brink's Financial Advisor\nOpinion of Morgan Stanley & Co. LLC\nFinancial analyses were performed.\nThis analysis resulted in a range of implied share prices of Brink's Common Stock (rounded to the nearest $0.25) of $92.00 to $128.25.\nOpinion of NCR Atleos's Financial Advisor\nOpinion of J.P. Morgan Securities LLC\nJ.P. Morgan performed financial analyses. This analysis resulted in implied per share equity values for Brink's Common Stock of approximately $142.25 to $172.75, and implied per share equity values for NCR Atleos common stock of $40.00 to $60.00.\n`;
    const ops = parseFairness(doc, { acquirerName: "Brinks Co", targetName: "NCR Atleos Corp", offerPrice: 50.4, consideration: "Mixed" });
    expect(ops.find((o) => o.bank === "Morgan Stanley")).toMatchObject({ side: "acquirer", ranges: [] });
    expect(ops.find((o) => o.bank === "JPMorgan")).toMatchObject({ side: "target", ranges: [{ low: 40, high: 60 }] });
  });

  it("looks back to the sentence's start when only forecast owners are near (Goldman's NextEra DCF on Dominion, Devon on Coterra)", () => {
    const pad = "and preferred stock, using publicly available filings as directed by, and approved for Goldman Sachs' use by, the management of Dominion Energy, to derive a range of illustrative equity values for NextEra Energy.";
    const sentence = "Goldman Sachs then divided the range of illustrative equity values it derived by the number of fully diluted outstanding shares of NextEra Energy, as provided by the management of NextEra Energy and approved for Goldman Sachs' use by the management of Dominion Energy, using the treasury stock method, to derive a range of illustrative present values per share ranging from $105.44 to $131.88.";
    expect(read(`Discounted Cash Flow Analysis\n${pad} ${sentence}`, "Nextera Energy Inc", "Dominion Energy, Inc")).toEqual([]);
    // Must not break: the same sentence about the target.
    const own = sentence.replace("outstanding shares of NextEra Energy, as provided by the management of NextEra Energy", "outstanding shares of Dominion Energy, as provided by the management of Dominion Energy").replace("105.44", "68.64").replace("131.88", "87.66");
    expect(read(`Discounted Cash Flow Analysis\n${own}`, "Nextera Energy Inc", "Dominion Energy, Inc")).toEqual(["68.64-87.66"]);
  });

  it("keeps the target's column of a table headed by both parties (AvalonBay)", () => {
    const table = "derive a range of implied share prices for Equity Residential common shares and shares of AvalonBay common stock.\nEquity Residential\nAvalonBay\n\nPeer\nRange\nIllustrative\nShare Price\nPeer\nRange\nIllustrative\nShare Price\n\nImplied Cap Rate (Green Street)\n6.5% to 5.5%\n$59.93 to $74.08\n6.5% to 5.5%\n$166.91 to $207.13\n\nAverage Range\nN/A\n$61.09 to $70.54\nN/A\n$168.65 to $194.93\n";
    expect(read(table, "Equity Residential", "Avalonbay Communities Inc")).toEqual(["166.91-207.13", "168.65-194.93"]);
    // Must not break: a row of one company's ranges by metric (II-VI / Coherent), and a later sentence under an earlier table's head.
    expect(read("Equity Residential\nAvalonBay\n1.2x\n1.4x\nMorgan Stanley reviewed the targets. This resulted in a discounted price target range of $168.65 to $194.93 per share.", "Equity Residential", "Avalonbay Communities Inc")).toEqual(["168.65-194.93"]);
    expect(read("Implied Equity Value Per Share of Coherent\nEV / Revenue\nEV / EBITDA\nimplied per share $101.75 - $137.50\n$81.25 - $120.75", "II-VI Inc", "Coherent Inc")).toEqual(["101.75-137.5", "81.25-120.75"]);
  });
});

describe("last review: not a value of the target", () => {
  const read = (body: string) => parseFairness(`Opinion of Goldman Sachs & Co. LLC\nSummary of Financial Analyses\n${body}\n`, { acquirerName: "Buyer Corp", targetName: "Target Corp", offerPrice: null, consideration: "Cash" })[0]?.ranges.map((r) => `${r.method}: ${r.low}-${r.high}`) ?? [];

  it("the value of what's being paid (Albertsons), so the DCF is the first DCF", () => {
    const doc = `Implied Value of the Aggregate Consideration\nGoldman Sachs then added the ranges of implied values of the Share Component of the Aggregate Consideration to the implied value of the Cash Component of the Aggregate Consideration to derive a range of implied values of the Aggregate Consideration of $31.95 to $34.14 per share of Common Stock.\nIllustrative Discounted Cash Flow Analysis. Goldman Sachs performed an analysis to derive a range of illustrative present values per Company share of Common Stock of $27.48 to $33.27.`;
    expect(read(doc)).toEqual(["Discounted cash flow: 27.48-33.27"]);
    // Must not break: a column beside a real range.
    expect(read("Discounted Cash Flow Analysis. This resulted in implied per share values of $27.48 to $33.27, against the $34.10 per share implied by the merger consideration.")).toEqual(["Discounted cash flow: 27.48-33.27"]);
  });

  it("what synergies are worth (Xilinx), and pro forma synergy columns (Kansas City Southern)", () => {
    expect(read("Discounted Cash Flow Analysis. DBO then divided the range of illustrative present values it derived by the number of fully-diluted outstanding shares of Target common stock, to calculate a range of implied values per share of Target common stock of the expected net synergies and rounded to the nearest whole dollar, of $10 to $26 per share.")).toEqual([]);
    expect(read("This analysis yielded the following implied per share equity value ranges on a standalone and on a pro forma basis:\nImplied Equity Value Per Share of KCS common stock\nStandalone Pro-Forma $990 million synergy case Pro-Forma $377 million synergy case\n$226.00 - $280.00\n$310.00 - $365.00 $291.00 - $343.00")).toEqual([]);
    // Must not break: the target's value after counting synergies is a value of the target (Heritage Commerce, Cambridge).
    expect(read(`Dividend Discount Analysis. These calculations resulted in a range of implied values of $58.50 to $75.50 per share and, after taking into account the net present value of the Synergies ("Synergized Dividend Discount Analysis"), $87.25 to $120.50 per share of Target common stock.`)).toHaveLength(2);
  });

  it("a cost estimate (Columbia), not a cost of equity (Gatos)", () => {
    expect(read("professional and advisory fees, and other miscellaneous costs. Morgan Stanley estimated these costs at a range of $3.07 to $3.50 per share.")).toEqual([]);
    expect(read("price targets for Gatos common stock (discounting one year using a rate of 12.0%, based on the midpoint of the range of Gatos' estimated cost of equity), which indicated price targets of $11.00 to $18.00 per share.")).toEqual(["Analyst price targets: 11-18"]);
    // Must not break: costs earlier in the sentence as an input.
    expect(read("After deducting estimated costs, the liquidation analysis resulted in implied values per share of $14.00 to $16.00.")).toEqual(["Liquidation: 14-16"]);
  });
});

describe("last review: which bank", () => {
  it("a heading's short form names the bank, as a heading only (DBO on Xilinx)", () => {
    const section = "Opinion of DBO\nAMD retained DBO to provide it with financial advisory services. DBO performed financial analyses. Selected Companies Analysis. This resulted in implied equity values per share of Xilinx common stock of $97.00 to $118.00.\nAMD has agreed to pay DBO a fee of approximately $27.0 million.\n";
    const ops = parseFairness(`Opinions of AMD's Financial Advisors\n${section}`, { acquirerName: "AMD", targetName: "Xilinx Inc", offerPrice: null, consideration: "Stock" });
    expect(ops[0]).toMatchObject({ bank: "DBO Partners", side: "acquirer", feeUsd: 27e6 });
    expect(findBanks("the dbo plan and DBO benefits")).toEqual([]);
  });

  const joint = (between: string) => `Opinions of Allen & Company and J.P. Morgan
Opinion of Allen & Company LLC
WBD has engaged Allen & Company as a financial advisor to WBD.
For Allen & Company's financial advisory services in connection with the Merger, WBD has agreed to pay Allen & Company an aggregate cash fee of $100 million.
Opinion of J.P. Morgan Securities LLC
WBD retained J.P. Morgan Securities LLC as a financial advisor to WBD.
For services rendered in connection with the Merger, WBD has agreed to pay J.P. Morgan an aggregate fee of $90 million.
Financial Analyses of Allen & Company and J.P. Morgan
Selected Companies Analysis. This analysis indicated the following approximate implied equity value per share reference range for WBD:
Implied Equity Value Per Share Reference Range
$15.53 - $21.18
${between}`;
  const DCF = `Discounted Cash Flow Analysis
Allen & Company calculated ranges of terminal values by applying a selected range of perpetuity growth rates. The present values of the cash flows and terminal values were then calculated by Allen & Company using selected ranges of discount rates of 8.0% to 9.5% in the case of the Streaming & Studios Business. This analysis indicated the following approximate implied equity value per share reference range for WBD, as compared to the Merger Consideration:
Implied Equity Value Per Share Reference Range
$21.16 - $31.91
J.P. Morgan calculated ranges of terminal values by applying a selected range of perpetuity growth rates. The present values of the cash flows and terminal values were then calculated by J.P. Morgan using selected ranges of discount rates of 8.5% to 9.5% in the case of the Streaming & Studios Business. This analysis indicated the following approximate implied equity value per share reference range for WBD, as compared to the Merger Consideration:
Implied Equity Value Per Share Reference Range
$20.67 - $31.34
`;
  const ctx = { acquirerName: "Paramount Skydance Corporation", targetName: "Warner Bros. Discovery, Inc.", offerPrice: 31, consideration: "Cash" };

  it("one section for two banks gives each its own DCF, rate and fee, and both the shared ranges (Warner Bros. Discovery)", () => {
    const ops = parseFairness(joint(DCF), ctx);
    expect(ops.map((o) => o.bank)).toEqual(["Allen & Company", "JPMorgan"]);
    expect(ops[0]).toMatchObject({ feeUsd: 100e6, discountRatePct: [8, 9.5], ranges: [{ low: 15.53, high: 21.18 }, { method: "Discounted cash flow", low: 21.16, high: 31.91 }] });
    expect(ops[1]).toMatchObject({ feeUsd: 90e6, discountRatePct: [8.5, 9.5], ranges: [{ low: 15.53, high: 21.18 }, { method: "Discounted cash flow", low: 20.67, high: 31.34 }] });
  });

  it("what both did stays with both", () => {
    const both = `Discounted Cash Flow Analysis\nAllen & Company and J.P. Morgan calculated the present values using discount rates of 8.0% to 9.5%, which resulted in implied equity values per share of $21.00 to $31.00.\n`;
    const ops = parseFairness(joint(both), ctx);
    expect(ops.map((o) => o.ranges.at(-1))).toEqual([{ method: "Discounted cash flow", low: 21, high: 31 }, { method: "Discounted cash flow", low: 21, high: 31 }]);
  });

  it("must not break: another bank's analyses heading still ends a one-bank section", () => {
    const pad = "Lorem ipsum dolor sit amet. ".repeat(30);
    const doc = `Opinion of Goldman Sachs & Co. LLC\n${pad}\nDiscounted Cash Flow Analysis. This resulted in implied per share values of $40.00 to $50.00.\nSummary of J.P. Morgan's Financial Analyses\nDiscounted Cash Flow Analysis. This resulted in implied per share values of $60.00 to $70.00.\n`;
    expect(parseFairness(doc, { acquirerName: "Buyer Corp", offerPrice: null }).map((o) => [o.bank, o.ranges.length])).toEqual([["Goldman Sachs", 1]]);
  });
});
