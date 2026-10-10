import { describe, expect, it } from "vitest";
import { htmlToText } from "../text";
import { extractMergerPrice, item101, parseMergerItem } from "./eightk";

// Synthetic Item 1.01 sections in the style of real merger 8-Ks.
const TARGET_SIDE = `UNITED STATES SECURITIES AND EXCHANGE COMMISSION FORM 8-K
Item 1.01 Entry into a Material Definitive Agreement.
Agreement and Plan of Merger
On December 1, 2025, Keystone Events, Inc., a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with Nimbus US Inc., a Delaware corporation ("Parent") and a wholly owned subsidiary of Nimbus S.p.A. ("Nimbus"), and Everest Merger Sub Inc., a Delaware corporation and a wholly owned subsidiary of Parent ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Company, with the Company surviving as a wholly owned subsidiary of Parent (the "Merger"). At the effective time, each share of Class A common stock, par value $0.00001 per share, of the Company shall be converted into the right to receive $4.50 in cash, without interest.
Item 9.01 Financial Statements and Exhibits.`;

const SPONSOR_SHELL = `Item 1.01. Entry into Material Definitive Agreement.
On November 16, 2025, Harbor Packaging Corporation, a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with Anchor Purchaser, LLC, a Delaware limited liability company ("Parent") that is affiliated with Clayton, Dubilier & Rice, LLC ("CD&R"), and Anchor Merger Sub, Inc., a Delaware corporation and a wholly owned subsidiary of Parent ("Merger Sub"), pursuant to which Merger Sub will be merged with and into the Company (the "Merger"). Each share of common stock, $0.10 par value per share, will be automatically converted into the right to receive cash in an amount equal to $42.15 in cash without interest (the "Merger Consideration").
Item 5.03 Amendments.`;

const TENDER = `Item 1.01 Entry into a Material Definitive Agreement.
On September 10, 2026, Bluebird Auctions Inc., a Delaware corporation ("Bluebird"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with Northwind, Inc., a Delaware corporation ("Parent"), and Apple Merger Sub, Inc., a Delaware corporation ("Merger Sub"). Parent will cause Merger Sub to commence a cash tender offer to acquire all of Bluebird's outstanding shares of common stock, par value $0.001 per share ("Bluebird Stock"), for $10.50 per share, net to the seller in cash, without interest.
Item 8.01 Other Events.`;

const NOT_A_MERGER = `Item 1.01 Entry into a Material Definitive Agreement.
On March 3, 2026, the Company entered into a Credit Agreement with Bank of Somewhere, N.A. providing a $500 million revolving facility.
Item 2.03 Creation of a Direct Financial Obligation.`;

