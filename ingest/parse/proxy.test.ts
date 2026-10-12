import { describe, expect, it } from "vitest";
import { extractProxyAdvisors, extractProxyPremium, extractImpliedPerShare } from "./proxy";

describe("extractProxyPremium", () => {
  it("reads the premium over the last closing price", () => {
    const t = `The merger consideration represents a premium of approximately 32% over the closing price per share of Common Stock on June 23, 2025, the last full trading day prior to the Company's announcement of its entry into the Merger Agreement, and (ii) a premium of approximately 23% over the volume-weighted average price for the 30 trading days.`;
    expect(extractProxyPremium(t)).toBe(32);
  });

  it("prefers the unaffected price and skips VWAP premiums", () => {
    const t = `a premium of approximately 113% over the volume-weighted average closing share price for the 30-trading day period. The price represents a premium of approximately 65% over Olo's unaffected share price on NYSE of $6.21.`;
    expect(extractProxyPremium(t)).toBe(65);
  });

  it("skips premiums of earlier proposals in the background section", () => {
    const t = `The proposed price per share represented a premium of approximately 21% over $46.41, the closing price for shares of our common stock on the NYSE on such date. The Merger Consideration represents a premium of approximately 25% over the closing price for shares of our common stock on the Unaffected Date.`;
    expect(extractProxyPremium(t)).toBe(25);
    const avid = `the Merger Consideration of $12.50 per share constituted a premium of approximately 63.8% to the closing price of Avid's common stock of $7.63 on June 4, 2024, the last trading day prior to GHO's initial proposal.`;
    expect(extractProxyPremium(avid)).toBeNull();
  });

  it("skips premiums over the 52-week high", () => {
    const t = `The Merger Consideration represents an implied premium of approximately 3% to the highest closing price of the common stock during the fifty-two (52)-week period prior to the Unaffected Date.`;
    expect(extractProxyPremium(t)).toBeNull();
  });

  it("ignores precedent statistics and ranges", () => {
    const t = `Goldman Sachs reviewed a median premium of 44% over the closing price of targets. QXO proposed a premium of 20% to 30% over the undisturbed share price. The median premium of 30% to the unaffected price was noted.`;
    expect(extractProxyPremium(t)).toBeNull();
  });

  it("reads the other ways proxies state the premium", () => {
    // "N% premium over", bullet lists after "premium of approximately:", "(i) approximately N% to", "based on".
    expect(extractProxyPremium(`the fact that the Offer Price represents (i) an approximately 61% premium over the closing price per Share on January 3, 2025, the last full trading day prior to the public announcement`)).toBe(61);
    expect(extractProxyPremium(`$19.00 per share price of Company common stock to be paid in cash, which represented a premium of approximately: • 125% over the closing stock price on July 18, 2025, the last full trading day prior to the Board's approval of the merger; • 111% over the 60-day volume-weighted average trading price`)).toBe(125);
    expect(extractProxyPremium(`A: The merger consideration represents a premium of (i) approximately 68% to Vimeo's closing stock price of company common stock on September 9, 2025, the last trading day before the announcement`)).toBe(68);
    expect(extractProxyPremium(`• The proposed consideration is at a premium above TrueCar's stock price: • approximately 78% above the closing price per share of TrueCar's Common Stock on October 13, 2025 (the last trading day prior to the public announcement of the Merger);`)).toBe(78);
    expect(extractProxyPremium(`the consideration to be paid pursuant to the Merger Agreement represented: • a premium of 36.0% based on the closing price per share of Common Stock on July 8, 2025 of $16.91`)).toBe(36);
  });

  it("keeps the board's reasons, whatever their introduction says", () => {
    // The list's introduction ("… be submitted to the shareholders …") is not a bid; a later VWAP figure isn't this one's.
    const faro = `The Board unanimously (iii) directed that the Merger Agreement be submitted to the shareholders of FARO for its approval and (iv) recommended that FARO's shareholders vote to adopt the Merger Agreement: • the fact that the Merger Consideration represents an implied premium of approximately 40% over the closing price of FARO common stock on May 5, 2025, the latest trading day before the Merger Agreement was entered into, and approximately 61% over the 30-day average;`;
    expect(extractProxyPremium(faro)).toBe(40);
    // "the proposed Cash Consideration" is the deal's own consideration.
    expect(extractProxyPremium(`• the fact that the proposed Cash Consideration of $3.25 per Share represented a premium of approximately 213% over the closing price of $1.04 per Share on October 27, 2023, the last full day of trading before the Company announced the transaction;`)).toBe(213);
    // Two trading days before the announcement is still the unaffected price.
    expect(extractProxyPremium(`the $1.14 per share to be received in the merger represents a premium of approximately 20% over the closing price per share as of February 2, 2024, two trading days before the public announcement of the merger`)).toBe(20);
  });

  it("skips bids, ranges and stale prices from the background", () => {
    for (const t of [
      `The March 28 Offer represented a 65% premium to the closing share price of the Company's common stock of $11.53 on March 27, 2025.`,
      `Party A's March 26th Offer represented a 50% premium to the Company's $3.01 closing price per share on March 26, 2025.`,
      `BDT was prepared to increase its offer price to $7.50 per Class A Share in cash, which represented a 49% premium to the closing price of the Class A Shares on October 24, 2022.`,
      `Blackstone submitted a revised proposal to acquire all of our outstanding common stock for $63.00 per share in cash (representing an approximate 16% premium to the $54.41 per share closing price of the Company's common stock on March 24, 2022).`,
      `a price of $3.00 - $3.75 per share (which represented a 121% - 176% premium to the closing share price of UpHealth Common Stock on August 21, 2023 of $1.36)`,
      `On October 16, 2025, K-C delivered a revised proposal of 0.1586 shares plus $4.00 in cash per share, representing (i) an implied nominal value of $23.02 per share and (ii) a premium of approximately 41.6% over the $16.26 closing price of Kenvue common stock as of October 15, 2025.`,
      `• a premium of approximately 42.4% to the closing price of Castlight's common stock on December 6, 2021, the trading date approximately one month prior to the Agreement Date;`,
      `the per-share merger consideration constituted a premium of: • approximately 7% premium over the Company's all-time high closing stock price on August 28, 2025`,
    ]) expect(extractProxyPremium(t), t.slice(0, 50)).toBeNull();
    // A bid named by its amount (HNI's successive proposals for Kimball).
    expect(extractProxyPremium(`The $11.00 transaction consideration represented a premium of approximately 49% over the November 16, 2022 closing sale price of Kimball common stock.`)).toBeNull();
    // A list item after one about the deal itself still counts ("the fact that the Offer Price offered a significant premium …").
    expect(extractProxyPremium(`the fact that the Offer Price offered a significant premium to the Shares based on then-current and historical market prices, including: • a premium of approximately 26.5% to the closing price of Castlight's common stock on January 3, 2022, the trading date immediately prior to the Agreement Date; • a premium of approximately 42.4% to the closing price on December 6, 2021, the trading date approximately one month prior to the Agreement Date;`)).toBe(26.5);
  });
});

