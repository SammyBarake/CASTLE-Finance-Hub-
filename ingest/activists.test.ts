// The once-only re-read of stored stakes through the real ingestActivists, with EDGAR stood in by fixtures.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivistStake } from "../lib/types";
import { ACTIVIST_RULE_VERSION, collapseRefilings, ingestActivists } from "./activists";
import type { Directory } from "./deals";
import type { State } from "./store";

const edgar = vi.hoisted(() => ({ docs: {} as Record<string, string>, reads: [] as string[], failing: new Set<string>() }));

vi.mock("./edgar", async (importOriginal) => {
  const real = await importOriginal<typeof import("./edgar")>();
  return {
    ...real,
    getDailyIndex: async () => null,
    getSubmissions: async () => ({ name: "" }),
    getText: async (url: string) => {
      edgar.reads.push(url);
      if (edgar.failing.has(url)) throw new Error("EDGAR 503");
      return edgar.docs[url] ?? "";
    },
  };
});

const url = (cik: string, id: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${id.replace(/-/g, "")}/primary_doc.xml`;
const key = (id: string) => `13drule${ACTIVIST_RULE_VERSION}:${id}`;

function xml(o: { issuer: string; cik: string; investor: string; purpose: string; item3?: string; item5?: string; percent?: number; shares?: number }) {
  return `<edgarSubmission><formData><coverPageHeader><issuerInfo><issuerCIK>${o.cik}</issuerCIK><issuerName>${o.issuer}</issuerName></issuerInfo></coverPageHeader>
<reportingPersons><reportingPersonInfo><reportingPersonCIK>900</reportingPersonCIK><reportingPersonName>${o.investor}</reportingPersonName><aggregateAmountOwned>${o.shares ?? 1000}</aggregateAmountOwned><percentOfClass>${o.percent ?? 6}</percentOfClass></reportingPersonInfo></reportingPersons>
<items1To7><item3>${o.item3 ?? "Working capital."}</item3><item4><transactionPurpose>${o.purpose}</transactionPurpose></item4><item5>${o.item5 ?? ""}</item5></items1To7></formData></edgarSubmission>`;
}

const stake = (over: Partial<ActivistStake> & { id: string }): ActivistStake => ({
  filedDate: new Date().toISOString().slice(0, 10),
  eventDate: null,
  investor: { name: "Saba Capital Management, L.P.", cik: "900" },
  company: { name: "Widget Corp", ticker: "WDGT", cik: "100" },
  percent: 6,
  shares: 1000,
  aims: ["Board seats", "Operational changes"],
  purpose: "old quote",
  activist: true,
  amendments: 2,
  lastAmended: "2026-10-01",
  url: "",
  ...over,
});

const directory = { byCik: new Map([["100", { name: "Widget Corp", ticker: "WDGT" }], ["200", { name: "Gadget Inc", ticker: "GDGT" }]]) } as unknown as Directory;
const SABA = "The Reporting Persons believe that the Common Shares are undervalued and represent an attractive investment opportunity. The Reporting Persons may make binding or non-binding shareholder proposals, or may nominate one or more individuals as nominees for election to the Board. The Reporting Persons intend to review their investment in the Issuer on a continuing basis, and have not entered into any agreement with any third party.";
const KOCH = "The Reporting Persons acquired the Public Shares for investment purposes, other than activities solely in connection with a nomination under 240.14a-11. The Reporting Persons view themselves as passive investors.";

function run(activists: ActivistStake[], seen: string[] = activists.map((s) => `13dname:${s.id}`)) {
  const state = { activists, seen: new Set(seen), deals: [], ipos: [] } as unknown as State;
  // An empty window: no daily index is read, as on any run that finds nothing new.
  return ingestActivists(state, { from: "2030-01-02", to: "2030-01-01", directory, log: () => {} }).then((res) => ({ state, res }));
}

beforeEach(() => {
  edgar.docs = {};
  edgar.reads = [];
  edgar.failing = new Set();
});

describe("re-reading stored stakes", () => {
  it("updates what passes, keeps its amendments, and removes what no longer does", async () => {
    edgar.docs[url("100", "0001-26-000001")] = xml({ issuer: "Widget Corp", cik: "100", investor: "Saba Capital Management, L.P.", purpose: SABA });
    edgar.docs[url("200", "0001-26-000002")] = xml({ issuer: "Gadget Inc", cik: "200", investor: "KDT Holdings, LLC", purpose: KOCH });
    const koch = stake({ id: "0001-26-000002", investor: { name: "KDT Holdings, LLC", cik: "901" }, company: { name: "Gadget Inc", ticker: "GDGT", cik: "200" }, shares: 2000 });
    const { state } = await run([stake({ id: "0001-26-000001" }), koch]);
    expect(state.activists.map((s) => s.id)).toEqual(["0001-26-000001"]);
    const [saba] = state.activists;
    expect(saba.aims).toEqual([]);
    expect(saba.purpose).not.toBe("old quote");
    expect(saba.amendments).toBe(2);
    expect(saba.lastAmended).toBe("2026-10-01");
    // A removed stake is marked too, so it isn't fetched again.
    expect(state.seen.has(key("0001-26-000001"))).toBe(true);
    expect(state.seen.has(key("0001-26-000002"))).toBe(true);
  });

  it("happens once per stake", async () => {
    const id = "0001-26-000001";
    edgar.docs[url("100", id)] = xml({ issuer: "Widget Corp", cik: "100", investor: "Saba Capital Management, L.P.", purpose: SABA });
    const { state } = await run([stake({ id })]);
    expect(edgar.reads).toHaveLength(1);
    edgar.reads = [];
    // A later change to the stored record isn't overwritten by another read.
    state.activists[0].purpose = "kept";
    const second = await run(state.activists, [...state.seen]);
    expect(edgar.reads).toHaveLength(0);
    expect(second.state.activists[0].purpose).toBe("kept");
  });

  it("a failed fetch keeps the stake as it was and tries again next run", async () => {
    const id = "0001-26-000001";
    edgar.failing.add(url("100", id));
    const { state } = await run([stake({ id })]);
    expect(state.activists).toHaveLength(1);
    expect(state.activists[0].aims).toEqual(["Board seats", "Operational changes"]);
    expect(state.seen.has(key(id))).toBe(false);

    edgar.failing.clear();
    edgar.docs[url("100", id)] = xml({ issuer: "Widget Corp", cik: "100", investor: "Saba Capital Management, L.P.", purpose: SABA });
    const next = await run(state.activists, [...state.seen]);
    expect(next.state.activists[0].aims).toEqual([]);
    expect(next.state.seen.has(key(id))).toBe(true);
  });

  it("a document that isn't a 13D keeps the stake too", async () => {
    const id = "0001-26-000001";
    edgar.docs[url("100", id)] = "<html>Not here</html>";
    const { state } = await run([stake({ id })]);
    expect(state.activists).toHaveLength(1);
    expect(state.seen.has(key(id))).toBe(false);
  });

  it("corrects the stake and the firm's name: Karp's group total, a typed name over EDGAR's capitals", async () => {
    const id = "0001-26-000001";
    edgar.docs[url("100", id)] = xml({
      issuer: "Widget Corp",
      cik: "100",
      investor: "Wynnefield Partners Small Cap Value, L.P.",
      purpose: "On July 8, 2025, the Reporting Persons delivered an open letter to the Board urging a sale of the Company.",
      item5: "As of the date hereof, the Reporting Persons beneficially own an aggregate of 2,188,109 shares of Class A Common Stock, representing approximately 5.4% of the outstanding shares.",
      percent: 4.1,
      shares: 1631110,
    });
    const { state } = await run([stake({ id, investor: { name: "Wynnefield Partners Small CAP Value LP", cik: "900" }, percent: 4.1, shares: 1631110 })]);
    expect(state.activists[0]).toMatchObject({ percent: 5.4, shares: 2188109, aims: ["Sale or strategic review"], investor: { name: "Wynnefield Partners Small Cap Value, L.P.", cik: "900" } });
  });

  it("a stake already read by these rules isn't fetched", async () => {
    const id = "0001-26-000001";
    await run([stake({ id })], [`13dname:${id}`, key(id)]);
    expect(edgar.reads).toHaveLength(0);
  });
});

describe("collapseRefilings", () => {
  const filed = "2026-03-11";
  const bluejay = (id: string, name: string, cik: string, amendments = 0, lastAmended: string | null = null) =>
    stake({ id, filedDate: filed, investor: { name, cik }, company: { name: "Bluejay Diagnostics, Inc.", ticker: "BJDX", cik: "300" }, percent: 3.65, shares: 12345, amendments, lastAmended });

  it("one group's filing of one 13D is one stake (Northstrive and Lichti on Bluejay), with the most amendments", () => {
    const out = collapseRefilings([bluejay("0001213900-26-025973", "Braeden Lichti", "2", 3, "2026-06-01"), bluejay("0001213900-26-025920", "Northstrive Fund II LP", "1"), bluejay("0001213900-26-025962", "Northstrive Fund II LP", "1", 1, "2026-05-01")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "0001213900-26-025920", investor: { name: "Northstrive Fund II LP" }, amendments: 3, lastAmended: "2026-06-01" });
  });

  it("JANA's two Alkami filings (different days and sizes) stay two, as do Recanati and L.I.A. on Evogene (different sizes)", () => {
    const jana = (id: string, filedDate: string, percent: number, shares: number) => stake({ id, filedDate, percent, shares, investor: { name: "JANA Partners Management, LP", cik: "1" } });
    expect(collapseRefilings([jana("a", "2026-04-01", 5.1, 5431388), jana("b", "2026-06-29", 6.3, 6747707)])).toHaveLength(2);
    const evogene = (id: string, name: string, percent: number, shares: number) => stake({ id, filedDate: filed, percent, shares, investor: { name, cik: id } });
    expect(collapseRefilings([evogene("c", "Leon Recanati", 5.7, 800000), evogene("d", "L.I.A. Pure Capital Ltd", 12.61, 1800000)])).toHaveLength(2);
  });

  it("no figures, no proof: two blank stakes on one day stay two", () => {
    const blank = (id: string) => stake({ id, filedDate: filed, percent: null, shares: null });
    expect(collapseRefilings([blank("a"), blank("b")])).toHaveLength(2);
  });
});
