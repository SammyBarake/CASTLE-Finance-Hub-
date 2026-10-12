import { describe, expect, it } from "vitest";
import { completedAround, isSigningFor, listedOn, provablyUnlistedOn, registrantMatches, takenOverAround } from "./deals";
import { nameOn } from "./edgar";
import { junkReason, sanitizeDeal, SPAC_NAME, tidyDeals } from "./tidy";
import type { StoredDeal } from "./store";

let n = 0;
function deal(over: Partial<StoredDeal> = {}): StoredDeal {
  n++;
  return {
    id: `d${n}`,
    announcedDate: "2024-01-10",
    acquirer: { name: "Acme Corp", ticker: "ACME", cik: "100" },
    target: { name: "Widget Inc.", ticker: "WDGT", cik: "200" },
    valueUsd: 1e9,
    valueKind: "equity",
    pricePerShare: 20,
    premiumPct: 30,
    consideration: "Cash",
    sector: "Tech",
    industry: null,
    status: "Pending",
    statusDate: "2024-02-01",
    enterpriseValueUsd: null,
    evEbitda: null,
    evRevenue: null,
    acquirerAdvisors: [],
    targetAdvisors: [],
    filings: [],
    sources: [],
    statusCheckedAt: null,
    financialsCheckedAt: null,
    ...over,
  };
}

describe("nameOn", () => {
  const sub = {
    name: "Teledyne FLIR, LLC",
    formerNames: [
      { name: "FLIR SYSTEMS INC", from: "1994-01-01T00:00:00.000Z", to: "2021-05-14T00:00:00.000Z" },
      { name: "FLIR SYSTEMS HOLDINGS", from: "1990-01-01T00:00:00.000Z", to: "1994-01-01T00:00:00.000Z" },
    ],
  };
  it("returns the name in use on the date", () => {
    expect(nameOn(sub, "2021-01-04")).toBe("FLIR SYSTEMS INC");
    expect(nameOn(sub, "1992-06-01")).toBe("FLIR SYSTEMS HOLDINGS");
    expect(nameOn(sub, "2022-01-01")).toBe("Teledyne FLIR, LLC");
    expect(nameOn({ name: "Acme" }, "2021-01-01")).toBe("Acme");
  });
});

