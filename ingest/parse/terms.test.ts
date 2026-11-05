import { describe, expect, it } from "vitest";
import { combineTerms, parseDealTerms, parseProxyTerms, saneFee } from "./terms";
import type { DealTerms } from "../../lib/types";

describe("last review: fees", () => {
  it("skips a rejected bid's fee where too few dates stand near (Shockwave, Cowen)", () => {
    const shockwave = { target: "Shockwave Medical, Inc.", acquirer: "Johnson & Johnson" };
    expect(parseDealTerms(`Company B's "best and final" proposal was for $360 per share in cash, with a $500 million reverse termination fee. Shockwave will be required to pay to Parent a termination fee of $448,000,000 under specified circumstances.`, shockwave)).toMatchObject({ targetFeeUsd: 448e6, reverseFeeUsd: null });
    const cowen = { target: "Cowen Inc.", acquirer: "Toronto Dominion Bank" };
    expect(parseDealTerms(`The parties exchanged a revised draft merger agreement that contained a "reverse termination fee" of $100.0 million. TD will be required to pay Cowen an expense reimbursement.`, cowen).reverseFeeUsd).toBeNull();
  });

  it("reads 'termination fee in an amount', and not a counterproposal (Holly Energy)", () => {
    const names = { target: "Holly Energy Partners LP", acquirer: "HF Sinclair Corp" };
    const t = parseDealTerms(`HF Sinclair's counterproposal for a reverse fee would have equaled approximately $40 million in termination fee payments. HEP will pay HF Sinclair a termination fee in an amount in cash equal to $10.0 million and reimburse its expenses. HF Sinclair will pay HEP a termination fee in an amount in cash equal to $20.0 million and reimburse its expenses.`, names);
    expect(t).toMatchObject({ targetFeeUsd: 10e6, reverseFeeUsd: 20e6 });
  });

  it("the guard is case-sensitive, and a window's cut word isn't a bidder (CyrusOne, Atrion)", () => {
    const names = { target: "CyrusOne Inc.", acquirer: "KKR" };
    expect(parseDealTerms("Under specified circumstances, Parent must pay to the other party a termination fee of $500 million.", names).reverseFeeUsd).toBe(500e6);
    const atrion = `The Merger Agreement also provides that Parent will be required to pay the Company a termination fee in an amount equal to $40.725 million upon termination of the Merger Agreement in accordance with its terms, under specified circumstances, if, at the time of such termination, (i) the Required Regulatory Approvals have not been obtained, (ii) there is a law or order that enjoins or otherwise prohibits or makes illegal the consummation of the Merger or imposes a Burdensome Condition, in each case, if such law or order relates to a Required Regulatory Approval, (iii) the Company Stockholder Approval has been obtained, and (iv) all of the conditions have been satisfied.`;
    expect(parseDealTerms(atrion, { target: "Atrion Corp", acquirer: "Nordson Corp" }).reverseFeeUsd).toBe(40.725e6);
  });

  it("reads 'in cash,' before 'in the case of' (Flowserve), and SomaLogic's wording stays", () => {
    const flowserve = { target: "Flowserve Corp", acquirer: "Chart Industries, Inc." };
    expect(parseDealTerms("Each party may be required to pay a termination fee equal to $250 million in cash, in the case of Chart, and $215 million in cash, in the case of Flowserve.", flowserve)).toMatchObject({ targetFeeUsd: 215e6, reverseFeeUsd: 250e6 });
    const soma = { target: "SomaLogic, Inc.", acquirer: "Standard BioTools Inc." };
    expect(parseDealTerms("Either party may be required to pay a termination fee in the amount of $19,123,214, in the case of Standard BioTools, and in the amount of $17,176,173, in the case of SomaLogic.", soma)).toMatchObject({ targetFeeUsd: 17_176_173, reverseFeeUsd: 19_123_214 });
  });
});

