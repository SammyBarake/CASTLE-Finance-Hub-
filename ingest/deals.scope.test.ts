/**
 * What the real ingest does with these, EDGAR stubbed: a target listed abroad or over the counter stays out through its closing
 * release, a de-SPACed operating company stays in, and a registrant's state tag doesn't make a listed target private.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FtsHit } from "./edgar";
import type { State, StoredDeal } from "./store";

const h = vi.hoisted(() => ({
  subs: {} as Record<string, unknown>,
  hits: [] as unknown[],
  docs: {} as Record<string, string>,
  lookups: {} as Record<string, { cik: string; name: string }[]>,
}));

vi.mock("./edgar", async (orig) => {
  const actual = await orig<typeof import("./edgar")>();
  const missing = async () => {
    throw new actual.NotFoundError("not in this test");
  };
  return {
    ...actual,
    // Each document once, under the first private query.
    fullTextSearch: async (o: { q: string; from: string; to: string }) => (o.q === '"has acquired"' ? (h.hits as FtsHit[]).filter((x) => x.fileDate >= o.from && x.fileDate <= o.to) : []),
    getSubmissions: async (cik: string) => {
      if (h.subs[cik]) return h.subs[cik];
      throw new actual.NotFoundError("not in this test");
    },
    getJson: missing,
    getText: async (url: string) => {
      const file = url.split("/").pop()!;
      if (h.docs[file]) return h.docs[file];
      throw new actual.NotFoundError("not in this test");
    },
    getTextHead: missing,
    getDailyIndex: async () => null,
    lookupCompanies: async (name: string) => h.lookups[name] ?? [],
    filingDocuments: async () => [],
    getListedCompanies: async () => [],
  };
});

const filer = (cik: string, name: string, forms: [string, string][], over: Record<string, unknown> = {}) => ({
  cik,
  name,
  sic: "3000",
  sicDescription: "Stub",
  tickers: [],
  exchanges: [],
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
  ...over,
});

const release = (file: string, adsh: string, fileDate: string, cik: string, name: string, text: string, sics: string[] = []): FtsHit => {
  h.docs[file] = text;
  return { id: `${adsh}:${file}`, adsh, file, form: "8-K", rootForm: "8-K", fileType: "EX-99.1", fileDate, ciks: [cik], displayNames: [`${name}  (CIK ${cik.padStart(10, "0")})`], sics, items: [] };
};

const listed = (cik: string, name: string, ticker: string) => ({ cik, name, ticker, exchange: "Nasdaq" });

async function run(from: string, to: string, directory: ReturnType<typeof listed>[], deals: StoredDeal[] = []) {
  const { ingestDeals, buildDirectory } = await import("./deals");
  const state: State = { deals, ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] };
  await ingestDeals(state, { from, to, directory: buildDirectory(directory), log: () => {}, today: "2026-11-03" });
  return state;
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("no network in a test");
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  h.subs = {};
  h.hits = [];
  h.docs = {};
  h.lookups = {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a target quoted over the counter", () => {
  const zeo = listed("1865506", "Zeo Energy Corp.", "ZEO");
  const announcement = () =>
    release(
      "ann.htm",
      "0001213900-25-048489",
      "2025-05-29",
      "1865506",
      "Zeo Energy Corp.",
      "Zeo Energy Corp. to Acquire Heliogen, Inc., Expected to Create a Clean Energy Leader\nNEW PORT RICHEY, Fla., May 29, 2025 - Zeo Energy Corp. (NASDAQ: ZEO) and Heliogen, Inc. (OTCQX: HLGN) today announced a definitive agreement under which Zeo Energy Corp. will acquire Heliogen, Inc.",
    );
  const closing = () =>
    release("close.htm", "0001213900-25-073918", "2025-08-11", "1865506", "Zeo Energy Corp.", "Zeo Energy Corp. Completes Acquisition of Heliogen, Inc.\nNEW PORT RICHEY, Fla., Aug. 11, 2025 - Zeo Energy Corp. today announced that it has completed the acquisition of Heliogen, Inc.");

  it("Zeo / Heliogen: its closing release doesn't bring it back, though it has a ticker", async () => {
    h.hits = [announcement(), closing()];
    h.subs["1865506"] = filer("1865506", "Zeo Energy Corp.", [["10-K", "2025-03-20"]], { exchanges: ["Nasdaq"], tickers: ["ZEO"] });
    const state = await run("2025-05-01", "2025-08-31", [zeo]);
    expect(state.deals.filter((d) => /Heliogen/i.test(d.target.name))).toEqual([]);
    expect(state.seen.has("offshore:1865506:heliogen")).toBe(true);
  });

  it("a closing release with no earlier announcement read still makes a record (the key is what stops it)", async () => {
    h.hits = [closing()];
    h.subs["1865506"] = filer("1865506", "Zeo Energy Corp.", [["10-K", "2025-03-20"]], { exchanges: ["Nasdaq"], tickers: ["ZEO"] });
    const state = await run("2025-05-01", "2025-08-31", [zeo]);
    expect(state.deals.filter((d) => /Heliogen/i.test(d.target.name))).toHaveLength(1);
  });

  it("an OTC bank stays in (Peoples / Citizens National)", async () => {
    h.hits = [
      release(
        "pebo.htm",
        "0000318300-26-000142",
        "2026-04-21",
        "318300",
        "Peoples Bancorp Inc",
        `Peoples Bancorp Inc. to Acquire Citizens\nMARIETTA, Ohio, April 21, 2026 - Peoples Bancorp Inc. (NASDAQ: PEBO) and Citizens National Corporation ("Citizens") (OTCPK: CZNL) today announced a definitive agreement under which Peoples Bancorp Inc. will acquire Citizens for $76.6 million.`,
        ["6022"],
      ),
    ];
    h.subs["318300"] = filer("318300", "Peoples Bancorp Inc", [["10-K", "2026-03-01"]], { exchanges: ["Nasdaq"], tickers: ["PEBO"], sic: "6022" });
    const state = await run("2026-04-01", "2026-04-30", [listed("318300", "Peoples Bancorp Inc", "PEBO")]);
    expect(state.deals.map((d) => d.target.name)).toEqual(["Citizens National Corporation"]);
    expect(state.deals[0].privateTarget).toBe(true);
  });
});

describe("a registrant's state tag", () => {
  it("Independent / Enterprise Bancorp: a listed target, not a private one", async () => {
    h.hits = [
      release(
        "indb.htm",
        "0000776901-24-000173",
        "2024-12-09",
        "776901",
        "Independent Bank Corp",
        "Independent Bank Corp. to Acquire Enterprise Bancorp, Inc.\nROCKLAND, Mass., Dec. 9, 2024 - Independent Bank Corp. today announced a definitive agreement under which Independent Bank Corp. will acquire Enterprise Bancorp, Inc. for $562 million.",
        ["6022"],
      ),
    ];
    h.lookups["Enterprise Bancorp Inc"] = [{ cik: "1018399", name: "ENTERPRISE BANCORP INC /MA/" }];
    h.lookups["Enterprise Bancorp"] = h.lookups["Enterprise Bancorp Inc"];
    h.subs["776901"] = filer("776901", "Independent Bank Corp", [["10-K", "2024-03-01"]], { exchanges: ["Nasdaq"], tickers: ["INDB"], sic: "6022" });
    h.subs["1018399"] = filer("1018399", "ENTERPRISE BANCORP INC /MA/", [["10-K", "2024-03-08"], ["DEFM14A", "2025-02-19"], ["25-NSE", "2025-07-01"]], { sic: "6022" });
    const state = await run("2024-12-01", "2024-12-31", [listed("776901", "Independent Bank Corp", "INDB")]);
    expect(state.deals).toHaveLength(1);
    expect(state.deals[0].privateTarget).toBeUndefined();
    expect(state.deals[0].target.cik).toBe("1018399");
  });
});

describe("a target with the blank-check code", () => {
  const record = (cik: string, name: string): StoredDeal =>
    ({
      id: `${cik}-2022-07-25`,
      announcedDate: "2022-07-25",
      acquirer: { name: "MasTec, Inc.", ticker: "MTZ", cik: "15615" },
      target: { name, ticker: null, cik },
      valueUsd: 1.1e9,
      valueKind: "transaction",
      pricePerShare: null,
      premiumPct: null,
      consideration: "Mixed",
      sector: "Industrials",
      industry: "x",
      status: "Pending",
      statusDate: null,
      enterpriseValueUsd: null,
      evEbitda: null,
      evRevenue: null,
      acquirerAdvisors: [],
      targetAdvisors: [],
      filings: [],
      sources: ["a"],
      statusCheckedAt: null,
      financialsCheckedAt: null,
    }) as unknown as StoredDeal;

  it("MasTec / Infrastructure and Energy Alternatives: a de-SPACed operating company stays", async () => {
    h.subs["1652362"] = filer("1652362", "Infrastructure & Energy Alternatives, Inc.", [["10-K", "2022-03-01"], ["DEFM14A", "2022-08-20"]], { sic: "6770" });
    const state = await run("2026-11-01", "2026-11-03", [], [record("1652362", "Infrastructure and Energy Alternatives, Inc.")]);
    expect(state.deals).toHaveLength(1);
  });

  it("a real blank-check shell goes", async () => {
    h.subs["999"] = filer("999", "M III Acquisition Corp.", [["10-K", "2022-03-01"]], { sic: "6770" });
    const state = await run("2026-11-01", "2026-11-03", [], [record("999", "M III Acquisition Corp.")]);
    expect(state.deals).toHaveLength(0);
  });
});
