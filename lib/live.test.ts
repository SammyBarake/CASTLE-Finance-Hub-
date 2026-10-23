import { describe, expect, it } from "vitest";
import { bookRows } from "./books";
import { bookTable, dealsForQuery, dealsTable, iposForQuery, leagueForQuery, precedentsForQuery, toLiveCsv } from "./live";
import type { Deal, Ipo, LeagueTableEntry } from "./types";

const deal = (id: string, over: Partial<Deal> = {}): Deal =>
  ({
    id,
    announcedDate: "2026-09-01",
    acquirer: { name: `Buyer ${id}`, ticker: null, cik: null },
    target: { name: `Target ${id}`, ticker: "TGT", cik: null },
    valueUsd: 2_345_678_901,
    pricePerShare: 25.5,
    premiumPct: 31.25,
    consideration: "Cash",
    sector: "Tech",
    industry: "Software",
    status: "Pending",
    statusDate: null,
    enterpriseValueUsd: null,
    evEbitda: 14.2,
    evRevenue: null,
    acquirerAdvisors: ["Goldman Sachs"],
    targetAdvisors: ["Morgan Stanley", "Qatalyst"],
    filings: [{ form: "8-K", filedDate: "2026-09-01", url: "https://www.sec.gov/x.htm" }],
    targetFeeUsd: null,
    reverseFeeUsd: null,
    goShop: null,
    goShopDays: null,
    ...over,
  }) as Deal;

/** The CSV rows, after the byte-order mark every live CSV starts with. */
const lines = (csv: string) => csv.slice(1).trimEnd().split(String.fromCharCode(13, 10));

describe("toLiveCsv", () => {
  it("writes numbers bare, quotes only what needs it, and never lets a cell run as a formula", () => {
    const csv = toLiveCsv({ headers: ["A", "B", "C", "D"], rows: [[1.5, 'He said "hi", twice', "=HYPERLINK(1)", null], [-3, "-not a formula", "@x", "plain"]] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines(csv)).toEqual(["A,B,C,D", '1.5,"He said ""hi"", twice",\'=HYPERLINK(1),', "-3,'-not a formula,'@x,plain"]);
  });

  it("labels every row of sample data", () => {
    expect(lines(toLiveCsv({ headers: ["A"], rows: [[1]] }, { sample: true }))).toEqual(["Data,A", "SAMPLE (FICTIONAL),1"]);
  });
});

describe("live tables follow the page's filters", () => {
  const deals = [deal("a"), deal("b", { sector: "Healthcare", valueUsd: 5e8 }), deal("c", { valueUsd: 9e9, status: "Closed" })];

  it("Deal Flow: the same query as the page, in $M, % and x, with links", () => {
    const rows = dealsForQuery(deals, new URLSearchParams("sector=Tech&min=1&sort=value"), "2026-10-22");
    expect(rows.map((d) => d.id)).toEqual(["c", "a"]);
    const t = dealsTable([deals[0]], "https://castle.test");
    const at = (h: string) => t.rows[0][t.headers.indexOf(h)];
    expect(at("Deal value ($M)")).toBe(2345.7);
    expect(at("Premium (%)")).toBe(31.3);
    expect(at("EV / EBITDA")).toBe(14.2);
    expect(at("Target advisors")).toBe("Morgan Stanley; Qatalyst");
    expect(at("Castle tear sheet")).toBe("https://castle.test/tearsheet/deal/a");
  });

  it("Precedents: seeded from the subject deal, without it or the unticked outliers", () => {
    const comps = [deal("subject", { valueUsd: 3e9 }), deal("comp-1", { valueUsd: 2e9 }), deal("comp-2", { valueUsd: 4e9 }), deal("too-big", { valueUsd: 50e9 })];
    const ids = precedentsForQuery(comps, new URLSearchParams("deal=subject&x=comp-2"), "2026-10-22").map((d) => d.id);
    expect(ids).toEqual(["comp-1"]); // a third to three times the subject's size; comp-2 unticked; the subject itself left out
  });

  it("Advisors: ranked by deal count when asked, with that ranking's change", () => {
    const e = (name: string, dealCount: number, dealValueUsd: number, rankChange: number, dealCountRankChange: number): LeagueTableEntry => ({
      advisor: { name, shortName: name.slice(0, 2) },
      dealCount,
      dealValueUsd,
      rankChange,
      dealCountRankChange,
    });
    const entries = [e("Big Value", 3, 9e10, 1, -2), e("Many Deals", 9, 1e10, 0, 3)];
    expect(leagueForQuery(entries, new URLSearchParams("sort=deals")).map((r) => [r.e.advisor.name, r.rank, r.change])).toEqual([
      ["Many Deals", 1, 3],
      ["Big Value", 2, -2],
    ]);
    expect(leagueForQuery(entries, new URLSearchParams()).map((r) => r.e.advisor.name)).toEqual(["Big Value", "Many Deals"]);
  });

  it("IPOs: stage, sector, underwriter and minimum raise", () => {
    const ipo = (id: string, over: Partial<Ipo>): Ipo => ({ id, company: { name: id, ticker: null, cik: null }, sector: "Tech", industry: null, stage: "Filed", filedDate: "2026-09-01", pricedDate: null, expectedRaiseUsd: 3e8, offerPrice: null, underwriters: ["Goldman Sachs"], description: "", filings: [], ...over });
    const ipos = [ipo("a", {}), ipo("b", { stage: "Priced" }), ipo("c", { expectedRaiseUsd: 1e8 }), ipo("d", { underwriters: ["JPMorgan"] })];
    expect(iposForQuery(ipos, new URLSearchParams("stage=Filed&bank=Goldman+Sachs&min=250")).map((i) => i.id)).toEqual(["a"]);
    expect(iposForQuery(ipos, new URLSearchParams("stage=Nonsense")).length).toBe(4);
  });

  it("A shared book: the author's comment next to each deal, and deals that left the data say so", () => {
    const items = [
      { dealId: "a", note: "Anchor comp", label: "Buyer a → Target a", date: "2026-09-01" },
      { dealId: "gone", note: "", label: "Old → Older", date: "2024-01-01" },
    ];
    const t = bookTable(bookRows(items, new Map([["a", deal("a")]])), "https://castle.test");
    const comment = t.headers.indexOf("Comment");
    expect(t.rows[0][comment]).toBe("Anchor comp");
    expect(t.rows[1].slice(0, 2)).toEqual(["2024-01-01", "Old → Older"]);
    expect(t.rows[1][5]).toBe("Not in Castle's data");
  });
});
