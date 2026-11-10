import { describe, expect, it } from "vitest";
import { completedAround, isSigningFor, listedOn, provablyUnlistedOn, registrantMatches, takenOverAround } from "./deals";
import { nameOn } from "./edgar";
import { correctKnownClosing, junkReason, mergeSplitRecords, oneDeal, putReleaseFirst, reversedCopies, sanitizeDeal, SPAC_NAME, tidyDeals } from "./tidy";
import type { StoredDeal } from "./store";

describe("putReleaseFirst", () => {
  const base = "https://www.sec.gov/Archives/edgar/data/1361113/000121390026109901/";

  it("links the release a deal was read from, ahead of the bare form it came with", () => {
    const d = { filings: [{ form: "8-K", filedDate: "2026-10-15", url: `${base}ea0308610-8k_varonis.htm` }], sources: ["0001213900-26-109901:ea0308610-8k_varonis.htm", "0001213900-26-109901:ea030861001ex99-1.htm"] };
    putReleaseFirst(d);
    expect(d.filings[0]).toEqual({ form: "8-K (EX-99)", filedDate: "2026-10-15", url: `${base}ea030861001ex99-1.htm` });
    expect(d.filings[1].form).toBe("8-K");
    // Running again changes nothing.
    putReleaseFirst(d);
    expect(d.filings).toHaveLength(2);
  });

  it("puts a same-day release first, and never moves an earlier filing behind a later one", () => {
    const d = {
      filings: [
        { form: "8-K", filedDate: "2026-10-15", url: `${base}a.htm` },
        { form: "DEFA14A (EX-99.1)", filedDate: "2026-10-15", url: "https://www.sec.gov/Archives/edgar/data/1/000000000000000002/b.htm" },
        { form: "8-K (EX-99.1)", filedDate: "2026-10-20", url: "https://www.sec.gov/Archives/edgar/data/1/000000000000000003/c.htm" },
      ],
      sources: [],
    };
    putReleaseFirst(d);
    expect(d.filings.map((f) => f.form)).toEqual(["DEFA14A (EX-99.1)", "8-K", "8-K (EX-99.1)"]);
    const later = { filings: [{ form: "8-K", filedDate: "2026-10-15", url: `${base}a.htm` }, { form: "8-K (EX-99.1)", filedDate: "2026-10-20", url: "https://www.sec.gov/Archives/edgar/data/1/000000000000000003/c.htm" }], sources: [] };
    putReleaseFirst(later);
    expect(later.filings[0].form).toBe("8-K");
  });

  it("on the same day, prefers an 8-K's exhibit to another form's memo or deck, and a 99.1 to a 99.2", () => {
    const d = {
      filings: [
        { form: "SC TO-C (EX-99.2)", filedDate: "2022-11-01", url: "https://www.sec.gov/Archives/edgar/data/1/000000000000000001/deck.htm" },
        { form: "8-K (EX-99.2)", filedDate: "2022-11-01", url: "https://www.sec.gov/Archives/edgar/data/1/000000000000000002/ex992.htm" },
        { form: "8-K", filedDate: "2022-11-01", url: "https://www.sec.gov/Archives/edgar/data/1/000000000000000002/a.htm" },
        { form: "8-K (EX-99)", filedDate: "2022-11-01", url: "https://www.sec.gov/Archives/edgar/data/1/000000000000000002/ex991.htm" },
      ],
      sources: [],
    };
    putReleaseFirst(d);
    expect(d.filings.map((f) => f.form)).toEqual(["8-K (EX-99)", "8-K (EX-99.2)", "SC TO-C (EX-99.2)", "8-K"]);
    const pick = { filings: [{ form: "8-K", filedDate: "2026-10-15", url: `${base}a.htm` }], sources: ["0001213900-26-109901:a.htm", "0001213900-26-109901:ex99-2.htm", "0001213900-26-109901:ex99-1.htm"] };
    putReleaseFirst(pick);
    expect(pick.filings[0].url).toBe(`${base}ex99-1.htm`);
  });

  it("leaves a deal alone when no release is on record, and doesn't take another filing's exhibit", () => {
    const d = { filings: [{ form: "8-K", filedDate: "2026-10-15", url: `${base}a.htm` }], sources: ["0001213900-26-109901:a.htm", "0009999999-26-000001:ex99-1.htm", "0001213900-26-109901:ex10-1.htm"] };
    putReleaseFirst(d);
    expect(d.filings).toHaveLength(1);
    const none = { filings: [], sources: [] };
    putReleaseFirst(none);
    expect(none.filings).toEqual([]);
  });
});

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

  it("falls back to the earliest name still in use after the date when EDGAR's 'from' is late", () => {
    const rumble = {
      name: "RideNow Group, Inc.",
      formerNames: [
        { name: "RumbleOn, Inc.", from: "2021-06-24T00:00:00.000Z", to: "2025-08-12T00:00:00.000Z" },
        { name: "Smart Server, Inc", from: "2014-01-24T00:00:00.000Z", to: "2017-01-23T00:00:00.000Z" },
      ],
    };
    expect(nameOn(rumble, "2021-03-15")).toBe("RumbleOn, Inc.");
    expect(nameOn(rumble, "2016-01-01")).toBe("Smart Server, Inc");
    expect(nameOn(rumble, "2026-01-01")).toBe("RideNow Group, Inc.");
  });
});