describe("extractProxyAdvisors", () => {
  it("reads fairness-opinion headings", () => {
    const t = `Opinion of Goldman Sachs & Co. LLC (page 50)\nOpinion of the Company's Financial Advisor\nOpinion of Houlihan Lokey Capital, Inc., dated July 1, 2025`;
    expect(extractProxyAdvisors(t, "Olo Inc.")).toEqual(expect.arrayContaining(["Goldman Sachs"]));
  });

  it("skips the other side's advisor heading and reads the board's opinion", () => {
    const t = `Opinion of Viper's Financial Advisor\nOpinion of Sitio's Financial Advisor. The Sitio Board considered the opinion of J.P. Morgan, dated June 2, 2025.`;
    expect(extractProxyAdvisors(t, "Sitio Royalties Corp.")).toEqual(["JPMorgan"]);
  });
});

describe("premium wordings", () => {
  it("reads 'percent', a colon list, 'compared to', 'relative to' and 'per share, based on'", () => {
    expect(extractProxyPremium("Q: How does the per share price compare to the market price? A: This amount constitutes (1) a premium of approximately 47 percent to the closing price of our common stock on March 24, 2022, the last full trading day prior to the public announcement of the merger.")).toBe(47);
    expect(extractProxyPremium("• The attractive value of the Merger Consideration, which constitutes a premium of: • approximately 20.4% above the closing price per share of Common Stock on August 4, 2023 (the last trading day prior to public announcement of the Merger); and • approximately 30.9% above the 30-day volume weighted average price.")).toBe(20.4);
    expect(extractProxyPremium("The $17.12 per Share represents a compelling premium of approximately (i) 34% compared to the closing price of the Company common stock of $12.78 on September 9, 2025, the last trading day before the public announcement of the merger agreement.")).toBe(34);
    expect(extractProxyPremium("The merger consideration payable to our shareholders represents a premium of approximately 19% relative to the unaffected closing price for shares of our common stock on December 4, 2023.")).toBe(19);
    expect(extractProxyPremium("• that the per share merger consideration represents a premium of 28% per share, based on the closing prices of Spirit common stock on November 17, 2021, the last trading day before the public announcement of the merger;")).toBe(28);
  });
});

describe("extractImpliedPerShare", () => {
  it("reads a stock deal's value per share at announcement", () => {
    expect(extractImpliedPerShare("Based on the closing price of Extra Space common stock of $156.93 on March 31, 2023, the last trading day before public announcement of the proposed transaction, the exchange ratio represented approximately $145.82 in Extra Space common stock for each share of Life Storage common stock.")).toBe(145.82);
    expect(extractImpliedPerShare("Based on the closing price of Fulton common stock on March 1, 2022, the last trading day before the public announcement of the signing of the merger agreement, the value of the per share merger consideration payable to holders of Prudential shares was $17.52. Based on the closing price of Fulton common stock on May 2, 2022, the latest practicable trading day before the date of this proxy statement/prospectus, the value of the per share merger consideration was $16.10.")).toBe(17.52);
  });
  it("ignores the latest practicable date and ranges", () => {
    expect(extractImpliedPerShare("Based on the closing price of Acme common stock on May 2, 2022, the latest practicable trading day before the date of this proxy statement, the exchange ratio represented approximately $16.10 for each share of Widget common stock.")).toBeNull();
    expect(extractImpliedPerShare("Based on the range of trading prices of Acme common stock during the period after March 31, 2023, the last trading day before the public announcement, the exchange ratio represented a market value ranging from $128.31 to $147.20 for each share.")).toBeNull();
  });
});