describe("junkReason", () => {
  it("drops a national bank subsidiary as the buyer", () => {
    expect(junkReason(deal({ acquirer: { name: "Citibank, N.A.", ticker: null, cik: null } }))).toMatch(/lender/);
  });

  it("drops a private purchase by a SPAC-named buyer whatever its industry", () => {
    expect(junkReason(deal({ privateTarget: true, industry: "Gas & Other Services Combined", acquirer: { name: "Rice Acquisition Corp.", ticker: null, cik: null }, target: { name: "Aria Energy LLC", ticker: null, cik: null } }))).toMatch(/SPAC/);
    expect(junkReason(deal({ acquirer: { name: "Rice Acquisition Corp.", ticker: null, cik: null } }))).toBeNull();
  });

  it("drops a run of hyphenated words as a private target", () => {
    expect(junkReason(deal({ privateTarget: true, target: { name: "Cash-Flow-Positive", ticker: null, cik: null } }))).toMatch(/description/);
    expect(junkReason(deal({ privateTarget: true, target: { name: "Mercedes-Benz Trucks", ticker: null, cik: null } }))).toBeNull();
  });

  it("drops a private 'target' named only for an oil and gas basin, and a buyer run into 'at the Closing'", () => {
    expect(junkReason(deal({ privateTarget: true, target: { name: "Eagle Ford", ticker: null, cik: null } }))).toMatch(/basin/);
    expect(junkReason(deal({ privateTarget: true, target: { name: "Permian Basin Assets", ticker: null, cik: null } }))).toMatch(/basin/);
    expect(junkReason(deal({ privateTarget: true, target: { name: "Eagle Ford Oil & Gas Corp", ticker: null, cik: null } }))).toBeNull();
    expect(junkReason(deal({ acquirer: { name: "Tenax at the Closing", ticker: null, cik: null } }))).toMatch(/implausible/);
  });

  it("rejects paperwork names and self-deals", () => {
    expect(junkReason(deal({ target: { name: "Entry into a Material Definitive Agreement", ticker: null, cik: null } }))).toMatch(/implausible/);
    expect(junkReason(deal({ acquirer: { name: "Widget", ticker: null, cik: "200" } }))).toMatch(/same registrant/);
    expect(junkReason(deal({ target: { name: "Zamboni MergerCo Inc.", ticker: null, cik: null } }))).toMatch(/merger vehicle/);
    // Real entities: an SEC registrant's own name, and a private group's legal parent.
    expect(junkReason(deal({ target: { name: "Frontier Communications Parent, Inc.", ticker: "FYBR", cik: "20520" } }))).toBeNull();
    expect(junkReason(deal({ privateTarget: true, premiumPct: null, pricePerShare: null, target: { name: "RSC Topco", ticker: null, cik: null } }))).toBeNull();
    // Private banks quote per-share prices: resolved against EDGAR during enrichment, not dropped here.
    expect(junkReason(deal({ privateTarget: true, target: { name: "Comunibanc Corp.", ticker: null, cik: null }, premiumPct: null, pricePerShare: 31.5 }))).toBeNull();
    // A placeholder buyer is kept until a filing names the sponsor.
    expect(junkReason(deal({ acquirer: { name: "Parent", ticker: null, cik: null } }))).toBeNull();
  });

  it("rejects legal documents and dates read as buyers", () => {
    expect(junkReason(deal({ acquirer: { name: "Restated Credit Agreement", ticker: null, cik: null } }))).toMatch(/implausible/);
    expect(junkReason(deal({ acquirer: { name: "Notes and the Indenture are jointly", ticker: null, cik: null } }))).toMatch(/implausible/);
    expect(junkReason(deal({ acquirer: { name: "December 2019", ticker: null, cik: null } }))).toMatch(/implausible/);
    // Real names with these words stay.
    expect(junkReason(deal({ acquirer: { name: "Credit Acceptance Corporation", ticker: "CACC", cik: "885550" } }))).toBeNull();
  });

  it("rejects business development companies (investment funds) as targets", () => {
    expect(junkReason(deal({ target: { name: "Goldman Sachs BDC, Inc.", ticker: "GSBD", cik: "1572694" } }))).toMatch(/investment fund/);
    expect(junkReason(deal({ industry: null, target: { name: "OHA Investment Corp", ticker: "OHAI", cik: "1414932" } }))).toMatch(/investment fund/);
    // An operating company with an industry code and a similar name stays.
    expect(junkReason(deal({ industry: "State Commercial Banks", target: { name: "Pinnacle Capital Corp", ticker: null, cik: "123" } }))).toBeNull();
  });

  it("rejects the same company on both sides by name", () => {
    expect(junkReason(deal({ acquirer: { name: "Nasdaq-listed Gryphon Digital Mining", ticker: null, cik: null }, target: { name: "Gryphon Digital Mining, Inc.", ticker: "GRYP", cik: "1" } }))).toMatch(/same company/);
    expect(junkReason(deal({ acquirer: { name: "Hampton Roads Bankshares, Inc.", ticker: null, cik: null }, target: { name: "Xenith Bankshares, Inc.", ticker: null, cik: "2" } }))).toBeNull();
    // A shared first word isn't the same company.
    expect(junkReason(deal({ acquirer: { name: "Viking Global Technologies, Inc.", ticker: null, cik: null }, target: { name: "Viking Energy", ticker: null, cik: null }, privateTarget: true }))).toBeNull();
  });

  it("cleans a described name before judging it", () => {
    const d = deal({ privateTarget: true, target: { name: "Leading Loyalty Provider Punchh Inc.", ticker: null, cik: null } });
    const deals = [d];
    expect(tidyDeals(deals).dropped).toEqual([]);
    expect(d.target.name).toBe("Punchh Inc.");
  });

  it("rejects SPACs buying private companies, and bare legal suffixes as names", () => {
    const spac = deal({ privateTarget: true, industry: "Blank Checks", acquirer: { name: "Global Star Acquisition Inc.", ticker: "GLST", cik: "1922331" }, target: { name: "K Enter Holdings Inc.", ticker: null, cik: null } });
    expect(junkReason(spac)).toMatch(/SPAC buyer/);
    expect(junkReason({ ...spac, acquirer: { name: "Northern Star Investment Corp. II", ticker: null, cik: "1" } })).toMatch(/SPAC buyer/);
    // A de-SPACed operating company can keep SIC 6770 for years.
    expect(junkReason({ ...spac, acquirer: { name: "Infrastructure & Energy Alternatives, Inc.", ticker: "IEA", cik: "1" } })).toBeNull();
    expect(junkReason(deal({ acquirer: { name: "Callodine Midco, Inc.", ticker: null, cik: null }, target: { name: "Corp", ticker: null, cik: null } }))).toMatch(/implausible/);
  });
});