describe("last review: lenders", () => {
  it("not a merger agreement's index of defined terms (STORE, CBIZ, Bluegreen)", () => {
    const index = `"Financing Commitments" Recital D "Fraud" Section 9.5(a) "GAAP" Section 3.7(a) "Goldman Sachs" Section 3.19 "Governmental Entity" Section 3.4 "HSR Act" Section 3.4(b)`;
    expect(parseDealTerms(index, { target: "STORE Capital Corp", acquirer: "GIC and Oak Street" }).financingBanks).toEqual([]);
    expect(parseDealTerms(`Index of Defined Terms "Financing Commitments" 5.7(a)(ii) "Fundamental Representations" 8.2(a) "GAAP" 4.5(b) "Goldman Sachs" 4.21 "Grant" 3.2`, { target: "CBIZ, Inc.", acquirer: "Grant Thornton Advisors" }).financingBanks).toEqual([]);
    // Must not break: a real commitment listing its amounts.
    expect(parseDealTerms("Citigroup and Barclays have committed to provide a $2.5 billion term loan, a $1.5 billion revolver, a $0.5 billion bridge facility and $1.2 billion of notes at 5.5% interest.", { target: "A Corp", acquirer: "B Corp" }).financingBanks).toEqual(["Citigroup", "Barclays"]);
  });

  it("not an adviser's assumption (Organon, AssetMark, SP Plus)", () => {
    expect(parseDealTerms("Morgan Stanley assumed that the final terms were as deemed appropriate and that Sun Pharma will obtain financing in accordance with the terms set forth in the Debt Commitment Letter.", { target: "Organon & Co.", acquirer: "Sun Pharma" }).financingBanks).toEqual([]);
    expect(parseDealTerms("Morgan Stanley assumed that Parent will obtain financing in accordance with the terms set forth in the Financing Commitments.", { target: "SP Plus Corp", acquirer: "Metropolis Technologies, Inc." }).financingBanks).toEqual([]);
  });

  it("not an escrow agent named in the next sentence (Sotherly)", () => {
    expect(parseDealTerms(`without the consent of the debt financing sources so affected. 96 Table of Contents ESCROW AGREEMENT Simultaneously with the execution of the Merger Agreement, Parent, Merger Sub, the Company and JPMorgan Chase Bank, N.A., as escrow agent, entered into an Escrow Agreement.`, { target: "Sotherly Hotels Inc.", acquirer: "Kemmons Wilson" }).financingBanks).toEqual([]);
  });

  it("a list with semicolons is one sentence, for lenders only (TXNM)", () => {
    const txnm = "Royal Bank of Canada; RBC Capital Markets, LLC; BNP Paribas; Canadian Imperial Bank of Commerce, New York Branch; MUFG Bank, Ltd.; and Sumitomo Mitsui Banking Corporation provided a debt commitment letter to Parent.";
    expect(parseDealTerms(txnm, { target: "Txnm Energy Inc", acquirer: "Blackstone Infrastructure" }).financingBanks).toEqual(["RBC Capital Markets", "BNP Paribas", "MUFG", "SMBC Nikko"]);
    // Must not break: a go-shop's sentence still ends at a semicolon (Sealed Air, CynergisTek).
    expect(parseDealTerms(`The Company may solicit proposals during a 30-day "go-shop" period; Parent proposed changes to the No-Shop.`, { target: "A Corp", acquirer: "B Corp" }).goShop).toBe(true);
  });

  it("a glossary's lenders count (VICI / MGP)", () => {
    expect(parseDealTerms(`"bridge facility" refers to a bridge loan. "Lenders" refers to Morgan Stanley Senior Funding, Inc., JPMorgan Chase Bank, N.A. and Citigroup Global Markets Inc., who have committed to provide the bridge facility.`, { target: "MGM Growth Properties LLC", acquirer: "Vici Properties Inc." }).financingBanks).toEqual(["Morgan Stanley", "JPMorgan", "Citigroup"]);
    // Must not break: other glossary lines.
    expect(parseDealTerms(`"Goldman Sachs" refers to Goldman Sachs & Co. LLC, in connection with the financing commitments.`, { target: "A Corp", acquirer: "B Corp" }).financingBanks).toEqual([]);
  });
});

describe("last review: financing condition and go-shop", () => {
  it("reads 'is not a condition' and two names before a possessive (Triton, Sealed Air)", () => {
    expect(parseDealTerms("The receipt of financing by BIPC or Parent is not a condition to completion of the Transactions.", { target: "Triton International Ltd", acquirer: "Brookfield Infrastructure Partners L.P." }).financingCondition).toBe(false);
    expect(parseDealTerms("The obligation of Parent and Merger Sub to consummate the Merger is not subject to Parent or Merger Sub's receipt of financing.", { target: "Sealed Air Corp", acquirer: "Clayton, Dubilier & Rice, LLC" }).financingCondition).toBe(false);
    // Must not break: a bid's words.
    expect(parseDealTerms(`${STORY}Party A's proposal was not subject to a financing contingency and said the receipt of financing would not be subject to any condition.`, names).financingCondition).toBeNull();
  });

  it("a date before the 'no-shop period start date' is a go-shop (Medallia), the term alone isn't (Verint)", () => {
    expect(parseDealTerms(`The Company may solicit until 12:01 a.m. on September 4, 2021 (which we refer to as the "no-shop period start date"). Thereafter the Company shall not solicit.`, names)).toMatchObject({ goShop: true, goShopDays: null });
    expect(parseDealTerms(`Until the "no-shop period start date" the Merger Agreement contains customary "no-shop" provisions.`, names).goShop).toBe(false);
  });

  it("the go-shop's days, not a tail after its end (Necessity Retail)", () => {
    const rtl = `During the period of 30 days following the execution of the Merger Agreement (the "go-shop" period), the Company may solicit proposals relating to alternative transactions. In connection with entering into a Superior Proposal with a go shop bidder on or before the date that is 15 days following the end of go-shop period provided for by the Merger Agreement, RTL will pay to GNL a termination fee of $16 million.`;
    expect(parseDealTerms(rtl, { target: "Necessity Retail REIT Inc", acquirer: "Global Net Lease, Inc." })).toMatchObject({ goShop: true, goShopDays: 30 });
  });
});

