import { describe, expect, it } from "vitest";
import { displayName, extractAdvisors, extractConsideration, extractPremium, extractPrice, extractValue, parsePressRelease, splitHeadline } from "./press";

// Fixtures are synthetic releases written in the style of real 8-K exhibits.

const CASH_DEAL = `EX-99.1
Exhibit 99.1
Northwind Systems to Acquire Bluebird Analytics, Expanding Its Data Platform
• Transaction expected to be accretive in year two
• Conference call at 8:30 a.m. ET
AUSTIN, Texas, March 3, 2026 - Northwind Systems, Inc. (NASDAQ: NWSY) and Bluebird Analytics, Inc. (NYSE: BLBD) today announced a definitive agreement under which Northwind will acquire all outstanding shares of Bluebird for $42.50 per share in cash, representing an implied equity value of approximately $3.2 billion. The per-share price represents a premium of approximately 31% to Bluebird's unaffected closing stock price on February 27, 2026 and a premium of 36% to its 30-day volume-weighted average price.
Bluebird's common stock has a par value of $0.001 per share.
Advisors
Goldman Sachs & Co. LLC is serving as financial advisor to Northwind, and Latham & Watkins LLP is serving as legal counsel. J.P. Morgan Securities LLC is serving as exclusive financial advisor and provided a fairness opinion to Bluebird, and Wachtell, Lipton, Rosen & Katz is serving as legal counsel.
Forward-Looking Statements
This release mentions a $1.00 per share dividend in a hypothetical.`;

const TAKE_PRIVATE = `Exhibit 99.1
Harbor Freight Logistics, Inc. Enters into Definitive Agreement to Be Acquired by Affiliates of Crestline Partners for $18.75 Per Share in Cash
DENVER, CO - JUNE 9, 2026 - Harbor Freight Logistics, Inc. (NYSE: HFL) ("HFL" or the "Company") today announced that it has entered into a definitive agreement to be acquired by affiliates of Crestline Partners ("Crestline"), in an all-cash transaction representing an enterprise value of approximately $1.4 billion, including net debt. The purchase price represents a premium of approximately 27% to the Company's unaffected closing share price.
Evercore is serving as financial advisor to the Company. Houlihan Lokey is serving as financial advisor to Crestline.`;

const STOCK_MERGER = `Exhibit 99.1
Summit Bancorp and Valley Ridge Financial Announce Merger Agreement
RICHMOND, Va., May 12, 2026 - Summit Bancorp, Inc. (NASDAQ: SMBK) and Valley Ridge Financial Corp. (NASDAQ: VRFC) today announced that they have entered into a definitive merger agreement. Under the terms of the agreement, Valley Ridge shareholders will receive 1.25 shares of Summit common stock for each share of Valley Ridge common stock, a fixed exchange ratio. The transaction is valued at approximately $410 million.
Keefe, Bruyette & Woods, A Stifel Company, is serving as financial advisor to Summit. Piper Sandler & Co. is serving as financial advisor to Valley Ridge.`;

const UPDATE = `Exhibit 99.1
Harbor Freight Logistics Announces Expiration of HSR Waiting Period
DENVER, CO, August 1, 2026 - Harbor Freight Logistics, Inc. (NYSE: HFL) today announced the expiration of the waiting period under the HSR Act in connection with the previously announced merger agreement pursuant to which Crestline Partners will acquire the Company for $18.75 per share in cash.`;

const COMPLETION = `Exhibit 99.1
Northwind Systems Completes Acquisition of Bluebird Analytics
AUSTIN, Texas, September 1, 2026 - Northwind Systems, Inc. (NASDAQ: NWSY) today announced that it has completed its previously announced acquisition of Bluebird Analytics, Inc. Bluebird stockholders received $42.50 per share in cash. Bluebird's common stock will no longer trade on the NYSE.`;

const NOTES = `Exhibit 99.1
Acme Corp Announces Pricing of $500 Million Convertible Senior Notes Offering
NEW YORK, April 2, 2026 - Acme Corp (NYSE: ACME) today announced the pricing of $500 million of convertible notes. The initial conversion price represents a premium of approximately 32.5% over the last reported sale price.`;

