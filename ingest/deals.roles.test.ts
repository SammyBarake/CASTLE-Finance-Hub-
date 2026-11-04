/**
 * The real enrichment on hand-made records, with EDGAR stubbed: a record read backwards gets its roles swapped, and the
 * reaction it held was the old "buyer's" shares. It must not stay on the record as the new buyer's (ingest/reactions.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { State, StoredDeal } from "./store";

const h = vi.hoisted(() => ({ subs: {} as Record<string, unknown> }));

vi.mock("./edgar", async (orig) => {
  const actual = await orig<typeof import("./edgar")>();
  const missing = async () => {
    throw new actual.NotFoundError("not in this test");
  };
  return {
    ...actual,
    fullTextSearch: async () => [],
    getSubmissions: async (cik: string) => {
      if (h.subs[cik]) return h.subs[cik];
      throw new actual.NotFoundError("not in this test");
    },
    getJson: missing,
    getText: missing,
    getTextHead: missing,
    getDailyIndex: async () => null,
    lookupCompanies: async () => [],
    filingDocuments: async () => [],
    getListedCompanies: async () => [],
  };
});

/** A filer with these forms on file. */
const filer = (cik: string, name: string, forms: [string, string][]) => ({
  cik,
  name,
  sic: "3000",
  sicDescription: "Stub",
  tickers: [name.slice(0, 3).toUpperCase()],
  exchanges: ["NYSE"],
  stateOfIncorporation: "DE",
  formerNames: [],
  filings: {
    recent: {
      accessionNumber: forms.map((_, i) => `0000000000-26-${100000 + Number(cik) + i}`),
      filingDate: forms.map((f) => f[1]),
      form: forms.map((f) => f[0]),
      primaryDocument: forms.map(() => "d.htm"),
      items: forms.map(() => ""),
    },
    files: [],
  },
});

const reaction = { announcementPct: -5, announcementVsMarketPct: -6, m6VsMarketPct: 2.5, y1VsMarketPct: null };

const record = (): StoredDeal =>
  ({
    id: "222-2026-03-02",
    announcedDate: "2026-03-02",
    acquirer: { name: "Alpha Widgets Inc", ticker: "ALP", cik: "111" },
    target: { name: "Bravo Gadgets Inc", ticker: "BRA", cik: "222" },
    valueUsd: 1e9,
    valueKind: "transaction",
    pricePerShare: null,
    premiumPct: null,
    consideration: "Stock",
    sector: "Tech",
    industry: "x",
    status: "Announced",
    statusDate: null,
    enterpriseValueUsd: null,
    evEbitda: null,
    evRevenue: null,
    acquirerAdvisors: ["A"],
    targetAdvisors: ["B"],
    filings: [{ form: "8-K", filedDate: "2026-03-02", url: "https://www.sec.gov/Archives/edgar/data/222/000000000026100222/d.htm" }],
    sources: ["a"],
    statusCheckedAt: null,
    financialsCheckedAt: null,
    reaction,
    reactionCheckedAt: "2026-11-01",
  }) as unknown as StoredDeal;

async function enrich(deals: StoredDeal[]) {
  const { ingestDeals, buildDirectory } = await import("./deals");
  const state: State = { deals, ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] };
  await ingestDeals(state, { from: "2026-11-01", to: "2026-11-03", directory: buildDirectory([]), log: () => {}, today: "2026-11-03" });
  return state;
}

describe("a record read backwards", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("no network in a test");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    // The "target" registered shares on an S-4 and filed no target's document; the "buyer" filed the merger proxy.
    h.subs["222"] = filer("222", "Bravo Gadgets Inc", [["S-4", "2026-04-01"], ["10-K", "2026-02-20"]]);
    h.subs["111"] = filer("111", "Alpha Widgets Inc", [["DEFM14A", "2026-05-01"], ["10-K", "2026-02-20"]]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("swaps the roles and doesn't keep the old buyer's reaction as the new buyer's", async () => {
    const state = await enrich([record()]);
    const [deal] = state.deals;
    expect(deal.acquirer.cik).toBe("222");
    expect(deal.target.cik).toBe("111");
    expect(deal.reaction).toBeUndefined();
    expect(deal.reactionCheckedAt).toBeUndefined();
  });
});