const names = { target: "ACV Auctions Inc.", acquirer: "Copart, Inc." };
/** Two dated sentences before a passage put it in the negotiation's story. */
const STORY = "On January 4, 2025, the parties met. On January 9, 2025, the parties met again. ";
/** Far enough on that nothing after it is in the story. */
const PAD = "Lorem ipsum dolor sit amet ".repeat(120);

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

describe("which side a fee is on", () => {
  it("takes the amount's own label before a neighbouring one (Paramount / WBD, Manning & Napier, Instructure)", () => {
    const wbd = { target: "Warner Bros. Discovery, Inc.", acquirer: "Paramount Skydance Corporation" };
    const t = parseDealTerms(
      `WBD may be required to pay PSKY a termination fee of $3 billion (the "Company Termination Fee"). Under specified circumstances a termination fee of $7 billion (the "Regulatory Termination Fee") may be payable by PSKY to WBD.`,
      wbd,
    );
    expect(t).toMatchObject({ targetFeeUsd: 3e9, reverseFeeUsd: 7e9 });
    const manning = parseDealTerms(
      `otherwise upon termination of the Merger Agreement, the Company will be required to pay Parent a termination fee of $8,790,000; and Parent will be required to pay the Company a termination fee of $15,070,000 (the "Parent Termination Fee"); in each case under certain specified circumstances.`,
      { target: "Manning & Napier, Inc.", acquirer: "Callodine Group, LLC" },
    );
    expect(manning).toMatchObject({ targetFeeUsd: 8_790_000, reverseFeeUsd: 15_070_000 });
    expect(parseDealTerms(`a termination fee of $109,000,000 (the "Instructure Termination Fee")`, { target: "Instructure Holdings, Inc.", acquirer: "KKR & Co. Inc." }).targetFeeUsd).toBe(109e6);
  });

  it("reads a label in lower case and a fee called a fee (Intricon), and keeps Chico's antitrust fee and up-to", () => {
    const t = parseDealTerms(
      `The Company will be required to pay Parent a fee of $4.0 million upon termination of the Merger Agreement under certain circumstances. Parent's liability is limited to the Parent termination fee of $6.0 million.`,
      { target: "Intricon Corp", acquirer: "Altaris" },
    );
    expect(t).toMatchObject({ targetFeeUsd: 4e6, reverseFeeUsd: 6e6 });
    const chicos = parseDealTerms(
      `The Company must pay Parent a termination fee of up to $29,956,324. Parent will pay the Company a fee of $39,941,765 (the "Antitrust Termination Fee").`,
      { target: "Chico's FAS, Inc.", acquirer: "Sycamore Partners" },
    );
    expect(chicos).toMatchObject({ targetFeeUsd: 29_956_324, reverseFeeUsd: 39_941_765 });
  });

  it("doesn't take a bank's fee for a break fee", () => {
    const t = parseDealTerms("The Company has agreed to pay Goldman Sachs a fee of $25 million, whether or not the Merger Agreement is terminated.", names);
    expect(t.targetFeeUsd).toBeNull();
  });

  it("drops words both parties share and reads initials (Dominion / NextEra, KCS / CPRL)", () => {
    const dominion = { target: "Dominion Energy, Inc", acquirer: "Nextera Energy Inc" };
    const t = parseDealTerms(
      "Dominion Energy may be required to pay NextEra Energy a cash termination fee equal to $2.24 billion or NextEra Energy may be required to pay Dominion Energy a cash termination fee equal to $6.52 billion or a regulatory termination fee equal to $4.83 billion.",
      dominion,
    );
    expect(t).toMatchObject({ targetFeeUsd: 2.24e9, reverseFeeUsd: 6.52e9 });
    const kcs = parseDealTerms(
      "KCS may be required to pay CPRL a termination payment of $700.0 million. CPRL may be required to pay KCS a termination payment of either $700.0 million or $1.0 billion, depending on the reason for termination.",
      { target: "Kansas City Southern", acquirer: "Canadian Pacific Railway Ltd" },
    );
    expect(kcs).toMatchObject({ targetFeeUsd: 700e6, reverseFeeUsd: 1e9 });
  });

  it("reads a party's own name over a role word in it", () => {
    const t = parseDealTerms("Walt Disney Company will be required to pay Pixar a termination fee of $100 million.", { target: "Pixar Inc", acquirer: "Walt Disney Company" });
    expect(t).toMatchObject({ targetFeeUsd: null, reverseFeeUsd: 100e6 });
  });

  it("reads a payer written after the amount (IHS Markit)", () => {
    const ihs = { target: "IHS Markit Ltd.", acquirer: "S&P Global Inc." };
    expect(parseDealTerms("a termination fee of $1,075,000,000 (payable by IHS Markit) under certain circumstances", ihs).targetFeeUsd).toBe(1_075_000_000);
    expect(parseDealTerms("a termination fee of $2,380,000,000 (payable by S&P Global) under certain circumstances", ihs).reverseFeeUsd).toBe(2_380_000_000);
    const firstSun = parseDealTerms("a termination fee of $45.1 million will be payable by FirstSun and a termination fee of $31.4 million will be payable by First Foundation, as applicable, upon termination", {
      target: "First Foundation Inc.",
      acquirer: "Firstsun Capital Bancorp",
    });
    expect(firstSun).toMatchObject({ targetFeeUsd: 31.4e6, reverseFeeUsd: 45.1e6 });
  });

  it("gives a fee either side may owe to both (Discover, Kenvue, Zynga, Qorvo, NYCB)", () => {
    const both = (s: string, target: string, acquirer: string) => parseDealTerms(s, { target, acquirer });
    expect(both("a termination fee of $1.38 billion payable by either Capital One or Discover to the other party", "Discover Financial Services", "Capital One Financial Corp")).toMatchObject({ targetFeeUsd: 1.38e9, reverseFeeUsd: 1.38e9 });
    expect(both("K-C or Kenvue may be required to pay a termination fee to the other equal to $1.136 billion.", "Kenvue Inc.", "Kimberly Clark Corp")).toMatchObject({ targetFeeUsd: 1.136e9, reverseFeeUsd: 1.136e9 });
    expect(both("Take-Two or Zynga may be required to pay the other a termination fee of $550 million.", "Zynga Inc", "Take Two Interactive Software Inc")).toMatchObject({ targetFeeUsd: 550e6, reverseFeeUsd: 550e6 });
    expect(
      both(
        "Upon termination of the Merger Agreement, each of Qorvo and Skyworks under specified circumstances, including termination by such party to accept a superior proposal or termination by the other party upon a change in such party's board of directors' recommendation to its stockholders, will be required to pay the other party a termination fee of $298,692,098.",
        "Qorvo, Inc.",
        "Skyworks Solutions, Inc.",
      ),
    ).toMatchObject({ targetFeeUsd: 298_692_098, reverseFeeUsd: 298_692_098 });
    expect(both("a termination fee of $90 million will be payable by either NYCB or Flagstar, as applicable.", "Flagstar Bancorp Inc", "New York Community Bancorp, Inc.")).toMatchObject({ targetFeeUsd: 90e6, reverseFeeUsd: 90e6 });
    expect(both("IsoPlexis or Berkeley Lights, as applicable, may be required to pay the other party a termination fee of $2.3 million.", "IsoPlexis Corp", "Berkeley Lights, Inc.")).toMatchObject({ targetFeeUsd: 2.3e6, reverseFeeUsd: 2.3e6 });
  });

  it("gives one side when only one owes it, whatever a neighbouring sentence says", () => {
    // Haynes: a plain "The Company will be required to pay Parent" doesn't become both because of "or".
    const haynes = parseDealTerms("The Company will be required to pay Parent a termination fee in an amount equal to $28,000,000, (i) if the Merger Agreement is terminated due to the Company accepting a superior proposal or (ii) if the Board changes its recommendation.", { target: "Haynes International Inc", acquirer: "North American Stainless" });
    expect(haynes).toMatchObject({ targetFeeUsd: 28e6, reverseFeeUsd: null });
    // Valaris: an earlier question and answer about the other side stands in the same span.
    const valaris = parseDealTerms(
      "Q: Does Transocean have to pay anything to Valaris if the Business Combination is not completed? A: In certain circumstances, depending on the reasons for the termination of the Business Combination Agreement, Transocean may have to pay Valaris a termination amount of $195 million. Q: Does Valaris have to pay anything to Transocean if the Business Combination is not completed? A: In certain circumstances, depending on the reasons for the termination of the Business Combination Agreement, Valaris may have to pay Transocean a termination amount of $173 million.",
      { target: "Valaris Ltd", acquirer: "Transocean Ltd." },
    );
    expect(valaris).toMatchObject({ targetFeeUsd: 173e6, reverseFeeUsd: 195e6 });
  });

  it("gives each amount its own side when the filing says which (Ranger, Cherry Hill, SomaLogic)", () => {
    expect(parseDealTerms("the Company or Parent would be required to pay the other party a termination fee of $60 million and $95 million, respectively.", { target: "Ranger Oil Corp", acquirer: "Baytex Energy Corp." })).toMatchObject({ targetFeeUsd: 60e6, reverseFeeUsd: 95e6 });
    expect(
      parseDealTerms("the Company or Parent, as applicable, would be required to pay the other party a termination fee of, in the case of payment by the Company, $4,700,000 and, in the case of payment by Parent, $7,990,000.", {
        target: "Cherry Hill Mortgage Investment Corp",
        acquirer: "TPG Mortgage Investment Trust, Inc.",
      }),
    ).toMatchObject({ targetFeeUsd: 4.7e6, reverseFeeUsd: 7.99e6 });
    expect(
      parseDealTerms("The Merger Agreement provides that a termination fee in the amount of $19,123,214, in the case of Standard BioTools, and in the amount of $17,176,173, in the case of SomaLogic, may be payable.", {
        target: "SomaLogic, Inc.",
        acquirer: "Standard Biotools Inc.",
      }),
    ).toMatchObject({ targetFeeUsd: 17_176_173, reverseFeeUsd: 19_123_214 });
  });

  it("reads a termination amount (AZEK)", () => {
    const t = parseDealTerms("AZEK may be required to pay James Hardie a termination amount of $272 million.", { target: "AZEK Co Inc.", acquirer: "James Hardie Industries plc" });
    expect(t.targetFeeUsd).toBe(272e6);
  });
});