describe("extractValue ignores numbers that aren't the deal price", () => {
  it("skips market sizes, combined-company values and sponsor boilerplate", () => {
    expect(extractValue("The global MICE market was valued at approximately USD $945.6 billion in 2025.")).toBeNull();
    expect(extractValue("All stock transaction with combined enterprise value of approximately $135 billion.")).toBeNull();
    expect(extractValue("Since its inception, CD&R has managed more than $40 billion with an aggregate transaction value of more than $175 billion.")).toBeNull();
    expect(extractValue("The Company will be acquired in an all-cash transaction valued at approximately $2.5 billion.")).toEqual({ usd: 2.5e9, kind: "transaction" });
  });
  it("reads 'to acquire X for USD 6.2 billion'", () => {
    expect(extractValue("Ericsson has agreed to acquire Vonage for USD 6.2 billion, to spearhead the creation of a global network platform.")).toEqual({ usd: 6.2e9, kind: "transaction" });
  });
});

describe("displayName", () => {
  it("title-cases EDGAR names and drops state tags", () => {
    expect(displayName("DIODES INC /DEL/")).toBe("Diodes Inc");
    expect(displayName("AMETEK INC/")).toBe("Ametek Inc");
    expect(displayName("Sealed Air Corp/De")).toBe("Sealed Air Corp");
    expect(displayName("Copart, Inc.")).toBe("Copart, Inc.");
    expect(displayName("California BanCorp \\ CA")).toBe("California BanCorp");
    expect(displayName("Novo Nordisk A/S")).toBe("Novo Nordisk A/S");
    expect(displayName("NORTHSTRIVE FUND II LP")).toBe("Northstrive Fund II LP");
    expect(displayName("II-VI INC")).toBe("II-VI Inc");
    expect(displayName("COPART")).toBe("Copart");
  });
});

describe("extractPrice skips contingent value rights", () => {
  it("takes the cash price, not the CVR", () => {
    const t = `Under the terms of the agreement, Acme will commence a tender offer to acquire all outstanding shares of Widget for $2.02 per share in cash, plus one non-transferable contingent value right (CVR) entitling the holder to receive up to $0.17 per share in cash upon achievement of a milestone.`;
    expect(extractPrice(t)).toBe(2.02);
  });
});

describe("private-company acquisitions", () => {
  const ACQUIRES = `EX-99.1
Acme Industrial Corp. Acquires Precision Valve Systems
Expands flow-control portfolio
CLEVELAND, March 3, 2026 -- Acme Industrial Corp. (NYSE: ACME) today announced that it has acquired Precision Valve Systems, LLC, a privately held manufacturer of industrial valves, for $185 million in cash. The acquisition is expected to be accretive in the first full year.`;

  const AGREEMENT = `EX-99.1
Orbit Software to Acquire DataLoom
AUSTIN, June 9, 2026 -- Orbit Software, Inc. (Nasdaq: ORBT) today announced that it has entered into a definitive agreement to acquire DataLoom, Inc., a privately held data-integration company, for approximately $420 million in cash and stock. The transaction is expected to close in the third quarter.`;

  const ANNOUNCES = `EX-99.1
Summit Health Announces Acquisition of Riverbend Clinics
DENVER, Aug. 4, 2026 -- Summit Health Inc. (NYSE: SMHI) announced today that it has completed the acquisition of Riverbend Clinics, a privately-held network of 14 outpatient clinics. Terms were not disclosed.`;

  it("reads 'Acquires' as a completed private deal", () => {
    const p = parsePressRelease(ACQUIRES, { filerName: "ACME INDUSTRIAL CORP", filerTickers: ["ACME"] })!;
    expect(p.kind).toBe("completion");
    expect(p.acquirer.name).toBe("Acme Industrial Corp.");
    expect(p.target.name).toBe("Precision Valve Systems");
    expect(p.privateTarget).toBe(true);
    expect(p.valueUsd).toBe(185e6);
  });

  it("reads an agreement to acquire a private company as an announcement", () => {
    const p = parsePressRelease(AGREEMENT, { filerName: "ORBIT SOFTWARE, INC.", filerTickers: ["ORBT"] })!;
    expect(p.kind).toBe("announcement");
    expect(p.target.name).toBe("DataLoom");
    expect(p.privateTarget).toBe(true);
    expect(p.valueUsd).toBe(420e6);
  });

  it("treats 'Announces Acquisition of' with 'has completed' as closed, undisclosed value", () => {
    const p = parsePressRelease(ANNOUNCES, { filerName: "SUMMIT HEALTH INC", filerTickers: ["SMHI"] })!;
    expect(p.kind).toBe("completion");
    expect(p.target.name).toBe("Riverbend Clinics");
    expect(p.privateTarget).toBe(true);
    expect(p.valueUsd).toBeNull();
  });

  it("rejects carve-outs of a named company's business", () => {
    const carve = `EX-99.1
Acme Industrial Corp. to Acquire Honeywell's Valve Business
CLEVELAND, March 3, 2026 -- Acme Industrial Corp. (NYSE: ACME) today announced a definitive agreement to acquire the industrial valve business of Honeywell for $300 million.`;
    expect(parsePressRelease(carve, { filerName: "ACME INDUSTRIAL CORP", filerTickers: ["ACME"] })).toBeNull();
  });

  it("treats a suffixed name without a ticker as a private target", () => {
    const suffixed = `EX-99.1
Orbit Software Completes Acquisition of Nimbus Labs
AUSTIN, June 9, 2026 -- Orbit Software, Inc. (Nasdaq: ORBT) today announced that it has completed the acquisition of Nimbus Labs, Inc., a developer of edge-computing tools.`;
    const p = parsePressRelease(suffixed, { filerName: "ORBIT SOFTWARE, INC.", filerTickers: ["ORBT"] })!;
    expect(p.kind).toBe("completion");
    expect(p.target.name).toBe("Nimbus Labs");
    expect(p.privateTarget).toBe(true);
  });

  it("does not call a listed target private", () => {
    const p = parsePressRelease(CASH_DEAL, { filerName: "Northwind Systems, Inc.", filerTickers: ["NWSY"] })!;
    expect(p.privateTarget).toBe(false);
  });
});