describe("sanitizeDeal", () => {
  it("clears impossible values and keeps each bank on one side", () => {
    const d = deal({ premiumPct: 367, valueUsd: 5020, terms: { targetFeeUsd: 4e6, reverseFeeUsd: 6e6, goShop: false, goShopDays: null, financingCondition: null, financingBanks: [] }, acquirerAdvisors: ["Centerview", "Goldman Sachs"], targetAdvisors: ["Centerview"] });
    expect(sanitizeDeal(d)).toBe(true);
    expect(d.premiumPct).toBeNull();
    expect(d.valueUsd).toBeNull();
    // No value to compare against: the fee stays.
    expect(d.terms!.targetFeeUsd).toBe(4e6);
    expect(d.acquirerAdvisors).toEqual(["Goldman Sachs"]);
  });

  it("re-cleans names that have no CIK, leaving SEC names alone", () => {
    const d = deal({ acquirer: { name: "Rithm Capital Corp.", ticker: "RITM", cik: "1556593" }, target: { name: "Sculptor Capital Management Together", ticker: null, cik: null } });
    sanitizeDeal(d);
    expect(d.target.name).toBe("Sculptor Capital Management");
    expect(d.acquirer.name).toBe("Rithm Capital Corp.");
  });

  it("drops a fee that is an absurd share of the deal", () => {
    const d = deal({ valueUsd: 170e6, terms: { targetFeeUsd: 5.56e12, reverseFeeUsd: 11e6, goShop: false, goShopDays: null, financingCondition: null, financingBanks: [] } });
    sanitizeDeal(d);
    expect(d.terms!.targetFeeUsd).toBeNull();
    expect(d.terms!.reverseFeeUsd).toBe(11e6);
    expect(sanitizeDeal(d)).toBe(false);
  });
});