describe("what isn't a fee", () => {
  it("not the cap on expenses inside a fee sentence (iCAD), but an up-to fee stays (Chico's)", () => {
    const t = parseDealTerms(
      "the Company will be required to pay Parent a termination fee equal to (i) $1,000,000, plus (ii) the amount of all documented fees and expenses of Parent, up to an amount of $2,000,000.",
      { target: "Icad Inc", acquirer: "RadNet, Inc." },
    );
    expect(t.targetFeeUsd).toBe(1e6);
  });

  it("not an early bid in the story (JetBlue's $200M), nor the increase from it", () => {
    const spirit = { target: "Spirit Airlines, Inc.", acquirer: "Jetblue Airways Corp" };
    expect(parseDealTerms(`${STORY}JetBlue will pay Spirit a reverse termination fee of $200 million.`, spirit).reverseFeeUsd).toBeNull();
    expect(parseDealTerms("the course of negotiations, which resulted in an increase of at least 48 Table of Contents $270 million from the initial reverse termination fee offered by JetBlue", spirit).reverseFeeUsd).toBeNull();
  });

  it("not an aggregate cap on what a sponsor owes (Whitestone, Marlin)", () => {
    const whitestone = parseDealTerms(
      "the reverse termination fee of, or damages up to, $77.0 million, in each case, payable by Parent under certain circumstances and certain enforcement costs up to $3.0 million in the aggregate (but in no event more than $80.0 million for such reverse termination fee, damages and enforcement costs, in the aggregate)",
      { target: "Whitestone REIT", acquirer: "Ares Management Corp" },
    );
    expect(whitestone.reverseFeeUsd).toBe(77e6);
    const marlin = parseDealTerms(
      `(a) the Company will be required to pay Parent a termination fee of approximately $10.3 million, or (b) Parent will be required to pay the Company a termination fee of approximately $20.7 million (the "Parent Termination Fee"). Under the Limited Guarantee, such funds have agreed to guarantee Parent's obligation to pay the Parent Termination Fee, subject to a cap of approximately $21.7 million.`,
      { target: "Marlin Business Services Corp", acquirer: "HPS Investment Partners, LLC" },
    );
    expect(marlin).toMatchObject({ targetFeeUsd: 10.3e6, reverseFeeUsd: 20.7e6 });
  });

  it("not what a rival's proposal would pay under another agreement (RR Donnelley)", () => {
    const t = parseDealTerms("clarifying that the December 9 Chatham Proposal contemplated that Chatham would pay, on RRD's behalf, the applicable termination fee of $20,000,000 to Atlas under the Atlas Merger Agreement", {
      target: "RR Donnelley & Sons Co",
      acquirer: "Chatham Asset Management",
    });
    expect(t.reverseFeeUsd).toBeNull();
  });
});

