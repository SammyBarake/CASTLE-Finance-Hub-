import { describe, expect, it } from "vitest";
import { parseDealTerms, saneFee } from "./terms";

const names = { target: "ACV Auctions Inc.", acquirer: "Copart, Inc." };

describe("parseDealTerms", () => {
  it("reads both fees from defined terms and payers, a no-shop and no financing condition", () => {
    const t = parseDealTerms(
      `Item 1.01 Entry into a Material Definitive Agreement. The Company has agreed to customary non-solicitation restrictions. The Merger is not subject to a financing condition.
       Upon termination of the Merger Agreement under specified circumstances, including a change in the recommendation of the Company Board, the Company will be required to pay Parent a termination fee of $57.7 million (the "Company Termination Fee").
       If the Merger Agreement is terminated because required regulatory approvals are not obtained, Parent will be required to pay the Company a termination fee of $115.3 million (the "Parent Termination Fee").`,
      names,
    );
    expect(t).toMatchObject({ targetFeeUsd: 57.7e6, reverseFeeUsd: 115.3e6, goShop: false, financingCondition: false, financingBanks: [] });
  });

  it("reads a go-shop and its length, and keeps the full fee over the reduced go-shop fee", () => {
    const t = parseDealTerms(
      `During the period beginning on the date of the Merger Agreement and continuing until 11:59 p.m. Eastern Time on the 45th day after the date of the Merger Agreement (the "Go-Shop Period"), the Company may solicit alternative proposals.
       The Company will be required to pay Parent a termination fee of $27.5 million, or $11.0 million if the Merger Agreement is terminated during the Go-Shop Period to accept a Superior Proposal.`,
      { target: "Mistras Group, Inc.", acquirer: "H.I.G. Capital" },
    );
    expect(t).toMatchObject({ goShop: true, goShopDays: 45, targetFeeUsd: 27.5e6 });
  });

  it("recognises parties named by any word of their names", () => {
    const t = parseDealTerms(
      "Under certain circumstances, Atleos will be required to pay Brink's a termination fee equal to $180 million, and Brink's will be required to pay Atleos a termination fee of $360 million.",
      { target: "NCR Atleos Corp", acquirer: "Brink's Co" },
    );
    expect(t).toMatchObject({ targetFeeUsd: 180e6, reverseFeeUsd: 360e6 });
  });

  it("ignores expense reimbursement and leaves unstated terms null", () => {
    const t = parseDealTerms("If the stockholders do not approve the Merger, the Company will reimburse Parent's expenses up to $5 million.", names);
    expect(t).toEqual({ targetFeeUsd: null, reverseFeeUsd: null, goShop: null, goShopDays: null, financingCondition: null, financingBanks: [] });
  });

  it("names committed lenders but not advisors", () => {
    const t = parseDealTerms(
      `Parent has obtained debt financing commitments from JPMorgan Chase Bank, N.A. and Goldman Sachs Bank USA pursuant to a debt commitment letter.
       Lazard is acting as financial advisor to the Company in connection with the debt financing.`,
      names,
    );
    expect(t.financingBanks).toEqual(["JPMorgan", "Goldman Sachs"]);
  });
});

describe("saneFee", () => {
  it("drops fees outside 0.3%–15% of the deal value", () => {
    expect(saneFee(30e6, 1e9)).toBe(30e6);
    expect(saneFee(1e6, 1e9)).toBeNull();
    expect(saneFee(300e6, 1e9)).toBeNull();
    expect(saneFee(30e6, null)).toBe(30e6);
  });
});
