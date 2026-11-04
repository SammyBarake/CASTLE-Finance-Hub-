// Rules from the October 2026 fact-check of live deals against their filings. Synthetic text in the style of the
// filings, with made-up names.
import { describe, expect, it } from "vitest";
import { extractMergerPrice, parseMergerItem, withItem101Price } from "./eightk";
import { extractAdvisors, extractConsideration, extractPremium, extractPrice, extractValue, isCarveOut, parsePressRelease, type ParsedPress } from "./press";
import { jointBuyers } from "./sponsor";

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

describe("consideration", () => {
  it("never reads the surviving company's or a subsidiary's own shares as the price, across a par value", () => {
    // A cash deal whose holders' sentence runs on through the clauses for the merger sub's and subsidiaries' shares.
    expect(
      extractConsideration(
        'At the effective time, (b) each share of common stock of the Company will be converted into the right to receive $23.50 in cash, without interest, and (f) each share of common stock of Merger Subsidiary will automatically be converted into and become one share of common stock, par value $0.01 per share, of the Surviving Corporation.',
      ),
    ).toBe("Cash");
    // A reincorporation step first, then the share exchange with its cash leg.
    expect(
      extractConsideration(
        "First, each share of Bluebird common stock will be converted into the right to receive one share of common stock, par value $0.01 per share, of the Bluebird Subsidiary. Then each share of the Bluebird Subsidiary will be exchanged for 2.0548 ordinary shares of Northwind and $48.75 in cash.",
      ),
    ).toBe("Mixed");
  });

  it("reads cash and equity written as amounts or a combination", () => {
    expect(extractConsideration("The total consideration for the transaction will consist of approximately $1.89 billion of cash, subject to customary adjustments, and $82 million in equity.")).toBe("Mixed");
    expect(extractConsideration("Upon closing, Bluebird shareholders will receive a cash payment of $350 million and 5 million shares of Northwind, Inc. common stock.")).toBe("Mixed");
    expect(extractConsideration("The purchase price is comprised of a combination of Northwind equity and cash, consisting of approximately 9 million shares of Northwind common stock.")).toBe("Mixed");
    expect(extractConsideration("Northwind completed its acquisition of Bluebird Holdings, Inc. for approximately $1.45 billion in upfront cash.")).toBe("Cash");
    // A buyback's share count is not consideration.
    expect(extractConsideration("During the quarter the Company repurchased 5 million shares of its common stock.")).toBeNull();
  });
});