describe("parsePressRelease", () => {
  it("parses a cash acquisition announced by the acquirer", () => {
    const p = parsePressRelease(CASH_DEAL, { filerName: "Northwind Systems, Inc.", filerTickers: ["NWSY"] })!;
    expect(p.kind).toBe("announcement");
    expect(p.acquirer).toMatchObject({ name: "Northwind Systems, Inc.", ticker: "NWSY", exchange: "NASDAQ" });
    expect(p.target).toMatchObject({ ticker: "BLBD", exchange: "NYSE" });
    expect(p.target.name).toMatch(/^Bluebird/);
    expect(p.pricePerShare).toBe(42.5);
    expect(p.premiumPct).toBe(31);
    expect(p.valueUsd).toBe(3.2e9);
    expect(p.valueKind).toBe("equity");
    expect(p.consideration).toBe("Cash");
    expect(p.acquirerAdvisors).toEqual(["Goldman Sachs"]);
    expect(p.targetAdvisors).toEqual(["JPMorgan"]);
  });

  it("parses a take-private filed by the target", () => {
    const p = parsePressRelease(TAKE_PRIVATE, { filerName: "HARBOR FREIGHT LOGISTICS, INC.", filerTickers: ["HFL"] })!;
    expect(p.kind).toBe("announcement");
    expect(p.acquirer.name).toBe("Crestline Partners");
    expect(p.target).toMatchObject({ ticker: "HFL" });
    expect(p.pricePerShare).toBe(18.75);
    expect(p.valueUsd).toBe(1.4e9);
    expect(p.valueKind).toBe("enterprise");
    expect(p.targetAdvisors).toEqual(["Evercore"]);
    expect(p.acquirerAdvisors).toEqual(["Houlihan Lokey"]);
  });

  it("works out the acquirer in an all-stock merger from the share exchange", () => {
    const p = parsePressRelease(STOCK_MERGER, { filerName: "Summit Bancorp, Inc.", filerTickers: ["SMBK"] })!;
    expect(p.acquirer.ticker).toBe("SMBK");
    expect(p.target.ticker).toBe("VRFC");
    expect(p.consideration).toBe("Stock");
    expect(p.valueUsd).toBe(410e6);
    expect(p.acquirerAdvisors).toEqual(["Stifel"]);
    expect(p.targetAdvisors).toEqual(["Piper Sandler"]);
  });

  it("classifies follow-up releases", () => {
    expect(parsePressRelease(UPDATE, { filerName: "Harbor Freight Logistics, Inc.", filerTickers: ["HFL"] })?.kind).toBe("update");
    const done = parsePressRelease(COMPLETION, { filerName: "Northwind Systems, Inc.", filerTickers: ["NWSY"] })!;
    expect(done.kind).toBe("completion");
    expect(done.target.name).toMatch(/^Bluebird/);
  });

  it("trims the target's name out of a run-on acquirer name", () => {
    const text = `Exhibit 99.1
Keystone Software Shareholders Approve Acquisition by Thoma Bravo
BOSTON, May 5, 2026 - Keystone Software, Inc. (NYSE: KSW) today announced that its stockholders approved the previously announced merger agreement under which Thoma Bravo Keystone Shareholders will acquire Keystone Software for $30.00 per share in cash.`;
    const p = parsePressRelease(text, { filerName: "Keystone Software, Inc.", filerTickers: ["KSW"] })!;
    expect(p.kind).toBe("update");
    expect(p.acquirer.name).toBe("Thoma Bravo");
  });

  it("rejects capital-markets releases that mention a premium", () => {
    expect(parsePressRelease(NOTES, { filerName: "Acme Corp", filerTickers: ["ACME"] })).toBeNull();
  });

  it("keeps deals whose sub-headline mentions earnings, and reads USD-prefixed prices", () => {
    const text = `Exhibit 99.1
Will Accelerate Revenue Growth Immediately After Close; Expected to be Accretive to Non-GAAP Diluted Earnings
BOSTON, May 5, 2026 - Orion Pharma Inc. (Nasdaq: ORPH) and Keystone Rare Disease Inc. (Nasdaq: KRD) today announced a definitive agreement under which Orion will acquire Keystone for USD 14.50 per share in cash, a premium of 33% to the unaffected closing price, for a total equity value of approximately USD 4.8 billion.`;
    const p = parsePressRelease(text, { filerName: "Keystone Rare Disease Inc.", filerTickers: ["KRD"] })!;
    expect(p.kind).toBe("announcement");
    expect(p.target.ticker).toBe("KRD");
    expect(p.pricePerShare).toBe(14.5);
    expect(p.valueUsd).toBe(4.8e9);
  });

  it("does not treat 'expected to close' or separation completion as a completed deal", () => {
    const text = `Exhibit 99.1
Northwind to acquire Bluebird for $72.00 per share in cash; transaction expected to close in the first half of 2027 following completion of the spin-off
AUSTIN, Texas, March 3, 2026 - Northwind Systems, Inc. (NASDAQ: NWSY) today announced a definitive agreement to acquire Bluebird Analytics, Inc. (NYSE: BLBD).`;
    expect(parsePressRelease(text, { filerName: "Northwind Systems, Inc.", filerTickers: ["NWSY"] })?.kind).toBe("announcement");
  });

  it("never lets a party name run across a sentence", () => {
    const text = `Exhibit 99.1
Harbor Freight Logistics to be Acquired by CD&R for $42.15 per Share in Cash
DENVER, CO, June 9, 2026 - Harbor Freight Logistics, Inc. (NYSE: HFL) today announced a definitive agreement under which it will be acquired by CD&R. About Harbor Freight Logistics Harbor Freight Logistics is a leading carrier.`;
    const p = parsePressRelease(text, { filerName: "Harbor Freight Logistics, Inc.", filerTickers: ["HFL"] })!;
    expect(p.acquirer.name).toBe("CD&R");
    expect(p.target.ticker).toBe("HFL");
  });

  it("reads 'X has entered into a definitive agreement to acquire Y'", () => {
    const text = `Exhibit 99.1
Establishes a Durable Platform for Long-Term Revenue Growth
SAN DIEGO, April 6, 2026 - Orion Biosciences, Inc. (Nasdaq: ORBI) and Keystone Therapeutics, Inc. (Nasdaq: KYTX) today announced that Orion has entered into a definitive agreement to acquire Keystone for $53.00 per share in cash, representing a total transaction equity value of $2.9 billion.`;
    const p = parsePressRelease(text, { filerName: "Keystone Therapeutics, Inc.", filerTickers: ["KYTX"] })!;
    expect(p.acquirer.ticker).toBe("ORBI");
    expect(p.target.ticker).toBe("KYTX");
    expect(p.pricePerShare).toBe(53);
  });

  it("rejects unsolicited proposals", () => {
    const text = `Exhibit 99.1
Crestline Partners Proposes to Acquire Harbor Freight Logistics for $20.00 Per Share
DENVER, CO, June 1, 2026 - Crestline Partners today delivered a non-binding proposal to acquire Harbor Freight Logistics, Inc. (NYSE: HFL) for $20.00 per share in cash, a premium of 30% to the unaffected price.`;
    expect(parsePressRelease(text, { filerName: "Crestline Partners", filerTickers: [] })).toBeNull();
  });
});

