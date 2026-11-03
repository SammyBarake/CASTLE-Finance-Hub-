import { describe, expect, it } from "vitest";
import { formatDateLong, formatTimestampET, formatUsd } from "./format";
import { formatUsdShort, landingFigures, NOTABLE_DEAL_USD } from "./landing";
import { buildVolumeMatrix, ytdSummary } from "./metrics";
import { SECTORS, type Deal, type HubData, type Ipo, type LeagueTableEntry, type MonthlySectorVolume } from "./types";

const deal = (over: Partial<Deal>): Deal => ({
  id: Math.random().toString(36).slice(2),
  announcedDate: "2026-10-20",
  acquirer: { name: "Acme Industries", ticker: null, cik: null },
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
    expect(full.note).toBe("Public and private targets · coverage from Oct 2026");
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
    expect(f.deals[0]).toMatchObject({ target: "Alpha Robotics", mark: "AR", date: "Oct 20", value: "$1.00B" });
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

  it("keeps a vehicle or a defined term off the tombstones, and one deal read twice appears once", () => {
    const deals = [
      big("vehicle", "2026-10-22", { acquirer: { name: "Eclipse Merger Sub, Inc.", ticker: null, cik: null } }),
      big("twice-b", "2026-10-21", { acquirer: { name: "CD&R", ticker: null, cik: null }, target: { name: "McKesson Corp", ticker: null, cik: "2" } }),
      big("twice-a", "2026-10-21", { acquirer: { name: "CD&R and McKesson", ticker: null, cik: null }, targetAdvisors: ["Centerview"] }),
      // Same day, same round value, nobody in common: a different deal.
      big("other", "2026-10-21", { acquirer: { name: "Quanta Works", ticker: null, cik: null }, target: { name: "Elisity", ticker: null, cik: null } }),
      big("b", "2026-10-20"),
      big("c", "2026-10-19"),
    ];
    expect(landingFigures(hub({ deals })).deals.map((d) => d.id)).toEqual(["twice-a", "other", "b", "c"]);
  });

  it("sets a tombstone: the right verb, up to two banks, a real filing link, names without their legal form", () => {
    const deals = [
      big("open", "2026-10-20", {
        acquirer: { name: "Proofpoint, Inc.", ticker: null, cik: null },
        target: { name: "Varonis Systems Inc", ticker: "VRNS", cik: "9" },
        valueUsd: 5714309129,
        targetAdvisors: ["Goldman Sachs"],
        acquirerAdvisors: ["BofA Securities", "Morgan Stanley", "JPMorgan"],
        filings: [{ form: "8-K (EX-99.1)", filedDate: "2026-10-08", url: "https://www.sec.gov/x" }],
      }),
      big("closed", "2026-10-19", { status: "Closed" }),
      big("c", "2026-10-18"),
    ];
    const [open, closed] = landingFigures(hub({ deals })).deals;
    expect(open).toMatchObject({ acquirer: "Proofpoint", target: "Varonis Systems", verb: "to acquire", value: "$5.71B", figure: "$5.71B", dateFull: "October 20, 2026", advisors: ["Goldman Sachs", "BofA Securities"], moreAdvisors: 2 });
    expect(open.advisorsTitle).toBe("Target: Goldman Sachs. Acquirer: BofA Securities, Morgan Stanley, JPMorgan.");
    expect(open.filing).toEqual({ form: "8-K", filed: "Oct 8", url: "https://www.sec.gov/x" });
    expect(closed.verb).toBe("acquired");
    expect(closed.filing).toBeNull();
  });
});

