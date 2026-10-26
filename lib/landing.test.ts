import { describe, expect, it } from "vitest";
import { formatDateLong, formatTimestampET, formatUsd } from "./format";
import { landingFigures, NOTABLE_DEAL_USD } from "./landing";
import { buildVolumeMatrix, ytdSummary } from "./metrics";
import { SECTORS, type Deal, type HubData, type Ipo, type LeagueTableEntry, type MonthlySectorVolume } from "./types";

const deal = (over: Partial<Deal>): Deal => ({
  id: Math.random().toString(36).slice(2),
  announcedDate: "2026-10-20",
  acquirer: { name: "Buyer Corp", ticker: null, cik: null },
  target: { name: "Target Inc", ticker: "TGT", cik: "1" },
  valueUsd: 2e9,
  pricePerShare: null,
  premiumPct: null,
  consideration: "Cash",
  sector: "Tech",
  industry: null,
  status: "Announced",
  statusDate: null,
  enterpriseValueUsd: null,
  evEbitda: null,
  evRevenue: null,
  acquirerAdvisors: [],
  targetAdvisors: [],
  filings: [],
  ...over,
});

const ipo = (over: Partial<Ipo>): Ipo => ({
  id: Math.random().toString(36).slice(2),
  company: { name: "Newco", ticker: null, cik: null },
  sector: "Tech",
  industry: null,
  stage: "Filed",
  filedDate: "2026-09-01",
  pricedDate: null,
  expectedRaiseUsd: 3e8,
  offerPrice: null,
  underwriters: [],
  description: "",
  filings: [],
  ...over,
});

const bank = (name: string, dealCount: number, dealValueUsd: number): LeagueTableEntry => ({ advisor: { name, shortName: name.slice(0, 2) }, dealCount, dealValueUsd, rankChange: 0 });

/** `months` monthly rows from `from` ("YYYY-MM"): Tech only, `perMonth` deals of $1B each. */
function volume(from: string, months: number, perMonth = 10): MonthlySectorVolume[] {
  const [y, m] = from.split("-").map(Number);
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }).flatMap((month) => SECTORS.map((sector) => ({ month, sector, dealCount: sector === "Tech" ? perMonth : 0, dealValueUsd: sector === "Tech" ? perMonth * 1e9 : 0 })));
}

/** An October 2026 dataset, with overrides. totalDeals follows the deals unless given. */
function hub(over: Partial<HubData> = {}): HubData {
  const deals = over.deals ?? [deal({ id: "a" }), deal({ id: "b", announcedDate: "2026-10-18" }), deal({ id: "c", announcedDate: "2026-10-15" })];
  return {
    asOf: "2026-10-24T18:00:00Z",
    isSample: false,
    deals,
    monthlyVolume: volume("2024-10", 25),
    yearToDate: { through: "2026-10-24", value: 120e9, count: 300, priorValue: 100e9, priorCount: 250 },
    ipos: [],
    leagueTable: { period: "2026 YTD", entries: [bank("Goldman Sachs", 40, 210e9), bank("Morgan Stanley", 35, 180e9)] },
    valuations: [],
    macro: null,
    headline: { medianPremiumPct: 30, premiumSample: 25, ipoFiledCount: 12, ipoExpectedRaiseUsd: 5e9 },
    ...over,
    totalDeals: over.totalDeals ?? deals.length,
  };
}

describe("landingFigures: state", () => {
  it("shows nothing when the data is unavailable (never zeros)", () => {
    for (const f of [landingFigures(hub({ dataError: "database unreachable" })), landingFigures(hub({ deals: [], totalDeals: 0 }))]) {
      expect(f.state).toBe("unavailable");
      expect(f.kpis).toEqual([]);
      expect(f.deals).toEqual([]);
      expect(f.ogStats).toEqual([]);
      expect(f.asOf).toBeNull();
    }
  });

  it("marks sample data, and labels the data's own time", () => {
    expect(landingFigures(hub({ isSample: true })).state).toBe("sample");
    const f = landingFigures(hub());
    expect(f.state).toBe("live");
    expect(f.asOfLabel).toBe(formatTimestampET("2026-10-24T18:00:00Z"));
    expect(f.kpis).toHaveLength(4);
    expect(f.ogStats.map((s) => s.label)).toEqual(["Deals tracked", "M&A value, 2026 YTD", "IPOs filed"]);
  });
});

describe("landingFigures: deals tracked", () => {
  it("counts the whole dataset, with the start month only when the feed holds every deal", () => {
    const full = landingFigures(hub()).kpis[0];
    expect(full.value).toBe("3");
    expect(full.note).toBe("Public and private targets · from Oct 2026");
    const capped = landingFigures(hub({ totalDeals: 5400 })).kpis[0];
    expect(capped.value).toBe("5,400");
    expect(capped.note).toBe("Public and private targets");
  });
});