describe("tidyDeals", () => {
  it("keeps the right way round of a listed / private pair recorded both ways", () => {
    // MGP Ingredients bought Luxco: the listed record has no merger proxy of MGP's, so the private one stays.
    const back = deal({ id: "835011-2021-01-25", acquirer: { name: "Luxco", ticker: null, cik: null }, target: { name: "MGP Ingredients Inc", ticker: "MGPI", cik: "835011" }, announcedDate: "2021-01-25", valueUsd: 475e6, status: "Announced", statusDate: null });
    const right = deal({ id: "p-luxco-2021-04-01", privateTarget: true, acquirer: { name: "MGP Ingredients Inc", ticker: "MGPI", cik: "835011" }, target: { name: "Luxco", ticker: null, cik: null }, announcedDate: "2021-04-01", valueUsd: null, status: "Closed", statusDate: "2021-04-01" });
    const deals = [back, right];
    tidyDeals(deals);
    expect(deals).toEqual([right]);
    expect(right.acquirer.name).toBe("MGP Ingredients Inc");
    expect(right.valueUsd).toBe(475e6);
    // Commure bought Augmedix, which filed the merger proxy: the listed record stays.
    const listed = deal({ id: "1769804-2024-07-19", acquirer: { name: "Commure, Inc.", ticker: null, cik: null }, target: { name: "Augmedix, Inc.", ticker: "AUGX", cik: "1769804" }, announcedDate: "2024-07-19", milestones: { firstFiling: { form: "PREM14A", date: "2024-08-01" } } as StoredDeal["milestones"] });
    const wrong = deal({ id: "p-commure-2024-10-02", privateTarget: true, acquirer: { name: "Augmedix, Inc.", ticker: "AUGX", cik: "1769804" }, target: { name: "Commure", ticker: null, cik: null }, announcedDate: "2024-10-02" });
    const pair = [listed, wrong];
    tidyDeals(pair);
    expect(pair).toEqual([listed]);
  });

  it("drops a swapped copy whose buyer has no CIK, and rival bids read as a deal between the bidders", () => {
    const right = deal({ id: "1255474-2022-03-08", acquirer: { name: "Oasis Petroleum Inc.", ticker: null, cik: null }, target: { name: "Whiting Petroleum Corp", ticker: "WLL", cik: "1255474" }, announcedDate: "2022-03-08", milestones: { firstFiling: { form: "DEFM14A", date: "2022-05-01" } } as StoredDeal["milestones"] });
    const swapped = deal({ id: "1486159-2022-03-07", acquirer: { name: "Whiting Petroleum Corporation", ticker: null, cik: null }, target: { name: "Oasis Petroleum Inc.", ticker: "OAS", cik: "1486159" }, announcedDate: "2022-03-07", milestones: { firstFiling: { form: "S-4", date: "2022-04-28" } } as StoredDeal["milestones"] });
    const deals = [right, swapped];
    tidyDeals(deals);
    expect(deals).toEqual([right]);
    const won = deal({ acquirer: { name: "II-VI Inc", ticker: "IIVI", cik: "820318" }, target: { name: "Coherent Inc", ticker: "COHR", cik: "21510" }, announcedDate: "2021-02-12" });
    const lost = deal({ acquirer: { name: "MKS Inc", ticker: "MKSI", cik: "1049502" }, target: { name: "Coherent Inc", ticker: "COHR", cik: "21510" }, announcedDate: "2021-02-08", status: "Terminated" });
    const misread = deal({ acquirer: { name: "MKS Inc", ticker: "MKSI", cik: "1049502" }, target: { name: "II-VI Inc", ticker: "IIVI", cik: "820318" }, announcedDate: "2021-02-08" });
    const bids = [won, lost, misread];
    tidyDeals(bids);
    expect(bids).not.toContain(misread);
    expect(bids).toContain(won);
  });

  it("merges the same buyer's private purchase recorded at announcement and completion under two spellings", () => {
    const buyer = { name: "Ondas Inc.", ticker: "ONDS", cik: "1646188" };
    const ann = deal({ privateTarget: true, acquirer: buyer, target: { name: "Rotron Aero", ticker: null, cik: null }, announcedDate: "2026-02-02", status: "Announced", statusDate: null });
    const done = deal({ privateTarget: true, acquirer: buyer, target: { name: "Rotron Aerospace Ltd.", ticker: null, cik: null }, announcedDate: "2026-03-16", status: "Closed", statusDate: "2026-03-16" });
    const deals = [ann, done];
    expect(tidyDeals(deals).merged).toBe(1);
    expect(deals).toEqual([ann]);
    expect(ann.target.name).toBe("Rotron Aerospace Ltd.");
    expect(ann.status).toBe("Closed");
    // Another buyer's purchase of a similarly named company stays separate.
    const other = [deal({ privateTarget: true, target: { name: "Data Foundry", ticker: null, cik: null }, announcedDate: "2021-05-03" }), deal({ privateTarget: true, acquirer: { name: "Live Ventures", ticker: null, cik: null }, target: { name: "Data Foundry Holdings", ticker: null, cik: null }, announcedDate: "2021-09-03" })];
    expect(tidyDeals(other).merged).toBe(0);
  });

  it("treats a buyer written as its ticker as the same buyer, not a rival (UWMC / UWM Holdings)", () => {
    const first = deal({ acquirer: { name: "UWM Holdings Corp", ticker: "UWMC", cik: "1783398" }, announcedDate: "2025-12-17", status: "Pending" });
    const second = deal({ acquirer: { name: "UWMC", ticker: null, cik: null }, announcedDate: "2026-02-02", status: "Closed", statusDate: "2026-08-25" });
    const deals = [first, second];
    const r = tidyDeals(deals);
    expect(r.topped).toBe(0);
    expect(deals).toEqual([first]);
    expect(first.status).toBe("Closed");
    // Already marked topped by the old rule: the merge takes the real outcome and drops the stale timeline.
    const topped = deal({ acquirer: { name: "UWM Holdings Corp", ticker: "UWMC", cik: "1783398" }, announcedDate: "2025-12-17", status: "Terminated", statusDate: "2026-02-02", milestones: { terminated: "2026-02-02" } as StoredDeal["milestones"] });
    const again = [topped, deal({ acquirer: { name: "UWMC", ticker: null, cik: null }, announcedDate: "2026-02-02", status: "Closed", statusDate: "2026-08-25" })];
    tidyDeals(again);
    expect(again).toEqual([topped]);
    expect(topped.status).toBe("Closed");
    expect(topped.milestones).toBeUndefined();
  });

  it("merges the same buyer's second record (H&F / Hellman & Friedman)", () => {
    const a = deal({ acquirer: { name: "Hellman & Friedman", ticker: null, cik: null }, announcedDate: "2021-05-06", premiumPct: null });
    const b = deal({ acquirer: { name: "H&F", ticker: null, cik: null }, announcedDate: "2021-06-16", premiumPct: 25, status: "Closed", statusDate: "2021-07-23" });
    const deals = [a, b];
    const r = tidyDeals(deals);
    expect(deals).toEqual([a]);
    expect(r.merged).toBe(1);
    expect(a.premiumPct).toBe(25);
    expect(a.status).toBe("Closed");
  });

  it("marks an agreement topped by a rival buyer as terminated", () => {
    const first = deal({ acquirer: { name: "Option Care Health", ticker: "OPCH", cik: "300" }, announcedDate: "2023-05-03", status: "Closed", statusDate: "2024-08-01" });
    const second = deal({ acquirer: { name: "Optum", ticker: null, cik: null }, announcedDate: "2023-06-26", status: "Closed", statusDate: "2024-08-01" });
    const deals = [first, second];
    const r = tidyDeals(deals);
    expect(r.topped).toBe(1);
    expect(first.status).toBe("Terminated");
    expect(first.statusDate).toBe("2023-06-26");
    expect(second.status).toBe("Closed");
  });

  it("leaves deals for the same target years apart alone", () => {
    const deals = [deal({ announcedDate: "2021-01-01", status: "Terminated" }), deal({ acquirer: { name: "Other Co", ticker: null, cik: null }, announcedDate: "2024-01-01" })];
    const r = tidyDeals(deals);
    expect(r.topped + r.merged + r.dropped.length).toBe(0);
    // Bought, relisted and bought again: the first deal closed before the second was announced.
    const relisted = [deal({ announcedDate: "2018-01-01", status: "Closed", statusDate: "2018-06-01" }), deal({ acquirer: { name: "Other Co", ticker: null, cik: null }, announcedDate: "2024-01-01" })];
    expect(tidyDeals(relisted).topped).toBe(0);
    expect(relisted[0].status).toBe("Closed");
  });

  it("keeps the older registrant when the same deal was filed under a newer company of the same name", () => {
    const wrong = deal({ id: "2030781-2022-04-11", target: { name: "SailPoint, Inc.", ticker: "SAIL", cik: "2030781" }, acquirer: { name: "Thoma Bravo", ticker: null, cik: null }, announcedDate: "2022-04-11", status: "Announced" });
    const right = deal({ id: "1627857-2022-04-11", target: { name: "SailPoint Technologies Holdings, Inc.", ticker: null, cik: "1627857" }, acquirer: { name: "Thoma Bravo", ticker: null, cik: null }, announcedDate: "2022-04-11", status: "Closed", statusDate: "2022-08-16" });
    const deals = [wrong, right];
    const r = tidyDeals(deals);
    expect(r.merged).toBe(1);
    expect(deals.map((d) => d.id)).toEqual(["1627857-2022-04-11"]);
    expect(right.status).toBe("Closed");
  });

  it("drops a holding-company reorganization of a buyer read as a takeover", () => {
    const reorg = deal({ acquirer: { name: "Maui HoldCo, Inc.", ticker: null, cik: null }, target: { name: "Marvell Technology Group Ltd", ticker: "MRVL", cik: "1058057" }, announcedDate: "2020-10-30" });
    const real = deal({ acquirer: { name: "Marvell Technology, Inc.", ticker: "MRVL", cik: "1058057" }, target: { name: "Inphi Corp", ticker: "IPHI", cik: "1160958" }, announcedDate: "2020-10-29" });
    const deals = [reorg, real];
    tidyDeals(deals);
    expect(deals).toEqual([real]);
  });

  it("drops the copy of a deal read with buyer and target swapped, keeping the one whose target filed the proxy", () => {
    const right = deal({ id: "919864-2026-07-21", acquirer: { name: "First Financial Bancorp", ticker: "FFBC", cik: "708955" }, target: { name: "Finward Bancorp", ticker: "FNWD", cik: "919864" }, announcedDate: "2026-07-21", milestones: { path: "vote", firstFiling: { form: "DEFM14A", date: "2026-09-28" }, definitiveProxy: "2026-09-28", closed: null, terminated: null } });
    const swapped = deal({ id: "708955-2026-07-21", acquirer: { name: "Finward Bancorp", ticker: "FNWD", cik: "919864" }, target: { name: "First Financial Bancorp", ticker: "FFBC", cik: "708955" }, announcedDate: "2026-07-21", milestones: { path: null, firstFiling: { form: "S-4", date: "2026-09-04" }, definitiveProxy: null, closed: null, terminated: null } });
    const deals = [swapped, right];
    tidyDeals(deals);
    expect(deals.map((d) => d.id)).toEqual(["919864-2026-07-21"]);
  });

  it("marks an earlier agreement superseded by a later buyer as terminated, even if the later closing marked it Closed", () => {
    // Lockheed / Aerojet (2020, fell through) and L3Harris / Aerojet (2022, closed 2023): the 2023 Form 25 is L3Harris's.
    const first = deal({ acquirer: { name: "Lockheed Martin Corp", ticker: "LMT", cik: "936468" }, announcedDate: "2020-12-21", status: "Closed", statusDate: "2023-07-28" });
    const proxy = { path: "vote" as const, firstFiling: { form: "PREM14A", date: "2023-01-30" }, definitiveProxy: null, closed: "2023-07-28", terminated: null };
    const second = deal({ acquirer: { name: "L3Harris Technologies, Inc.", ticker: "LHX", cik: "202058" }, announcedDate: "2022-12-19", status: "Closed", statusDate: "2023-07-28", milestones: proxy });
    const r = tidyDeals([first, second]);
    expect(r.topped).toBe(1);
    expect(first.status).toBe("Terminated");
    expect(first.statusDate).toBeNull();
    expect(second.status).toBe("Closed");
  });

  it("leaves an earlier deal alone when the later record is the sale of one business, with no proxy of its own", () => {
    // ICE / Black Knight (closed 2023) and Constellation buying Black Knight's Empower unit, filed under Black Knight.
    const ice = deal({ acquirer: { name: "Intercontinental Exchange, Inc.", ticker: "ICE", cik: "1571949" }, announcedDate: "2022-05-04", status: "Closed", statusDate: "2023-09-05" });
    const unit = deal({ acquirer: { name: "Constellation Software Inc.", ticker: null, cik: null }, announcedDate: "2023-07-17", status: "Closed", statusDate: "2023-09-05" });
    expect(tidyDeals([ice, unit]).topped).toBe(0);
    expect(ice.status).toBe("Closed");
  });

  it("removes SPAC deals by name but keeps mortgage REITs named \"… Investment Corp.\"", () => {
    const spacTarget = deal({ target: { name: "Hudson Executive Investment Corp.", ticker: null, cik: "1803901" } });
    const spacBuyer = deal({ acquirer: { name: "Vine Hill Capital Investment Corp.", ticker: null, cik: null }, target: { name: "CoinShares PLC", ticker: null, cik: "2087587" } });
    const roman = deal({ target: { name: "FS Development Corp. II", ticker: null, cik: "1822711" } });
    const reit = deal({ acquirer: { name: "UWM Holdings Corporation", ticker: null, cik: "1783398" }, target: { name: "Two Harbors Investment Corp.", ticker: "TWO", cik: "1465740" } });
    const deals = [spacTarget, spacBuyer, roman, reit];
    expect(tidyDeals(deals).dropped).toHaveLength(3);
    expect(deals).toEqual([reit]);
  });

  it("removes junk records", () => {
    const deals = [deal({ acquirer: { name: "Company through a reverse triangular merger or other similar structure", ticker: null, cik: null } }), deal()];
    expect(tidyDeals(deals).dropped).toHaveLength(1);
    expect(deals).toHaveLength(1);
  });
});