describe("splitHeadline", () => {
  it("skips SEC cover pages and bullets above the dateline", () => {
    const text = `UNITED STATES SECURITIES AND EXCHANGE COMMISSION
Washington, D.C. 20549
Filed by Northwind Systems, Inc. pursuant to Rule 425
Northwind to Acquire Bluebird
• Creates a leader in analytics
AUSTIN, Texas, March 3, 2026 - Body text here.`;
    expect(splitHeadline(text).headline).toBe("Northwind to Acquire Bluebird");
    expect(splitHeadline(text).body).toBe("Body text here.");
  });

  it("takes the headline above sub-headlines that mention the merger", () => {
    const text = `Exhibit 99.1
Northwind Group and Bluebird Watson Announce Merger to Create Leading Global Advisory Firm
Combination offers clients a broader range of advice
Merger delivers significant potential to enhance long-term shareholder value through
incremental revenue growth and greater corporate efficiencies
LONDON - (BUSINESS WIRE) - June 30, 2026 - Body text here.`;
    expect(splitHeadline(text).headline).toBe("Northwind Group and Bluebird Watson Announce Merger to Create Leading Global Advisory Firm");
  });

  it("joins a headline wrapped over two lines, but not its sub-headline", () => {
    const wrapped = `Exhibit 99.1
PRESS
RELEASE
Harbor Freight Logistics Limited Enters into a Definitive
Agreement to be Acquired by Certain Investment Funds Affiliated
with Crestline Partners
New York, August 28, 2026 - Body text here.`;
    expect(splitHeadline(wrapped).headline).toBe(
      "Harbor Freight Logistics Limited Enters into a Definitive Agreement to be Acquired by Certain Investment Funds Affiliated with Crestline Partners",
    );
    const object = `Exhibit 99.1
Northwind Instruments Announces Agreement to Acquire
Bluebird Corporation
Combined company will lead in photonics
ANDOVER, Mass., February 23, 2026 - Body text here.`;
    expect(splitHeadline(object).headline).toBe("Northwind Instruments Announces Agreement to Acquire Bluebird Corporation");
    const subhead = `Exhibit 99.1
kcorliss@bluebird.com
Northwind Signs Definitive Agreement to Acquire Bluebird
World's #1 CRM and #1 analytics platform come together
SAN FRANCISCO, June 10, 2026 - Body text here.`;
    expect(splitHeadline(subhead).headline).toBe("Northwind Signs Definitive Agreement to Acquire Bluebird");
  });

  it("names the company when a deal is announced with its results", () => {
    const text = `Exhibit 99.1
Bluebird Inc. Reports Second Quarter Fiscal Year 2026 Financial Results
Announces agreement to be acquired by Crestline Partners in transaction valued at $551 million
LOS ANGELES (November 9, 2026) - Body text here.`;
    expect(splitHeadline(text).headline).toBe("Bluebird Inc. Announces agreement to be acquired by Crestline Partners in transaction valued at $551 million");
  });

  it("drops contact lines and labels above the headline", () => {
    const text = `Exhibit 99.1
MICROCHIP CONTACT:
J. Eric Smith - CFO (480) 792-7804
Sard Verbinnen & Co.
FOR IMMEDIATE RELEASE Northwind Technology to Acquire Bluebird
Chandler, Arizona - May 7, 2026 - Body text here.`;
    expect(splitHeadline(text).headline).toBe("Northwind Technology to Acquire Bluebird");
  });
});

