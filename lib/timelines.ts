/**
 * Deal timelines: how long deals take from announcement to closing, by sector and by path
 * (tender offer vs shareholder vote), and which deals are still waiting. Pure and testable.
 */
import { SECTORS } from "./sectors";
import type { Deal, Sector } from "./types";

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY));

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export interface DealTimeline {
  deal: Deal;
  outcome: "closed" | "terminated" | "open";
  /** Announcement to closing (closed deals). */
  daysToClose: number | null;
  /** Announcement to first proxy / 14D-9 filing. */
  daysToFirstFiling: number | null;
  /** Days since announcement (open deals) or until termination. */
  daysElapsed: number;
}

export function dealTimeline(deal: Deal, asOf: string): DealTimeline | null {
  const m = deal.milestones;
  if (!m) return null;
  const outcome = m.closed ? "closed" : m.terminated || deal.status === "Terminated" ? "terminated" : "open";
  const end = m.closed ?? m.terminated ?? asOf;
  return {
    deal,
    outcome,
    daysToClose: m.closed ? daysBetween(deal.announcedDate, m.closed) : null,
    daysToFirstFiling: m.firstFiling ? daysBetween(deal.announcedDate, m.firstFiling.date) : null,
    daysElapsed: daysBetween(deal.announcedDate, end),
  };
}

export const BUCKETS: { label: string; max: number }[] = [
  { label: "< 1 mo", max: 30 },
  { label: "1–2 mo", max: 60 },
  { label: "2–3 mo", max: 91 },
  { label: "3–4 mo", max: 122 },
  { label: "4–6 mo", max: 183 },
  { label: "6–9 mo", max: 274 },
  { label: "9–12 mo", max: 365 },
  { label: "1 yr +", max: Infinity },
];

/** A "close" within a week of the announcement means Castle first saw the deal at completion: its true timeline is unknown. */
export const MIN_CLOSE_DAYS = 7;
/** Open for 18+ months with no closing or termination filing: almost always a data gap, not a real wait. */
export const STALE_OPEN_DAYS = 540;

export interface TimelineStats {
  closed: DealTimeline[];
  /** Left out of the statistics: first seen at completion, or open implausibly long. */
  excluded: { seenAtCompletion: number; stale: number };
  open: (DealTimeline & { expectedDays: number | null; progressPct: number | null })[];
  terminated: DealTimeline[];
  medianDaysToClose: number | null;
  medianDaysToFirstFiling: number | null;
  bySector: { sector: Sector; median: number | null; n: number }[];
  byPath: { tender: { median: number | null; n: number }; vote: { median: number | null; n: number } };
  byConsideration: { cash: { median: number | null; n: number }; stock: { median: number | null; n: number } };
  histogram: { label: string; count: number }[];
  /** Terminated share of deals that reached an outcome, 0–100. */
  terminationPct: number | null;
}

const group = (xs: DealTimeline[]) => ({ median: median(xs.map((x) => x.daysToClose!)), n: xs.length });

export function timelineStats(deals: Deal[], asOf: string): TimelineStats {
  const measured = deals.map((d) => dealTimeline(d, asOf)).filter((t): t is DealTimeline => t != null);
  const seenAtCompletion = measured.filter((t) => t.outcome === "closed" && t.daysToClose! < MIN_CLOSE_DAYS);
  const stale = measured.filter((t) => t.outcome === "open" && t.daysElapsed >= STALE_OPEN_DAYS);
  const all = measured.filter((t) => !seenAtCompletion.includes(t) && !stale.includes(t));
  const closed = all.filter((t) => t.outcome === "closed");
  const terminated = all.filter((t) => t.outcome === "terminated");
  const bySector = SECTORS.map((sector) => ({ sector, ...group(closed.filter((t) => t.deal.sector === sector)) }));
  const sectorMedian = new Map(bySector.map((s) => [s.sector, s.median]));
  const overall = median(closed.map((t) => t.daysToClose!));
  const open = all
    .filter((t) => t.outcome === "open")
    .map((t) => {
      const expectedDays = sectorMedian.get(t.deal.sector) ?? overall;
      return { ...t, expectedDays, progressPct: expectedDays ? Math.round((t.daysElapsed / expectedDays) * 100) : null };
    })
    .sort((a, b) => b.daysElapsed - a.daysElapsed);
  const outcomes = closed.length + terminated.length;
  return {
    closed,
    excluded: { seenAtCompletion: seenAtCompletion.length, stale: stale.length },
    open,
    terminated,
    medianDaysToClose: overall,
    medianDaysToFirstFiling: median(all.map((t) => t.daysToFirstFiling).filter((v): v is number => v != null)),
    bySector,
    byPath: {
      tender: group(closed.filter((t) => t.deal.milestones?.path === "tender")),
      vote: group(closed.filter((t) => t.deal.milestones?.path === "vote")),
    },
    byConsideration: {
      cash: group(closed.filter((t) => t.deal.consideration === "Cash")),
      stock: group(closed.filter((t) => t.deal.consideration === "Stock" || t.deal.consideration === "Mixed")),
    },
    histogram: BUCKETS.map((b, i) => ({
      label: b.label,
      count: closed.filter((t) => t.daysToClose! >= (BUCKETS[i - 1]?.max ?? 0) && t.daysToClose! < b.max).length,
    })),
    terminationPct: outcomes ? Math.round((terminated.length / outcomes) * 100) : null,
  };
}

export const months = (days: number | null) => (days == null ? "—" : days < 45 ? `${days} days` : `${(days / 30.44).toFixed(1)} months`);

/** Plain-English takeaways for someone learning how deals get done. */
/** Short, number-led findings for the takeaways strip (the KPIs already carry the headline median and break rate). */
export function timelineInsights(s: TimelineStats): string[] {
  const out: string[] = [];
  const { tender, vote } = s.byPath;
  if (tender.median != null && vote.median != null && tender.n >= 3 && vote.n >= 3)
    out.push(`Tender offers closed in ${months(tender.median)} vs ${months(vote.median)} with a shareholder vote.`);
  const { cash, stock } = s.byConsideration;
  if (cash.median != null && stock.median != null && cash.n >= 3 && stock.n >= 3)
    out.push(
      stock.median > cash.median
        ? `Deals paid in stock took longer: ${months(stock.median)} vs ${months(cash.median)} for cash.`
        : `Stock and cash deals closed at a similar pace (${months(stock.median)} vs ${months(cash.median)}).`,
    );
  const ranked = s.bySector.filter((x) => x.median != null && x.n >= 3).sort((a, b) => a.median! - b.median!);
  if (ranked.length >= 2) out.push(`Fastest sector: ${ranked[0].sector} (${months(ranked[0].median)}). Slowest: ${ranked.at(-1)!.sector} (${months(ranked.at(-1)!.median)}).`);
  if (s.medianDaysToFirstFiling != null) out.push(`The first proxy or tender document followed the announcement after ${months(s.medianDaysToFirstFiling)} (median).`);
  return out;
}