describe("parseMergerItem", () => {
  it("parses a target-side merger 8-K", () => {
    const p = parseMergerItem(TARGET_SIDE, { filerName: "Keystone Events, Inc.", filerTickers: ["KEYS"] })!;
    expect(p.target.name).toBe("Keystone Events, Inc.");
    expect(p.acquirer.name).toBe("Nimbus US Inc.");
    expect(p.pricePerShare).toBe(4.5);
    expect(p.consideration).toBe("Cash");
  });

  it("names the sponsor behind a shell buyer", () => {
    const p = parseMergerItem(SPONSOR_SHELL, { filerName: "HARBOR PACKAGING CORP", filerTickers: ["HPC"] })!;
    expect(p.acquirer.name).toBe("Clayton, Dubilier & Rice, LLC");
    expect(p.target.name).toBe("Harbor Packaging Corporation");
    expect(p.pricePerShare).toBe(42.15);
  });

  it("parses a tender-offer deal with a named target", () => {
    const p = parseMergerItem(TENDER, { filerName: "Bluebird Auctions Inc.", filerTickers: ["BLBD"] })!;
    expect(p.target.name).toBe("Bluebird Auctions Inc.");
    expect(p.acquirer.name).toBe("Northwind, Inc.");
    expect(p.pricePerShare).toBe(10.5);
  });

  it("handles a tender offer with Purchaser and an Ultimate Parent", () => {
    const text = `Item 1.01 Entry into a Material Definitive Agreement.
On January 19, 2026, Redwood Bio, Inc., a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger (the "Merger Agreement") by and among the Company, Glaxo Holdings LLC, a Delaware limited liability company ("Parent"), Redrose Acquisition Co., a Delaware corporation ("Purchaser"), and, solely for purposes of Section 8.11 of the Merger Agreement, GSK plc ("Ultimate Parent"). Parent will cause Purchaser to commence a cash tender offer (the "Offer"). Following the Offer, Purchaser will merge with and into the Company, with the Company surviving as a wholly owned subsidiary of Parent.
Item 9.01 Exhibits.`;
    const p = parseMergerItem(text, { filerName: "Redwood Bio, Inc.", filerTickers: ["RDWD"] })!;
    expect(p.target.name).toBe("Redwood Bio, Inc.");
    expect(p.acquirer.name).toBe("GSK plc");
  });

  it("names the buyer when it is defined by its own name, not 'Parent'", () => {
    const text = `Item 1.01. Entry Into a Material Definitive Agreement.
On December 17, 2025, Lecturely, Inc. (the "Company" or "Lecturely") entered into an Agreement and Plan of Merger (the "Merger Agreement") with Coursebook, Inc. ("Coursebook") and Chess Merger Sub, Inc., a direct wholly owned subsidiary of Coursebook ("Merger Sub"). Merger Sub will merge with and into Lecturely (the "Merger"), with Lecturely surviving as a wholly owned subsidiary of Coursebook. Each share will be converted into the right to receive 0.800 shares of common stock of Coursebook.
Item 9.01 Exhibits.`;
    const p = parseMergerItem(text, { filerName: "Lecturely, Inc.", filerTickers: ["LECT"] })!;
    expect(p.target.name).toBe("Lecturely, Inc.");
    expect(p.acquirer.name).toBe("Coursebook, Inc.");
    expect(p.consideration).toBe("Stock");
  });

  it("reads a direct bank merger (target merges into the buyer)", () => {
    const text = `Item 1.01 Entry into a Material Definitive Agreement.
On October 27, 2025, Sunrise Capital Bancorp ("Sunrise") and Foundation Bank Inc. ("Foundation") entered into an Agreement and Plan of Merger (the "Merger Agreement") pursuant to which Foundation will merge with and into Sunrise, with Sunrise continuing as the surviving corporation (the "Merger").
Item 9.01 Exhibits.`;
    const p = parseMergerItem(text, { filerName: "Foundation Bank Inc.", filerTickers: ["FNDB"] })!;
    expect(p.target.name).toBe("Foundation Bank Inc.");
    expect(p.acquirer.name).toBe("Sunrise Capital Bancorp");
  });

  it("handles long clauses before 'will be merged with and into'", () => {
    const text = `Item 1.01 Entry into a Material Definitive Agreement.
On February 22, 2026, Evergreen Home Health, Inc., a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger (the "Merger Agreement"), pursuant to which the Company will be acquired by Anchor Parent, LLC, a Delaware limited liability company ("Parent"), an affiliate of Kinderhook Industries ("Kinderhook"). Anchor Merger Sub, Inc., a Delaware corporation ("Merger Sub") and a wholly owned subsidiary of Parent, will be merged with and into the Company.
Item 9.01 Exhibits.`;
    const p = parseMergerItem(text, { filerName: "Evergreen Home Health, Inc.", filerTickers: ["EHH"] })!;
    expect(p.target.name).toBe("Evergreen Home Health, Inc.");
    expect(p.acquirer.name).toBe("Kinderhook Industries");
  });

  it("ignores non-merger material agreements", () => {
    expect(item101(NOT_A_MERGER)).toBeNull();
    expect(parseMergerItem(NOT_A_MERGER, { filerName: "Acme", filerTickers: [] })).toBeNull();
  });

  it("does not read par values as the price", () => {
    expect(extractMergerPrice("par value $0.00001 per share, shall be converted into the right to receive $4.50 in cash")).toBe(4.5);
  });

  it("reads the cash price, not the CVR's contingent payment", () => {
    const s = `Purchaser will commence a tender offer to acquire all of the outstanding shares of common stock of the Company, par value $0.0001 per share (the "Shares"), for (i) $8.50 per Share, net to the seller in cash, without interest (the "Closing Amount"), plus (ii) one contingent value right per Share (a "CVR") which represents the right to receive up to $3.50 per Share upon the satisfaction of specified milestones, net to the seller in cash.`;
    expect(extractMergerPrice(s)).toBe(8.5);
  });
});

