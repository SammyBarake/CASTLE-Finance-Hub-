/**
 * The real enrichment on hand-made records, with EDGAR stubbed: closing days from the 8-K's own sentence, the buyer who took the target's name, a closing
 * only a target's 8-K states, and an announcement dated by its release.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { State, StoredDeal } from "./store";
import type { FtsHit } from "./edgar";
import { buyerNowNamedForTarget } from "./deals";

const h = vi.hoisted(() => ({ subs: {} as Record<string, unknown>, docs: {} as Record<string, string>, hits: [] as unknown[] }));

vi.mock("./edgar", async (orig) => {
  const actual = await orig<typeof import("./edgar")>();
  const doc = async (url: string) => {
    const file = url.split("/").at(-1)!;
    if (h.docs[file] != null) return h.docs[file];
    throw new actual.NotFoundError("not in this test");
  };
  return {
    ...actual,
    fullTextSearch: async () => h.hits,
    getSubmissions: async (cik: string) => {
      if (h.subs[cik]) return h.subs[cik];
      throw new actual.NotFoundError("not in this test");
    },
    getJson: async () => {
      throw new actual.NotFoundError("not in this test");
    },
    getText: doc,
    getTextHead: doc,
    getDailyIndex: async () => null,
    lookupCompanies: async () => [],
    filingDocuments: async () => [],
    getListedCompanies: async () => [],
  };
});

type Row = { form: string; date: string; items?: string; reportDate?: string; doc?: string };
const filer = (cik: string, name: string, rows: Row[], formerNames: unknown[] = []) => ({
  cik,
  name,
  sic: "3000",
  sicDescription: "Stub",
  tickers: [name.slice(0, 3).toUpperCase()],
  exchanges: ["NYSE"],
  stateOfIncorporation: "DE",
  formerNames,
  filings: {
    recent: {
      accessionNumber: rows.map((_, i) => `0000000000-26-${100000 + Number(cik) + i}`),
      filingDate: rows.map((r) => r.date),
      reportDate: rows.map((r) => r.reportDate ?? ""),
      form: rows.map((r) => r.form),
      primaryDocument: rows.map((r) => r.doc ?? "d.htm"),
      items: rows.map((r) => r.items ?? ""),
    },
    files: [],
  },
});

const base = {
  valueUsd: 1e8,
  valueKind: "transaction",
  pricePerShare: null,
  premiumPct: null,
  consideration: "Cash",
  sector: "Tech",
  industry: "x",
  status: "Announced",
  statusDate: null,
  enterpriseValueUsd: null,
  evEbitda: null,
  evRevenue: null,
  acquirerAdvisors: [],
  targetAdvisors: [],
  sources: ["a"],
  statusCheckedAt: null,
  financialsCheckedAt: "2026-11-01",
};

const privateDeal = (over: Record<string, unknown>) =>
  ({
    ...base,
    privateTarget: true,
    id: "p-acme-2026-01-01",
    announcedDate: "2026-01-01",
    acquirer: { name: "Buyer Inc", ticker: "BUY", cik: "111" },
    target: { name: "Acme Widgets", ticker: null, cik: null },
    filings: [{ form: "8-K", filedDate: "2026-01-01", url: "https://www.sec.gov/Archives/edgar/data/111/000000000026100111/d.htm" }],
    ...over,
  }) as unknown as StoredDeal;

async function enrich(deals: StoredDeal[], today = "2026-11-03") {
  const { ingestDeals, buildDirectory } = await import("./deals");
  const state: State = { deals, ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] };
  await ingestDeals(state, { from: today, to: today, directory: buildDirectory([]), log: () => {}, today });
  return state;
}

const hit = (over: Partial<FtsHit>) => ({ id: "x", adsh: "0000000000-21-000001", file: "a.htm", form: "8-K", rootForm: "8-K", fileType: "8-K", fileDate: "2021-01-01", ciks: [], displayNames: [], sics: [], items: [], ...over });

describe("private closings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("no network in a test");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    h.subs = {};
    h.docs = {};
    h.hits = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("takes the 8-K's stated day (Lixte / NOMAD)", async () => {
    h.subs["111"] = filer("111", "Lixte Biotechnology Holdings, Inc.", [{ form: "8-K", date: "2026-07-02", items: "1.01,2.01,9.01", doc: "nomad.htm" }]);
    h.docs["nomad.htm"] = `Item 1.01 Entry into a Material Definitive Agreement. The Merger Agreement with Nomad Transportable Power Systems, Inc ("NOMAD") is described above. Item 2.01 Completion of Acquisition or Disposition of Assets. On July 1, 2026, the Merger was consummated by the filing of a Certificate of Merger with NOMAD. Item 9.01 Financial Statements and Exhibits.`;
    const state = await enrich([privateDeal({ announcedDate: "2026-06-16", target: { name: "Nomad Transportable Power Systems", ticker: null, cik: null } })], "2026-07-05");
    expect(state.deals[0]).toMatchObject({ status: "Closed", statusDate: "2026-07-01" });
  });

  it("keeps the filing date when the 8-K gives only the agreement's", async () => {
    h.subs["111"] = filer("111", "Buyer Inc", [{ form: "8-K", date: "2026-04-03", items: "2.01,9.01", doc: "c.htm" }]);
    h.docs["c.htm"] = `Item 2.01 Completion of Acquisition or Disposition of Assets. The Company completed the acquisition of Acme Widgets, Inc. under the Merger Agreement, dated as of March 30, 2026. Item 9.01 Financial Statements and Exhibits.`;
    const state = await enrich([privateDeal({})], "2026-04-05");
    expect(state.deals[0]).toMatchObject({ status: "Closed", statusDate: "2026-04-03" });
  });

  it("a buyer who has since taken the target's name: its later 8-K lists a subsidiary, and the 10-K dates the closing (Peck / iSun)", async () => {
    h.subs["111"] = filer(
      "111",
      "ISUN, INC.",
      [
        { form: "8-K", date: "2021-10-05", items: "1.01,2.01,2.03,3.02,8.01,9.01", doc: "suncommon.htm" },
        { form: "10-K", date: "2021-04-01", doc: "tenk.htm" },
      ],
      [{ name: "PECK Co HOLDINGS, INC.", from: "2019-06-26T00:00:00.000Z", to: "2021-01-20T00:00:00.000Z" }],
    );
    h.docs["suncommon.htm"] = `Item 1.01 Entry into a Material Definitive Agreement. The Loan Agreement is guaranteed by iSun Energy LLC, a Delaware limited liability company. Item 2.01 Completion of Acquisition or Disposition of Assets. The Merger closed on October 1, 2021. Item 9.01 Exhibits.`;
    h.docs["tenk.htm"] = `On January 19, 2021, we completed a business combination (the "Merger Agreement") pursuant to which we acquired iSun Energy LLC ("iSun Energy, LLC").`;
    h.hits = [hit({ form: "10-K", rootForm: "10-K", fileType: "10-K", file: "tenk.htm", fileDate: "2021-04-01" })];
    const state = await enrich([privateDeal({ id: "p-isun-energy-2021-01-05", announcedDate: "2021-01-05", acquirer: { name: "Peck Company Holdings", ticker: "ISUN", cik: "111" }, target: { name: "iSun Energy", ticker: null, cik: null } })], "2022-11-03");
    expect(state.deals[0]).toMatchObject({ status: "Closed", statusDate: "2021-01-19" });
  });

  it("a serial buyer's 8-K naming the target still counts, and so does one from before the new name", () => {
    const riot = { name: "RideNow Group, Inc.", formerNames: [{ name: "RumbleOn, Inc.", from: "2021-06-01T00:00:00.000Z", to: "2025-07-01T00:00:00.000Z" }] };
    expect(buyerNowNamedForTarget(riot, "RideNow", "2021-03-12", "2021-08-31")).toBe(false);
    expect(buyerNowNamedForTarget(riot, "RideNow", "2021-03-12", "2025-08-31")).toBe(true);
    // A first word shared all along is no rename: First Merchants and First Capital.
    expect(buyerNowNamedForTarget({ name: "First Merchants Corp", formerNames: [] }, "First Capital", "2021-03-12", "2021-08-31")).toBe(false);
    expect(buyerNowNamedForTarget({ name: "Rocket Lab USA, Inc.", formerNames: [] }, "SolAero", "2021-12-20", "2022-01-20")).toBe(false);
  });

  it("a reverse merger's own closing 8-K, filed days after the buyer took the target's name, still counts", () => {
    // EDGAR's own record: Aerpio became Aadi Bioscience on August 23 2021, at the merger.
    const aadi = {
      name: "Whitehawk Therapeutics, Inc.",
      formerNames: [
        { name: "Aadi Bioscience, Inc.", from: "2021-08-27T00:00:00.000Z", to: "2025-03-18T00:00:00.000Z" },
        { name: "Aerpio Pharmaceuticals, Inc.", from: "2017-03-17T00:00:00.000Z", to: "2021-08-23T00:00:00.000Z" },
      ],
    };
    expect(buyerNowNamedForTarget(aadi, "Aadi Bioscience", "2021-05-16", "2021-08-27")).toBe(false);
    // Months on, an 8-K naming the old target is about something else (iSun's guarantor, nine months after the rename).
    expect(buyerNowNamedForTarget(aadi, "Aadi Bioscience", "2021-05-16", "2022-03-01")).toBe(true);
    const hornbeck = { name: "HORNBECK OFFSHORE SERVICES, INC.", formerNames: [{ name: "HELIX ENERGY SOLUTIONS GROUP INC", from: "2006-03-09T00:00:00.000Z", to: "2026-08-31T00:00:00.000Z" }] };
    expect(buyerNowNamedForTarget(hornbeck, "Hornbeck", "2026-04-23", "2026-09-02")).toBe(false);
  });
});

describe("a target's own 8-K closing the deal (Senti)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("no network in a test");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    h.subs = {};
    h.docs = {};
    h.hits = [];
    h.subs["222"] = filer("222", "Senti Biosciences Holdings, Inc.", [
      { form: "8-K", date: "2026-10-26", items: "1.01,1.02,2.01,3.02,9.01", reportDate: "2026-10-21", doc: "close.htm" },
      { form: "8-K", date: "2026-10-15", items: "5.07", reportDate: "2026-10-15" },
      { form: "DEFM14A", date: "2026-09-24" },
      { form: "PREM14A", date: "2026-07-21" },
      { form: "10-Q", date: "2026-05-10" },
      { form: "10-K", date: "2026-03-01" },
      { form: "10-K", date: "2025-03-01" },
    ]);
    h.docs["close.htm"] = `Introductory Note On October 21, 2026, Senti Biosciences Holdings, Inc., a Delaware corporation (the "Company"), completed the transactions contemplated by the Agreement and Plan of Merger, dated as of July 14, 2026 (the "Merger Agreement"), by and among the Company and ST NewCo Limited ("Parent"). Item 1.01 Entry into a Material Definitive Agreement. On October 21, 2026, Midco entered into a Contingent Value Rights Agreement. Item 1.02 Termination of a Material Definitive Agreement. The Company ended a services agreement.`;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const senti = () =>
    ({
      ...base,
      id: "222-2026-07-15",
      announcedDate: "2026-07-15",
      acquirer: { name: "Celadon Partners SPV 35", ticker: null, cik: null },
      target: { name: "Senti Biosciences Holdings, Inc.", ticker: "SNT", cik: "222" },
      filings: [{ form: "8-K", filedDate: "2026-07-15", url: "https://www.sec.gov/Archives/edgar/data/222/000000000026100222/d.htm" }],
      fairnessCheckedAt: "2026-11-01",
      fairnessParser: 999,
      meetingDate: "2026-10-08",
      proxyCheckedAt: "2026-11-01",
      termsCheckedAt: "2026-11-01",
    }) as unknown as StoredDeal;

  it("closes on the stated day, with the vote and the timeline's closing", async () => {
    const [deal] = (await enrich([senti()])).deals;
    expect(deal).toMatchObject({ status: "Closed", statusDate: "2026-10-21" });
    expect(deal.milestones).toMatchObject({ voteHeld: "2026-10-15", closed: "2026-10-21" });
  });

  it("stays Pending when the 8-K is another purchase", async () => {
    h.docs["close.htm"] = `Item 2.01 Completion of Acquisition or Disposition of Assets. On October 21, 2026, the Company completed the purchase of a laboratory under a Purchase Agreement, dated October 1, 2026. Item 9.01 Exhibits.`;
    const [deal] = (await enrich([senti()])).deals;
    expect(deal.status).toBe("Pending");
    expect(deal.milestones?.closed).toBeNull();
  });
});

describe("findAnnouncement", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("no network in a test");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    h.subs = {};
    h.docs = {};
    h.hits = [];
    h.subs["111"] = filer("111", "Greif, Inc", []);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const closingDated = () => privateDeal({ dateIsClosing: true, id: "p-ipackchem-2024-03-27", announcedDate: "2024-03-27", status: "Closed", statusDate: "2024-03-27", target: { name: "Ipackchem", ticker: null, cik: null } });

  it("dates it by the release, days before the 8-K (Greif / Ipackchem)", async () => {
    h.hits = [hit({ file: "rel.htm", fileDate: "2023-11-06", adsh: "0000043920-23-000057" })];
    h.docs["rel.htm"] = "Greif Plans to Acquire IPACKCHEM\nDELAWARE, Ohio, Oct. 31, 2023 (GLOBE NEWSWIRE) -- Greif, Inc. has entered into a definitive agreement to acquire Ipackchem.";
    const [deal] = (await enrich([closingDated()], "2024-03-28")).deals;
    expect(deal.announcedDate).toBe("2023-10-31");
    expect(deal.dateIsClosing).toBeUndefined();
  });

  it("by another document of the same filing, when this one gives no day", async () => {
    h.hits = [hit({ file: "body.htm", fileDate: "2023-11-06", adsh: "0000043920-23-000057" }), hit({ file: "rel.htm", fileDate: "2023-11-06", adsh: "0000043920-23-000057" })];
    h.docs["body.htm"] = "Item 8.01 Other Events. Greif, Inc. has entered into a definitive agreement to acquire Ipackchem.";
    h.docs["rel.htm"] = "Greif Plans to Acquire IPACKCHEM\nDELAWARE, Ohio, Oct. 31, 2023 (GLOBE NEWSWIRE) -- Greif today announced its plans.";
    const [deal] = (await enrich([closingDated()], "2024-03-28")).deals;
    expect(deal.announcedDate).toBe("2023-10-31");
  });

  it("by the filing date when nothing states a day", async () => {
    h.hits = [hit({ file: "body.htm", fileDate: "2023-11-06", adsh: "0000043920-23-000057" })];
    h.docs["body.htm"] = "Item 8.01 Other Events. Greif, Inc. has entered into a definitive agreement to acquire Ipackchem.";
    const [deal] = (await enrich([closingDated()], "2024-03-28")).deals;
    expect(deal.announcedDate).toBe("2023-11-06");
  });

  it("by the signing an 8-K states, filed days later (Organon / Dermavant: signed Tuesday, filed the next Monday)", async () => {
    h.hits = [hit({ file: "body.htm", fileDate: "2023-11-06", adsh: "0000043920-23-000057" })];
    h.docs["body.htm"] =
      "FORM 8-K Date of Report (Date of earliest event reported): October 31, 2023 Item 1.01 Entry into a Material Definitive Agreement. On October 31, 2023, Greif, Inc. (the \"Company\"), and Greif Bermuda Ltd., an indirect wholly owned subsidiary of the Company, entered into a Share Purchase Agreement to acquire Ipackchem.";
    const [deal] = (await enrich([closingDated()], "2024-03-28")).deals;
    expect(deal.announcedDate).toBe("2023-10-31");
  });

  it("from a results release that announces it (Sensata / Dynapower, TransMedics / Summit Aviation)", async () => {
    h.hits = [hit({ file: "q3.htm", fileDate: "2023-08-01", adsh: "0000043920-23-000041" })];
    h.docs["q3.htm"] = "GREIF REPORTS THIRD QUARTER 2023 RESULTS DELAWARE, Ohio, Aug. 1, 2023 -- Greif today reported results. Recent Highlights ▪ Net sales rose 5%. ▪ Signed definitive agreement to acquire Ipackchem. ▪ Completed a notes offering.";
    const [deal] = (await enrich([closingDated()], "2024-03-28")).deals;
    expect(deal.announcedDate).toBe("2023-08-01");
  });

  it("not from a purchase only in prospect (CarGurus: \"the potential future purchase of the remaining 49% interest in CarOffer\")", async () => {
    h.hits = [hit({ file: "q1.htm", fileDate: "2023-05-09", adsh: "0000043920-23-000030" })];
    h.docs["q1.htm"] = "GREIF REPORTS FIRST QUARTER 2023 RESULTS There were 7.9 million potentially dilutive shares related to the potential future purchase of the remaining 49% interest in Ipackchem.";
    const [deal] = (await enrich([closingDated()], "2024-03-28")).deals;
    expect(deal.announcedDate).toBe("2024-03-27");
  });

  it("not from a results release, a letter of intent or a recollection: those leave the date for the next document", async () => {
    h.hits = [
      hit({ file: "q3.htm", fileDate: "2023-08-01", adsh: "0000043920-23-000041" }),
      hit({ file: "loi.htm", fileDate: "2023-09-01", adsh: "0000043920-23-000045" }),
      hit({ file: "recall.htm", fileDate: "2023-10-02", adsh: "0000043920-23-000050" }),
      hit({ file: "rel.htm", fileDate: "2023-11-06", adsh: "0000043920-23-000057" }),
    ];
    h.docs["q3.htm"] = "GREIF ANNOUNCES THIRD QUARTER 2023 RESULTS Highlights • Announced agreement to acquire Ipackchem\nDELAWARE, Ohio, Aug. 1, 2023 -- Greif today reported results.";
    h.docs["loi.htm"] = "Item 8.01 Other Events. On September 1, 2023, Greif, Inc. entered into a binding letter of intent (the \"LOI\") to acquire Ipackchem.";
    h.docs["recall.htm"] = "Item 8.01 Other Events. In March 2023, we entered into an agreement to acquire Ipackchem. On October 2, 2023, we received the regulators' approval.";
    h.docs["rel.htm"] = "Greif Plans to Acquire IPACKCHEM\nDELAWARE, Ohio, Oct. 31, 2023 (GLOBE NEWSWIRE) -- Greif, Inc. has entered into a definitive agreement to acquire Ipackchem.";
    const [deal] = (await enrich([closingDated()], "2024-03-28")).deals;
    expect(deal.announcedDate).toBe("2023-10-31");
  });
});

describe("purchaseAgreementEnded", () => {
  it("reads the end of the agreement defined beside the company's name (Freedom / Maxim, Tempo / Optimum)", async () => {
    const { purchaseAgreementEnded } = await import("./deals");
    const maxim = 'Item 1.02 Termination of a Material Definitive Agreement. As previously disclosed, on February 15, 2023, Freedom Holding Corp. (the "Company") entered into a Membership Interest Purchase Agreement (the "Purchase Agreement") with Maxim Partners LLC for the purchase of 100% of the membership interests of Maxim Group LLC. Accordingly, effective October 31, 2023, the Company and the Sellers terminated the Purchase Agreement by their mutual written consent.';
    expect(purchaseAgreementEnded(maxim, /\bMaxim\b/i)).toBe(true);
    const optimum = 'pursuant to a Securities Purchase Agreement (as amended, the "Purchase Agreement") by and among the Company, Optimum Design Associates, Inc. The Purchase Agreement contained the right for either party to terminate the Purchase Agreement if the closing had not occurred. As a result, the Purchase Agreement was terminated as of August 1, 2023.';
    expect(purchaseAgreementEnded(optimum, /\bOptimum Design Associates\b/i)).toBe(true);
  });
  it("not another agreement the 8-K ends, nor a right to terminate (Standard BioTools / Treeline)", async () => {
    const { purchaseAgreementEnded } = await import("./deals");
    const other = 'Item 1.02 The material terms of the Multiplex Bio Purchase Agreement are incorporated by reference. The Company entered into an Agreement and Plan of Merger (the "Merger Agreement") with Treeline Biosciences, Inc. The Multiplex Bio Purchase Agreement was terminated.';
    expect(purchaseAgreementEnded(other, /\bTreeline Biosciences\b/i)).toBe(false);
    const right = 'a Stock Purchase Agreement (the "Purchase Agreement") with Acme Widgets, Inc. Either party has the right to terminate the Purchase Agreement if the closing does not occur by June 30.';
    expect(purchaseAgreementEnded(right, /\bAcme Widgets\b/i)).toBe(false);
  });
});

describe("a run's deadline", () => {
  beforeEach(() => {
    h.subs = {};
    h.docs = {};
    h.hits = [];
  });

  async function runBy(deadline: number) {
    const { ingestDeals, buildDirectory } = await import("./deals");
    const deal = privateDeal({ statusCheckedAt: null });
    const state: State = { deals: [deal], ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] };
    const stats = await ingestDeals(state, { from: "2026-11-03", to: "2026-11-03", directory: buildDirectory([]), log: () => {}, today: "2026-11-03", deadline });
    return { stats, deal: state.deals[0] };
  }

  it("past it while filings are left to read: stops there, enriches nothing, and says so", async () => {
    // (A merger 8-K: the search keeps Item 1.01 8-Ks.)
    h.hits = [hit({ id: "0000000000-26-000001:a.htm", displayNames: ["Buyer Inc  (BUY)  (CIK 0000000111)"], ciks: ["0000000111"], items: ["1.01"] })];
    const { stats, deal } = await runBy(Date.now() - 1);
    expect(stats.outOfTime).toBe("reading");
    expect(stats.documents).toBe(0);
    expect(deal.statusCheckedAt).toBeNull();
  });

  it("past it with every filing read: stops enriching and says so", async () => {
    const { stats, deal } = await runBy(Date.now() - 1);
    expect(stats.outOfTime).toBe("enriching");
    expect(deal.statusCheckedAt).toBeNull();
  });

  it("not reached: the run is whole", async () => {
    const { stats, deal } = await runBy(Date.now() + 3_600_000);
    expect(stats.outOfTime).toBeUndefined();
    expect(deal.statusCheckedAt).toBe("2026-11-03");
  });
});
