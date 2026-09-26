/**
 * Build the hub's derived series (deal volume, league table, valuation medians)
 * from raw deals. Pure and deterministic, so it works on sample or real data.
 */
import { median } from "./metrics";
import { SECTORS, type Deal, type HubData, type Ipo, type LeagueTableEntry, type Macro, type MonthlySectorVolume, type SectorValuation } from "./types";

const MONTHS = 24;
const QUARTERS = 8;
const LEAGUE_SIZE = 30;
/** Caps on what ships to the browser (the screener filters client-side). Aggregates use everything. */
export const DEAL_FEED_SIZE = 600;
export const IPO_FEED_SIZE = 150;

const monthKey = (y: number, m0: number) => {
  const d = new Date(Date.UTC(y, m0, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const quarterOf = (iso: string) => `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

/** The 24 complete months before `asOf`'s month. */
export function monthlyVolume(deals: Deal[], asOf: string): MonthlySectorVolume[] {
  const now = new Date(asOf);
  const months = Array.from({ length: MONTHS }, (_, i) => monthKey(now.getUTCFullYear(), now.getUTCMonth() - MONTHS + i));
  const rows = new Map<string, MonthlySectorVolume>();
  for (const month of months) for (const sector of SECTORS) rows.set(`${month}|${sector}`, { month, sector, dealValueUsd: 0, dealCount: 0 });
  for (const d of deals) {
    if (d.status === "Terminated") continue;
    const row = rows.get(`${d.announcedDate.slice(0, 7)}|${d.sector}`);
    if (!row) continue;
    row.dealCount += 1;
    row.dealValueUsd += d.valueUsd ?? 0;
  }
  return [...rows.values()];
}

function rankAdvisors(deals: Deal[]) {
  const stats = new Map<string, { count: number; value: number }>();
  for (const d of deals) {
    for (const name of new Set([...d.acquirerAdvisors, ...d.targetAdvisors])) {
      const s = stats.get(name) ?? { count: 0, value: 0 };
      s.count += 1;
      s.value += d.valueUsd ?? 0;
      stats.set(name, s);
    }
  }
  return [...stats.entries()].sort((a, b) => b[1].value - a[1].value || b[1].count - a[1].count || a[0].localeCompare(b[0]));
}

/** Year-to-date league table by deal value; rank change versus the end of the previous quarter. */
export function leagueTable(deals: Deal[], asOf: string, shortName: (name: string) => string): HubData["leagueTable"] {
  const year = asOf.slice(0, 4);
  const q = Math.floor((Number(asOf.slice(5, 7)) - 1) / 3);
  const priorQuarterEnd = `${year}-${String(q * 3).padStart(2, "0")}-31`;
  const ytd = deals.filter((d) => d.announcedDate.startsWith(year) && d.status !== "Terminated");
  const current = rankAdvisors(ytd);
  const prior = q > 0 ? rankAdvisors(ytd.filter((d) => d.announcedDate <= priorQuarterEnd)) : [];
  const priorRank = new Map(prior.map(([name], i) => [name, i + 1]));

  const entries: LeagueTableEntry[] = current.slice(0, LEAGUE_SIZE).map(([name, s], i) => {
    const before = priorRank.get(name);
    return {
      advisor: { name, shortName: shortName(name) },
      dealCount: s.count,
      dealValueUsd: s.value,
      rankChange: before ? before - (i + 1) : 0,
    };
  });
  return { period: `${year} YTD`, entries };
}

/** Median multiples per sector per quarter, last 8 quarters including the current one. */
export function sectorValuations(deals: Deal[], asOf: string): SectorValuation[] {
  const now = new Date(asOf);
  const quarters = Array.from({ length: QUARTERS }, (_, i) => quarterOf(monthKey(now.getUTCFullYear(), now.getUTCMonth() - 3 * (QUARTERS - 1 - i))));
  const out: SectorValuation[] = [];
  for (const quarter of quarters) {
    for (const sector of SECTORS) {
      const inQ = deals.filter((d) => d.sector === sector && quarterOf(d.announcedDate) === quarter && d.status !== "Terminated");
      const vals = (f: (d: Deal) => number | null) => inQ.map(f).filter((v): v is number => v != null);
      const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
      out.push({
        quarter,
        sector,
        medianEvEbitda: round1(median(vals((d) => d.evEbitda))),
        medianEvRevenue: round1(median(vals((d) => d.evRevenue))),
        medianPremiumPct: round1(median(vals((d) => d.premiumPct))),
        dealCount: inQ.length,
      });
    }
  }
  return out;
}

/** Strip ingest-only fields so only the public contract reaches the browser. */
export function toPublicDeal(d: Deal): Deal {
  return {
    id: d.id,
    announcedDate: d.announcedDate,
    acquirer: d.acquirer,
    target: d.target,
    valueUsd: d.valueUsd,
    pricePerShare: d.pricePerShare,
    premiumPct: d.premiumPct,
    consideration: d.consideration,
    sector: d.sector,
    industry: d.industry,
    status: d.status,
    statusDate: d.statusDate,
    enterpriseValueUsd: d.enterpriseValueUsd,
    evEbitda: d.evEbitda,
    evRevenue: d.evRevenue,
    acquirerAdvisors: d.acquirerAdvisors,
    targetAdvisors: d.targetAdvisors,
    filings: d.filings,
  };
}

export function toPublicIpo(i: Ipo): Ipo {
  return {
    id: i.id,
    company: i.company,
    sector: i.sector,
    industry: i.industry,
    stage: i.stage,
    filedDate: i.filedDate,
    pricedDate: i.pricedDate,
    expectedRaiseUsd: i.expectedRaiseUsd,
    offerPrice: i.offerPrice,
    underwriters: i.underwriters,
    description: i.description,
    filings: i.filings,
  };
}

export function buildHubData(input: { deals: Deal[]; ipos: (Ipo & { lastActivity?: string })[]; asOf: string; shortName: (name: string) => string; macro?: Macro | null }): HubData {
  const deals = [...input.deals].sort((a, b) => b.announcedDate.localeCompare(a.announcedDate) || a.id.localeCompare(b.id));
  const ipos = [...input.ipos].sort((a, b) => (b.lastActivity ?? b.pricedDate ?? b.filedDate).localeCompare(a.lastActivity ?? a.pricedDate ?? a.filedDate));
  return {
    asOf: input.asOf,
    isSample: false,
    totalDeals: deals.length,
    deals: deals.slice(0, DEAL_FEED_SIZE).map(toPublicDeal),
    monthlyVolume: monthlyVolume(deals, input.asOf),
    ipos: ipos.slice(0, IPO_FEED_SIZE).map(toPublicIpo),
    leagueTable: leagueTable(deals, input.asOf, input.shortName),
    valuations: sectorValuations(deals, input.asOf),
    macro: input.macro ?? null,
  };
}