describe("landingFigures: announced M&A value", () => {
  it("is the Hub's year-to-date figure, note and change (no drift)", () => {
    const data = hub();
    const ytd = ytdSummary(buildVolumeMatrix(data.monthlyVolume, data.asOf.slice(0, 7)), data.yearToDate)!;
    const kpi = landingFigures(data).kpis[1];
    expect(kpi.value).toBe(formatUsd(ytd.value));
    expect(kpi.note).toBe(`Jan 1 – ${formatDateLong(ytd.throughDay!)} · YoY`);
    expect(kpi.changePct).toBeCloseTo(ytd.valueChangePct);
    expect(kpi.changePct).toBeCloseTo(20);
  });

  it("uses the last 12 complete months before April, with no change chip", () => {
    const kpi = landingFigures(
      hub({ asOf: "2026-02-10T18:00:00Z", monthlyVolume: volume("2024-02", 25), yearToDate: { through: "2026-02-10", value: 30e9, count: 60, priorValue: 25e9, priorCount: 50 } }),
    ).kpis[1];
    expect(kpi.note).toBe("Last 12 months · Feb 2025 – Jan 2026");
    expect(kpi.value).toBe("$120.00B");
    expect(kpi.changePct).toBeNull();
  });

  it("uses the last 12 months when the year to date has too few deals", () => {
    const kpi = landingFigures(hub({ yearToDate: { through: "2026-10-24", value: 5e9, count: 24, priorValue: 4e9, priorCount: 20 } })).kpis[1];
    expect(kpi.note).toMatch(/^Last 12 months · /);
    expect(kpi.changePct).toBeNull();
    expect(landingFigures(hub({ yearToDate: { through: "2026-10-24", value: 5e9, count: 24, priorValue: 4e9, priorCount: 20 } })).ogStats[1].label).toBe("M&A value, last 12 months");
  });

  it("shows no change when last year had nothing to compare with (not +0.0%)", () => {
    const kpi = landingFigures(hub({ yearToDate: { through: "2026-10-24", value: 120e9, count: 300, priorValue: 0, priorCount: 0 } })).kpis[1];
    expect(kpi.value).toBe("$120.00B");
    expect(kpi.changePct).toBeNull();
  });
});

describe("landingFigures: top advisor", () => {
  it("names the top bank by value once it has enough deals", () => {
    const kpi = landingFigures(hub()).kpis[2];
    expect(kpi.label).toBe("Top advisor · 2026 YTD");
    expect(kpi.value).toBe("Goldman Sachs");
    expect(kpi.text).toBe(true);
    expect(kpi.note).toBe("40 deals · $210.0B");
  });

  it("counts the banks instead while the leader has fewer than 10 deals, and shows a dash with none", () => {
    const thin = landingFigures(hub({ leagueTable: { period: "2026 YTD", entries: [bank("Goldman Sachs", 9, 20e9), bank("Lazard", 4, 8e9)] } })).kpis[2];
    expect(thin.label).toBe("Advisors credited · 2026 YTD");
    expect(thin.value).toBe("2");
    expect(thin.text).toBe(false);
    const none = landingFigures(hub({ leagueTable: { period: "2026 YTD", entries: [] } })).kpis[2];
    expect(none.value).toBe("—");
    expect(none.note).toBe("None credited yet");
  });
});

describe("landingFigures: IPOs filed", () => {
  it("reads the headline, or computes it from the lists when the copy has none", () => {
    expect(landingFigures(hub()).kpis[3].value).toBe("12");
    const kpi = landingFigures(hub({ headline: undefined, ipos: [ipo({}), ipo({}), ipo({ stage: "Priced" })] })).kpis[3];
    expect(kpi.value).toBe("2");
  });
});

describe("landingFigures: latest deals", () => {
  const big = (id: string, announcedDate: string, over: Partial<Deal> = {}) => deal({ id, announcedDate, valueUsd: NOTABLE_DEAL_USD * 2, ...over });

  it("lists the newest live deals of $500M and up, skipping terminated deals and undisclosed values, at most 4", () => {
    const deals = [
      big("t", "2026-10-23", { status: "Terminated" }),
      big("n", "2026-10-22", { valueUsd: null }),
      deal({ id: "small", announcedDate: "2026-10-21", valueUsd: 1e8 }),
      big("a", "2026-10-20", { target: { name: "Alpha Robotics", ticker: null, cik: null } }),
      big("b", "2026-10-19"),
      big("c", "2026-10-18"),
      big("d", "2026-10-17"),
      big("e", "2026-10-16"),
    ];
    const f = landingFigures(hub({ deals }));
    expect(f.deals.map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
    expect(f.dealsNote).toBe("$500M and up");
    expect(f.deals[0]).toMatchObject({ target: "Alpha Robotics", mark: "AR", date: "Oct 20", value: "$1.00B", sector: "Tech" });
  });

  it("falls back to the newest with any disclosed value, and hides the panel under 3", () => {
    const deals = [big("a", "2026-10-20"), deal({ id: "s1", announcedDate: "2026-10-19", valueUsd: 1e8 }), deal({ id: "s2", announcedDate: "2026-10-18", valueUsd: 2e8 })];
    const f = landingFigures(hub({ deals }));
    expect(f.deals.map((d) => d.id)).toEqual(["a", "s1", "s2"]);
    expect(f.dealsNote).toBe("Newest with a disclosed value");
    const few = landingFigures(hub({ deals: [big("a", "2026-10-20"), deal({ id: "x", valueUsd: null }), deal({ id: "y", status: "Terminated" })] }));
    expect(few.deals).toEqual([]);
    expect(few.dealsNote).toBe("");
  });
});
