import { describe, expect, it } from "vitest";
import { extractProxyAdvisors, extractProxyPremium, extractImpliedPerShare, meetingDateOf, parseMergerProxy, sideAdvisors } from "./proxy";

describe("meetingDateOf", () => {
  it("reads the meeting however the proxy words it", () => {
    expect(meetingDateOf("Because of this, Hess is holding a special meeting of its stockholders on May 28, 2024 to vote on the merger.", "2024-04-26")).toBe("2024-05-28");
    expect(meetingDateOf("NOTICE OF SPECIAL MEETING OF STOCKHOLDERS TO BE HELD NOVEMBER 17, 2026", "2026-10-19")).toBe("2026-11-17");
    expect(meetingDateOf("NOTICE OF SPECIAL MEETING OF STOCKHOLDERS DATE: April 30, 2026 TIME: 9:00 a.m.", "2026-03-27")).toBe("2026-04-30");
    expect(meetingDateOf("NOTICE OF EXTRAORDINARY GENERAL MEETING OF SHAREHOLDERS OF MERUS N.V. TO BE HELD TUESDAY, DECEMBER 9, 2025", "2025-11-12")).toBe("2025-12-09");
    expect(meetingDateOf("We will hold the Special Meeting of Catalent at 8:00 a.m., Eastern Time, on May 29, 2024.", "2024-04-15")).toBe("2024-05-29");
    expect(meetingDateOf("a special meeting of stockholders of LHC Group, Inc. (\"LHC\") to be held at 9:00 a.m. (Central time) on June 21, 2022", "2022-05-17")).toBe("2022-06-21");
    expect(meetingDateOf("The Spirit AeroSystems Special Meeting will be held virtually via live audio webcast at www.virtualshareholdermeeting.com/SPR2025SM, on January 31, 2025", "2024-12-20")).toBe("2025-01-31");
    expect(meetingDateOf("The first shareholder meeting, which is convened by the U.K. Court, the \"Court Meeting,\" will be held on August 9, 2022, at 8:15 a.m.", "2022-07-08")).toBe("2022-08-09");
  });
  it("takes an annual meeting only when the proxy names no other", () => {
    expect(meetingDateOf("our 2021 Annual Meeting of Stockholders (the \"Annual Meeting\"). The Annual Meeting will be held virtually on March 2, 2021.", "2021-01-29")).toBe("2021-03-02");
    expect(meetingDateOf("Our annual meeting was held on June 2, 2026. A special meeting of stockholders will be held on June 30, 2026.", "2026-05-20")).toBe("2026-06-30");
  });
  it("skips the record date, the mailing, deadlines and the board's own meetings", () => {
    expect(meetingDateOf("at the time of the Special Meeting. Only stockholders of record as of the close of business on December 2, 2026 may vote.", "2026-11-20")).toBeNull();
    expect(meetingDateOf("the enclosed notice of Special Meeting and form of proxy card, is first being mailed to stockholders on or about August 24, 2026", "2026-08-24")).toBeNull();
    expect(meetingDateOf("The special meeting. This proxy statement is dated August 15, 2026.", "2026-08-15")).toBeNull();
    expect(meetingDateOf("resolutions adopted at a special meeting of the board of directors held on August 27, 2026", "2026-08-20")).toBeNull();
    expect(meetingDateOf("before the SHBI special meeting, holders must request documents by June 12, 2026", "2026-05-08")).toBeNull();
    // A notice's own date isn't the meeting's (Electro-Sensors).
    expect(meetingDateOf("NOTICE OF SPECIAL MEETING OF SHAREHOLDERS June 25, 2026", "2026-06-20")).toBeNull();
  });
  it("skips a date before the filing or too far after it, and goes on to the next", () => {
    expect(meetingDateOf("Stockholders approved at a special meeting held on March 1, 2026 the plan.", "2026-04-01")).toBeNull();
    expect(meetingDateOf("A special meeting on March 1, 2026 approved the plan. The special meeting of stockholders will be held on May 5, 2026.", "2026-04-01")).toBe("2026-05-05");
    expect(meetingDateOf("A special meeting will be held on March 1, 2027.", "2026-04-01")).toBeNull();
  });
});

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

  it("skips a premium over a high, unaffected or not", () => {
    // Kellanova: the 33% over the 52-week high isn't read; the same 33% over the close, in the board's reasons, is.
    const kellanova = `The Merger Consideration represents a premium of approximately 44% to Kellanova's unaffected 30-trading day volume weighted average price and a premium of approximately 33% to Kellanova's unaffected 52-week high as of August 2, 2024.`;
    expect(extractProxyPremium(kellanova)).toBeNull();
    expect(extractProxyPremium(`${kellanova} • the fact that the Merger Consideration of $83.50 per share to be received by Kellanova shareowners in the Merger represents a premium of: • approximately 33% over the closing price per share as of August 2, 2024, the last full trading day prior to Reuters' published article reporting that Mars was exploring an acquisition of Kellanova (the "Unaffected Date");`)).toBe(33);
    for (const t of [
      `This is a 15 percent premium over our all time high of the undisturbed share price before the transaction leaked.`,
      `The Merger Consideration represents a 15% premium to the Company's unaffected 52-week high.`,
      `The Merger Consideration represents a 9.5% premium to the unaffected peak trading price.`,
      `The Merger Consideration represents a 7% premium to the unaffected five-year trading high.`,
    ]) expect(extractProxyPremium(t), t).toBeNull();
    // A high beside the close leaves the close standing.
    expect(extractProxyPremium(`The Merger Consideration represents a premium of 33% to the unaffected closing share price of $52.57 on March 14, 2018 and exceeds the all-time high price of $69.72 per share.`)).toBe(33);
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

describe("sideAdvisors", () => {
  const joint = `Opinion of Nicolet's Financial Advisor. Nicolet retained Stifel, Nicolaus & Company, Incorporated ("Stifel") to act as its financial advisor in connection with the merger. Opinion of County's Financial Advisor. County retained Piper Sandler & Co. ("Piper Sandler") to render a fairness opinion to its board.`;
  it("reads each side's bank under its own heading", () => {
    const s = sideAdvisors(joint, { name: "County Bancorp, Inc." }, { name: "Nicolet Bankshares, Inc.", ticker: "NIC" });
    expect(s.acquirer).toEqual(["Stifel"]);
    expect(s.target).toEqual(["Piper Sandler"]);
  });
  it("matches a heading by acronym or ticker, and skips a party that is neither company", () => {
    const t = `Opinion of AGM's Financial Advisor. Barclays Capital Inc. delivered its opinion. Opinion of the Financial Advisors to the MSGE Special Committee. Moelis & Company LLC rendered its opinion. Opinion of Party A's Financial Advisor. Goldman Sachs & Co. LLC advised Party A.`;
    expect(sideAdvisors(t, { name: "Athene Holding Ltd" }, { name: "Apollo Global Management, Inc." }).acquirer).toEqual(["Barclays"]);
    expect(sideAdvisors(t, { name: "MSG Networks Inc." }, { name: "MSG Entertainment", ticker: "MSGE" }).acquirer).toEqual(["Moelis"]);
    expect(sideAdvisors(t, { name: "Widget Inc." }, { name: "Acme Corp" }).acquirer).toEqual([]);
  });
  it("keeps the buyer's bank off the target list", () => {
    const p = parseMergerProxy(joint, "County Bancorp, Inc.", { name: "Nicolet Bankshares, Inc." });
    expect(p.acquirerAdvisors).toEqual(["Stifel"]);
    expect(p.targetAdvisors).toEqual(["Piper Sandler"]);
  });

  it("the buyer's own name is no adviser under the target's heading (TriState / Raymond James)", () => {
    const doc = `Opinion of TriState Capital's Financial Advisor (page 52 and Annex B)\nIn connection with the mergers, Stephens, Inc., TriState Capital's financial advisor, rendered an oral opinion.\nOpinion of TriState Capital's Financial Advisor\nTriState Capital engaged Stephens to act as financial adviser in connection with the proposed sale of TriState Capital to Raymond James.\n`;
    expect(sideAdvisors(doc, { name: "TriState Capital Holdings, Inc." }, { name: "Raymond James" })).toEqual({ acquirer: [], target: ["Stephens"] });
    // Must not break: the buyer's heading may name the buyer's own bank arm.
    expect(sideAdvisors(`Opinion of Raymond James's Financial Advisor\nRaymond James & Associates, Inc. rendered its opinion.\n`, { name: "TriState Capital Holdings, Inc." }, { name: "Raymond James" }).acquirer).toEqual(["Raymond James"]);
  });

  it("a cross-reference opens no section, and the next party's heading ends one (CVB / Heritage Commerce)", () => {
    const doc = `see "The Merger-Opinion of Heritage's Financial Advisor" beginning on page 79.\nOpinion of CVBF's Financial Advisor (see page 72)\nJ.P. Morgan Securities LLC acted as financial advisor to CVBF.\nOpinion of Heritage's Financial Advisor (see page 79)\nPiper Sandler & Co. acted as financial advisor to Heritage's board of directors.\n`;
    const sides = sideAdvisors(doc, { name: "Heritage Commerce Corp" }, { name: "CVB Financial Corp", ticker: "CVBF" });
    expect(sides).toEqual({ acquirer: ["JPMorgan"], target: ["Piper Sandler"] });
    // A heading naming a bank next doesn't end the party's: "Opinion of Dominion Energy's Financial Advisors / Opinion of Goldman Sachs".
    expect(sideAdvisors(`Opinion of Dominion Energy's Financial Advisors\nOpinion of Goldman Sachs & Co. LLC\nGoldman Sachs rendered its opinion.\n`, { name: "Dominion Energy, Inc" }, { name: "Nextera Energy Inc" }).target).toEqual(["Goldman Sachs"]);
    // ... and " ." before the quote is one too (Calavo's glossary).
    expect(sideAdvisors(`has the meaning set forth in " The Mergers-Opinion of Calavo's Financial Advisor ." BofA Securities, Inc. is named next.\n`, { name: "Calavo Growers Inc" }, { name: "Mission Produce, Inc." }).target).toEqual([]);
  });

  it("the loose fallback gives up the buyer's banks, not one the target retained (Shell Midstream, Manning & Napier)", () => {
    const shell = `The Conflicts Committee retained Intrepid Partners, LLC as its financial advisor. Parent also engaged Barclays Capital Inc. to serve as its financial advisor. Barclays Capital Inc. is acting as financial advisor to Shell Midstream in connection with the merger.\n`;
    expect(parseMergerProxy(shell, "Shell Midstream Partners, L.P.", { name: "Shell USA, Inc." }).targetAdvisors).toEqual([]);
    // Must not break: an "Opinion of" heading isn't touched, nor a bank the target itself retained.
    const manning = `PJT Partners LP ("PJT Partners") was retained by Company to act as its financial advisor. Representatives of Gibson Dunn, PJT Partners, Sidley Austin, Callodine's financial advisors met. PJT Partners is acting as financial advisor to Manning & Napier in connection with the mergers.\n`;
    expect(parseMergerProxy(manning, "Manning & Napier, Inc.", { name: "Callodine Group, LLC" }).targetAdvisors).toEqual(["PJT Partners"]);
    expect(extractProxyAdvisors("Opinion of Goldman Sachs & Co. LLC\nParent engaged Goldman Sachs as its financial advisor.\n", "Target Inc.", "Parent Inc.")).toEqual(["Goldman Sachs"]);
  });
});
