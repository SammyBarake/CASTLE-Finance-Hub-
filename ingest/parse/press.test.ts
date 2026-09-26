import { describe, expect, it } from "vitest";
import { extractAdvisors, extractConsideration, extractPremium, extractPrice, extractValue, parsePressRelease, splitHeadline } from "./press";

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
});

describe("term extractors", () => {
  it("ignores par values and dividends when finding the offer price", () => {
    expect(extractPrice("Each share has a par value of $0.01 per share. Holders will receive $25.00 per share in cash.")).toBe(25);
    expect(extractPrice("The board declared a dividend of $0.18 per share.")).toBeNull();
  });

  it("prefers the premium to the unaffected price", () => {
    expect(extractPremium("a premium of 20% to the 30-day VWAP and a premium of 35% to the unaffected closing price")).toBe(35);
  });

  it("reads value kind and units", () => {
    expect(extractValue("representing an enterprise value of approximately $866 million")).toEqual({ usd: 866e6, kind: "enterprise" });
    expect(extractValue("an all-cash transaction valued at approximately $7.7 billion")).toEqual({ usd: 7.7e9, kind: "transaction" });
    expect(extractValue("with $75 billion of capital under management")).toBeNull();
  });

  it("classifies consideration, including negations", () => {
    expect(extractConsideration("holders will receive $10.00 in cash and 0.5 shares of Acme common stock")).toBe("Mixed");
    expect(extractConsideration("The consideration is payable in Acme common shares. No cash consideration is payable. The exchange ratio is fixed.")).toBe("Stock");
  });

  it("assigns advisors to the right side", () => {
    const text = "Barclays is serving as exclusive financial advisor to the Special Committee. Moelis & Company LLC is acting as financial advisor to Parent.";
    expect(extractAdvisors(text, "Parent", "Target Co", "target", "TGT")).toEqual({ acquirerAdvisors: ["Moelis"], targetAdvisors: ["Barclays"] });
  });
});
