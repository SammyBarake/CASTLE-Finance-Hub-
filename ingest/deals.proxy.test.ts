/**
 * Which proxy a deal's terms and advisers come from, on hand-made records with EDGAR stubbed: this buyer's among several, a topped deal's up to its end
 * date, and the target's own heading joining a list a release filled.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredDeal } from "./store";

const h = vi.hoisted(() => ({ docs: {} as Record<string, string> }));

vi.mock("./edgar", async (orig) => {
  const actual = await orig<typeof import("./edgar")>();
  const doc = async (url: string) => {
    const file = url.split("/").at(-1)!;
    if (h.docs[file] != null) return h.docs[file];
    throw new actual.NotFoundError("not in this test");
  };
  const none = async () => {
    throw new actual.NotFoundError("not in this test");
  };
  return { ...actual, getText: doc, getTextHead: doc, getJson: none, getSubmissions: none };
});

import { enrichDeal, opensNamingBuyerInFull, proxyOfThisBuyer, readDealTerms } from "./deals";

type Row = { form: string; date: string; items?: string; doc?: string };
const sub = (rows: Row[], name = "Target Inc") =>
  ({
    cik: "54480",
    name,
    sic: "3000",
    sicDescription: "Stub",
    tickers: ["TGT"],
    exchanges: ["NYSE"],
    stateOfIncorporation: "DE",
    formerNames: [],
    filings: {
      recent: {
        accessionNumber: rows.map((_, i) => `0000000000-26-${100000 + i}`),
        filingDate: rows.map((r) => r.date),
        reportDate: rows.map(() => ""),
        form: rows.map((r) => r.form),
        primaryDocument: rows.map((r) => r.doc ?? "d.htm"),
        items: rows.map((r) => r.items ?? ""),
      },
      files: [],
    },
  }) as never;

const deal = (over: Partial<StoredDeal>) =>
  ({
    id: "54480-2021-03-22",
    announcedDate: "2021-03-22",
    acquirer: { name: "Canadian Pacific Railway Ltd", ticker: "CP", cik: "16875" },
    target: { name: "Kansas City Southern", ticker: "KSU", cik: "54480" },
    valueUsd: 29e9,
    valueKind: "transaction",
    pricePerShare: 90,
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
    sources: [],
    statusCheckedAt: "2026-11-05",
    financialsCheckedAt: "2026-11-05",
    financialsVersion: 999,
    fairnessCheckedAt: "2026-11-05",
    fairnessParser: 999,
    termsCheckedAt: "2026-11-05",
    termsParser: 999,
    ...over,
  }) as unknown as StoredDeal;

beforeEach(() => {
  h.docs = {};
});

describe("opensNamingBuyerInFull", () => {
  it("two words where the second is the name's, one otherwise", () => {
    expect(opensNamingBuyerInFull("merger with Canadian National Railway Company", "Canadian Pacific Railway Ltd")).toBe(false);
    expect(opensNamingBuyerInFull("PROSPECTUS OF CANADIAN PACIFIC RAILWAY LIMITED", "Canadian Pacific Railway Ltd")).toBe(true);
    expect(opensNamingBuyerInFull("merger with Merck", "Merck & Co., Inc.")).toBe(true);
    expect(opensNamingBuyerInFull("merger with Netflix", "Netflix, Inc.")).toBe(true);
  });
});

describe("proxyOfThisBuyer", () => {
  const cn = "Dear Stockholders: merger with Canadian National Railway Company. JP Morgan and RBC have committed to provide the bridge facility.";
  const cp = "PROSPECTUS OF CANADIAN PACIFIC RAILWAY LIMITED. BMO Capital Markets and Goldman Sachs have committed to provide the bridge facility.";

  it("takes this buyer's where one form has two: CP's, not CN's filed first (Kansas City Southern)", async () => {
    h.docs = { "cn.htm": cn, "cp.htm": cp };
    const s = sub([{ form: "DEFM14A", date: "2021-07-07", doc: "cn.htm" }, { form: "DEFM14A", date: "2021-11-03", doc: "cp.htm" }]);
    expect((await proxyOfThisBuyer(s, deal({})))?.primaryDocument).toBe("cp.htm");
    const { terms } = await readDealTerms(deal({}), s);
    expect(terms?.financingBanks).toEqual(["BMO Capital Markets", "Goldman Sachs"]);
  });

  it("the earliest when both are this buyer's (Black Knight), and reads nothing extra for one", async () => {
    h.docs = { "a.htm": "merger with Intercontinental Exchange, Inc.", "b.htm": "amended merger with Intercontinental Exchange, Inc." };
    const ice = deal({ acquirer: { name: "Intercontinental Exchange, Inc.", ticker: "ICE", cik: "1571949" } });
    const s = sub([{ form: "DEFM14A", date: "2022-07-20", doc: "a.htm" }, { form: "DEFM14A", date: "2023-08-01", doc: "b.htm" }]);
    expect((await proxyOfThisBuyer(s, ice))?.primaryDocument).toBe("a.htm");
    // One proxy: no opening is fetched, so a missing document can't matter.
    expect((await proxyOfThisBuyer(sub([{ form: "DEFM14A", date: "2022-07-20", doc: "gone.htm" }]), ice))?.primaryDocument).toBe("gone.htm");
    // Neither names the buyer: still the earliest.
    h.docs = { "a.htm": "the merger", "b.htm": "the merger" };
    expect((await proxyOfThisBuyer(s, ice))?.primaryDocument).toBe("a.htm");
  });

  it("a topped deal with no end date gets only a proxy naming it (Aya on the winner's; Lockheed on its own)", async () => {
    h.docs = { "aya.htm": "merger with Knox Lane", "lmt.htm": "merger with Lockheed Martin", "l3.htm": "merger with L3Harris Technologies" };
    const aya = deal({ acquirer: { name: "Aya Healthcare", ticker: null, cik: null }, status: "Terminated", statusDate: null });
    expect(await proxyOfThisBuyer(sub([{ form: "DEFM14A", date: "2026-01-01", doc: "aya.htm" }]), aya)).toBeUndefined();
    const lockheed = deal({ acquirer: { name: "Lockheed Martin Corp", ticker: "LMT", cik: "936468" }, announcedDate: "2020-12-21", status: "Terminated", statusDate: null });
    expect((await proxyOfThisBuyer(sub([{ form: "DEFM14A", date: "2021-02-05", doc: "lmt.htm" }, { form: "DEFM14A", date: "2023-02-05", doc: "l3.htm" }]), lockheed))?.primaryDocument).toBe("lmt.htm");
  });
});

describe("a topped deal's terms on the next read", () => {
  const fee = (who: string, n: string) => `${who} will be required to pay Parent a termination fee of $${n} million under specified circumstances.`;

  it("stop at its end date: Netflix's own proxy stands, MKS has none, and the winner's signing 8-K is the winner's", async () => {
    h.docs = { "netflix.htm": `merger with Netflix, Inc. ${fee("WBD", "2,800")}`, "psky.htm": `merger with Paramount Skydance. ${fee("WBD", "3,000")}` };
    const netflix = deal({ acquirer: { name: "Netflix, Inc.", ticker: "NFLX", cik: "1065280" }, target: { name: "WBD", ticker: "WBD", cik: "1437107" }, announcedDate: "2025-12-05", status: "Terminated", statusDate: "2026-02-27" });
    const s = sub([{ form: "DEFM14A", date: "2026-01-20", doc: "netflix.htm" }, { form: "DEFM14A", date: "2026-03-30", doc: "psky.htm" }]);
    expect((await readDealTerms(netflix, s)).terms?.targetFeeUsd).toBe(2800e6);

    h.docs = { "win.htm": `Item 1.01 Entry into a Material Definitive Agreement. ${fee("The Company", "1.2")} Item 9.01 Exhibits.`, "ii.htm": `merger with II-VI. ${fee("The Company", "108.8")}` };
    const enodia = deal({ acquirer: { name: "Enodia", ticker: null, cik: null }, target: { name: "Kezar", ticker: "KZR", cik: "1645666" }, announcedDate: "2026-03-12", status: "Terminated", statusDate: "2026-03-30" });
    expect((await readDealTerms(enodia, sub([{ form: "8-K", date: "2026-03-30", items: "1.01,1.02", doc: "win.htm" }, { form: "SC 14D9", date: "2026-04-20", doc: "ii.htm" }]))).terms).toBeNull();
  });
});

describe("advisers from the proxy", () => {
  const today = "2026-11-05";
  const proxy = `PROXY Opinion of TriState Capital's Financial Advisor (page 52)
In connection with the mergers, Stephens, Inc., TriState Capital's financial advisor, rendered an oral opinion.`;

  it("moves the buyer off the target and adds the target's heading to a list a release filled (TriState / Raymond James)", async () => {
    h.docs = { "p.htm": proxy };
    const d = deal({ id: "1380846-2021-10-21", announcedDate: "2021-10-21", acquirer: { name: "Raymond James", ticker: null, cik: null }, target: { name: "TriState Capital Holdings, Inc.", ticker: "TSC", cik: "1380846" }, targetAdvisors: ["Raymond James"], status: "Pending" });
    await enrichDeal(d, sub([{ form: "DEFM14A", date: "2022-01-27", doc: "p.htm" }], "TriState Capital Holdings, Inc."), today);
    expect(d.targetAdvisors).toEqual(["Stephens"]);
    expect(d.acquirerAdvisors).toEqual(["Raymond James"]);
  });

  it("must not put a bank a release gave the buyer on the target (Ultralife's XMS), and keeps self-advice (GreenSky)", async () => {
    h.docs = { "p.htm": "Parent engaged XMS Capital Partners as its financial advisor. XMS Capital Partners acted as financial advisor to Ultralife in connection with the merger." };
    const ul = deal({ id: "875657-2026-10-27", announcedDate: "2026-10-27", acquirer: { name: "EnerSys", ticker: "ENS", cik: "1289308" }, target: { name: "Ultralife Corp", ticker: "ULBI", cik: "875657" }, acquirerAdvisors: ["XMS Capital"], status: "Pending" });
    await enrichDeal(ul, sub([{ form: "SC 14D9", date: "2026-11-01", doc: "p.htm" }], "Ultralife Corp"), today);
    expect(ul.targetAdvisors).toEqual([]);
    expect(ul.acquirerAdvisors).toEqual(["XMS Capital"]);

    h.docs = { "g.htm": "Opinion of GreenSky's Financial Advisor\nMorgan Stanley & Co. LLC rendered its opinion on the sale to Goldman Sachs." };
    const gs = deal({ id: "1712923-2021-09-15", announcedDate: "2021-09-15", acquirer: { name: "Goldman Sachs Group Inc", ticker: "GS", cik: "886982" }, target: { name: "GreenSky, Inc.", ticker: "GSKY", cik: "1712923" }, acquirerAdvisors: ["Goldman Sachs"], status: "Pending" });
    await enrichDeal(gs, sub([{ form: "DEFM14A", date: "2021-12-01", doc: "g.htm" }], "GreenSky, Inc."), today);
    expect(gs.targetAdvisors).toEqual(["Morgan Stanley"]);
    expect(gs.acquirerAdvisors).toEqual(["Goldman Sachs"]);
  });
});
