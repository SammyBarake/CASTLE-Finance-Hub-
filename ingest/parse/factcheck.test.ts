// Rules from the October 2026 fact-check of live deals against their filings. Synthetic text in the style of the
// filings, with made-up names.
import { describe, expect, it } from "vitest";
import { extractMergerPrice, withItem101Price } from "./eightk";
import { extractPremium, extractPrice, extractValue, parsePressRelease, type ParsedPress } from "./press";

describe("prices: the cash leg of cash and shares is not the price", () => {
  it("skips cash written before the shares in a merger 8-K", () => {
    const azek =
      'Item 1.01 … each share of class A common stock of the Company issued and outstanding immediately prior to the Effective Time will be canceled and converted into the right to receive $31.20 in cash, without interest, from Northwind less any applicable withholding taxes (the "Cash Consideration"), and 0.8820 shares (the "Exchange Ratio"), par value EUR 0.25 per share, of Northwind ("Northwind Shares") and cash in lieu of fractional shares (collectively, the "Merger Consideration").';
    expect(extractMergerPrice(azek)).toBeNull();
    // An all-cash price still reads.
    expect(extractMergerPrice('each share will be converted into the right to receive $42.15 in cash, without interest (the "Merger Consideration").')).toBe(42.15);
  });

  it("skips cash after the shares in a numbered list", () => {
    expect(extractMergerPrice("will be converted into the right to receive (i) one share of Parent Class A Common Stock, without interest, and (ii) $12.00 in cash, without interest.")).toBeNull();
    expect(
      extractPrice(
        "each outstanding share of Bluebird common stock will be converted into the right to receive (i) 0.7512 shares of Northwind Class A Common Stock, par value $0.01 per share, and (ii) $48.00 per share in cash, without interest.",
      ),
    ).toBeNull();
    // A cash election is worth the whole price.
    expect(
      extractMergerPrice(
        'each share will be converted into the right to receive, at the election of the shareholder, either $12.00 in cash, without interest (the "Cash Election"), or a combination of $3.00 in cash, without interest, and one Class A Share (the "Cash/Stock Election").',
      ),
    ).toBe(12);
  });

  it("skips the cash consideration of a cash-and-shares deal, not of a cash election", () => {
    expect(
      extractPrice(
        "Bluebird stockholders will have the right to elect to receive either 1.6839 shares of Northwind common stock or $28.00 in cash. Bluebird stockholders electing to receive cash consideration will receive the cash consideration of $28.00 per share of Bluebird common stock.",
      ),
    ).toBe(28);
    const proForma =
      "Northwind will pay $54.00 in cash and 0.8125 shares of Northwind Class A Common Stock for each share of Bluebird common stock. The estimated cash payment is the number of Bluebird shares outstanding multiplied by the cash consideration of $54.00 per share to be paid by Northwind pursuant to the Merger Agreement.";
    expect(extractPrice(proForma)).toBeNull();
    // In an all-cash deal the cash consideration is the price, and so is a total of stock and cash.
    expect(extractPrice("Bluebird stockholders will receive cash consideration of $54.00 per share in an all-cash transaction.")).toBe(54);
    expect(extractPrice("Based on Northwind's closing price, the implied value of the total stock and cash consideration to be received by Bluebird's stockholders in the merger is $11.35 per share.")).toBe(11.35);
  });

  it("skips a collar's bound and a debenture's conversion price", () => {
    expect(
      extractPrice(
        "Northwind to Acquire Bluebird for $33.25 per Common Share. If Northwind's average price is between $20.00 and $24.215 per share, Bluebird stockholders receive a minimum of $15.794 per share in value on the stock portion of the consideration.",
      ),
    ).toBe(33.25);
    expect(extractPrice("In certain circumstances, the Debenture is convertible at the option of Northwind into Bluebird Shares at a price of US$0.22 per Bluebird Share.")).toBeNull();
  });
});

