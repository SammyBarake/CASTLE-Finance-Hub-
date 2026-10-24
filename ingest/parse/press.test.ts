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

  it("reads two buyers signing one agreement to acquire a third company", () => {
    const text = `Exhibit 99.1
Crestline and Northwind Corporation Sign Agreement to Acquire Bluebird Health
DUBLIN, Ohio, October 6, 2026 - Crestline, Northwind Corporation (NYSE: NWC) ("Northwind"), and Bluebird Health, Inc. (Nasdaq: BLBH) announced today that they have entered into a definitive agreement, under which Crestline and Northwind will acquire Bluebird Health for $32.05 per share, reflecting a total enterprise value of approximately $5.8 billion.`;
    const p = parsePressRelease(text, { filerName: "Northwind Corporation", filerTickers: ["NWC"] })!;
    expect(p.acquirer.name).toBe("Crestline and Northwind Corporation");
    expect(p.target.name).toMatch(/^Bluebird Health/);
    // The price after a long description of the target.
    expect(p.pricePerShare).toBe(32.05);
  });

  // Node 24's engine missed some (?i:...) matches in capitals and title case ("SIGN AN … AGREEMENT", "AN ENTITY
  // CONTROLLED BY"). Every article and optional word the patterns allow, so a rewrite the engine mishandles fails here.
  const titleCase = (s: string) => s.replace(/[A-Za-z]+/g, (w) => w[0] + w.slice(1).toLowerCase());

  it("reads every 'sign / enter into / announce … agreement to acquire' in capitals and title case", () => {
    const text = (headline: string) => `Exhibit 99.1
${headline}
DUBLIN, Ohio, October 6, 2026 - Crestline Partners, Northwind Corporation (NYSE: NWC) ("Northwind"), and Bluebird Health, Inc. (Nasdaq: BLBH) announced today a transaction under which Bluebird Health shareholders will receive $32.05 per share in cash.`;
    for (const verb of ["SIGN", "ENTER INTO", "ANNOUNCE"])
      for (const article of ["", "A ", "AN "])
        for (const words of ["", "DEFINITIVE ", "MERGER ", "DEFINITIVE MERGER "]) {
          const headline = `CRESTLINE AND NORTHWIND ${verb} ${article}${words}AGREEMENT TO ACQUIRE BLUEBIRD HEALTH`;
          for (const h of [headline, titleCase(headline)]) {
            const p = parsePressRelease(text(h), { filerName: "Northwind Corporation", filerTickers: ["NWC"] });
            expect(p?.acquirer.name.toUpperCase(), h).toBe("CRESTLINE AND NORTHWIND");
            expect(p?.target.name, h).toBe("Bluebird Health, Inc.");
          }
        }
  });

  it("reads every 'to be acquired by an entity controlled by' in capitals and title case", () => {
    const text = (headline: string) => `Exhibit 99.1
${headline}
DENVER, CO - JUNE 9, 2026 - Bluebird Holdings, Inc. (NYSE: BLBH) today announced a transaction under which its shareholders will receive $18.75 per share in cash.`;
    for (const article of ["A ", "AN "])
      for (const newly of ["", "NEWLY FORMED "])
        for (const toBe of ["", "TO BE "])
          for (const verb of ["FORMED", "OWNED", "CONTROLLED"]) {
            const headline = `BLUEBIRD HOLDINGS TO BE ACQUIRED BY ${article}${newly}ENTITY ${toBe}${verb} BY CRESTLINE PARTNERS`;
            for (const h of [headline, titleCase(headline)]) {
              const p = parsePressRelease(text(h), { filerName: "Bluebird Holdings, Inc.", filerTickers: ["BLBH"] });
              expect(p?.acquirer.name.toUpperCase(), h).toBe("CRESTLINE PARTNERS");
              expect(p?.target.name, h).toBe("Bluebird Holdings, Inc.");
            }
          }
  });

  it("spots a carve-out whose unit carries a trademark sign", () => {
    const text = `Exhibit 99.1
Northwind Technologies, Inc. Agrees to Acquire Bluebird Inc.'s Ophir ® Optics Business, Adding Advanced Infrared Optics Capabilities
SANTA ANA, Calif., October 20, 2026 - Northwind Technologies, Inc. (NASDAQ: NWTI) today announced that it has entered into a definitive agreement to acquire the Ophir Optics business ("Ophir Optics") from Bluebird Inc. (NASDAQ: BLBD) for approximately $650 million in an all-cash transaction.`;
    expect(parsePressRelease(text, { filerName: "Northwind Technologies, Inc.", filerTickers: ["NWTI"] })).toBeNull();
  });

  it("reads a buy-out of the rest of a company as that company, and skips stakes, branches and units", () => {
    const rest = `Exhibit 99.1
Northwind Pharmaceuticals to Acquire Remaining Stake in Bluebird Therapeutics
CARLSBAD, Calif., August 31, 2020 - Northwind Pharmaceuticals, Inc. (Nasdaq: NWPH) and Bluebird Therapeutics, Inc. (Nasdaq: BLBT) today announced a definitive agreement under which Northwind will acquire all of the outstanding shares of Bluebird it does not already own for $18.15 per share in cash.`;
    expect(parsePressRelease(rest, { filerName: "Northwind Pharmaceuticals, Inc.", filerTickers: ["NWPH"] })?.target.name).toMatch(/^Bluebird Therapeutics/);
    const skip = (headline: string) =>
      parsePressRelease(`Exhibit 99.1\n${headline}\nDENVER, May 1, 2024 - Northwind Corp. (NYSE: NWC) today announced the acquisition described above for $20 million.`, { filerName: "Northwind Corp.", filerTickers: ["NWC"] });
    expect(skip("Northwind Corp. to Acquire Majority Stake in Bluebird Bank")).toBeNull();
    expect(skip("Northwind Corp. Completes Acquisition of Seven Bluebird Savings Bank Montana Branches")).toBeNull();
    expect(skip("Northwind Corp. to Acquire Fasteners and Components Business")).toBeNull();
    expect(skip("Northwind Corp. Acquires Crypto Technology from Token IQ")).toBeNull();
  });

  it("skips a carve-out whose headline breaks at the possessive, an offer to the board, and a price adjustment", () => {
    const carve = `Exhibit 99.1
NEWS RELEASE
Allegro to Acquire Bluebird & Decker's
Access Technologies Business
DUBLIN, April 22, 2022 - Allegro plc (NYSE: ALGR) today announced it will acquire Bluebird & Decker's Access Technologies Business for $900 million.`;
    expect(parsePressRelease(carve, { filerName: "Allegro plc", filerTickers: ["ALGR"] })).toBeNull();
    const offer = `Exhibit 99.1
NORTHWIND MORTGAGE TRUST SUBMITS OFFER TO ACQUIRE BLUEBIRD MORTGAGE CAPITAL CORPORATION FOR IMPLIED PRICE OF $9.88 PER SHARE
NEW YORK, July 13, 2023 - Northwind Mortgage Trust, Inc. (NYSE: NWMT) today announced that it submitted a proposal to the Board of Directors of Bluebird Mortgage Capital Corporation (NYSE: BMC) to acquire BMC.`;
    expect(parsePressRelease(offer, { filerName: "Bluebird Mortgage Capital Corp", filerTickers: ["BMC"] })).toBeNull();
    expect(extractValue("The total transaction consideration is also subject to a downward adjustment of a maximum $110 million in the event Bluebird does not achieve certain operational milestones.")).toBeNull();
  });

  it("takes the total of cash and shares as the price, not the cash leg", () => {
    expect(
      extractPrice(
        "Bluebird shareholders will receive $3.50 per share in cash as well as 0.14625 Northwind shares for each Bluebird share held at closing, for a total consideration to Bluebird shareholders of $21.01 per share, based on the closing price of Northwind shares.",
      ),
    ).toBe(21.01);
    // Cash and a CVR: the cash is the price.
    expect(extractPrice("Bluebird stockholders will receive $14.00 per share in cash plus one contingent value right per share.")).toBe(14);
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
    // A cash-or-stock election is mixed, with the ratio written before legal words.
    expect(extractConsideration("each Common Share will be converted into the right to receive, at the election of the holder, (i) for each Common Share with respect to which a Stock Election has been made, 3.8721 fully paid and non-assessable Parent Shares; (ii) for each Common Share with respect to which a Cash Election has been made, $374.00 in cash")).toBe("Mixed");
    expect(extractConsideration("each outstanding share of Synergy will be converted into the right to receive £4.39 ($7.06) in cash and 0.4308 of a share of New STERIS.")).toBe("Mixed");
    // Warrants per share are not shares; a lump sum in cash elsewhere is the balance sheet.
    expect(extractConsideration("in all cases EP shareholders will receive 0.640 KMI warrants per share of EP common stock. The offer is comprised of $14.65 in cash and 0.4187 KMI shares.")).toBe("Mixed");
    expect(extractConsideration("Holders will receive 0.75 shares of Acme common stock for each share. At quarter end, Acme had $2.4 billion in cash.")).toBe("Stock");
    // Cerner: a cash tender offer; the employee awards converted into the buyer's stock are not the holders' price.
    expect(
      extractConsideration(
        'Merger Subsidiary will commence a cash tender offer to acquire all of the outstanding shares for a purchase price of $95.00 per share, net to the holders thereof in cash. Each RSU will be converted into a restricted stock unit denominated in shares of Oracle\'s common stock, adjusted based on an exchange ratio. In the Merger, each outstanding share will be converted into the right to receive cash in an amount equal to the Offer Price.',
      ),
    ).toBe("Cash");
    expect(extractConsideration("Thermo Fisher will acquire PPD for $47.50 per share for a total cash purchase price of $17.4 billion.")).toBe("Cash");
    // A slide deck: "72% stock (1:1 share) and 28% cash ($88.82/share)".
    expect(extractConsideration("Purchasing Norfolk Southern for an implied value of $320 per share; 72% stock (1:1 share) and 28% cash ($88.82/share)")).toBe("Mixed");
    // A tender's top-up threshold is not a share exchange; "the Offer Price in cash" is cash (Cascade).
    expect(extractConsideration("The Top-Up Option may be exercised if the Shares owned by Parent would constitute one Share more than 90% of the outstanding Shares. Each Share will be converted into the right to receive the Offer Price in cash.")).toBe("Cash");
    // "0.70 of a fully paid and nonassessable share" (TXI); fractional-share cash is not part of the price.
    expect(extractConsideration("Each share of TXI common stock will be converted into the right to receive 0.70 of a fully paid and nonassessable share of Martin Marietta common stock. No fractional shares will be issued and TXI's stockholders will receive cash in lieu of any fractional shares.")).toBe("Stock");
    expect(extractConsideration("No fractional shares of JLL Common Stock will be issued, and holders will receive cash in lieu of any fractional shares. Each HFF Share will be converted into the right to receive $24.63 in cash and 0.1505 of a share of JLL Common Stock.")).toBe("Mixed");
    // Tender releases: an ADS ratio, "all stockholders" and a count of shares tendered are not share exchanges; a cash
    // sentence that also mentions equity awards still counts (Sourcefire); "per Biohaven share in cash".
    expect(extractConsideration("Thoma Bravo will initiate a cash tender offer for $66.00 per ordinary share and ADS (each ADS representing one ordinary share) in cash.")).toBe("Cash");
    expect(extractConsideration("LabCorp would acquire Sequenom in a cash tender offer for $2.40 per share. These documents will be available to all stockholders of Sequenom free of charge.")).toBe("Cash");
    expect(extractConsideration("Astellas purchased shares of Audentes for a price of US$60.00 per share net to the seller in cash. As of the expiration, 35,852,857 shares of Audentes common stock were validly tendered.")).toBe("Cash");
    expect(extractConsideration("Under the terms of the agreement, Cisco will pay $76 per share in cash and assume outstanding equity awards.")).toBe("Cash");
    expect(extractConsideration("Biohaven shareholders will receive $148.50 per Biohaven share in cash, plus 0.5 of a share of a new publicly traded company.")).toBe("Mixed");
    // A holders' sentence that runs on into the awards still counts (Ryland).
    expect(extractConsideration("Each share of Ryland common stock will be converted and exchangeable for 1.0191 issued and outstanding shares of common stock of the Surviving Corporation, and each Ryland stock option will be converted into an option of the Surviving Corporation.")).toBe("Stock");
  });

  it("finds the offer price, not reference prices, buybacks or collar bounds", () => {
    // Beazer's earnings release: the buyback price came after the offer.
    expect(extractPrice("Beazer announced that it has entered into a definitive agreement to be acquired by Dream Finders Homes, Inc. for $33.50 per share in an all-cash transaction. During the quarter we repurchased 0.9 million shares at an average price of $23.04 per share.")).toBe(33.5);
    expect(extractPrice("Holders will receive 0.32 shares of Herman Miller for each share of Knoll. Based on Herman Miller's five-day volume weighted average price of $43.94 per share, the transaction terms imply a purchase price of $25.06 per share.")).toBe(25.06);
    expect(extractPrice("Pacer holders will receive $6.00 in cash and XPO stock (provided that this volume weighted average price is no less than $23.12 per share and no greater than $32.94 per share).")).toBeNull();
    // A floor in the offer itself counts; a top-up doesn't.
    expect(extractPrice("Sentio stockholders will receive: (i) no less than $14.37 per share in cash at the closing of the merger; (ii) up to an additional $0.55 per share in cash.")).toBe(14.37);
    // Two share classes: the first is the main one.
    expect(extractPrice("Brookfield will acquire all of the outstanding shares of common stock of Watermark for $6.768 per Class A share and $6.699 per Class T share in an all-cash transaction.")).toBe(6.768);
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

  it("pairs a label with the amount written before it, and reads only the amount's own sentence", () => {
    // Endeavor's headline.
    expect(extractValue(`Transaction at $13 Billion Equity Value and $25 Billion Consolidated Enterprise Value is Largest Private Equity Take-Private in 10 Years`)).toEqual({ usd: 13e9, kind: "equity" });
    // AMD / Xilinx: "industry" in the next sentence is not this figure's context.
    expect(extractValue(`AMD will acquire Xilinx in an all-stock transaction valued at $35 billion. The combination will create the industry's leading high performance computing company.`)).toEqual({ usd: 35e9, kind: "transaction" });
    expect(extractValue(`The global semiconductor market was valued at $600 billion in 2024.`)).toBeNull();
  });

  it("skips track records, face values and other currencies", () => {
    expect(extractValue(`Macquarie Capital's deep sector expertise in telecommunications and media sectors with 376 transactions completed, valued at $212 billion in the year ended March 31, 2020.`)).toBeNull();
    expect(extractValue(`Its equity sponsor posted record results, valued at $212 billion in the year ended March 31, 2020.`)).toBeNull();
    // A year-end in the sentence before does not matter (Asbury / Herb Chambers).
    expect(extractValue(`The Herb Chambers Companies sold approximately 50,000 vehicles during the year ended December 31, 2024. The aggregate net purchase price was $1.45 billion.`)?.usd).toBe(1.45e9);
    expect(extractValue(`Since 1988, Vestar funds have completed more than 80 investments in companies - as well as more than 200 add-on acquisitions - with a total value of approximately $50 billion.`)).toBeNull();
    expect(extractValue(`Combined, Encore and Asset Acceptance have purchased over 60 million consumer accounts with a face value of over $130 billion.`)).toBeNull();
    expect(extractValue(`The gross transaction value will be NT$6.8 billion (approximately US$223 million).`)).toBeNull();
    // A deal's own value still counts.
    expect(extractValue(`The transaction is valued at approximately $1.4 billion, including debt.`)?.usd).toBe(1.4e9);
  });
});

