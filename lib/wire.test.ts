import { describe, expect, it } from "vitest";
import type { Deal, HubData } from "./types";
import { expandCore, hubCore, hubDetails, packRows, unpackRows, withDetails } from "./wire";

const deal = (id: string, over: Partial<Deal> = {}): Deal =>
  ({
    id,
    announcedDate: "2026-09-01",
    acquirer: { name: "Buyer", ticker: null, cik: null },
    target: { name: "Target", ticker: "TGT", cik: "123" },
    valueUsd: 1e9,
    premiumPct: null,
    filings: [{ form: "8-K", filedDate: "2026-09-01", url: "https://www.sec.gov/Archives/edgar/data/123/000012345626000001/ex99.htm" }],
    ...over,
  }) as Deal;

const full = {
  asOf: "2026-10-22T00:00:00Z",
  isSample: false,
  totalDeals: 2,
  deals: [
    deal("a", { terms: { goShop: false, goShopDays: null, targetFeeUsd: 3e7, reverseFeeUsd: null, financingBanks: [], financingCondition: null }, milestones: { firstFiling: "2026-09-02" } as unknown as Deal["milestones"] }),
    deal("b", { privateTarget: true, filings: [{ form: "8-K", filedDate: "2026-09-01", url: "https://example.com/release.htm" }] }),
  ],
  monthlyVolume: [],
  ipos: [],
  leagueTable: { period: "2026 YTD", entries: [] },
  valuations: [],
  macro: null,
  activists: [{ id: "s1" }],
  fees: [{ dealId: "a" }],
} as unknown as HubData;

describe("packRows", () => {
  it("gives back exactly the rows it packed: nulls stay null, absent fields stay absent, nested objects intact", () => {
    const rows = [
      { id: "a", value: 1, premium: null, party: { name: "X", ticker: null }, onlySome: true, list: [1, 2] },
      { id: "b", value: null, premium: 2.5, party: { name: "Y", ticker: "Y", cik: "9" }, list: [] },
      { id: "c", value: 3, premium: null, party: null, onlySome: false, list: [3], skipped: undefined },
    ];
    const packed = packRows(rows);
    expect(Object.keys(packed.sparse).sort()).toEqual(["onlySome"]);
    const back = unpackRows(JSON.parse(JSON.stringify(packed)));
    // JSON drops a field whose value is undefined, and so does the packer.
    expect(back).toEqual(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))));
    expect("onlySome" in back[1]).toBe(false);
    expect(back[0].premium).toBeNull();
  });

  it("packs a field whose values are all objects by column too", () => {
    const packed = packRows([{ party: { name: "X", cik: null } }, { party: { name: "Y" } }]);
    expect(packed.cols.party).toEqual({ packed: { n: 2, cols: { name: ["X", "Y"] }, sparse: { cik: { 0: null } } } });
  });
});

describe("the two downloads", () => {
  it("leave the details and the long lists out of the core, pack the deals and shorten EDGAR links", () => {
    const wire = hubCore(full);
    expect(wire).not.toHaveProperty("deals");
    expect(wire).not.toHaveProperty("activists");
    expect(wire).not.toHaveProperty("fees");
    const deals = unpackRows(wire.dealColumns);
    expect(deals[0]).not.toHaveProperty("terms");
    expect(deals[0]).not.toHaveProperty("milestones");
    expect((deals[0].filings as { url: string }[])[0].url).toBe("123/000012345626000001/ex99.htm");
    expect((deals[1].filings as { url: string }[])[0].url).toBe("https://example.com/release.htm");
    expect(full.deals[0].terms).toBeDefined(); // the input is untouched
  });

  it("put back exactly what the server had, once both have arrived", () => {
    const back = withDetails(expandCore(JSON.parse(JSON.stringify(hubCore(full)))), JSON.parse(JSON.stringify(hubDetails(full))));
    expect(back).toEqual(full);
  });

  it("carry details only for deals that have some", () => {
    expect(Object.keys(hubDetails(full).deals)).toEqual(["a"]);
    expect(withDetails(expandCore(hubCore(full)), null).deals[0].terms).toBeUndefined();
  });
});