describe("headline details", () => {
  const ctx = { filerName: "Northwind Foods, Inc.", filerTickers: ["NWF"] };

  it("keeps an apostrophe that belongs to the target's name, but still spots carve-outs", () => {
    const brand = `Exhibit 99.1
Northwind Foods Acquires Mama Rosa's Pizza Crusts
Parsippany, N.J., July 13, 2026 - Northwind Foods, Inc. (NYSE: NWF) announced today that it has acquired Spartan Foods of America, Inc., the maker of Mama Rosa's pizza crusts, for $50 million.`;
    expect(parsePressRelease(brand, ctx)?.target.name).toBe("Mama Rosa's Pizza Crusts");
    const unit = `Exhibit 99.1
Northwind Foods to Acquire Bluebird's Valve Manufacturing Unit
Parsippany, N.J., July 13, 2026 - Northwind Foods, Inc. (NYSE: NWF) announced today that it will acquire the valve unit of Bluebird Corp.`;
    expect(parsePressRelease(unit, ctx)).toBeNull();
  });

  it("cuts 'X and Y Announce Agreement for X to Acquire Y' to the buyer", () => {
    const text = `Exhibit 99.1
Galena and Bluebird Announce Agreement for Galena to Acquire Bluebird
ZURICH, July 21, 2026 - Galena AG (SIX: GALN) and Bluebird, Inc. (NASDAQ: BLBD) today announced a definitive merger agreement under which Galena will acquire Bluebird for $32.00 per share in cash.`;
    expect(parsePressRelease(text, { filerName: "Bluebird, Inc.", filerTickers: ["BLBD"] })?.acquirer.name).toBe("Galena");
  });

  it("reads two buyers announcing an acquisition", () => {
    const text = `Exhibit 99.1
Northwind and Crestline Global Announce Acquisition of Specialty Insurance Company Bluebird Holdings, Inc.
NEW YORK, January 15, 2026 - Northwind and Crestline Global today announced a definitive agreement to acquire Bluebird Holdings, Inc. (NYSE: BLBD) for $14.00 per share in cash.`;
    const p = parsePressRelease(text, { filerName: "Bluebird Holdings, Inc.", filerTickers: ["BLBD"] })!;
    expect(p.acquirer.name).toBe("Northwind and Crestline Global");
    expect(p.target).toMatchObject({ name: "Bluebird Holdings, Inc.", ticker: "BLBD" });
  });

  it("keeps an announcement whose first paragraph mentions an earlier deal", () => {
    const text = `Exhibit 99.1
NORTHWIND DIGITAL ANNOUNCES ACQUISITION OF BLUEBIRD
IRVINE, Calif., October 21, 2026 - Northwind Digital Corporation (NASDAQ: NWDC) and Bluebird Corporation (NASDAQ: BLBD) today announced a definitive agreement under which Northwind will acquire Bluebird for $86.50 per share. The transaction is in addition to the previously announced investment by Crestline.`;
    expect(parsePressRelease(text, { filerName: "Northwind Digital Corporation", filerTickers: ["NWDC"] })?.kind).toBe("announcement");
  });
});