describe("parseMergerItem: defined securities are not parties", () => {
  const BUYER_SIDE = `Item 1.01 Entry into a Material Definitive Agreement.
On September 28, 2025, RYVYL Inc., a Nevada corporation (the "Company"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with RTB Merger Sub, Inc., a Delaware corporation and wholly owned subsidiary of the Company ("Merger Sub"), and RTB Digital, Inc., a Delaware corporation ("RTB").
Merger and Merger Consideration. The Merger Agreement provides that Merger Sub will merge with and into RTB (the "Merger"), with RTB surviving the merger as a wholly owned subsidiary of the Company. Prior to the effective time, the holders of RTB's preferred stock (the "RTB Preferred Stock") shall exchange or convert all of their shares of RTB Preferred Stock for shares of RTB's common stock.
Item 9.01 Financial Statements and Exhibits.`;
  it("takes the filer as buyer, not the target's preferred stock", () => {
    const p = parseMergerItem(BUYER_SIDE, { filerName: "RYVYL Inc.", filerTickers: ["RVYL"] })!;
    expect(p.target.name).toBe("RTB Digital, Inc.");
    expect(p.acquirer.name).toBe("RYVYL Inc.");
  });
});
describe("parseMergerItem: older filings and partnerships", () => {
  const ctx = { filerName: "TransMontaigne Partners L.P.", filerTickers: [] };

  it("reads a partnership target defined as \"the Partnership\"", () => {
    const text = `Item 1.01 Entry into a Material Definitive Agreement.
On October 8, 2018, TransMontaigne Partners L.P., a Delaware limited partnership (the "Partnership"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with Kestrel Energy Holdings LLC, a Delaware limited liability company ("Parent"), and Kestrel Merger Sub LLC ("Merger Sub"), pursuant to which Merger Sub will merge with and into the Partnership, with the Partnership surviving as a subsidiary of Parent. Each common unit will be converted into the right to receive $41.00 in cash.
Item 9.01 Financial Statements and Exhibits.`;
    const p = parseMergerItem(text, ctx)!;
    expect(p.target.name).toBe("TransMontaigne Partners L.P.");
    expect(p.acquirer.name).toBe("Kestrel Energy Holdings LLC");
    expect(p.pricePerShare).toBe(41);
  });

  it("reads the Company merging into a merger sub as the target", () => {
    const text = `Item 1.01. Entry into a Material Definitive Agreement.
On March 31, 2026, Bluebird & Co., Inc., a Delaware corporation (the "Company") entered into an Agreement and Plan of Merger (the "Merger Agreement") among Crestline Midco, Inc., a Delaware corporation ("Parent"), Crestline Merger Sub, Inc., a Delaware corporation and a wholly-owned Subsidiary of Parent, ("Corp Merger Sub"), and Bluebird Group, LLC ("Group LLC"). Pursuant to the Merger Agreement, the Company will merge with and into Corp Merger Sub (the "Company Merger"), and each share of Class A common stock of the Company will be converted into the right to receive $12.85 in cash.
Item 9.01 Financial Statements and Exhibits.`;
    const p = parseMergerItem(text, { filerName: "Bluebird & Co., Inc.", filerTickers: [] })!;
    expect(p.target.name).toBe("Bluebird & Co., Inc.");
    expect(p.acquirer.name).toBe("Crestline Midco, Inc.");
    expect(p.pricePerShare).toBe(12.85);
  });

  it("reads defined terms written with Windows-1252 quote entities (2018–2019 filings)", () => {
    const html = `<html><body><p>Item 1.01 Entry into a Material Definitive Agreement.</p><p>On January 5, 2019, Eli Lilly and Company, an Indiana corporation (&#147;Parent&#148;), Bowfin Acquisition Corporation, a Delaware corporation and a wholly owned subsidiary of Parent (&#147;Purchaser&#148;), and Loxo Oncology, Inc., a Delaware corporation (the &#147;Company&#148;), entered into an Agreement and Plan of Merger (the &#147;Merger Agreement&#148;). Purchaser will commence a tender offer to acquire all of the outstanding shares of common stock of the Company for $235.00 per share, net to the seller in cash, and Purchaser will then merge with and into the Company.</p><p>Item 9.01 Financial Statements and Exhibits.</p></body></html>`;
    const p = parseMergerItem(htmlToText(html), { filerName: "Loxo Oncology, Inc.", filerTickers: [] })!;
    expect(p.target.name).toBe("Loxo Oncology, Inc.");
    expect(p.acquirer.name).toBe("Eli Lilly and Company");
    expect(p.pricePerShare).toBe(235);
  });
});

