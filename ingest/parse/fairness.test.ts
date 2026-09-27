import { describe, expect, it } from "vitest";
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

describe("methodFor", () => {
  it("prefers the sentence, then the paragraph's run-in heading, then the heading above", () => {
    expect(methodFor("Discounted Cash Flow Analysis\nsome text", "indicated price targets ranging from")).toBe("Analyst price targets");
    expect(methodFor("Discounted Cash Flow Analysis\nPrecedent Premia Paid Analysis. Centerview applied a range which resulted in", "which resulted in")).toBe("Premiums paid");
    expect(methodFor("Selected Precedent Transactions Analysis\n47\n​The results were applied, which resulted in", "which resulted in")).toBe("Precedent transactions");
  });
});