describe("prices: other reference prices and currencies", () => {
  it("skips the value put on the buyer's own shares", () => {
    expect(
      extractPrice(
        "The purchase price consists of approximately 7 million shares of Northwind common stock, valued at $11.40 per share (i.e. the volume weighted average price per share of Northwind common stock for the 30 trading days ending on the closing date), and $25.0 million of cash.",
      ),
    ).toBeNull();
    expect(extractPrice("The stock consideration of $20.00 per share (i.e. the volume-weighted average price of Northwind common stock over the ten trading days before closing) will be paid in Northwind shares.")).toBeNull();
  });

  it("skips another dollar written with a letter prefix", () => {
    expect(extractPrice("Northwind will acquire Bluebird Energy Corp. for C$2.15 per share in cash.")).toBeNull();
    expect(extractPrice("Northwind will acquire Bluebird Energy Corp. for US$2.15 per share in cash.")).toBe(2.15);
    expect(extractMergerPrice("each share will be converted into the right to receive C$4.10 in cash, without interest.")).toBeNull();
  });

  it("reads a per share value stated at the buyer's last close", () => {
    const t =
      "As of May 1, 2026, the exchange ratio implies a total equity value of approximately $4.0 billion. This is calculated on a fully diluted basis and based on Northwind's 5-day VWAP. This represents a $15.75 per share value based on the closing price of Northwind Class A common stock as of May 1, 2026, and a premium of approximately 40% to the unaffected Bluebird closing share price.";
    expect(extractPrice(t)).toBe(15.75);
    expect(extractPrice("This represents a $15.75 per share value based on Northwind's 5-day volume-weighted average price.")).toBeNull();
  });

  it("reads the value each share is given in a cash-or-stock election", () => {
    const t =
      "The transaction values each Bluebird share at $310, representing a premium of 18.5% to Bluebird's 60-day volume-weighted average price and 22.4% to Bluebird's closing price on Friday, March 6, 2026. Bluebird stockholders may elect to receive $310 in cash or 12.4 shares of Northwind common stock for each share.";
    expect(extractPrice(t)).toBe(310);
    expect(extractPremium(t)).toBe(22.4);
  });
});

describe("premiums", () => {
  it("never takes a premium over an average, unaffected or not", () => {
    expect(
      extractPremium(
        "The purchase price of $48.10 per share represents a 21.0% premium to Bluebird Energy's unaffected 30-day volume weighted average price (VWAP) as of February 3, 2026, the day prior to an article reporting a potential sale.",
      ),
    ).toBeNull();
  });

  it("reads each figure of a list against its own reference", () => {
    expect(extractPremium("a premium of 25% to Bluebird's closing price on May 1, 2026 and 31% to its 30-day VWAP")).toBe(25);
    expect(extractPremium("The total $43.50 per share consideration represents a premium of approximately 26% over Bluebird's unaffected closing share price on February 28, 2017; approximately 14% over Bluebird's 30-day volume weighted average price.")).toBe(26);
    expect(extractPremium("The exchange ratio implies a premium of 21% based on the 20-day volume-weighted average price and 17% based on the closing price of Bluebird shares on July 3, 2025.")).toBe(17);
    // A sentence ends at a quotation too: the averages in the next one are not this premium's.
    expect(extractPremium('a premium of approximately 160% to the Company\'s unaffected share price on July 16, 2010, the last trading day prior to the proposal. "For more than two months, the Board has worked to …"')).toBe(160);
    // One reference for both figures: the averages.
    expect(extractPremium("a premium of 30% and 35% to the 30-day and 60-day volume-weighted average prices")).toBeNull();
  });

  it("skips the premium of a total that counts contingent value rights", () => {
    const t =
      'Northwind will acquire all of the outstanding shares of Bluebird for $64.00 per share in cash at closing, plus non-transferable contingent value rights ("CVRs") providing for up to $8.00 per share. The total transaction value represents a premium of 30% to Bluebird\'s unaffected 60-day VWAP, a premium of 24% to Bluebird\'s unaffected 30-day VWAP, and a premium of 17% to Bluebird\'s unaffected closing price.';
    expect(extractPremium(t)).toBeNull();
    expect(extractPremium(t + " The upfront cash payment of $64.00 per share represents a premium of 9% to Bluebird's unaffected closing price.")).toBe(9);
  });
});

