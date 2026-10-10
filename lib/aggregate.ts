/**
 * Build the hub's derived series (deal volume, league table, valuation medians)
 * from raw deals. Pure and deterministic, so it works on sample or real data.
 */
import { feeRows } from "./fees";
import { median } from "./metrics";
import { displayCompanyName } from "./names";
import { SECTORS, type ActivistStake, type Deal, type HubData, type Ipo, type LeagueTableEntry, type Macro, type MonthlySectorVolume, type SectorValuation } from "./types";

const MONTHS = 24;
const MAX_MONTHS = 72;
const QUARTERS = 8;
const LEAGUE_SIZE = 30;
/**
 * Caps on what ships to the browser (the screener filters client-side). Aggregates use everything.
 * Heavy per-deal detail (fairness opinions) is left out and loaded on demand from /api/deal/[id].
 */
export const DEAL_FEED_SIZE = 4000;
export const IPO_FEED_SIZE = 150;

const monthKey = (y: number, m0: number) => {
  const d = new Date(Date.UTC(y, m0, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
/**
 * The first month the data really covers: at least a quarter of a typical month's deals. The history starts in
 * January 2021, but a few deals announced in 2020 were found later (when they closed); counting from them would
 * open the volume chart with near-empty months that look like a collapse in M&A.
 */
export function coverageStart(deals: Deal[]): string | null {
  const counts = new Map<string, number>();
  for (const d of deals) if (d.status !== "Terminated") counts.set(d.announcedDate.slice(0, 7), (counts.get(d.announcedDate.slice(0, 7)) ?? 0) + 1);
  if (!counts.size) return null;
  const sorted = [...counts.values()].sort((a, b) => a - b);
  const threshold = Math.max(1, sorted[Math.floor(sorted.length / 2)] / 4);
  const month = [...counts].filter(([, n]) => n >= threshold).map(([m]) => m).sort()[0];
  return `${month}-01`;
}

const quarterOf = (iso: string) => `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

/**
 * Complete months before `asOf`'s month, as far back as the data goes (at least 24, at most 72, so a longer history
 * shows up without inventing empty months before coverage began), then `asOf`'s own month so far. The site shows
 * that last one as a month in progress (`VolumeMatrix.partial`) and leaves it out of month-on-month comparisons.
 */
export function monthlyVolume(deals: Deal[], asOf: string): MonthlySectorVolume[] {
  const now = new Date(asOf);
  const first = coverageStart(deals) ?? asOf.slice(0, 10);
  const span = (now.getUTCFullYear() - Number(first.slice(0, 4))) * 12 + (now.getUTCMonth() - (Number(first.slice(5, 7)) - 1));
  const length = Math.min(MAX_MONTHS, Math.max(MONTHS, span));
  const months = Array.from({ length: length + 1 }, (_, i) => monthKey(now.getUTCFullYear(), now.getUTCMonth() - length + i));
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

/**
 * Year to date through `asOf`'s day, against the same days a year earlier (Jan 1 – Oct 7 vs Jan 1 – Oct 7): a month
 * in progress compared with the whole of last year's month would make every October look like a slump.
 */
export function yearToDate(deals: Deal[], asOf: string): NonNullable<HubData["yearToDate"]> {
  const through = asOf.slice(0, 10);
  const year = Number(through.slice(0, 4));
  const total = (from: string, to: string) => {
    let value = 0;
    let count = 0;
    for (const d of deals) {
      if (d.status === "Terminated" || d.announcedDate < from || d.announcedDate > to) continue;
      count++;
      value += d.valueUsd ?? 0;
    }
    return { value, count };
  };
  const current = total(`${year}-01-01`, through);
  const prior = total(`${year - 1}-01-01`, `${year - 1}${through.slice(4)}`);
  return { through, value: current.value, count: current.count, priorValue: prior.value, priorCount: prior.count };
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
/** Fewest deals behind a median before it is shown: with one or two, a single deal would swing the line. */
export const MIN_VALUATION_SAMPLE = 3;
/** Each point is a trailing-twelve-month median: the quarter plus the three before it. */
const LTM_QUARTERS = 4;

export function sectorValuations(deals: Deal[], asOf: string): SectorValuation[] {
  const now = new Date(asOf);
  const span = QUARTERS + LTM_QUARTERS - 1;
  const all = Array.from({ length: span }, (_, i) => quarterOf(monthKey(now.getUTCFullYear(), now.getUTCMonth() - 3 * (span - 1 - i))));
  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  const med = (v: number[]) => (v.length >= MIN_VALUATION_SAMPLE ? round1(median(v)) : null);
  const live = deals.filter((d) => d.status !== "Terminated");
  const out: SectorValuation[] = [];
  for (let qi = LTM_QUARTERS - 1; qi < all.length; qi++) {
    const quarter = all[qi];
    const window = new Set(all.slice(qi - LTM_QUARTERS + 1, qi + 1));
    for (const sector of SECTORS) {
      const inSector = live.filter((d) => d.sector === sector);
      const ltm = inSector.filter((d) => window.has(quarterOf(d.announcedDate)));
      const vals = (f: (d: Deal) => number | null) => ltm.map(f).filter((v): v is number => v != null);
      const ebitda = vals((d) => d.evEbitda);
      const revenue = vals((d) => d.evRevenue);
      const premium = vals((d) => d.premiumPct);
      out.push({
        quarter,
        sector,
        medianEvEbitda: med(ebitda),
        medianEvRevenue: med(revenue),
        medianPremiumPct: med(premium),
        dealCount: inSector.filter((d) => quarterOf(d.announcedDate) === quarter).length,
        sample: { evEbitda: ebitda.length, evRevenue: revenue.length, premium: premium.length },
      });
    }
  }
  return out;
}

/**
 * Strip ingest-only fields so only the public contract reaches the browser. Heavy detail stays out of the page feed
 * and /api/deal/[id] serves the full record (`withFairness`): fairness opinions (one drawer tab; the feed carries
 * `hasFairness`) and the filing list, a third of the feed's weight (the feed keeps the first filing, the source the
 * row menu opens, and `filingCount`).
 */
export function toPublicDeal(d: Deal, opts: { withFairness?: boolean } = {}): Deal {
  return {
    id: d.id,
    announcedDate: d.announcedDate,
    acquirer: { ...d.acquirer, name: displayCompanyName(d.acquirer.name) },
    target: { ...d.target, name: displayCompanyName(d.target.name) },
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
    filings: opts.withFairness ? d.filings : d.filings.slice(0, 1),
    ...(opts.withFairness || d.filings.length <= 1 ? {} : { filingCount: d.filings.length }),
    ...(d.fairness?.length ? (opts.withFairness ? { fairness: d.fairness, hasFairness: true } : { hasFairness: true }) : {}),
    ...(d.milestones ? { milestones: d.milestones } : {}),
    ...(d.terms ? { terms: d.terms } : {}),
    ...(d.privateTarget ? { privateTarget: true } : {}),
  };
}

export function toPublicIpo(i: Ipo): Ipo {
  return {
    id: i.id,
    company: { ...i.company, name: displayCompanyName(i.company.name) },
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

/**
 * What every page carries: the dataset without its long lists (deals, IPOs, activist stakes, fees). The shell
 * renders from this at once; the full dataset loads once per visit from /api/hub and stays in memory, so switching
 * pages never re-downloads it.
 */
export function bootHubData(full: HubData): HubData {
  return { ...full, deals: [], ipos: [], activists: [], fees: [] };
}

export function buildHubData(input: {
  deals: Deal[];
  ipos: (Ipo & { lastActivity?: string })[];
  asOf: string;
  shortName: (name: string) => string;
  macro?: Macro | null;
  activists?: ActivistStake[];
}): HubData {
  const deals = [...input.deals].sort((a, b) => b.announcedDate.localeCompare(a.announcedDate) || a.id.localeCompare(b.id));
  const ipos = [...input.ipos].sort((a, b) => (b.lastActivity ?? b.pricedDate ?? b.filedDate).localeCompare(a.lastActivity ?? a.pricedDate ?? a.filedDate));
  return {
    asOf: input.asOf,
    isSample: false,
    totalDeals: deals.length,
    deals: deals.slice(0, DEAL_FEED_SIZE).map((d) => toPublicDeal(d)),
    fees: feeRows(deals),
    monthlyVolume: monthlyVolume(deals, input.asOf),
    yearToDate: yearToDate(deals, input.asOf),
    ipos: ipos.slice(0, IPO_FEED_SIZE).map(toPublicIpo),
    leagueTable: leagueTable(deals, input.asOf, input.shortName),
    valuations: sectorValuations(deals, input.asOf),
    macro: input.macro ?? null,
    activists: (input.activists ?? []).map((a) => ({
      ...a,
      investor: { ...a.investor, name: displayCompanyName(a.investor.name) },
      company: { ...a.company, name: displayCompanyName(a.company.name) },
    })),
  };
}