describe("consideration: amounts, lists and what is not the price", () => {
  it("reads each leg written as an amount or a share count", () => {
    expect(extractConsideration("Bluebird shareholders will receive consideration of $3.65 billion in cash and $1.55 billion in Northwind Exchange common shares.")).toBe("Mixed");
    expect(extractConsideration("The transaction consideration will consist of approximately 117.3 million shares of Northwind common stock and $8 billion of cash, subject to customary adjustments.")).toBe("Mixed");
    expect(extractConsideration("Bluebird common stockholders will receive a cash payment equal to a 15.75% premium to Bluebird's diluted book value per share and shares of Northwind common stock.")).toBe("Mixed");
    // Cash paid for the stock is cash.
    expect(extractConsideration("Northwind has acquired Bluebird for a total consideration of approximately $57 million in cash for the stock of the company.")).toBe("Cash");
  });

  it("skips financing and dividend payments", () => {
    // How the offer is paid for is not what holders receive.
    expect(extractConsideration("The additional consideration payable under the revised terms would be financed with an additional $25.0 million in equity from funds advised by Northwind.")).toBeNull();
    // A dividend make-whole in an all-stock deal.
    expect(
      extractConsideration(
        "Each share of Bluebird common stock will be converted into 0.75 shares of Northwind common stock. In addition, if Northwind pays a cash dividend before the closing, each share of Bluebird common stock will also be entitled to receive a cash payment equal to the dividend.",
      ),
    ).toBe("Stock");
    // "Market share" is not shares: "approximately two share points in the category".
    expect(extractConsideration("The purchase price will be satisfied through $4 million in cash at closing. These brands represent approximately two share points in the category.")).toBe("Cash");
  });

  it("reads legs written loosely, further on, or in full", () => {
    expect(extractConsideration("Total consideration of $360 million is comprised of $335 million cash and $25 million of Northwind common stock.")).toBe("Mixed");
    expect(
      extractConsideration(
        "Northwind will acquire Bluebird for a purchase price of approximately $500 million, consisting of approximately $425 million in cash, subject to customary adjustments for working capital, transaction expenses, cash and indebtedness, and approximately $75 million in Northwind common stock.",
      ),
    ).toBe("Mixed");
    expect(extractConsideration("The purchase price includes $11.3 million in cash and approximately $6.8 million worth of Northwind common stock.")).toBe("Mixed");
    expect(extractConsideration("Consideration for the transaction consists of 43.8 million Northwind shares and $212.5 million in cash.")).toBe("Mixed");
    expect(extractConsideration("Total consideration consists of $3.5 million in cash and 3,067,179 shares of Northwind common stock.")).toBe("Mixed");
    expect(extractConsideration("Upon closing, Bluebird's owner will receive total consideration comprised of approximately $688 million in cash and approximately 62.5 million Northwind common shares.")).toBe("Mixed");
  });

  it("reads past an earn-out's sentence to the upfront one", () => {
    expect(
      extractConsideration(
        "Bluebird shareholders will also be eligible to receive contingent consideration consisting of 12.5 million shares of Northwind common stock. At closing, Bluebird shareholders will receive $30 million in cash and 37.5 million shares of Northwind common stock.",
      ),
    ).toBe("Mixed");
  });

  it("never reads a dollar amount, a count the price is worked out on, excluded shares or an offering as shares paid", () => {
    expect(
      extractConsideration(
        "Northwind will commence a tender offer for all outstanding shares of Bluebird for a purchase price of $14.92 per share in cash, plus one contingent value right, for a total potential consideration of up to $126.56 per share in cash (an aggregate of up to approximately $309.6 million excluding shares held by Northwind).",
      ),
    ).toBe("Cash");
    expect(extractConsideration("An affiliate of Northwind will commence an all-cash tender offer. The aggregate purchase price for the equity of Bluebird is approximately $294 million (which consists of approximately 35.9 million shares, inclusive of all shares of common stock).")).toBe("Cash");
    expect(
      extractConsideration(
        "Each share of common stock of the Company (subject to certain exceptions, including shares of Common Stock owned by the Company, Merger Sub or Parent and shares of Common Stock owned by stockholders who have demanded appraisal rights) will be converted into the right to receive $61.00 in cash.",
      ),
    ).toBe("Cash");
    expect(extractConsideration("Northwind will pay $9.00 per share in cash. Northwind funded the transaction with cash on hand and the proceeds of a public offering of 11,075,000 shares of common stock.")).toBe("Cash");
  });
});