describe("formatUsdShort", () => {
  it("drops the false precision of a figure set large", () => {
    expect(formatUsdShort(652.21e9)).toBe("$652B");
    expect(formatUsdShort(98.42e9)).toBe("$98.4B");
    expect(formatUsdShort(1.65e9)).toBe("$1.65B");
    expect(formatUsdShort(115e9)).toBe("$115B");
    expect(formatUsdShort(1.214e12)).toBe("$1.21T");
    expect(formatUsdShort(980e6)).toBe("$980M");
    expect(formatUsdShort(null)).toBe("—");
    // Rounded first, so a figure never reads "$1000B" at the seam of two units.
    expect(formatUsdShort(999.6e9)).toBe("$1.00T");
    expect(formatUsdShort(99.96e9)).toBe("$100B");
    expect(formatUsdShort(999.9e6)).toBe("$1.00B");
    expect(formatUsdShort(0)).toBe("$0");
    expect(formatUsdShort(4e5)).toBe("<$1M");
  });
});

describe("landingFigures: the plate", () => {
  it("is the Hub's matrix: one readout per month, resting on the last complete one, with the largest deal named", () => {
    const deals = [
      deal({ id: "top", announcedDate: "2026-09-10", valueUsd: 9e9, acquirer: { name: "Northwind Inc", ticker: null, cik: null }, target: { name: "Big Target Corp", ticker: null, cik: "3" } }),
      deal({ id: "gone", announcedDate: "2026-09-11", valueUsd: 90e9, status: "Terminated" }),
    ];
    const plate = landingFigures(hub({ deals })).plate!;
    expect(plate.months).toHaveLength(25);
    expect(plate.partial).toBe(true);
    expect(plate.months[plate.rest].key).toBe("2026-09");
    expect(plate.from).toBe("October 2024");
    expect(plate.to).toBe("October 2026");
    expect(plate.months[plate.rest].largest).toEqual({ label: "Northwind → Big Target", value: "$9.00B", id: "top" });
    expect(plate.years.map((y) => y.label)).toEqual(["2025", "2026"]);
    // Too few banks to fill the ring: no ring.
    expect(plate.league).toEqual([]);
    expect(plate.peak.label).toBe("Oct 2024 · $10.0B");
  });

  it("always names the deal its total counts: a vehicle buyer just isn't named, and a registrant's SEC name is real", () => {
    const deals = [
      deal({ id: "frontier", announcedDate: "2026-09-05", valueUsd: 20e9, acquirer: { name: "Verizon Communications Inc", ticker: null, cik: null }, target: { name: "Frontier Communications Parent, Inc.", ticker: null, cik: "20520" } }),
      deal({ id: "vehicle", announcedDate: "2026-08-12", valueUsd: 8e9, acquirer: { name: "Acme Merger Sub", ticker: null, cik: null }, target: { name: "Lumen Works Inc", ticker: null, cik: "4" } }),
    ];
    const months = landingFigures(hub({ deals })).plate!.months;
    expect(months.find((m) => m.key === "2026-09")!.largest).toEqual({ label: "Verizon Communications → Frontier Communications Parent", value: "$20.0B", id: "frontier" });
    expect(months.find((m) => m.key === "2026-08")!.largest).toEqual({ label: "Lumen Works", value: "$8.00B", id: "vehicle" });
  });

  it("draws the league ring only with enough banks to fill it", () => {
    const entries = Array.from({ length: 16 }, (_, i) => bank(`Merchant Bank ${i}`, 20 - i, (20 - i) * 1e9));
    const plate = landingFigures(hub({ leagueTable: { period: "2026 YTD", entries } })).plate!;
    expect(plate.league).toHaveLength(14);
    expect(plate.league[0]).toBe("Merchant Bank 0");
  });

  it("isn't drawn from too little data or from nothing", () => {
    expect(landingFigures(hub({ monthlyVolume: volume("2026-03", 6) })).plate).toBeNull();
    expect(landingFigures(hub({ monthlyVolume: volume("2024-10", 25, 0) })).plate).toBeNull();
  });
});