describe("listing and role checks", () => {
  const filings = (rows: [string, string][]) => ({
    recent: { accessionNumber: rows.map((_, i) => `a${i}`), filingDate: rows.map((r) => r[1]), form: rows.map((r) => r[0]), primaryDocument: rows.map(() => "x.htm"), items: rows.map(() => "") },
  });

  it("listedOn: a reporting company still listed, or delisted after the deal", () => {
    const abiomed = { exchanges: [], filings: filings([["25-NSE", "2022-12-23"], ["SC 14D9", "2022-11-15"], ["10-Q", "2022-11-01"]]) };
    expect(listedOn(abiomed, "2022-11-01")).toBe(true);
    const pending = { exchanges: ["Nasdaq"], filings: filings([["10-Q", "2026-08-05"]]) };
    expect(listedOn(pending, "2026-09-01")).toBe(true);
    // Deregistered long ago: its old Form 25 and 10-Ks don't count.
    const bremer = { exchanges: [], filings: filings([["15-12G", "2004-03-01"], ["25-NSE", "2004-02-01"], ["10-K", "2003-03-01"]]) };
    expect(listedOn(bremer, "2025-01-27")).toBe(false);
  });

  it("provablyUnlistedOn: listed today but not reporting when the deal was announced", () => {
    // Figma: a Form D in 2013, an IPO in 2025; Adobe's agreement was in 2022.
    const figma = { filings: filings([["10-Q", "2025-09-10"], ["424B4", "2025-07-31"], ["S-1", "2025-07-01"], ["D", "2013-05-01"]]) };
    expect(provablyUnlistedOn(figma, "2022-09-15")).toBe(true);
    expect(provablyUnlistedOn(figma, "2025-10-01")).toBe(false);
    // A heavy filer whose index doesn't reach back that far: unknown, so not "unlisted".
    const heavy = { filings: { ...filings([["10-Q", "2026-08-01"], ["424B2", "2025-01-01"]]), files: [{ name: "older.json", filingFrom: "2019-01-01", filingTo: "2024-12-31" }] } };
    expect(provablyUnlistedOn(heavy as never, "2022-09-15")).toBe(false);
  });

  it("takenOverAround: the registrant filed takeover forms around the deal date", () => {
    const discover = { filings: filings([["25-NSE", "2025-05-19"], ["DEFM14A", "2024-12-20"], ["425", "2024-02-20"], ["10-K", "2024-02-15"]]) };
    expect(takenOverAround(discover, "2025-05-19")).toBe(true);
    const apiGroup = { filings: filings([["10-Q", "2025-11-01"], ["8-K", "2025-12-15"]]) };
    expect(takenOverAround(apiGroup, "2026-01-23")).toBe(false);
  });

  it("completedAround: the stored date is the closing (the target delisted within days)", () => {
    const discover = { filings: filings([["25-NSE", "2025-05-19"], ["DEFM14A", "2024-12-20"]]) };
    expect(completedAround(discover, "2025-05-19")).toBe(true);
    // Aerie's record was created from the announcement; its Form 25 came months later.
    expect(completedAround({ filings: filings([["25-NSE", "2022-11-21"]]) }, "2022-08-23")).toBe(false);
  });

  it("isSigningFor: the 8-K Item 1.01 is the merger agreement with this acquirer", () => {
    const section = "On February 19, 2024, Discover Financial Services entered into an Agreement and Plan of Merger with Capital One Financial Corporation.";
    expect(isSigningFor(section, "Capital One Financial Corp")).toBe(true);
    expect(isSigningFor("On February 1, 2024, the Company entered into a credit agreement with JPMorgan Chase Bank.", "Capital One Financial Corp")).toBe(false);
  });

  it("registrantMatches: one-word names only gain descriptors", () => {
    expect(registrantMatches("Aerie Pharmaceuticals Inc", "Aerie")).toBe(true);
    expect(registrantMatches("Arcadium Lithium plc", "Arcadium")).toBe(true);
    expect(registrantMatches("Ruths Hospitality Group, Inc.", "Ruth's Hospitality Group, Inc.")).toBe(true);
    expect(registrantMatches("Urstadt Biddle Properties Inc", "Urstadt Biddle")).toBe(true);
    expect(registrantMatches("Fortune Brands Home & Security, Inc.", "Fortune")).toBe(false);
    expect(registrantMatches("Beacon Financial Corp", "Beacon")).toBe(false);
    expect(registrantMatches("Aeries Technology, Inc.", "Aerie")).toBe(false);
  });
});