describe("term extractors", () => {
  it("ignores par values and dividends when finding the offer price", () => {
    expect(extractPrice("Each share has a par value of $0.01 per share. Holders will receive $25.00 per share in cash.")).toBe(25);
    expect(extractPrice("The board declared a dividend of $0.18 per share.")).toBeNull();
  });

  it("prefers the premium to the unaffected price", () => {
    expect(extractPremium("a premium of 20% to the 30-day VWAP and a premium of 35% to the unaffected closing price")).toBe(35);
    expect(
      extractPremium(
        "represents a premium of approximately 39% over the closing price on November 22, 2024, and a premium of approximately 90% over the 60-day volume-weighted average price. On December 30, the closing price was $4.40.",
      ),
    ).toBe(39);
    expect(extractPremium("a premium of 49% to the 30-day volume-weighted average price")).toBeNull();
  });

  it("reads value kind and units", () => {
    expect(extractValue("representing an enterprise value of approximately $866 million")).toEqual({ usd: 866e6, kind: "enterprise" });
    expect(extractValue("an all-cash transaction valued at approximately $7.7 billion")).toEqual({ usd: 7.7e9, kind: "transaction" });
    expect(extractValue("with $75 billion of capital under management")).toBeNull();
  });

  it("classifies consideration, including negations", () => {
    expect(extractConsideration("holders will receive $10.00 in cash and 0.5 shares of Acme common stock")).toBe("Mixed");
    expect(extractConsideration("The consideration is payable in Acme common shares. No cash consideration is payable. The exchange ratio is fixed.")).toBe("Stock");
    // One share plus cash is mixed, even with the share named first.
    expect(extractConsideration("Norfolk Southern shareholders will receive one Union Pacific common share and $88.82 in cash for each Norfolk Southern share.")).toBe("Mixed");
    // Financing language elsewhere doesn't make an all-cash offer mixed.
    expect(extractConsideration("Juniper shareholders will receive $40.00 per share in cash. HPE intends to fund the transaction with cash and new shares of mandatory convertible preferred stock.")).toBe("Cash");
    expect(extractConsideration("Discover shareholders will receive 1.0192 Capital One shares for each Discover share.")).toBe("Stock");
  });

  it("assigns advisors to the right side", () => {
    const text = "Barclays is serving as exclusive financial advisor to the Special Committee. Moelis & Company LLC is acting as financial advisor to Parent.";
    expect(extractAdvisors(text, "Parent", "Target Co", "target", "TGT")).toEqual({ acquirerAdvisors: ["Moelis"], targetAdvisors: ["Barclays"] });
  });

  it("reads possessives, lists, co-advisors and advisor headings", () => {
    // "X's financial advisor", including a short form of the name ("Bel's" = BEL Fuse Inc.).
    const possessive = "Advisors Evercore is serving as Bel's exclusive financial advisor and Citi is serving as exclusive financial advisor to Enercon for the transaction. Centerview Partners LLC is serving as Enercon's financial advisor.";
    expect(extractAdvisors(possessive, "BEL Fuse Inc", "Enercon Technologies", null, null)).toEqual({ acquirerAdvisors: ["Evercore"], targetAdvisors: ["Citigroup", "Centerview"] });
    const list = "Financial advisors to Clearlake include Morgan Stanley, Goldman Sachs, JP Morgan and Barclays. Kirkland & Ellis is legal counsel.";
    expect(extractAdvisors(list, "Clearlake Capital Group", "Dun & Bradstreet", null, null).acquirerAdvisors).toEqual(["Morgan Stanley", "Goldman Sachs", "JPMorgan", "Barclays"]);
    const co = "Lazard is acting as lead financial advisor with BofA Securities acting as co-advisor and Davis Polk & Wardwell LLP serving as legal counsel to Ferrero.";
    expect(extractAdvisors(co, "Ferrero International S.A.", "WK Kellogg Co", null, null).acquirerAdvisors).toEqual(["Lazard", "BofA Securities"]);
    const headed = "Herc Advisors Guggenheim Securities, LLC is serving as lead financial advisor for the transaction, and Credit Agricole Securities (USA) Inc is serving as co-financial advisor.";
    expect(extractAdvisors(headed, "Herc Holdings Inc", "H&E Equipment Services, Inc.", null, null).acquirerAdvisors).toEqual(["Guggenheim", "Credit Agricole"]);
  });
});