// Shapes found by the October 2026 big-deal check (merger-proxy filers with no deal); synthetic text in their style.
describe("parseMergerItem: structures the big-deal check found", () => {
  const item = (body: string) => `Item 1.01 Entry into a Material Definitive Agreement.\n${body}\nItem 9.01 Financial Statements and Exhibits.`;

  it("reads a bank merger where the named target merges into the buyer", () => {
    const p = parseMergerItem(
      item(`On April 18, 2026, Harbor Bancorp, a Delaware corporation ("Harbor"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with Lighthouse Financial Corporation, a Delaware corporation ("Lighthouse"). The Merger Agreement provides that, upon the terms and subject to the conditions set forth therein, Harbor will merge with and into Lighthouse (the "Merger"), with Lighthouse as the surviving corporation. Following the Merger, Harbor's wholly-owned subsidiary, Harbor National Bank, will merge with and into Lighthouse's wholly-owned subsidiary, Lighthouse Bank (the "Bank Merger").`),
      { filerName: "Harbor Bancorp", filerTickers: [] },
    )!;
    expect(p.target.name).toBe("Harbor Bancorp");
    expect(p.acquirer.name).toBe("Lighthouse Financial Corporation");
  });

  it('reads a defined term between the verb and "with and into", and a dash in the heading', () => {
    const p = parseMergerItem(
      `Item 1.01 - Entry into a Material Definitive Agreement Merger Agreement On October 10, 2026, Ridge Natural Resources Company, a Delaware corporation (the "Company" or "Ridge"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with Atlas Oil Corporation, a New Jersey corporation ("Parent" or "Atlas"), and SPQR, LLC, a wholly-owned subsidiary of Parent ("Merger Sub"). Merger Sub will merge (the "Merger") with and into the Company, with the Company surviving the Merger as a wholly owned subsidiary of Parent. Item 9.01 Exhibits.`,
      { filerName: "RIDGE NATURAL RESOURCES CO", filerTickers: [] },
    )!;
    expect(p.target.name).toBe("Ridge Natural Resources Company");
    expect(p.acquirer.name).toBe("Atlas Oil Corporation");
  });

  it("reads an Irish scheme of arrangement under a Transaction Agreement", () => {
    const p = parseMergerItem(
      item(`On December 11, 2026, Meadow Therapeutics plc, a public limited company incorporated under the laws of Ireland (the "Company"), entered into a Transaction Agreement (the "Transaction Agreement") by and among the Company, Summit Inc., a Delaware corporation ("Parent"), and Pillar Limited, a wholly owned subsidiary of Parent ("Acquirer Sub"). Under the terms of the Transaction Agreement, Acquirer Sub will acquire the Company (the "Acquisition") pursuant to a scheme of arrangement under the Companies Act 2014 of Ireland (the "Scheme"). Holders of the ordinary shares of the Company will be entitled to receive $116.50 in cash per Share (the "Consideration").`),
      { filerName: "Meadow Therapeutics plc", filerTickers: [] },
    )!;
    expect(p.target.name).toBe("Meadow Therapeutics plc");
    expect(p.acquirer.name).toBe("Summit Inc.");
    expect(p.pricePerShare).toBe(116.5);
  });

  it("names the consortium behind newly formed buyers in a UK scheme", () => {
    const p = parseMergerItem(
      item(`On March 28, 2026, Orbit Holdings plc, a public limited company formed under the laws of England and Wales (the "Company" or "Orbit"), entered into a Transaction Agreement (the "Transaction Agreement") by and among the Company, Neptune Intermediate Jersey Limited, a private limited company ("Parent"), and Neptune BidCo US Inc., a Delaware corporation and a wholly owned subsidiary of Parent ("Purchaser"), pursuant to which the Purchaser will acquire the issued and to be issued ordinary share capital of the Company by way of a scheme of arrangement (the "Scheme"). Parent and Purchaser are newly-formed entities established by a consortium of private investment funds led by funds affiliated with Elliott Investment Management L.P. and Brookfield Asset Management (the "Consortium").`),
      { filerName: "Orbit Holdings plc", filerTickers: [] },
    )!;
    expect(p.target.name).toBe("Orbit Holdings plc");
    expect(p.acquirer.name).toBe("Elliott Investment Management L.P. and Brookfield Asset Management");
  });

  it('keeps a name with an honorific period and a second defined term ("Mr. Cooper" or the "Company")', () => {
    const p = parseMergerItem(
      item(`On March 31, 2026, Rocket Companies, Inc. ("Rocket") entered into an Agreement and Plan of Merger (the "Merger Agreement") by and among Rocket, Maverick Merger Sub, Inc., a newly formed Delaware corporation and a direct, wholly owned subsidiary of Rocket ("Maverick Merger Sub"), Maverick Merger Sub 2, LLC, a direct wholly owned subsidiary of Rocket ("Forward Merger Sub"), and Mr. Cooper Group Inc., a Delaware corporation ("Mr. Cooper" or the "Company"). Maverick Merger Sub will merge with and into Mr. Cooper (the "Maverick Merger"), with Mr. Cooper surviving, and immediately following, Mr. Cooper will merge with and into Forward Merger Sub.`),
      { filerName: "Mr. Cooper Group Inc.", filerTickers: [] },
    )!;
    expect(p.target.name).toBe("Mr. Cooper Group Inc.");
    expect(p.acquirer.name).toBe("Rocket Companies, Inc.");
  });

  it("reads a partnership name followed by its listing, and prefers the merger into the filer over an OpCo merger", () => {
    const mlp = parseMergerItem(
      item(`On May 14, 2026, Otter Midstream Partners, L.P. (NYSE: OMP), a Delaware limited partnership ("Otter"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with Plains Gas, Inc., an Oklahoma corporation (NYSE: PGI) ("Plains"), and River Merger Sub, LLC, a wholly owned subsidiary of Plains ("Merger Sub"). Merger Sub will merge with and into Otter (the "Merger"), with Otter continuing as a wholly owned subsidiary of Plains.`),
      { filerName: "Otter Midstream Partners, L.P.", filerTickers: [] },
    )!;
    expect(mlp.target.name).toBe("Otter Midstream Partners, L.P.");
    expect(mlp.acquirer.name).toBe("Plains Gas, Inc.");
    const opco = parseMergerItem(
      item(`On March 1, 2026, Radial Infrastructure, Inc., a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger (the "Merger Agreement") with APW OpCo LLC ("OpCo"), Chord Parent, Inc. ("Parent"), Chord Merger Sub I, Inc. ("Merger Sub I"), and Chord Merger Sub II, LLC ("Merger Sub II"). (a) Merger Sub II will be merged with and into OpCo (the "OpCo Merger"), and (b) Merger Sub I will be merged with and into the Company (the "Company Merger"). Each share will be converted into the right to receive $15.00 in cash.`),
      { filerName: "Radial Infrastructure, Inc.", filerTickers: [] },
    )!;
    expect(opco.target.name).toBe("Radial Infrastructure, Inc.");
    expect(opco.pricePerShare).toBe(15);
  });

  it('reads a two-step bank deal ("will acquire Weston in two steps")', () => {
    const p = parseMergerItem(
      item(`On February 3, 2026, Weston Financial Corporation, a Delaware corporation ("Weston"), entered into a Transaction Agreement (the "Transaction Agreement") with Banco Iberico, S.A., a Spanish sociedad anónima ("Banco Iberico"), and a wholly owned subsidiary of Weston (the "Weston Subsidiary"). The Transaction Agreement provides that Banco Iberico will acquire Weston in two steps. First, Weston will merge with and into the Weston Subsidiary (the "Merger"). Second, Banco Iberico will acquire all outstanding shares of the Weston Subsidiary through a statutory share exchange.`),
      { filerName: "WESTON FINANCIAL CORP", filerTickers: [] },
    )!;
    expect(p.target.name).toBe("Weston Financial Corporation");
    expect(p.acquirer.name).toBe("Banco Iberico, S.A.");
  });

  it('names the sponsor from "acquisition of the Company by affiliates of …" and reads "by and among the Company, X"', () => {
    const p = parseMergerItem(
      item(`On February 4, 2026, CoreMap, Inc., a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger (the "Merger Agreement"), dated February 4, 2026, by and among the Company, Celestial-Saturn Parent Inc., a Delaware corporation ("Parent"), and Celestial-Saturn Merger Sub Inc., a Delaware corporation ("Acquisition Sub"), providing for the acquisition of the Company by affiliates of Stone Point Capital Partners and Insight Partners, subject to the terms and conditions set forth therein (the "Merger"). The Board approved the Merger of Acquisition Sub with and into the Company. Each share will be converted into the right to receive $80.00 in cash.`),
      { filerName: "CoreMap, Inc.", filerTickers: [] },
    )!;
    expect(p.target.name).toBe("CoreMap, Inc.");
    expect(p.acquirer.name).toBe("Stone Point Capital Partners");
    expect(p.pricePerShare).toBe(80);
  });

  it("takes the other side, not its merger sub, as buyer when the filer merges into that sub; ignores defined agreements", () => {
    const moe = parseMergerItem(
      item(`On May 20, 2026, Valley Communities, Inc., a Maryland corporation ("Valley"), Summit Residential, a Maryland real estate investment trust ("Summit Residential"), and Canopy Merger Sub LLC, a direct wholly owned subsidiary of Summit Residential ("Merger Sub"), entered into an Agreement and Plan of Merger (the "Merger Agreement"). At the Effective Time, Valley will merge with and into Merger Sub, with Merger Sub being the surviving entity (the "Merger").`),
      { filerName: "VALLEY COMMUNITIES INC", filerTickers: [] },
    )!;
    expect(moe.target.name).toBe("Valley Communities, Inc.");
    expect(moe.acquirer.name).toBe("Summit Residential");
    const endo = parseMergerItem(
      item(`On March 13, 2026, Indo, Inc. (the "Company" or "Indo"), entered into a Transaction Agreement (the "Transaction Agreement"), with Mallard plc, an Irish public limited company ("Mallard"), and Salvare Merger Sub LLC, a wholly owned subsidiary of Mallard ("Merger Sub"). The Transaction Agreement provides that Merger Sub will merge with and into the Company.`),
      { filerName: "Indo, Inc.", filerTickers: [] },
    )!;
    expect(endo.acquirer.name).toBe("Mallard plc");
  });

  it("reads a buyer whose description holds a parenthesis, and a lower-case web name", () => {
    const dutch = parseMergerItem(
      item(`On June 10, 2026, Grubby Inc., a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger with Fast Eat Takeaway.com N.V., a public limited liability company (naamloze vennootschap) incorporated under the laws of the Netherlands ("Parent"), and Checkers Merger Sub I, Inc. ("Merger Sub I"). Merger Sub I will merge with and into the Company.`),
      { filerName: "Grubby Inc.", filerTickers: [] },
    )!;
    expect(dutch.acquirer.name).toBe("Fast Eat Takeaway.com N.V.");
    const web = parseMergerItem(
      item(`On June 9, 2026, Tableau Lab, Inc., a Delaware corporation (the "Company"), entered into an Agreement and Plan of Merger with salesforce.com, inc., a Delaware corporation ("Parent"), and Sausalito Acquisition Corp., a wholly owned subsidiary of Parent ("Merger Sub"). Merger Sub will merge with and into the Company.`),
      { filerName: "Tableau Lab, Inc.", filerTickers: [] },
    )!;
    expect(web.acquirer.name).toMatch(/^salesforce\.com, inc/);
  });

  it("strips an earlier party's defined term from the front of the next name", () => {
    const p = parseMergerItem(
      item(`On June 15, 2026, Perrin Apparel International, Inc. ("Perrin" or the "Company") entered into an Agreement and Plan of Merger, by and among Perrin, Feld Holdings LLC, a Delaware limited liability company ("Parent"), and GF Merger Sub, Inc., a wholly-owned subsidiary of Parent ("Merger Sub"), providing for the merger of Merger Sub with and into the Company. Each share will be converted into the right to receive $27.50 in cash.`),
      { filerName: "Perrin Apparel International, Inc.", filerTickers: [] },
    )!;
    expect(p.target.name).toBe("Perrin Apparel International, Inc.");
    expect(p.acquirer.name).toBe("Feld Holdings LLC");
  });
});