describe("SPAC_NAME", () => {
  it("recognises blank-check buyers", () => {
    expect(SPAC_NAME.test("Churchill Capital Corp IV")).toBe(true);
    expect(SPAC_NAME.test("Swiftmerge Acquisition Corp")).toBe(true);
    expect(SPAC_NAME.test("Dragoneer Growth Opportunities Corp.")).toBe(true);
    expect(SPAC_NAME.test("Goldenstone Acquisition Ltd.")).toBe(true);
    expect(SPAC_NAME.test("Ares Capital Corp")).toBe(false);
    expect(SPAC_NAME.test("Main Street Capital Corp")).toBe(false);
  });
});

describe("same-day records for one target", () => {
  it("merges them, keeping the better-documented record and its buyer", () => {
    const mars = deal({ acquirer: { name: "Mars, Incorporated", ticker: null, cik: null }, target: { name: "Heska Corp", ticker: "HSKA", cik: "1038133" }, announcedDate: "2023-04-03", sources: ["a", "b", "c"] });
    const antech = deal({ acquirer: { name: "Antech Holdings Group LLC", ticker: null, cik: null }, target: { name: "Heska Corp", ticker: "HSKA", cik: "1038133" }, announcedDate: "2023-04-03", sources: ["d"], premiumPct: null });
    const r = tidyDeals([mars, antech]);
    expect(r.dropped.map((x) => x.id)).toEqual([antech.id]);
    expect(mars.acquirer.name).toBe("Mars, Incorporated");
    // A rival bid a few weeks later is a different agreement, not a duplicate.
    const lumentum = deal({ acquirer: { name: "Lumentum Holdings Inc.", ticker: "LITE", cik: "1633978" }, target: { name: "Coherent Inc", ticker: "COHR", cik: "21510" }, announcedDate: "2021-01-19" });
    const mks = deal({ acquirer: { name: "MKS Instruments", ticker: "MKSI", cik: "1049502" }, target: { name: "Coherent Inc", ticker: "COHR", cik: "21510" }, announcedDate: "2021-02-08" });
    expect(tidyDeals([lumentum, mks]).dropped.filter((x) => /announced the same day/.test(x.reason))).toEqual([]);
  });
});