describe("go-shop", () => {
  const closes = (s: string) => parseDealTerms(s, names);

  it("doesn't take what was asked for in the negotiation (Cerner, Hillenbrand, Agiliti, Capri)", () => {
    expect(closes(`After discussion, the Cerner Board directed Latham & Watkins to propose a 45 day go-shop provision. The parties shall not solicit any other bid.`)).toMatchObject({ goShop: false, goShopDays: null });
    expect(closes(`Lone Star's proposal included a 30-day exclusivity period and contemplated a post-signing "go-shop" period.`)).toMatchObject({ goShop: null, goShopDays: null });
    expect(closes(`The initial draft of the merger agreement also proposed (a) a go-shop period post signing.`)).toMatchObject({ goShop: null });
    expect(closes(`${STORY}Tapestry's increased offer price was conditional on Capri dropping its request to include a "go-shop" provision.`)).toMatchObject({ goShop: null });
  });

  it("doesn't take its absence for a go-shop (Pfsweb, LogicMark, Eargo, Fathom, J. Alexander's)", () => {
    expect(closes(`The Board considered that the Merger Agreement imposes restrictions, including the absence of an explicit "go shop" provision.`).goShop).toBeNull();
    expect(closes(`no market check or "go-shop" process was conducted in connection with Roth's engagement.`).goShop).toBeNull();
    expect(closes(`the PSC Stockholder was not willing to agree to a "go-shop" because of the distraction it would create.`).goShop).toBeNull();
    expect(closes(`such that a go-shop or market check would be a reasonable condition to any transaction with CORE.`).goShop).toBeNull();
    expect(closes(`Party B indicated that it was willing to include a go-shop provision with a termination fee in a merger agreement.`).goShop).toBeNull();
  });

  it("takes a heading or a defined term (VMware, Terran Orbital, Datto, Patterson)", () => {
    expect(closes(`Go Shop; No Solicitation of Other Offers by VMware (see page 110) The merger agreement provides that from the date thereof until 11:59 p.m. Pacific time, on July 5, 2022`).goShop).toBe(true);
    expect(closes(`Invention Assignment Agreements 86 Go-Shop; Covenants Regarding Non-Solicitation 86 Restrictions on Changes`).goShop).toBe(true);
    expect(closes(`Written Consent 66 Go Shop 66 No Solicitation 66`).goShop).toBe(true);
    expect(closes(`Conduct of Business Pending the Merger 92 Go-Shop; No-Shop; Alternative Acquisition Proposals 94`).goShop).toBe(true);
  });

  it("keeps real go-shops with a superior proposal beside them, and their days (Cloudera, New Relic, Doma)", () => {
    expect(closes(`The Merger Agreement provides a 30-day "go-shop" period during which the Company may solicit Acquisition Proposals and terminate to accept a Superior Proposal.`)).toMatchObject({ goShop: true, goShopDays: 30 });
    expect(closes(`The Company may solicit alternative proposals until 11:59 p.m. on the 45th day after the date of the Merger Agreement (the "Go-Shop Period").`)).toMatchObject({ goShop: true, goShopDays: 45 });
    expect(closes(`the "Go-Shop Period" means the period of 50 days following the date of the Merger Agreement during which the Company may solicit Superior Proposals.`)).toMatchObject({ goShop: true, goShopDays: 50 });
  });

  it("takes no day count from a draft once the deal has none (SolarWinds, Olaplex)", () => {
    const t = closes(`${STORY}A revised draft provided for a 45-day "go-shop" period. On February 2, 2025, the Company signed. ${PAD}The Company shall not solicit any Acquisition Proposal.`);
    expect(t).toMatchObject({ goShop: false, goShopDays: null });
  });
});