describe("landingFigures: the record", () => {
  const stated = (over: Partial<Deal> = {}) =>
    deal({
      id: "r",
      valueUsd: 3e9,
      pricePerShare: 42.5,
      premiumPct: 31.2,
      consideration: "Cash",
      acquirerAdvisors: ["Lazard"],
      targetAdvisors: ["Evercore"],
      filings: [{ form: "8-K", filedDate: "2026-10-20", url: "https://www.sec.gov/r" }],
      ...over,
    });

  it("is the newest deal that states everything, with a filing to check it against; a blank stays blank", () => {
    const deals = [deal({ id: "thin", announcedDate: "2026-10-23", valueUsd: 9e9 }), stated(), stated({ id: "older", announcedDate: "2026-09-01" })];
    const r = landingFigures(hub({ deals })).record!;
    expect(r).toMatchObject({ id: "r", verb: "to acquire", value: "$3.00B", price: "$42.50", premium: "31.2%", payment: "All cash", evEbitda: "—", targetAdvisors: "Evercore", acquirerAdvisors: "Lazard", isRelease: false });
    expect(r.filing.url).toBe("https://www.sec.gov/r");
  });

  it("prefers a deal whose linked document is the release that states the terms, and lists every bank", () => {
    const deals = [
      stated({ id: "bare", announcedDate: "2026-10-22" }),
      stated({ id: "release", announcedDate: "2026-10-21", status: "Closed", acquirerAdvisors: ["Lazard", "Citi", "UBS"], filings: [{ form: "8-K (EX-99.1)", filedDate: "2026-10-21", url: "https://www.sec.gov/x" }] }),
    ];
    expect(landingFigures(hub({ deals })).record).toMatchObject({ id: "release", verb: "acquired", isRelease: true, acquirerAdvisors: "Lazard, Citi, UBS" });
  });

  it("is absent rather than half-stated", () => {
    expect(landingFigures(hub({ deals: [stated({ premiumPct: null })] })).record).toBeNull();
    expect(landingFigures(hub({ deals: [stated({ valueUsd: 5e8 })] })).record).toBeNull();
    expect(landingFigures(hub({ deals: [stated({ privateTarget: true })] })).record).toBeNull();
    expect(landingFigures(hub({ deals: [stated({ filings: [] })] })).record).toBeNull();
  });
});

describe("landingFigures: the contents page", () => {
  it("counts only what the feed holds in full", () => {
    const deals = [deal({ id: "a", evEbitda: 10 }), deal({ id: "b" }), deal({ id: "c", evRevenue: 2 })];
    expect(landingFigures(hub({ deals })).counts).toMatchObject({ deals: 3, multiples: 2, banks: 2, ipos: 12 });
    expect(landingFigures(hub({ deals, totalDeals: 5400 })).counts).toMatchObject({ deals: 5400, multiples: null, terms: null });
  });

  it("builds a real comps set in the terminal's own statistics, linking to that same screen", () => {
    const comps = Array.from({ length: 9 }, (_, i) =>
      deal({ id: `c${i}`, announcedDate: `2026-09-${String(i + 1).padStart(2, "0")}`, industry: "Services-Prepackaged Software", valueUsd: (i + 1) * 2e9, evEbitda: 10 + i, evRevenue: 2, premiumPct: 20 + i }),
    );
    const p = landingFigures(hub({ deals: comps })).specimens!.precedents!;
    expect(p.screen).toBe("Software, $1B and up, past 24 months");
    expect(p.href).toBe("/precedents?sector=Tech&industry=software&min=1");
    expect(p.n).toBe(9);
    expect(p.rows).toHaveLength(5);
    expect(p.rows[0].id).toBe("c8");
    expect(p.summary.map((r) => r.label)).toEqual(["75th percentile", "Median", "25th percentile"]);
    expect(p.summary[1]).toMatchObject({ value: "$10.00B", evEbitda: "14.0x", premium: "24.0%" });
  });

  it("shows no comps from too few deals", () => {
    expect(landingFigures(hub({ deals: [deal({ evEbitda: 10, premiumPct: 20 })] })).specimens!.precedents).toBeNull();
  });
});