describe("advisers", () => {
  const advisers = (text: string, acq = "Northwind Corporation", tgt = "Bluebird Holdings, Inc.") => extractAdvisors(text, acq, tgt, null, null);

  it("credits a buyer's special committee to the buyer", () => {
    const r = advisers("Barclays Capital are acting as financial advisors to the Special Committee of the Board of Directors of Northwind and Cleary Gottlieb is serving as legal counsel.");
    expect(r.acquirerAdvisors).toEqual(["Barclays"]);
    expect(r.targetAdvisors).toEqual([]);
  });

  it('gives "also acting as financial advisors" the previous recipient', () => {
    const r = advisers("Centerview Partners LLC is acting as lead financial advisor to Northwind, and Citi, M. Klein & Company and LionTree Advisors are also acting as financial advisors. Evercore is serving as financial advisor to Bluebird.");
    expect(r.acquirerAdvisors).toEqual(["Centerview", "Citigroup", "M. Klein and Company", "LionTree"]);
    expect(r.targetAdvisors).toEqual(["Evercore"]);
  });

  it('reads banks credited without the words "financial advisor"', () => {
    expect(advisers("Morgan Stanley is acting as lead financial advisor to Northwind. Northwind is also being advised by Goldman Sachs, Citi and Mizuho.").acquirerAdvisors).toEqual(["Morgan Stanley", "Goldman Sachs", "Citigroup", "Mizuho"]);
    expect(advisers("Evercore acted as lead financial advisor, J.P. Morgan Securities LLC also advised Bluebird.").targetAdvisors).toEqual(["Evercore", "JPMorgan"]);
  });

  it("finds the recipient written first, last or as a defined name", () => {
    expect(advisers("For Bluebird, Evercore is serving as lead financial advisor and Latham & Watkins as deal counsel.").targetAdvisors).toEqual(["Evercore"]);
    expect(
      advisers(
        "UBS Investment Bank is acting as lead financial advisor, Goldman Sachs and J.P. Morgan are acting as co-lead financial advisors, Citi and Wells Fargo are acting as financial advisors, Davis Polk & Wardwell LLP is acting as legal counsel and Bass Berry & Sims PLC is acting as healthcare regulatory counsel to Northwind.",
      ).acquirerAdvisors,
    ).toContain("UBS");
    expect(advisers('Northwind has agreed to acquire Bluebird Holdings, Inc., which operates as Bluebird Group ("BBG"). Morgan Stanley & Co. LLC acted as financial advisor to BBG.').targetAdvisors).toEqual(["Morgan Stanley"]);
    expect(advisers("Advisors Northwind's financial advisor is Morgan Stanley & Co. LLC and Paul, Weiss is serving as legal advisor.").acquirerAdvisors).toEqual(["Morgan Stanley"]);
  });

  it("ties a defined name to its own party only", () => {
    // A shared first word is not the same company, nor is the other party's name run in front.
    expect(advisers('Community Health Systems, Inc. ("CHS") will acquire Health Management Associates. Goldman Sachs is serving as financial advisor to CHS.', "Community Health Systems, Inc.", "Health Management Associates, Inc.").acquirerAdvisors).toEqual(["Goldman Sachs"]);
    expect(advisers('The merger agreement, by and among Bluebird, Northwind Corporation ("Northwind") and Merger Sub, was approved. Morgan Stanley & Co. LLC acted as exclusive financial advisor and Davis Polk acted as legal advisor to Northwind Corporation.').acquirerAdvisors).toEqual(["Morgan Stanley"]);
    expect(advisers('Beacon Roofing Supply, Inc. ("Beacon") will acquire Roofing Supply Group ("RSG"). Citi is serving as financial advisor to Beacon.', "Beacon Roofing Supply, Inc.", "Roofing Supply Group").acquirerAdvisors).toEqual(["Citigroup"]);
  });

  it("reads each passive clause for its own party, never across a sentence", () => {
    const r = advisers("Lazard served as financial advisor to Bluebird. Northwind was advised by Dechert LLP and Bluebird was advised by RBC Capital Markets.");
    expect(r.acquirerAdvisors).toEqual([]);
    expect(r.targetAdvisors).toEqual(["Lazard", "RBC Capital Markets"]);
    expect(advisers("Evercore is acting as financial advisor to Bluebird. Northwind is advised by Goldman Sachs.").acquirerAdvisors).toEqual(["Goldman Sachs"]);
  });

  it("takes the first recipient that is a party, and ends the sentence after Inc.", () => {
    expect(advisers("Goldman Sachs & Co. LLC and Moelis & Company LLC served as financial advisors, Wachtell served as legal counsel to Bluebird, and Gibson, Dunn served as counsel to Northwind.").targetAdvisors).toEqual(["Goldman Sachs", "Moelis"]);
    const r = advisers("Keefe, Bruyette & Woods, Inc. served as financial advisor and Womble provided legal counsel to Northwind Corporation, Inc. Sandler O'Neill served as legal counsel to Bluebird Holdings, Inc.");
    expect(r.acquirerAdvisors).toEqual(["Stifel"]);
  });

  it("leaves an \"also\" without a party, and reads buy-side", () => {
    expect(advisers("Morgan Stanley is acting as lead financial advisor to the consortium. Citi is also acting as financial advisor. Evercore is serving as financial advisor to Bluebird.").targetAdvisors).toEqual(["Evercore"]);
    expect(advisers("UBS Investment Bank is acting as lead buyside financial advisor.").acquirerAdvisors).toEqual(["UBS"]);
  });

  it("credits only the adviser of its own clause", () => {
    // Not the parent named beside it, nor a bank named for a financing role, nor a research-coverage list.
    expect(advisers("Greenhill, a Mizuho affiliate, served as financial advisor and Troutman Pepper served as legal advisor to Northwind.").acquirerAdvisors).toEqual(["Greenhill"]);
    expect(advisers("B. Riley Securities, Inc. is acting as capital markets advisor and private placement agent to Northwind, and Raymond James & Associates, Inc. is acting as Northwind's financial advisor.").acquirerAdvisors).toEqual(["Raymond James"]);
    expect(advisers("The following firms provide research coverage: • Raymond James & Associates, Inc. • Robert W. Baird & Co. Additional Information Keefe Bruyette & Woods served as financial advisor to Bluebird.").targetAdvisors).toEqual(["Stifel"]);
  });

  it("knows real estate and bank boutiques", () => {
    expect(advisers("Olsen Palmer LLC is serving as exclusive financial advisor and rendered a fairness opinion to Bluebird's board of directors.").targetAdvisors).toEqual(["Olsen Palmer"]);
    expect(advisers("Goldman Sachs & Co. LLC, Wells Fargo, and Eastdil Secured are serving as financial advisors to Northwind.").acquirerAdvisors).toEqual(["Goldman Sachs", "Wells Fargo", "Eastdil Secured"]);
  });
});