describe("deal adjectives and asset headlines", () => {
  it("reads 'Announces Transformative Acquisition of'", () => {
    const t = `Exhibit 99.1
Ridgeline Energy Announces Transformative Acquisition of Cobalt Midstream
PITTSBURGH, March 11, 2024 -- Ridgeline Energy Corporation ("Ridgeline") (NYSE: RDGE) and Cobalt Midstream Corporation ("Cobalt") (NYSE: CBMD) today announced that they have entered into a definitive merger agreement. Under the terms of the merger agreement, Ridgeline will acquire Cobalt in an all-stock transaction.`;
    const p = parsePressRelease(t, { filerName: "Ridgeline Energy Corporation", filerTickers: ["RDGE"] })!;
    expect(p.kind).toBe("announcement");
    expect(p.acquirer.name).toMatch(/^Ridgeline Energy/);
    expect(p.target.name).toMatch(/^Cobalt Midstream/);
  });

  it("skips assets named right after a cut-off name", () => {
    const props = `Exhibit 99.1
Harbor Offshore Announces Accretive Acquisition of Producing Properties in the Gulf of Mexico
HOUSTON, May 1, 2024 - Harbor Offshore, Inc. (NYSE: HBO) today announced that it has entered into a definitive agreement to acquire producing properties for $70 million.`;
    expect(parsePressRelease(props, { filerName: "Harbor Offshore, Inc.", filerTickers: ["HBO"] })).toBeNull();
    const list = `Exhibit 99.1
Alder Metals Announces Strategic Acquisition of Kestrel's Bauxite, Alumina, and Aluminum Assets for $4.1 billion
PITTSBURGH, January 5, 2024 - Alder Metals Corporation (NYSE: ALD) today announced a definitive agreement to acquire the assets.`;
    expect(parsePressRelease(list, { filerName: "Alder Metals Corporation", filerTickers: ["ALD"] })).toBeNull();
  });

  it("keeps a slash between letters in a name, not in dates or phone numbers", () => {
    const t = `Exhibit 99.1
Quad/Graphix to Acquire LSC Printing in All-Stock Transaction
SUSSEX, Wis., October 31, 2018 - Quad/Graphix, Inc. (NYSE: QUAX) and LSC Printing, Inc. (NYSE: LKSP) today announced that they have entered into a definitive agreement under which Quad/Graphix will acquire LSC Printing in an all-stock transaction.`;
    expect(parsePressRelease(t, { filerName: "Quad/Graphix, Inc.", filerTickers: ["QUAX"] })?.acquirer.name).toMatch(/^Quad\/Graphix/);
    const dated = `Exhibit 99.1
11/14/11 Carlyle Parts to Acquire Tri-Star Connectors, Inc.
CHARLOTTE, N.C., November 14, 2011 - Carlyle Parts Incorporated (NYSE: CYP) announced today a definitive agreement to acquire Tri-Star Connectors, Inc.`;
    expect(parsePressRelease(dated, { filerName: "Carlyle Parts Incorporated", filerTickers: ["CYP"] })?.acquirer.name ?? "").not.toMatch(/11\/14/);
  });

  it("finds the name behind a description", () => {
    const comma = `Exhibit 99.1
Hubbell Soft to Acquire B2B Intelligence Leader, Clarebit
Cambridge, MA (November 1, 2023) - Hubbell Soft, Inc. (NYSE: HBSF) announced today that it has entered into a definitive agreement to acquire Clarebit, a top B2B data provider. Clarebit's data will expand the platform. Clarebit was founded in 2015.`;
    expect(parsePressRelease(comma, { filerName: "Hubbell Soft, Inc.", filerTickers: ["HBSF"] })?.target.name).toBe("Clarebit");
    const after = `Exhibit 99.1
NXQ Agrees to Acquire Edge AI Pioneer Kinora to Redefine the Intelligent Edge
EINDHOVEN, February 10, 2025 - NXQ Semiconductors N.V. (NASDAQ: NXQI) today announced a definitive agreement to acquire Kinora, Inc. for $307 million. Kinora's processors run AI models. Kinora is based in California.`;
    expect(parsePressRelease(after, { filerName: "NXQ Semiconductors N.V.", filerTickers: ["NXQI"] })?.target.name).toMatch(/^Kinora/);
    const body = `Exhibit 99.1
FRANKLYN ELECTRIC ACQUIRES WATER TREATMENT COMPANY
Fort Wayne, IN - April 1, 2021 - Franklyn Electric Co., Inc. (NASDAQ: FRNK) announced today that it has acquired Puronix, Inc. in an all-cash transaction. Puronix makes water softeners. Puronix will join the Water Systems segment.`;
    expect(parsePressRelease(body, { filerName: "Franklyn Electric Co., Inc.", filerTickers: ["FRNK"] })?.target.name).toMatch(/^Puronix/);
  });

  it("skips a named company's business unit", () => {
    const t = `Exhibit 99.1
EMBERCO Announces Definitive Agreement to Acquire the Larkspur Space and Navigation Business
ALHAMBRA, Calif., February 15, 2022 - EMBERCO Corporation (Nasdaq: EMBR) today announced that it has entered into a definitive agreement to acquire the Space and Navigation business of Larkspur Technologies, Inc. (NYSE: LKS) for $5 million.`;
    expect(parsePressRelease(t, { filerName: "EMBERCO Corporation", filerTickers: ["EMBR"] })).toBeNull();
  });

  it("skips assets bought from a named company", () => {
    const t = `Exhibit 99.1
Harlan Midstream LP Announces Transformative Transaction
HOUSTON, October 6, 2026 - Harlan Midstream LP (NYSE: HRLM) today announced the execution of a definitive agreement with Corvex Oil to acquire DJ Basin crude oil and gas gathering and storage assets from Corvex Oil. Corvex Oil will contribute its ownership interests in Harlan Midstream.`;
    expect(parsePressRelease(t, { filerName: "Harlan Midstream LP", filerTickers: ["HRLM"] })).toBeNull();
  });

  it("ends an all-capitals target before the sub-headline", () => {
    const t = `Exhibit 99.1
BANK9 CORP. TO ACQUIRE LANTERN BANK ACQUISITION ADDS CORE FUNDING TO BANK9'S DEPOSIT BASE
OKLAHOMA CITY, October 7, 2021 - Bank9 Corp. (NASDAQ: BKNN) today announced that it has entered into a definitive agreement to acquire Lantern Bank.`;
    const p = parsePressRelease(t, { filerName: "Bank9 Corp.", filerTickers: ["BKNN"] })!;
    expect(p.target.name.toUpperCase()).toBe("LANTERN BANK");
  });

  it("names a party written as its ticker from the release's own listing", () => {
    const t = `Exhibit 99.1
NWMC Announces Strategic Acquisition of HBR
PONTIAC, Mich., December 17, 2025 - Northwest Mortgage Holdings Corporation (NYSE: NWMC) and Harbor Residential Investment Corp. (NYSE: HBR) today announced a definitive merger agreement under which NWMC will acquire HBR in an all-stock transaction valued at approximately $1.3 billion.`;
    const p = parsePressRelease(t, { filerName: "Northwest Mortgage Holdings Corporation", filerTickers: ["NWMC"] })!;
    expect(p.acquirer.name).toBe("Northwest Mortgage Holdings Corporation");
    expect(p.acquirer.ticker).toBe("NWMC");
  });

  it("takes the name after a description where the headline stops", () => {
    const t = `Exhibit 99.1
Contacts: Investor Relations 650-628-0255
Northbeam Games Completes Acquisition of Mobile Game Creator
Playdemic from Granite Media
REDWOOD CITY, California - September 20, 2021 - Today, Northbeam Games Inc. (NASDAQ: NBGM) completed its acquisition of mobile game creator Playdemic from Granite Media for $1.4 billion in cash. Northbeam Games Completes Acquisition of Mobile Game Creator Playdemic from Granite Media.`;
    const p = parsePressRelease(t, { filerName: "Northbeam Games Inc.", filerTickers: ["NBGM"] })!;
    expect(p.target.name).toBe("Playdemic");
  });

  it("skips production bought in a region", () => {
    const t = `Exhibit 99.1
Prairie Oil Corp. Announces Strategic Acquisition of Cash-Flow-Positive Production in Saskatchewan
CALGARY, November 4, 2025 - Prairie Oil Corp. (NYSE American: PROC) today announced that it has acquired producing wells in Saskatchewan.`;
    expect(parsePressRelease(t, { filerName: "Prairie Oil Corp.", filerTickers: ["PROC"] })).toBeNull();
  });

  it("takes the US-listed one of two targets, reading a dual listing", () => {
    const t = `Exhibit 99.1
Granite Royalty to Acquire Sandpiper Gold and Horizon Metals and Reinforce its Position
DENVER, COLORADO. JULY 7, 2025: GRANITE ROYALTY, INC. (NASDAQ: GRYL) announced today its entry into agreements to acquire each of Sandpiper Gold Ltd. (TSX: SPG; NYSE: SPGD) ("Sandpiper") and Horizon Metals Corp. (TSXV: HZM; OTCQB: HZMCF) ("Horizon"). Under the terms of the agreement with Sandpiper, Granite will acquire 100% of the issued share capital of Sandpiper for Granite shares, representing a premium of 17% based on the closing price of Sandpiper shares.`;
    const p = parsePressRelease(t, { filerName: "Granite Royalty, Inc.", filerTickers: ["GRYL"] })!;
    expect(p.target.name).toBe("Sandpiper Gold Ltd.");
    expect(p.target.ticker).toBe("SPGD");
  });

  it("never takes a listing that runs both parties together for one of them", () => {
    const t = `Exhibit 99.1
SKX to Acquire Kayden Corporation for $1.25 Billion
GOTHENBURG, Sweden, September 6, 2013 - SKX and Kayden Corporation (NYSE: KDN) today announced a definitive agreement under which SKX will acquire Kayden Corporation for $50.00 per share in cash.`;
    const p = parsePressRelease(t, { filerName: "Kayden Corporation", filerTickers: ["KDN"] })!;
    expect(p.acquirer.name).toBe("SKX");
    expect(p.target.name).toBe("Kayden Corporation");
  });
});