describe("termination headlines", () => {
  const ctx = { filerName: "Integer Holdings Corp", filerTickers: ["ITGR"] };
  it("does not read early HSR termination as the deal ending", () => {
    const p = parsePressRelease(
      "Integer Receives Early Termination of Hart-Scott-Rodino Waiting Period for Pending Acquisition by KKR\nPLANO, Texas, September 30, 2026 -- Integer Holdings Corporation (NYSE: ITGR) today announced that it has received early termination of the waiting period under the HSR Act in connection with the previously announced acquisition of Integer by an affiliate of investment funds managed by KKR for $127 per share in cash.",
      ctx,
    );
    expect(p?.kind).not.toBe("termination");
  });
  it("still reads a terminated merger agreement", () => {
    const p = parsePressRelease(
      "Integer and KKR Mutually Agree to Terminate Merger Agreement\nPLANO, Texas, October 30, 2026 -- Integer Holdings Corporation (NYSE: ITGR) and KKR today announced that they have mutually agreed to terminate the merger agreement under which KKR would have acquired Integer.",
      ctx,
    );
    expect(p?.kind).toBe("termination");
  });
});
describe("extractValue: figures that are not the price", () => {
  it("skips synergies, costs, value creation and later instalments", () => {
    expect(extractValue(`• II-VI proposal represents 24.0% premium over implied value of MKS Instruments' acquisition proposal • $200 million of run-rate cost synergies expected within 36 months`)).toBeNull();
    expect(extractValue(`The transaction is expected to generate more than $2.8 billion in value creation from synergies, net of ~$400 million in expected one-time transaction and integration costs. The transaction values NFP at $13.4 billion.`)?.usd).toBe(13.4e9);
    expect(extractValue(`In addition to the initial cash purchase price at closing, Thermo Fisher has agreed to pay $125 million in January 2027.`)).toBeNull();
    // Costs mentioned before the figure don't matter.
    expect(extractValue(`$30 million of cash and certain other transaction costs, which implies a value of $150 million based upon a 15-day VWAP.`)?.usd).toBe(150e6);
  });
});