describe("joint buyers", () => {
  it("names every firm in a list", () => {
    expect(jointBuyers('Ironwood Inc. (" Ironwood ") and TPG Capital (" TPG "). Parent has obtained equity financing commitments')).toBe("Ironwood and TPG");
    expect(jointBuyers("Permira Advisers LLC, Warburg Pincus LLC, Francisco Partners Management, L.P. and Temasek Holdings (Private) Limited have committed to provide Parent")).toBe("Permira, Warburg Pincus, Francisco Partners and Temasek");
    expect(
      jointBuyers('The Public Investment Fund (" PIF "), private investment funds affiliated with Silver Lake Group, L.L.C. (" Silver Lake ") and private investment funds affiliated with Affinity Partners (" Affinity ," and, together with PIF and Silver Lake, the " Consortium ").'),
    ).toBe("PIF, Silver Lake and Affinity Partners");
  });

  it("keeps one firm alone", () => {
    expect(jointBuyers('Clayton, Dubilier & Rice, LLC ("CD&R"), and Anchor Merger Sub, Inc.')).toBeNull();
    expect(jointBuyers('Headwater Investments, LLC ("Headwater"), J. Bryan King and their respective affiliates.')).toBeNull();
    expect(jointBuyers("Thoma Bravo, L.P. and its affiliates")).toBeNull();
  });

  it("names joint sponsors behind a merger 8-K's vehicle", () => {
    const p = parseMergerItem(
      'Item 1.01 Entry into a Material Definitive Agreement. On October 20, 2026, Bluebird Holdings, Inc. (the "Company") entered into an Agreement and Plan of Merger (the "Merger Agreement") with Hopper Parent Inc., a Delaware corporation ("Parent"), and Hopper Merger Sub Inc., a Delaware corporation and wholly owned subsidiary of Parent ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company. Parent and Merger Sub are affiliates of funds managed by Ironwood Inc. (" Ironwood ") and TPG Capital (" TPG "). Each share will be converted into the right to receive $76.00 in cash.',
      { filerName: "Bluebird Holdings, Inc.", filerTickers: [] },
    );
    expect(p?.acquirer.name).toBe("Ironwood and TPG");
  });
});

describe("announcement dates", () => {
  const release = (body: string) => parsePressRelease(body, { filerName: "Northwind Group, Inc.", filerTickers: [] });

  it("reads a release's dateline and the announcement a completion refers back to", () => {
    expect(
      release(
        "Northwind Group to Acquire Bluebird Construction\nRaleigh, North Carolina - October 13, 2026 - Northwind Group, Inc. (NYSE: NWG) announced today that it has entered into a definitive agreement to acquire Bluebird Construction Inc., a privately held contractor, for $357.5 million.",
      )?.announcedOn,
    ).toBe("2026-10-13");
    expect(
      release(
        "Northwind Group Completes Acquisition of Bluebird B.V.\nTORONTO, Oct. 15, 2026 - Northwind Group, Inc. (NASDAQ: NWG) announced today that it has completed its previously announced acquisition of Bluebird B.V. Under the terms of the share purchase agreement announced on December 9, 2025, as amended, Northwind acquired all the outstanding shares of Bluebird.",
      )?.announcedOn,
    ).toBe("2025-12-09");
  });

  it("reads the signing date an Item 1.01 states", () => {
    const p = parseMergerItem(
      'Item 1.01 Entry into a Material Definitive Agreement. On February 3, 2026, Bluebird Financial Corporation (the "Company") entered into an Agreement and Plan of Merger (the "Merger Agreement") with Northwind Bancorp, Inc. ("Parent") and Northwind Merger Sub, Inc. ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company. Each share will be converted into the right to receive $48.75 in cash.',
      { filerName: "Bluebird Financial Corporation", filerTickers: [] },
    );
    expect(p?.signedOn).toBe("2026-02-03");
    // The signing isn't the announcement: only a release says when that was.
    expect(p?.announcedOn).toBeUndefined();
    expect(p?.item101).toBe(true);
  });

  it("reads the release an 8-K says went out, in its text or its exhibit list", () => {
    const body = 'Item 1.01 Entry into a Material Definitive Agreement. On February 1, 2026, Bluebird Financial Corporation (the "Company") entered into an Agreement and Plan of Merger (the "Merger Agreement") with Northwind Bancorp, Inc. ("Parent") and Northwind Merger Sub, Inc. ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company. Each share will be converted into the right to receive $48.75 in cash. ';
    const ctx = { filerName: "Bluebird Financial Corporation", filerTickers: [] };
    expect(parseMergerItem(body + "Item 7.01 Regulation FD Disclosure. On February 2, 2026, the Company issued a press release announcing the Merger.", ctx)?.announcedOn).toBe("2026-02-02");
    expect(parseMergerItem(body + "Item 9.01 Exhibits. 99.1 Joint Press Release, dated February 2, 2026, regarding the Merger Agreement.", ctx)?.announcedOn).toBe("2026-02-02");
    // Not its results, and not a release from before the signing.
    expect(parseMergerItem(body + "Item 2.02. On February 2, 2026, the Company issued a press release announcing its financial results for the quarter ended December 31, 2025 and the Merger.", ctx)?.announcedOn).toBeUndefined();
    expect(parseMergerItem(body + "On January 12, 2026, the Company issued a press release about the strategic review and the transaction process.", ctx)?.announcedOn).toBeUndefined();
  });

  it("states an amendment's signing date, so a later filing reads as an update", () => {
    const p = parseMergerItem(
      'Item 1.01 Entry into a Material Definitive Agreement. On June 18, 2025, Bluebird Solar Group Ltd (the "Company") entered into an Agreement and Plan of Merger (as amended, the "Merger Agreement") with Northwind Vitra Ltd. ("Parent") and Northwind Sub Ltd. ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company.',
      { filerName: "Bluebird Solar Group Ltd", filerTickers: [] },
    );
    expect(p?.signedOn).toBe("2025-06-18");
  });
});