describe("combineTerms", () => {
  const empty: DealTerms = { targetFeeUsd: null, reverseFeeUsd: null, goShop: null, goShopDays: null, financingCondition: null, financingBanks: [] };

  it("lets a proxy's go-shop beat an 8-K's inferred no-shop (VMware), with the proxy's days", () => {
    const t = combineTerms({ ...empty, goShop: false, targetFeeUsd: 1.5e9 }, { ...empty, goShop: true, goShopDays: 40, targetFeeUsd: 9e8 }, 61e9);
    expect(t).toMatchObject({ goShop: true, goShopDays: 40, targetFeeUsd: 1.5e9 });
  });

  it("never keeps days with goShop false", () => {
    expect(combineTerms({ ...empty, goShop: false }, { ...empty, goShop: null, goShopDays: 45 }, null)).toMatchObject({ goShop: false, goShopDays: null });
  });

  it("keeps an 8-K's go-shop and days, and a no-shop only the proxy states", () => {
    expect(combineTerms({ ...empty, goShop: true, goShopDays: 35 }, { ...empty, goShop: false }, null)).toMatchObject({ goShop: true, goShopDays: 35 });
    expect(combineTerms({ ...empty }, { ...empty, goShop: false }, null)).toMatchObject({ goShop: false, goShopDays: null });
  });

  it("re-checks fees against the deal's value and unions the lenders", () => {
    const t = combineTerms({ ...empty, targetFeeUsd: 110e6, financingBanks: ["UBS"] }, { ...empty, reverseFeeUsd: 110e6, financingBanks: ["UBS", "Citigroup"] }, 1e9);
    expect(t).toMatchObject({ targetFeeUsd: null, reverseFeeUsd: 110e6, financingBanks: ["UBS", "Citigroup"] });
  });
});