describe("junkReason", () => {
  it("drops a business development company as the target with or without a period after Corp", () => {
    const target = (name: string) => ({ name, ticker: null, cik: "1" });
    expect(junkReason(deal({ industry: null, target: target("Logan Ridge Finance Corp.") }))).toMatch(/investment fund/);
    expect(junkReason(deal({ industry: null, target: target("SLR Senior Investment Corp.") }))).toMatch(/investment fund/);
    expect(junkReason(deal({ industry: null, target: target("Logan Ridge Finance Corp") }))).toMatch(/investment fund/);
    // A company with an industry code is an operating company, or a REIT.
    expect(junkReason(deal({ industry: "Real Estate Investment Trusts", target: target("Two Harbors Investment Corp.") }))).toBeNull();
  });

  it("drops a national bank subsidiary as the buyer", () => {
    expect(junkReason(deal({ acquirer: { name: "Citibank, N.A.", ticker: null, cik: null } }))).toMatch(/lender/);
  });

  it("drops a private purchase by a SPAC-named buyer whatever its industry", () => {
    expect(junkReason(deal({ privateTarget: true, industry: "Gas & Other Services Combined", acquirer: { name: "Rice Acquisition Corp.", ticker: null, cik: null }, target: { name: "Aria Energy LLC", ticker: null, cik: null } }))).toMatch(/SPAC/);
    expect(junkReason(deal({ acquirer: { name: "Rice Acquisition Corp.", ticker: null, cik: null } }))).toBeNull();
  });

  it("drops a single branded hotel as a private target", () => {
    expect(junkReason(deal({ privateTarget: true, target: { name: "Residence Inn by Marriott Seattle South/Renton", ticker: null, cik: null } }))).toMatch(/hotel/);
    expect(junkReason(deal({ privateTarget: true, target: { name: "Radisson Hotel Group Americas", ticker: null, cik: null } }))).toBeNull();
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

  it("blanks a topped deal's terms for the next run to re-read up to its end date (MKS, Masonite), not the winner's, once", () => {
    const coherent = { name: "Coherent Inc", ticker: "COHR", cik: "21510" };
    const iiVi = deal({ id: "21510-2021-02-12", acquirer: { name: "II-VI Inc", ticker: "IIVI", cik: "820318" }, target: coherent, announcedDate: "2021-02-12", status: "Closed", statusDate: "2022-07-01", valueUsd: 7e9, terms: { targetFeeUsd: 108.8e6, reverseFeeUsd: 500e6, goShop: false, goShopDays: null, financingCondition: null, financingBanks: ["JPMorgan"] }, termsCheckedAt: "2026-11-05" });
    const mks = deal({ id: "21510-2021-02-08", acquirer: { name: "MKS Instruments Inc", ticker: "MKSI", cik: "1049502" }, target: coherent, announcedDate: "2021-02-08", status: "Pending", valueUsd: 7e9, terms: { ...iiVi.terms! }, termsCheckedAt: "2026-11-05" });
    expect(tidyDeals([mks, iiVi]).topped).toBe(1);
    expect(mks).toMatchObject({ status: "Terminated", statusDate: "2021-02-12", termsCheckedAt: null });
    expect(mks.terms).toBeUndefined();
    expect(mks.milestones).toBeUndefined();
    // The winner keeps its own.
    expect(iiVi.terms?.reverseFeeUsd).toBe(500e6);
    // The next run re-read it: tidy doesn't clear it again.
    mks.terms = { targetFeeUsd: 217.6e6, reverseFeeUsd: null, goShop: false, goShopDays: null, financingCondition: null, financingBanks: [] };
    mks.termsCheckedAt = "2026-11-06";
    expect(tidyDeals([mks, iiVi]).topped).toBe(0);
    expect(mks).toMatchObject({ termsCheckedAt: "2026-11-06", terms: { targetFeeUsd: 217.6e6 } });
  });

  it("a bank that is the buyer itself moves off the target, and self-advice stays credited (TriState, GreenSky)", () => {
    const tri = deal({ acquirer: { name: "Raymond James", ticker: null, cik: null }, targetAdvisors: ["Stephens", "Raymond James"], acquirerAdvisors: [] });
    sanitizeDeal(tri);
    expect(tri).toMatchObject({ targetAdvisors: ["Stephens"], acquirerAdvisors: ["Raymond James"] });
    const greensky = deal({ acquirer: { name: "Goldman Sachs Group Inc", ticker: "GS", cik: "886982" }, targetAdvisors: ["Morgan Stanley"], acquirerAdvisors: ["Goldman Sachs"] });
    sanitizeDeal(greensky);
    expect(greensky).toMatchObject({ targetAdvisors: ["Morgan Stanley"], acquirerAdvisors: ["Goldman Sachs"] });
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
    const reit = deal({ acquirer: { name: "UWM Holdings Corporation", ticker: null, cik: "1783398" }, target: { name: "Two Harbors Investment Corp.", ticker: "TWO", cik: "1465740" }, industry: "Real Estate Investment Trusts" });
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

describe("a losing bid and the winner's proxy", () => {
  const aerojet = { name: "Aerojet Rocketdyne Holdings, Inc.", ticker: "AJRD", cik: "40888" };
  const lockheed = { name: "Lockheed Martin Corp", ticker: "LMT", cik: "936468" };
  const l3 = { name: "L3Harris Technologies, Inc.", ticker: "LHX", cik: "202058" };
  const opinion = { bank: "Evercore", side: "target", ranges: [] } as unknown as NonNullable<StoredDeal["fairness"]>[number];
  const links = [{ label: "Background", url: "https://x/#b" }];
  const shared = { fairnessAdsh: "0001140361-23-006402", fairness: [opinion], proxySections: links, meetingDate: "2023-03-16", fairnessCheckedAt: "2026-11-04" };

  it("clears it from an earlier Terminated record with a blank date, keeps it read, and leaves the winner's alone", () => {
    const lost = deal({ id: "40888-2020-12-21", acquirer: lockheed, target: aerojet, announcedDate: "2020-12-21", status: "Terminated", statusDate: null, ...shared, milestones: { path: "vote", firstFiling: { form: "PREM14A", date: "2021-01-25" }, definitiveProxy: "2021-02-05", voteHeld: "2021-03-09", closed: "2023-07-28", terminated: null } });
    const won = deal({ id: "40888-2022-12-19", acquirer: l3, target: aerojet, announcedDate: "2022-12-18", status: "Closed", statusDate: "2023-07-28", ...shared });
    tidyDeals([lost, won]);
    expect(lost).toMatchObject({ fairnessAdsh: null, meetingDate: null, fairnessCheckedAt: "2026-11-04" });
    expect(lost.fairness).toBeUndefined();
    expect(lost.proxySections).toBeUndefined();
    // Its own milestones stay; what dates from the winner's deal goes.
    expect(lost.milestones).toMatchObject({ definitiveProxy: "2021-02-05", voteHeld: "2021-03-09", closed: null });
    expect(won).toMatchObject({ fairnessAdsh: shared.fairnessAdsh, proxySections: links, meetingDate: "2023-03-16" });
  });

  it("marks it read if the search hadn't finished, so it isn't read again", () => {
    const lost = deal({ acquirer: lockheed, target: aerojet, announcedDate: "2020-12-21", status: "Terminated", statusDate: null, ...shared, fairnessCheckedAt: null, statusCheckedAt: "2026-11-04" });
    const won = deal({ acquirer: l3, target: aerojet, announcedDate: "2022-12-18", status: "Closed", statusDate: "2023-07-28", ...shared });
    tidyDeals([lost, won]);
    expect(lost.fairnessCheckedAt).toBe("2026-11-04");
  });

  it("works when both are Terminated, as JetBlue and Frontier on Spirit", () => {
    const spirit = { name: "Spirit Airlines, Inc.", ticker: "SAVE", cik: "1498710" };
    const frontier = deal({ acquirer: { name: "Frontier Group Holdings, Inc.", ticker: "ULCC", cik: "1670076" }, target: spirit, announcedDate: "2022-02-07", status: "Terminated", statusDate: "2024-03-04", ...shared, milestones: { path: "vote", firstFiling: { form: "DEFM14A", date: "2022-05-11" }, definitiveProxy: "2022-05-11", voteHeld: "2022-10-19", closed: null, terminated: "2024-03-04" } });
    const jetblue = deal({ acquirer: { name: "Jetblue Airways Corp", ticker: "JBLU", cik: "1158463" }, target: spirit, announcedDate: "2022-07-28", status: "Terminated", statusDate: "2024-03-04", ...shared });
    tidyDeals([frontier, jetblue]);
    // The date was JetBlue's (blanked by the rule above), and so was the proxy.
    expect(frontier.statusDate).toBeNull();
    expect(frontier.fairnessAdsh).toBeNull();
    expect(jetblue.fairnessAdsh).toBe(shared.fairnessAdsh);
  });

  it("leaves two closed buyers of one company sharing theirs", () => {
    // Gray and IAC each bought part of Meredith, on one proxy.
    const meredith = { name: "Meredith Corp", ticker: "MDP", cik: "65011" };
    const gray = deal({ acquirer: { name: "Gray Television, Inc.", ticker: "GTN", cik: "43196" }, target: meredith, announcedDate: "2021-05-03", status: "Closed", statusDate: "2021-12-01", partOfTarget: true, ...shared });
    const iac = deal({ acquirer: { name: "IAC", ticker: "IAC", cik: "891103" }, target: meredith, announcedDate: "2021-10-06", status: "Closed", statusDate: "2021-12-01", partOfTarget: true, ...shared });
    tidyDeals([gray, iac]);
    expect(gray.fairnessAdsh).toBe(shared.fairnessAdsh);
    expect(iac.fairnessAdsh).toBe(shared.fairnessAdsh);
    expect(gray.proxySections).toEqual(links);
  });

  it("leaves a terminated deal with its own proxy, and the same buyer's later agreement", () => {
    const hess = { name: "Hess Corp", ticker: "HES", cik: "4447" };
    const own = deal({ acquirer: lockheed, target: hess, announcedDate: "2021-01-01", status: "Terminated", statusDate: "2021-06-01", ...shared, fairnessAdsh: "a" });
    const next = deal({ acquirer: l3, target: hess, announcedDate: "2022-01-01", status: "Closed", statusDate: "2022-06-01", ...shared, fairnessAdsh: "b" });
    tidyDeals([own, next]);
    expect(own.fairnessAdsh).toBe("a");
    // CP and KCS signed twice: one buyer, kept whole.
    const kcs = { name: "Kansas City Southern", ticker: "KSU", cik: "54480" };
    const first = deal({ acquirer: { name: "Canadian Pacific Railway Ltd", ticker: "CP", cik: "16875" }, target: kcs, announcedDate: "2021-03-21", status: "Terminated", statusDate: "2021-05-21", ...shared });
    const second = deal({ acquirer: { name: "Canadian Pacific Railway Ltd", ticker: "CP", cik: "16875" }, target: kcs, announcedDate: "2021-09-15", status: "Closed", statusDate: "2021-12-14", ...shared });
    tidyDeals([first, second]);
    expect(first.fairnessAdsh).toBe(shared.fairnessAdsh);
  });
});

describe("a closing filings can't date", () => {
  it("sets Expro / Frank's International to October 1 2021 and lets go of its later sale's proxy, once", () => {
    const franks = deal({ id: "1575828-2021-03-11", acquirer: { name: "Expro Ltd", ticker: "XPRO", cik: "2126198" }, target: { name: "Frank's International N.V.", ticker: "FI", cik: "1575828" }, announcedDate: "2021-03-11", status: "Closed", statusDate: "2026-07-14", fairnessAdsh: "0001104659-26-046161", fairnessCheckedAt: "2026-11-04", termsCheckedAt: "2026-11-04", proxySections: [{ label: "Background", url: "u" }], terms: { targetFeeUsd: 37_500_000, reverseFeeUsd: 71_500_000, goShop: null, goShopDays: null, financingCondition: null, financingBanks: [] }, milestones: { path: "vote", firstFiling: { form: "S-4", date: "2021-04-26" }, definitiveProxy: "2026-04-21", voteHeld: "2026-06-15", closed: "2026-07-14", terminated: null } });
    correctKnownClosing(franks);
    expect(franks).toMatchObject({ status: "Closed", statusDate: "2021-10-01", fairnessAdsh: null, termsCheckedAt: null, fairnessCheckedAt: "2026-11-04" });
    expect(franks.terms).toBeUndefined();
    expect(franks.proxySections).toBeUndefined();
    expect(franks.milestones).toEqual({ path: "vote", firstFiling: { form: "S-4", date: "2021-04-26" }, definitiveProxy: null, voteHeld: null, closed: "2021-10-01", terminated: null });
    // Terms read again later stay.
    franks.termsCheckedAt = "2026-11-05";
    correctKnownClosing(franks);
    expect(franks.termsCheckedAt).toBe("2026-11-05");
  });
  it("touches nothing else, nor Expro's own purchases", () => {
    const other = deal({ status: "Pending", statusDate: "2026-01-01", fairnessAdsh: "a" });
    correctKnownClosing(other);
    expect(other).toMatchObject({ status: "Pending", statusDate: "2026-01-01", fairnessAdsh: "a" });
    const later = deal({ target: { name: "Expro Group Holdings N.V.", ticker: "XPRO", cik: "1575828" }, announcedDate: "2026-01-15", status: "Closed", statusDate: "2026-07-14" });
    correctKnownClosing(later);
    expect(later.statusDate).toBe("2026-07-14");
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

  it("brings a reaction across only from the same buyer", () => {
    const reaction = { announcementPct: 1, announcementVsMarketPct: 2, m6VsMarketPct: null, y1VsMarketPct: null };
    const target = { name: "Heska Corp", ticker: "HSKA", cik: "1038133" };
    const listed = { name: "Lumentum Holdings Inc.", ticker: "LITE", cik: "1633978" };
    const keep = deal({ acquirer: { ...listed }, target, announcedDate: "2023-04-03", sources: ["a", "b", "c"] });
    const twin = deal({ acquirer: { ...listed }, target, announcedDate: "2023-04-03", sources: ["d"], reaction, reactionCheckedAt: "2026-11-01" });
    tidyDeals([keep, twin]);
    expect(keep.reaction).toEqual(reaction);
    expect(keep.reactionCheckedAt).toBe("2026-11-01");
    // Mars's shares aren't Lumentum's: Mars has none, so its record gets no reaction.
    const mars = deal({ acquirer: { name: "Mars, Incorporated", ticker: null, cik: null }, target, announcedDate: "2023-04-03", sources: ["a", "b", "c"] });
    const rival = deal({ acquirer: { ...listed }, target, announcedDate: "2023-04-03", sources: ["d"], reaction, reactionCheckedAt: "2026-11-01" });
    tidyDeals([mars, rival]);
    expect(mars.acquirer.name).toBe("Mars, Incorporated");
    expect(mars.reaction).toBeUndefined();
  });
});

describe("old merger-arb quotes", () => {
  it("are removed from every record, so the next save takes the raw quotes out of the public table", () => {
    const d = deal({}) as StoredDeal & { arb?: unknown };
    d.arb = { priceUsd: 45.68, spreadPct: 4, asOf: "2026-10-21" };
    tidyDeals([d]);
    expect("arb" in d).toBe(false);
  });
});

describe("merging a duplicate", () => {
  it("keeps the reaction the duplicate holds", () => {
    const reaction = { announcementPct: 1, announcementVsMarketPct: 2, m6VsMarketPct: 3, y1VsMarketPct: null };
    const buyer = { name: "Ondas Inc.", ticker: "ONDS", cik: "1646188" };
    const ann = deal({ privateTarget: true, acquirer: buyer, target: { name: "Rotron Aero", ticker: null, cik: null }, announcedDate: "2026-02-02", status: "Announced", statusDate: null });
    const done = deal({ privateTarget: true, acquirer: buyer, target: { name: "Rotron Aerospace Ltd.", ticker: null, cik: null }, announcedDate: "2026-03-16", status: "Closed", statusDate: "2026-03-16", reaction, reactionCheckedAt: "2026-10-01" });
    const deals = [ann, done];
    tidyDeals(deals);
    expect(deals).toEqual([ann]);
    expect(ann.reaction).toEqual(reaction);
    // One already there stays.
    const own = { ...reaction, announcementPct: 9 };
    const a = deal({ acquirer: buyer, reaction: own, announcedDate: "2026-02-02" });
    const b = deal({ acquirer: buyer, reaction, announcedDate: "2026-02-20" });
    tidyDeals([a, b]);
    expect(a.reaction).toBe(own);
  });

  it("doesn't pass one company's reaction to another its name happens to start like", () => {
    // Tidy's duplicate check goes by a shared first word: General Motors and General Electric for one target, 19 days apart.
    const reaction = { announcementPct: 1, announcementVsMarketPct: 2, m6VsMarketPct: 3, y1VsMarketPct: null };
    const target = { name: "Heska Corp", ticker: "HSKA", cik: "1038133" };
    const gm = deal({ acquirer: { name: "General Motors Co", ticker: "GM", cik: "1467858" }, target, announcedDate: "2024-03-01" });
    const ge = deal({ acquirer: { name: "General Electric Co", ticker: "GE", cik: "40545" }, target, announcedDate: "2024-03-20", reaction, reactionCheckedAt: "2026-10-01" });
    tidyDeals([gm, ge]);
    expect(gm.reaction).toBeUndefined();
    expect(gm.reactionCheckedAt).toBeUndefined();
  });
});

describe("one deal stored as two records", () => {
  const EDGAR = "https://www.sec.gov/Archives/edgar/data";
  const figure = (twoDay: number) => ({ twoDay } as unknown as StoredDeal["reaction"]);
  const buyer = (name: string, ticker: string | null, cik: string | null) => ({ name, ticker, cik });
  const closed = (over: Partial<StoredDeal>) => deal({ privateTarget: true, status: "Closed", ...over });

  it("a private copy filed by the listed target (Baxter / HILLROM, in Hill-Rom's own release)", () => {
    const baxter = buyer("Baxter International Inc", "BAX", "10456");
    const listed = deal({ id: "47518-2021-09-02", acquirer: baxter, target: { name: "Hill-Rom Holdings, Inc.", ticker: null, cik: "47518" }, announcedDate: "2021-09-02", status: "Closed", statusDate: "2021-12-13", sources: ["a:1", "a:2"] });
    const copy = closed({ id: "p-hillrom-2021-12-13", acquirer: baxter, target: { name: "HILLROM", ticker: null, cik: null }, announcedDate: "2021-12-13", statusDate: "2021-12-13", filings: [{ form: "8-K", filedDate: "2021-12-13", url: EDGAR + "/47518/000119312521355520/d210479dex991.htm" }], sources: ["b:1"], reaction: figure(-2) });
    const deals = [copy, listed];
    expect(mergeSplitRecords(deals).map((m) => m.why)).toEqual(["filed by the listed target"]);
    expect(deals).toEqual([listed]);
    expect(listed.announcedDate).toBe("2021-09-02");
    expect(listed.filings).toHaveLength(1);
    // Measured around the closing, three months after the announcement: not this deal's reaction.
    expect(listed.reaction).toBeUndefined();
  });

  it("not when the buyer of the private record is the listed target itself (Prosperity's banks, Stellar in the filing's words)", () => {
    const stellar = buyer("Stellar Bancorp, Inc.", "STEL", "1473844");
    const listed = deal({ acquirer: buyer("Prosperity Bancshares Inc", "PB", "1068851"), target: { name: "Stellar Bancorp, Inc.", ticker: "STEL", cik: "1473844" } });
    const own = closed({ acquirer: stellar, target: { name: "Other Bank", ticker: null, cik: null }, filings: [{ form: "8-K", filedDate: "2024-01-10", url: EDGAR + "/1473844/000000000000000001/a.htm" }] });
    expect(oneDeal(own, listed)).toBeNull();
  });

  it("the same buyer on the same day with nothing that differs (Simmons / Texas Bancshares), but not with another figure", () => {
    const simmons = buyer("Simmons First National Corp", "SFNC", "90498");
    const listed = deal({ acquirer: simmons, target: { name: "Spirit of Texas Bancshares, Inc.", ticker: "STXB", cik: "1499453" }, announcedDate: "2021-11-19", valueUsd: 581e6, pricePerShare: null, consideration: "Stock" });
    expect(oneDeal(closed({ acquirer: simmons, target: { name: "Texas Bancshares, Inc.", ticker: null, cik: null }, announcedDate: "2021-11-19", valueUsd: 581e6, pricePerShare: null, consideration: "Stock" }), listed)).toBe("same buyer, same day, no figure differs");
    expect(oneDeal(closed({ acquirer: simmons, target: { name: "Landmark Community Bank", ticker: null, cik: null }, announcedDate: "2021-11-19", valueUsd: 92e6, pricePerShare: null, consideration: "Stock" }), listed)).toBeNull();
  });

  it("a holding company and its business at one stated value (Vroom / Unitas and United Auto Credit), never by a value alone a month apart", () => {
    const vroom = buyer("Vroom, Inc.", "VRM", "1580864");
    const a = closed({ acquirer: vroom, target: { name: "Unitas Holdings Corp.", ticker: null, cik: null }, announcedDate: "2021-10-12", statusDate: "2022-02-01", valueUsd: 3e8 });
    const b = closed({ acquirer: vroom, target: { name: "United Auto Credit Corporation", ticker: null, cik: null }, announcedDate: "2021-10-12", statusDate: "2022-02-01", valueUsd: 3e8 });
    expect(oneDeal(a, b)).toBe("same stated value within a week");
    expect(oneDeal(a, { ...b, announcedDate: "2021-11-20" })).toBeNull();
  });

  it("two names closed together and paid alike (Hilton Grand Vacations / Dakota Holdings and Diamond Resorts)", () => {
    const hgv = buyer("Hilton Grand Vacations Inc.", "HGV", "1674168");
    const a = closed({ acquirer: hgv, target: { name: "Dakota Holdings, Inc.", ticker: null, cik: null }, announcedDate: "2021-03-11", statusDate: "2021-08-03", valueUsd: null, pricePerShare: null, consideration: "Stock" });
    const b = closed({ acquirer: hgv, target: { name: "Diamond Resorts", ticker: null, cik: null }, announcedDate: "2021-03-11", statusDate: "2021-08-03", valueUsd: 14e8, pricePerShare: null, consideration: "Stock" });
    expect(oneDeal(a, b)).toBe("closed the same day, same payment");
  });

  it("one name inside the other, closed together (US Bancorp / MUFG Union Bank and Union Bank, a year apart)", () => {
    const usb = buyer("US Bancorp", "USB", "36104");
    const a = closed({ acquirer: usb, target: { name: "MUFG Union Bank", ticker: null, cik: null }, announcedDate: "2021-09-21", statusDate: "2022-12-01", valueUsd: null, pricePerShare: null, consideration: null });
    const b = closed({ acquirer: usb, target: { name: "Union Bank", ticker: null, cik: null }, announcedDate: "2022-12-01", statusDate: "2022-12-01", valueUsd: null, pricePerShare: null, consideration: null });
    expect(oneDeal(a, b)).toBe("closed the same day, one name inside the other");
  });

  it("two registrants of one ticker (Energy Transfer / Crestwood Equity and Crestwood Midstream, both CEQP)", () => {
    const et = buyer("Energy Transfer LP", "ET", "1276187");
    const a = deal({ acquirer: et, target: { name: "Crestwood Midstream Partners LP", ticker: "CEQP", cik: "1304464" }, announcedDate: "2023-08-16" });
    const b = deal({ acquirer: et, target: { name: "Crestwood Equity Partners LP", ticker: "CEQP", cik: "1136352" }, announcedDate: "2023-08-16" });
    expect(oneDeal(a, b)).toBe("same buyer and target ticker");
  });

  it("leaves a serial buyer's real deals apart", () => {
    const prosperity = buyer("Prosperity Bancshares Inc", "PB", "1068851");
    const onfolio = buyer("Onfolio Holdings, Inc", "ONFO", "1825452");
    const ionq = buyer("IonQ, Inc.", "IONQ", "1824920");
    const cargurus = buyer("CarGurus, Inc.", "CARG", "1494259");
    const none = { valueUsd: null, pricePerShare: null, consideration: null };
    const pairs = [
      // Two Texas banks announced together, at different values.
      [closed({ acquirer: prosperity, status: "Announced", target: { name: "First Bancshares of Texas", ticker: null, cik: null }, announcedDate: "2022-10-11", valueUsd: 3416e5, pricePerShare: null, consideration: "Stock" }), closed({ acquirer: prosperity, status: "Announced", target: { name: "Lone Star State Bancshares", ticker: null, cik: null }, announcedDate: "2022-10-11", valueUsd: 2287e5, pricePerShare: null, consideration: "Stock" })],
      // Two sites bought and closed on one day, with nothing stated.
      [closed({ acquirer: onfolio, target: { name: "Proofread Anywhere", ticker: null, cik: null }, announcedDate: "2022-10-19", statusDate: "2022-10-19", ...none }), closed({ acquirer: onfolio, target: { name: "SEOButler", ticker: null, cik: null }, announcedDate: "2022-10-19", statusDate: "2022-10-19", ...none })],
      // A private purchase on the day of a listed one's date, whose filing isn't the target's.
      [closed({ acquirer: ionq, target: { name: "Skyloom", ticker: null, cik: null }, announcedDate: "2026-01-30", statusDate: "2026-01-30", ...none }), deal({ acquirer: ionq, target: { name: "SkyWater Technology, Inc", ticker: "SKYT", cik: "1819974" }, announcedDate: "2026-01-26", status: "Closed", statusDate: "2026-07-31", valueUsd: null, pricePerShare: null, consideration: "Mixed" })],
      // A stake, then the rest, three years on.
      [closed({ acquirer: cargurus, target: { name: "CarOffer", ticker: null, cik: null }, announcedDate: "2021-01-14", statusDate: "2021-01-14", valueUsd: null, pricePerShare: null, consideration: null }), closed({ acquirer: cargurus, target: { name: "CarOffer", ticker: null, cik: null }, announcedDate: "2023-12-04", statusDate: "2023-12-04", valueUsd: 75e6, pricePerShare: null, consideration: null })],
    ];
    for (const [a, b] of pairs) expect(oneDeal(a, b)).toBeNull();
    expect(oneDeal(deal({ partOfTarget: true }), deal())).toBeNull();
  });

  it("the record that stays takes a figure from the same days, and an earlier announcement's over its closing-day one (Helix / Hornbeck, MGP / Luxco)", () => {
    const helix = buyer("Helix Energy Solutions Group Inc", "HLX", "866829");
    const hornbeck = closed({ id: "p-hornbeck-2026-04-23", acquirer: helix, target: { name: "Hornbeck", ticker: null, cik: null }, announcedDate: "2026-04-23", statusDate: "2026-09-01", valueUsd: null, pricePerShare: null, consideration: "Stock", sources: ["a:1", "a:2"] });
    const vehicle = closed({ id: "p-odyssey-sub-2026-04-24", acquirer: { ...helix, ticker: "HOS" }, target: { name: "Odyssey Sub, Inc.", ticker: null, cik: null }, announcedDate: "2026-04-24", statusDate: "2026-09-01", valueUsd: null, pricePerShare: null, consideration: "Stock", sources: ["b:1"], reaction: figure(3) });
    const first = [hornbeck, vehicle];
    mergeSplitRecords(first);
    expect(first).toEqual([hornbeck]);
    expect(hornbeck.reaction).toEqual(figure(3));

    const mgp = buyer("MGP Ingredients Inc", "MGPI", "835011");
    const luxco = closed({ id: "p-luxco-2021-04-01", acquirer: mgp, target: { name: "Luxco", ticker: null, cik: null }, announcedDate: "2021-04-01", statusDate: "2021-04-01", valueUsd: 475e6, pricePerShare: null, consideration: "Mixed", sources: ["c:1", "c:2"], reaction: figure(-9) });
    const holdco = closed({ id: "p-london-holdco-2021-01-25", acquirer: { ...mgp, ticker: "CASK" }, target: { name: "London HoldCo, Inc.", ticker: null, cik: null }, announcedDate: "2021-01-25", statusDate: "2021-04-01", valueUsd: null, pricePerShare: null, consideration: "Stock", sources: ["d:1", "c:1"], reaction: figure(6) });
    const second = [holdco, luxco];
    mergeSplitRecords(second);
    expect(second).toEqual([luxco]);
    expect(luxco.announcedDate).toBe("2021-01-25");
    expect(luxco.reaction).toEqual(figure(6));
  });

  it("through tidy, the merged record is reported dropped so the database removes it", () => {
    const vroom = buyer("Vroom, Inc.", "VRM", "1580864");
    const a = closed({ id: "p-united-auto-credit-2021-10-12", acquirer: vroom, target: { name: "United Auto Credit Corporation", ticker: null, cik: null }, announcedDate: "2021-10-12", statusDate: "2022-02-01", valueUsd: 3e8, pricePerShare: null, sources: ["a:1", "a:2"] });
    const b = closed({ id: "p-unitas-2021-10-12", acquirer: vroom, target: { name: "Unitas Holdings Corp.", ticker: null, cik: null }, announcedDate: "2021-10-12", statusDate: "2022-02-01", valueUsd: 3e8, pricePerShare: null, sources: ["b:1"] });
    const deals = [a, b];
    const r = tidyDeals(deals);
    expect(deals.map((d) => d.id)).toEqual(["p-united-auto-credit-2021-10-12"]);
    expect(r.dropped.map((d) => d.id)).toEqual(["p-unitas-2021-10-12"]);
  });

  it("a buyout read backwards goes, and the record the target filed for stays (Seacor buying American Industrial Partners)", () => {
    const seacor = { name: "Seacor Holdings Inc", ticker: null, cik: "859598" };
    const real = deal({ id: "859598-2020-12-07", acquirer: buyer("American Industrial Partners", null, null), target: seacor, announcedDate: "2020-12-07", status: "Closed", statusDate: "2021-04-16", valueUsd: 845445221, pricePerShare: 41.5, milestones: { firstFiling: { form: "SC 14D9", date: "2020-12-15" } } as StoredDeal["milestones"] });
    const back = closed({ id: "p-american-industrial-partners-2021-04-16", acquirer: buyer("Seacor Holdings Inc", "CKH", "859598"), target: { name: "American Industrial Partners", ticker: null, cik: null }, announcedDate: "2021-04-16", status: "Announced", statusDate: null, valueUsd: null, sources: ["b:1"] });
    const deals = [real, back];
    expect(reversedCopies(deals).map((m) => m.extra.id)).toEqual([back.id]);
    expect(deals).toEqual([real]);
    expect(real.sources).toEqual(["b:1"]);
  });

  it("a listed company issuing the shares keeps the private record, with the closing (JFB Construction / XTEND)", () => {
    const jfb = { name: "JFB Construction Holdings", ticker: "JFB", cik: "2024306" };
    const swapped = deal({ id: "2024306-2026-02-18", acquirer: buyer("Xtend AI Robotics, Inc.", "XTND", "2111860"), target: jfb, announcedDate: "2026-02-13", status: "Closed", statusDate: "2026-09-03", valueUsd: 15e8, pricePerShare: null, consideration: "Stock", milestones: { firstFiling: { form: "DEFM14C", date: "2026-08-01" } } as StoredDeal["milestones"], sources: ["a:1"] });
    const own = closed({ id: "p-xtend-reality-expansion-2026-02-17", acquirer: jfb, target: { name: "XTEND Reality Expansion Ltd.", ticker: null, cik: null }, announcedDate: "2026-02-17", status: "Announced", statusDate: null, valueUsd: 15e8, pricePerShare: null, consideration: "Stock", sources: ["b:1"] });
    const deals = [swapped, own];
    reversedCopies(deals);
    expect(deals).toEqual([own]);
    expect(own).toMatchObject({ status: "Closed", statusDate: "2026-09-03" });
  });

  it("an agreement can't end after its rival signed: the date is the rival's, so it goes blank (Frontier / Spirit, JetBlue's 2024 date)", () => {
    const spirit = { name: "Spirit Airlines, Inc.", ticker: "SAVE", cik: "1498710" };
    const frontier = deal({ id: "1498710-2022-02-07", acquirer: buyer("Frontier Group Holdings, Inc.", "ULCC", "1670076"), target: spirit, announcedDate: "2022-02-07", status: "Terminated", statusDate: "2024-03-04", valueUsd: 29e8 });
    const jetblue = deal({ id: "1498710-2022-07-28", acquirer: buyer("JetBlue Airways Corp", "JBLU", "1158463"), target: spirit, announcedDate: "2022-07-28", status: "Terminated", statusDate: "2024-03-04", valueUsd: 38e8 });
    tidyDeals([frontier, jetblue]);
    expect(frontier).toMatchObject({ status: "Terminated", statusDate: null });
    expect(jetblue.statusDate).toBe("2024-03-04");
  });
});

describe("a new public company over the buyer of another", () => {
  it("is a holding-company reorganization, not a takeover (New Pubco / R1 RCM, buying Cloudmed)", () => {
    const r1 = { name: "R1 RCM Inc.", ticker: "RCM", cik: "1472595" };
    const reorganised = deal({ id: "1472595-2022-01-10", acquirer: { name: "New Pubco and Sellers", ticker: null, cik: null }, target: r1, announcedDate: "2022-01-10", valueUsd: 41e8 });
    const cloudmed = deal({ id: "p-cloudmed-2022-01-10", privateTarget: true, acquirer: r1, target: { name: "Cloudmed", ticker: null, cik: null }, announcedDate: "2022-01-10", valueUsd: 41e8 });
    const deals = [reorganised, cloudmed];
    tidyDeals(deals);
    expect(deals.map((d) => d.id)).toEqual(["p-cloudmed-2022-01-10"]);
  });
});

describe("SPAC names with a series numeral", () => {
  it("are SPACs", () => {
    expect(SPAC_NAME.test("Roth CH Acquisition V Co.")).toBe(true);
    expect(SPAC_NAME.test("Acquisition Vault Co.")).toBe(false);
  });
});
