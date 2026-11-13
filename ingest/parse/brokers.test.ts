import { describe, expect, it } from "vitest";
import { applyAgreementBanks, brokerBanks } from "./brokers";
import { sanitizeDeal } from "../tidy";
import type { StoredDeal } from "../store";

const preamble = (target: string, term = "Company") =>
  `AGREEMENT AND PLAN OF MERGER, by and among Tempus AI, Inc., a Delaware corporation (" Parent "), Orbit Merger Sub, Inc. (" Merger Sub "), and ${target}, a Delaware corporation (the " ${term} "). `;

describe("brokerBanks", () => {
  it("reads each side's clause, past a copy made available to the other side", () => {
    const text =
      preamble("Personalis, Inc.") +
      `Section 3.24 Brokers. (a) Except for Centerview and TD Cowen, a copy of whose respective engagement agreements have been made available to Parent, neither the Company nor any Company Subsidiary has employed any investment banker, broker or finder in connection with the Transactions. Section 3.25 Insurance. ` +
      `Section 4.11 Brokers. Other than Morgan Stanley & Co. LLC, neither Parent nor any Parent Subsidiary has employed or engaged any investment banker, broker or finder in connection with the Transactions who is entitled to any fee. Section 4.12 Financing.`;
    expect(brokerBanks(text, { targetName: "Personalis, Inc.", acquirerName: "Tempus AI, Inc." })).toEqual({ acquirer: ["Morgan Stanley"], target: ["Centerview", "TD Cowen"] });
  });

  it("doesn't take a firm's own 'Company' for the target", () => {
    const text =
      preamble("Magellan Health, Inc.") +
      `Section 4.7 Broker's Fees. Except for Allen & Company LLC, J.P. Morgan Securities LLC and Barclays Capital Inc., the fees and expenses of which shall be paid by Parent, neither Parent nor any of its Affiliates has engaged any financial advisor, broker or finder. Section 4.8 Other. ` +
      `Section 4.9 Brokers. With the exception of the engagement of Keefe, Bruyette & Woods, Inc., a Stifel Company, Parent has not employed any broker or finder in connection with the Merger. Section 4.10 Other.`;
    expect(brokerBanks(text, { targetName: "Magellan Health, Inc." }).acquirer).toEqual(["Allen & Company", "JPMorgan", "Barclays", "Stifel"]);
  });

  it("follows who made the arrangements over who would pay", () => {
    const text =
      preamble("Life Storage, Inc.") +
      `Section 5.16 No Brokers. Except for the fees and expenses of Citigroup Global Markets Inc., no broker, investment banker, financial advisor or other Person is entitled to receive any broker's fee in each case from the Company or any of the Company Subsidiaries in connection with this Agreement based upon arrangements made by or on behalf of Parent or any of its Subsidiaries. Section 5.17 Other.`;
    expect(brokerBanks(text, { targetName: "Life Storage, Inc." })).toEqual({ acquirer: ["Citigroup"], target: [] });
  });

  it("takes a bank defined as one side's adviser over a slip in the clause", () => {
    const text =
      preamble("ACELYRIN, Inc.") +
      `4.23 Brokers and Finders. No broker, investment banker, financial advisor or other Person, other than Morgan Stanley & Co. LLC (the " Parent Financial Advisor "), the fees and expenses of which will be paid by Parent, is entitled to any broker's fee based upon arrangements made by or on behalf of the Company. 4.24 Other.`;
    expect(brokerBanks(text, { targetName: "ACELYRIN, Inc." }).acquirer).toEqual(["Morgan Stanley"]);
  });

  it("reads a partnership, an acquired company, and parties called by their own names", () => {
    expect(
      brokerBanks(preamble("Enable Midstream Partners, LP", "Partnership") + `Section 3.21 Finders or Brokers. Except for Goldman Sachs & Co. LLC, neither the Partnership nor any of its Subsidiaries has employed any investment banker, broker or finder. Section 3.22 Other.`, {
        targetName: "Enable Midstream Partners, LP",
      }).target,
    ).toEqual(["Goldman Sachs"]);
    expect(
      brokerBanks(preamble("Conformis, Inc.") + `3.25 Brokers and Other Advisors. Except for UBS, no broker, finder or other Person is entitled to any fee in connection with the Transactions based upon arrangements made by or on behalf of any Acquired Company. SECTION 4 REPRESENTATIONS AND WARRANTIES OF PARENT AND MERGER SUB Parent hereby represents.`, {
        targetName: "Conformis Inc",
      }),
    ).toEqual({ acquirer: [], target: ["UBS"] });
    const banks = `AGREEMENT by and between Columbia Banking System, Inc., a Washington corporation (" Columbia "), and Umpqua Holdings Corporation, an Oregon corporation (" Umpqua "). 3.7 Broker's Fees. With the exception of the engagement of J.P. Morgan Securities LLC, neither Umpqua nor any Umpqua Subsidiary has employed any broker, finder or financial advisor. 3.8 Other. 4.7 Broker's Fees. With the exception of the engagement of Keefe, Bruyette & Woods, Inc., neither Columbia nor any Columbia Subsidiary has employed any broker, finder or financial advisor. 4.8 Other.`;
    expect(brokerBanks(banks, { targetName: "Umpqua Holdings Corp", acquirerName: "Columbia Banking System, Inc." })).toEqual({ acquirer: ["Stifel"], target: ["JPMorgan"] });
  });

  it("ignores who would bear the fee, and a contents line", () => {
    const text =
      preamble("Green Dot Corporation") +
      `Section 3.7 Brokers A-24 Section 3.8 Other A-25 ` +
      `Section 3.7 Brokers. With the exception of Citigroup Global Markets Inc., no broker, finder or investment banker is entitled to any fee from any of the Transferred Entities for which Purchaser or any of its Affiliates would have any Liability. Section 3.8 No Other Representations.`;
    expect(brokerBanks(text, { targetName: "Green Dot Corporation" })).toEqual({ acquirer: [], target: [] });
  });

  it("reads nothing without the target's own definition, or when the record runs the other way", () => {
    const clause = `Section 4.7 Brokers. Except for Lazard Frères & Co. LLC, neither the Company nor any Subsidiary has employed any broker or finder. Section 4.8 Other.`;
    expect(brokerBanks(`Some Other Corp, a Delaware corporation (the " Company "). ` + clause, { targetName: "Rover Group, Inc." })).toEqual({ acquirer: [], target: [] });
    expect(brokerBanks(preamble("Rover Group, Inc.") + clause, { targetName: "Rover Group, Inc." }).target).toEqual(["Lazard"]);
  });

  it("leaves out a bank a person hired, a holder's representation, and a bank defined for a financing role", () => {
    const qad =
      preamble("QAD Inc.") +
      `Section 4.19 Brokers and Other Advisors. Except for (i) Morgan Stanley & Co. LLC. (" Morgan Stanley "), which has been retained by the Special Committee, and (ii) Moelis & Company LLC, which has been retained by Pamela Lopker, the founder and President of the Company, there is no investment banker, broker or finder that has been retained by or is authorized to act on behalf of the Company. Section 4.20 Other.`;
    expect(brokerBanks(qad, { targetName: "QAD Inc" }).target).toEqual(["Morgan Stanley"]);
    const holder = preamble("TestEquity Acquisition, LLC") + `Section 4.9 Brokers. Other than Piper Sandler & Co., the Company Equityholder has not entered into any agreement that would obligate it to pay any commission or finder's fee. Section 4.10 Other.`;
    expect(brokerBanks(holder, { targetName: "TestEquity Acquisition, LLC" })).toEqual({ acquirer: [], target: [] });
    // The Company of that agreement isn't the record's target Lawson, defined just before it as Parent.
    const lawson = `by and among Lawson Products, Inc., a Delaware corporation (" Parent "), and TestEquity Acquisition, LLC (the " Company "). 3.17 Brokers and Finders. Other than Piper Sandler & Co., none of the Company Group has entered into any agreement that would obligate it to pay any brokerage fee. 3.18 Other.`;
    expect(brokerBanks(lawson, { targetName: "Lawson Products Inc" })).toEqual({ acquirer: [], target: [] });
    const placement =
      preamble("Flushing Financial Corp") +
      `J.P. Morgan Securities LLC (the " Placement Agent ") is acting solely as placement agent. Section 4.7 Broker's Fees. With the exception of the engagement of Keefe, Bruyette & Woods, Inc. and J.P. Morgan Securities LLC, neither Parent nor any of its Subsidiaries has employed any broker, finder or financial advisor in connection with the Mergers or the other transactions contemplated by this Agreement. Section 4.8 Other.`;
    expect(brokerBanks(placement, { targetName: "Flushing Financial Corp" }).acquirer).toEqual(["Stifel"]);
  });

  it("drops a bank both sides' clauses name", () => {
    const text =
      preamble("Acme Corp") +
      `Section 3.20 Brokers. Except for Evercore Group L.L.C., neither the Company nor any Subsidiary has employed any broker. Section 3.21 Other. Section 4.9 Brokers. Except for Evercore Group L.L.C. and Moelis & Company LLC, neither Parent nor any Subsidiary has employed any broker. Section 4.10 Other.`;
    expect(brokerBanks(text, { targetName: "Acme Corp" })).toEqual({ acquirer: ["Moelis"], target: [] });
  });
});