describe("parseProxyTerms", () => {
  const front = "Table of contents and notices. ".repeat(5800); // about 180,000 characters of front matter
  const dominion = { target: "Dominion Energy, Inc", acquirer: "Nextera Energy Inc" };

  it("reads a fee section past long front matter (Dominion at 177,000 characters, Qorvo at 179,000)", () => {
    const t = parseProxyTerms(`${front}Dominion Energy will be required to pay to NextEra Energy a termination fee of $2.24 billion if: NextEra Energy will be required to pay to Dominion Energy a termination fee of $6.52 billion if:`, dominion);
    expect(t).toMatchObject({ targetFeeUsd: 2.24e9, reverseFeeUsd: 6.52e9 });
  });

  it("further on only fills: the summary's fee and flag stand (Extended Stay, Heska)", () => {
    const stay = { target: "Extended Stay America, Inc.", acquirer: "Blackstone and Starwood Capital Group" };
    const summary = `Parent will be required to pay the Company a termination fee of $300 million. The Company shall not solicit any other bid. `;
    const t = parseProxyTerms(`${summary}${front}The agreement should include a reverse termination fee of $350 million and the merger agreement would include a "go-shop" provision for 30 days.`, stay);
    expect(t).toMatchObject({ reverseFeeUsd: 300e6, goShop: false, goShopDays: null });
    const heska = parseProxyTerms(`The Company shall not solicit any other bid. ${front}the Heska Board may be entitled to a "go shop" in the definitive transaction agreement.`, { target: "Heska Corp", acquirer: "Mars, Incorporated" });
    expect(heska).toMatchObject({ goShop: false, goShopDays: null });
  });

  it("gives a shown go-shop its days from further on (VMware), but not when counts disagree or the Board only discussed it", () => {
    const heading = `Go Shop; No Solicitation of Other Offers by VMware (see page 110) The merger agreement provides that the Company may solicit until July 5, 2022. `;
    const vmware = { target: "Vmware, Inc.", acquirer: "Broadcom Inc." };
    expect(parseProxyTerms(`${heading}${front}the provisions of the merger agreement that permit VMware, during a 40-day go-shop period, to solicit alternative proposals from third parties;`, vmware).goShopDays).toBe(40);
    // PS Business Parks: a bid's 45 days stand beside the signed 30.
    const psb = `${heading}${front}(iii) a go-shop period of 45 days after signing the merger agreement, (iv) a termination fee. ${PAD}the Company's right under the Merger Agreement to a 30-day "go-shop" period`;
    expect(parseProxyTerms(psb, vmware)).toMatchObject({ goShop: true, goShopDays: null });
    // Enstar's "25-day" against a go-shop that ran 35 days.
    const enstar = `${heading}${front}The Board discussed, among other things, the Company having meaningful negotiations with any third party during a 25-day "go-shop" period under the merger agreement.`;
    expect(parseProxyTerms(enstar, vmware).goShopDays).toBeNull();
  });

  it("reads lenders and a financing statement from anywhere in the proxy", () => {
    const t = parseProxyTerms(`${front}${front}The consummation of the Merger is not conditioned on Parent's receipt of any financing. Parent has obtained debt financing commitments from Barclays Bank PLC.`, names);
    expect(t).toMatchObject({ financingCondition: false, financingBanks: ["Barclays"] });
  });
});

describe("financing condition", () => {
  const fc = (s: string) => parseDealTerms(s, names).financingCondition;

  it("reads negated sentences as no condition (Bally's, HNI / Kimball, Compass, Select Interior, R1 RCM)", () => {
    expect(fc("The obligation of the parties to consummate the Merger Transactions is not subject to the availability of the Debt Financing.")).toBe(false);
    expect(fc("Although HNI's obligation to consummate the merger is not conditioned upon consummation of the debt financing, if HNI is unable to obtain it")).toBe(false);
    expect(fc("Compass' obligation to complete the transaction is not contingent on the receipt by Compass of any financing.")).toBe(false);
    expect(fc("The Merger is not subject to Parent obtaining any financing.")).toBe(false);
    expect(fc("The consummation of the Merger is not conditioned on Parent's receipt of any financing.")).toBe(false);
    expect(fc("Consummation of the Offer will not be subject to a financing condition.")).toBe(false);
  });

  it("takes nothing from a bid (Sumo Logic, Herc / H&E, Stonemor)", () => {
    expect(fc("The Sponsor D proposal contemplated that the definitive agreement would not be subject to any financing contingency.")).toBeNull();
    expect(fc(`${STORY}a draft that would include, inter alia, a go-shop, no financing contingency and a covenant.`)).toBeNull();
    expect(fc(`${STORY}Mr. Barber stated that he did not expect the Company Board would be open to a transaction which is contingent on receipt of debt financing.`)).toBeNull();
    expect(fc("For a Competing Transaction to constitute a Superior Proposal, such Competing Transaction must not be subject to a financing condition.")).toBeNull();
    expect(fc(`The December 18th Proposal was not contingent on Sanofi obtaining financing but did require completion of customary due diligence.`)).toBeNull();
    expect(fc(`an updated letter of intent, including a termination fee payable by Parent Group Member; and • no financing contingency.`)).toBeNull();
  });

  it("reads a present-tense statement even after dated sentences (Utz)", () => {
    expect(fc(`${STORY}The obligation of Parent to consummate the Merger is not subject to any financing condition.`)).toBe(false);
  });

  it("leaves it blank when no sentence states it, and reads a real condition", () => {
    expect(fc("Parent intends to fund the Merger with cash on hand.")).toBeNull();
    expect(fc("The Merger is conditioned upon the receipt of financing.")).toBe(true);
    expect(fc("The Merger is not subject to a financing condition. The Merger is conditioned upon the receipt of financing.")).toBe(false);
  });
});

