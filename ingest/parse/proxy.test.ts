import { describe, expect, it } from "vitest";
import { extractProxyAdvisors, extractProxyPremium } from "./proxy";

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