describe("scope", () => {
  const release = (body: string) => parsePressRelease(body, { filerName: "Northwind Energy Inc.", filerTickers: [] });

  it("marks a target listed abroad only, and reads its name after a comma", () => {
    const p = release(
      'Northwind Announces Agreement to Acquire Montney Oil Producer,\nBluebird Energy Corp.\nCALGARY, Alberta, Oct. 26, 2026 - Northwind Energy Inc. (NYSE: NWE) announced today that it has entered into a definitive agreement to acquire Bluebird Energy Corp. ("Bluebird") (TSXV: BLU) for approximately $1.0 billion.',
    );
    expect(p?.target.name).toBe("Bluebird Energy Corp.");
    expect(p?.targetListedAbroad).toBe(true);
  });

  it("joins a headline's business word on the next line, which makes it a carve-out", () => {
    expect(
      release(
        "Northwind Energy Signs Definitive Agreement to Acquire Bluebird Distributors\nBusiness\nNEW YORK, Oct. 23, 2026 - Northwind Energy Inc. (NYSE: NWE) announced today that it has signed a definitive agreement to acquire the managed services business of Bluebird Distributors.",
      ),
    ).toBeNull();
  });
});

describe("landing-page review: numbers a banker would catch", () => {
  it("a buyer described as a firm's portfolio company doesn't hide the deal's value; a firm's holdings still do", () => {
    expect(extractValue("Proofpoint, a portfolio company of Thoma Bravo, will acquire Harlow Systems in a transaction valued at approximately $6.3 billion.")?.usd).toBe(6.3e9);
    expect(extractValue("Thoma Bravo's portfolio companies have a total value of approximately $50 billion.")).toBeNull();
  });

  it("the combined companies' enterprise value isn't the price", () => {
    expect(extractValue("The merger will create a leader, with an enterprise value for the combined companies of approximately $17 billion.")).toBeNull();
  });

  it("the buyer's share price that a stock deal is worked out from isn't the offer price", () => {
    expect(extractPrice("Holders of Target will receive 7,692,308 shares of Buyer common stock (determined as $200 million divided by $26.00 per share).")).toBeNull();
    expect(extractPrice("Stockholders will receive $26.00 per share in cash.")).toBe(26);
  });

  it("the value's own words name its kind, and a ceiling isn't a price", () => {
    expect(extractValue("The transaction values Harlow at an enterprise value of approximately $55 billion.")).toEqual({ usd: 55e9, kind: "enterprise" });
    expect(extractValue("The transaction values Harlow at an equity value of approximately $4 billion.")).toEqual({ usd: 4e9, kind: "equity" });
    expect(extractValue("in an all-stock transaction valued at up to $1.3 billion. The acquisition extends the platform.")).toBeNull();
  });

  it("a refinery or a plant bought from someone isn't a company", () => {
    expect(isCarveOut("Valero to Acquire Former Houston Refinery from LyondellBasell", "", "Former Houston")).toBe(true);
    expect(isCarveOut("Acme to Acquire Plant Therapeutics from its founders", "", "Plant Therapeutics")).toBe(false);
  });
});