describe("applyAgreementBanks", () => {
  it("moves a bank to the side its clause names and adds missing ones, never against a fairness opinion", () => {
    const d = { acquirerAdvisors: [] as string[], targetAdvisors: ["Centerview", "TD Cowen", "Morgan Stanley"] };
    expect(applyAgreementBanks(d, { acquirer: ["Morgan Stanley", "Goldman Sachs"], target: ["Centerview"] })).toBe(true);
    expect(d).toEqual({ acquirerAdvisors: ["Morgan Stanley", "Goldman Sachs"], targetAdvisors: ["Centerview", "TD Cowen"] });
    const opined = { acquirerAdvisors: [] as string[], targetAdvisors: ["Lazard"], fairness: [{ bank: "Lazard", side: "target" as const }] };
    expect(applyAgreementBanks(opined, { acquirer: ["Lazard"], target: [] })).toBe(false);
  });

  it("is applied by tidy only while the record's target is the one it was read for", () => {
    const base = {
      id: "x",
      announcedDate: "2026-07-20",
      acquirer: { name: "Tempus AI, Inc.", cik: "1717115", ticker: "TEM" },
      target: { name: "Personalis, Inc.", cik: "1527753", ticker: "PSNL" },
      acquirerAdvisors: [] as string[],
      targetAdvisors: ["Centerview", "Morgan Stanley"],
      agreementBanks: { acquirer: ["Morgan Stanley"], target: ["Centerview"], targetCik: "1527753" },
      premiumPct: null,
      valueUsd: null,
      filings: [],
      sources: [],
    } as unknown as StoredDeal;
    sanitizeDeal(base);
    expect([base.acquirerAdvisors, base.targetAdvisors]).toEqual([["Morgan Stanley"], ["Centerview"]]);
    const turned = { ...base, acquirerAdvisors: [] as string[], targetAdvisors: ["Centerview", "Morgan Stanley"], target: { name: "Other Co", cik: "999", ticker: null } } as StoredDeal;
    sanitizeDeal(turned);
    expect(turned.targetAdvisors).toEqual(["Centerview", "Morgan Stanley"]);
  });
});