describe("lenders", () => {
  const banks = (s: string) => parseDealTerms(s, names).financingBanks;

  it("doesn't credit the target's advisers or the people in the room (Twitter, Denny's, Genmab / Merus)", () => {
    expect(banks("Parent received a debt commitment letter, and representatives of each of Goldman Sachs and J.P. Morgan discussed it with the Board.")).toEqual([]);
    expect(banks("Representatives of Truist Securities updated the Board on the debt commitment letter.")).toEqual([]);
  });

  it("doesn't credit a highly confident letter, or a losing bidder's draft (VMware, Masonite, ChannelAdvisor)", () => {
    expect(banks("included letters from each of Barclays, Citi, Credit Suisse and Morgan Stanley providing that the foregoing banks were highly confident regarding the financing commitments")).toEqual([]);
    expect(banks("a bid submission that included a draft Debt Commitment Letter from Goldman Sachs")).toEqual([]);
  });

  it("doesn't credit the agent of an old facility, but a real commitment beside one stays (SailPoint, Paramount, NCR Atleos)", () => {
    expect(banks("to refinance the Credit Agreement, dated as of August 2019, among SailPoint, lenders party thereto, Citibank, N.A., as administrative agent, in connection with the commitment letter")).toEqual([]);
    expect(
      banks(
        `In connection with the Transactions, on February 26, 2026, Brink's entered into a debt commitment letter (the "Initial Commitment Letter") with Morgan Stanley Senior Funding, Inc. ("MSSF"), pursuant to which MSSF committed to provide a term loan to refinance the Credit Agreement, dated as of October 16, 2023.`,
      ),
    ).toEqual(["Morgan Stanley"]);
  });

  it("treats a list item as a sentence, unless the sentence introduces the list (II-VI, PNM, Radius)", () => {
    expect(banks(`• "debt commitment letter" refers to the Commitment Letter, dated March 25, 2021, by and among II-VI, JPMorgan Chase Bank, N.A. and Citigroup Global Markets Inc. • "debt financing" refers to the loans under it.`)).toEqual(["JPMorgan", "Citigroup"]);
    expect(banks(`Parent, Goldman Sachs and Sumitomo Mitsui Banking Corporation (referred to in this proxy statement as the "initial lenders") provided: • the TNMP Debt Commitment Letter, pursuant to which the initial lenders committed to provide the TNMP Debt Financing`)).toEqual(["Goldman Sachs", "SMBC Nikko"]);
    expect(banks("Goldman Sachs and its affiliates may at any time purchase, sell, hold or vote long or short positions and investments in securities of the parties, each of which is delivering an equity commitment letter.")).toEqual([]);
  });

  it("reads a list of banks through N.A. and Inc. (Slack, CyrusOne)", () => {
    expect(banks("Salesforce obtained a commitment letter and a commitment from Citigroup Global Markets Inc., Bank of America, N.A., JPMorgan Chase Bank, N.A. to provide a bridge facility.")).toEqual(["Citigroup", "BofA Securities", "JPMorgan"]);
  });

  it("keeps commitment wordings (Thermo / PPD, BioMarin / Amicus, Monmouth, a bank that also advises)", () => {
    expect(banks("Thermo Fisher entered into a commitment letter with Morgan Stanley Senior Funding, Inc. and Barclays Bank PLC.")).toEqual(["Morgan Stanley", "Barclays"]);
    expect(banks(`${STORY}On December 31, 2025, the Debt Commitment Letter was amended and restated to add Citigroup Global Markets Inc., Wells Fargo Bank, National Association and HSBC Bank USA, National Association as additional commitment parties.`)).toEqual(["Citigroup", "Wells Fargo", "HSBC"]);
    expect(banks("The joint lead arrangers and bookrunners for the Debt Financing are Citigroup Global Markets Inc. and UBS AG, Stamford Branch.")).toEqual(["Citigroup", "UBS"]);
    expect(banks("Owens & Minor obtained a debt commitment letter from JPMorgan Chase Bank, N.A.")).toEqual(["JPMorgan"]);
    expect(banks(`${STORY}Parent's debt commitment letter: "debt commitment letter" refers to the Commitment Letter, dated March 25, 2021, by and among II-VI, JPMorgan Chase Bank, N.A. and Citigroup Global Markets Inc.`)).toEqual(["JPMorgan", "Citigroup"]);
  });
});

describe("full-dollar fee amounts", () => {
  it("doesn't multiply an amount already in dollars by a unit word that follows it", () => {
    const t = parseDealTerms(
      `The Company will be required to pay Parent a termination fee of $5,560,000 million in the event the Company terminates the Merger Agreement to accept a Superior Proposal.`,
      names,
    );
    expect(t.targetFeeUsd).toBe(5_560_000);
    // "$1,250 million" is a real way to write $1.25 billion.
    expect(parseDealTerms(`Parent will be required to pay the Company a termination fee of $1,250 million.`, names).reverseFeeUsd).toBe(1.25e9);
  });

  it("rounds away floating-point dust", () => {
    expect(parseDealTerms(`Parent will be required to pay the Company a termination fee of $1.07 billion.`, names).reverseFeeUsd).toBe(1_070_000_000);
  });
});

describe("saneFee", () => {
  it("drops fees outside 0.3%–10% of the deal value (12% for reverse fees)", () => {
    expect(saneFee(30e6, 1e9)).toBe(30e6);
    expect(saneFee(1e6, 1e9)).toBeNull();
    expect(saneFee(110e6, 1e9)).toBeNull();
    expect(saneFee(110e6, 1e9, "reverse")).toBe(110e6);
    expect(saneFee(130e6, 1e9, "reverse")).toBeNull();
    expect(saneFee(30e6, null)).toBe(30e6);
  });
});