describe("values", () => {
  it("skips a total that includes an earn-out", () => {
    const t =
      'Northwind Construction Group, Inc. announced today that it has entered into a definitive agreement to acquire Bluebird Paving Inc. ("Bluebird"), a leading regional site development contractor, for $212.5 million. • Selling stockholders may earn additional consideration of up to $60.0 million, payable in cash and stock, based on Bluebird\'s adjusted EBITDA for 2026, bringing total potential transaction value to approximately $272.5 million.';
    expect(extractValue(t)).toEqual({ usd: 212.5e6, kind: "transaction" });
    expect(extractValue("The transaction, including the $75 million in contingent consideration, is valued at $216 million.")).toBeNull();
    expect(extractValue("Northwind will acquire Bluebird for an aggregate transaction value of $20 million in upfront cash plus contractual rights for potential contingent payments of up to $14 million.")?.usd).toBe(20e6);
    // Nor a collar's bounds on the stock part.
    expect(extractValue("the maximum value of the Northwind common stock at closing would be approximately $11 million and the minimum value of the Northwind common stock would be approximately $9 million.")).toBeNull();
  });

  it('reads "for a purchase price of"', () => {
    expect(extractValue("Northwind has completed its acquisition of Bluebird Logistics from Atlas for a purchase price of $1.025 billion.")?.usd).toBeCloseTo(1.025e9, -3);
    expect(extractValue("Northwind acquired a portfolio of projects in Saskatchewan for $1,500,000 (CAD).")).toBeNull();
  });

  it("reads the dollars after another currency", () => {
    expect(
      extractValue(
        'Northwind Group Inc. today announced that it has acquired Bluebird Engineering Limited ("Bluebird"), a leading UK maker of road maintenance equipment for £95 million, or approximately $125,400,000, subject to customary closing adjustments. Founded in 1972, Bluebird makes gritters.',
      ),
    ).toEqual({ usd: 125.4e6, kind: "transaction" });
    expect(
      extractValue("Northwind has completed the acquisition of Bluebird, a Germany-based IT distributor focused on cloud services, for an aggregate purchase price of approximately €21.5 million ($24.1 million [1] )."),
    ).toEqual({ usd: 24.1e6, kind: "transaction" });
  });
});

describe("an 8-K read as a release takes its Item 1.01 price", () => {
  const eightK = `UNITED STATES SECURITIES AND EXCHANGE COMMISSION
FORM 8-K
BLUEBIRD DIAGNOSTICS CORPORATION
(Exact name of registrant as specified in its charter)
Item 1.01 Entry into a Material Definitive Agreement.
Agreement and Plan of Merger
On March 2, 2026, Bluebird Diagnostics Corporation, a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with Northwind Laboratories, an Illinois corporation ("Parent"), and Falcon Merger Sub, Inc., a Delaware corporation and a wholly owned subsidiary of Parent ("Merger Sub"). Pursuant to the Merger Agreement, Merger Sub will merge with and into the Company (the "Merger"), with the Company surviving as a wholly owned subsidiary of Parent.
At the effective time of the Merger, each share of common stock of the Company issued and outstanding immediately prior to the effective time will be converted into and will thereafter represent the right to receive $72.00 in cash, without interest (the "Merger Consideration").
Item 9.01 Financial Statements and Exhibits.`;
  const read: ParsedPress = {
    kind: "announcement",
    headline: "Northwind Laboratories to acquire Bluebird Diagnostics",
    acquirer: { name: "Northwind Laboratories", ticker: null, exchange: null },
    target: { name: "Bluebird Diagnostics Corporation", ticker: null, exchange: null },
    pricePerShare: null,
    premiumPct: null,
    valueUsd: null,
    valueKind: null,
    consideration: "Cash",
    acquirerAdvisors: [],
    targetAdvisors: [],
  };

  it("fills the price the release reader can't read", () => {
    expect(parsePressRelease(eightK, { filerName: "Bluebird Diagnostics Corp", filerTickers: [] })?.pricePerShare ?? null).toBeNull();
    expect(withItem101Price(read, eightK)?.pricePerShare).toBe(72);
    // Never for a private target, and never over a price the release gave.
    expect(withItem101Price({ ...read, privateTarget: true }, eightK)?.pricePerShare).toBeNull();
    expect(withItem101Price({ ...read, pricePerShare: 70 }, eightK)?.pricePerShare).toBe(70);
  });
});
