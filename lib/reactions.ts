/**
 * "Did buyers win?": how listed acquirers' shares moved against the S&P 500 when they announced a deal, and six months
 * on, grouped by how they paid, what they bought and how big it was. From `Deal.reaction` (Yahoo prices, see
 * ingest/prices.ts). Medians, so a few micro-cap reverse mergers moving ±100% don't set the figure.
 */
import { median } from "./metrics";
import type { Deal } from "./types";

/** A group needs this many deals before its median is shown. */
export const MIN_GROUP = 5;

export interface ReactionGroup {
  label: string;
  count: number;
  /** Median move against the S&P 500 over the two trading days after the announcement (%). */
  announcement: number | null;
  /** Share of buyers that beat the S&P 500 over those two days (%). */
  beatPct: number | null;
  /** Median move against the S&P 500 six months on, and how many deals are that old. */
  sixMonths: number | null;
  sixMonthsCount: number;
}

export interface ReactionSummary {
  all: ReactionGroup;
  groups: { title: string; rows: ReactionGroup[] }[];
  /** The biggest deals the market liked most and least (announcement move against the S&P 500). */
  best: Deal[];
  worst: Deal[];
}

const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

function group(label: string, deals: Deal[]): ReactionGroup {
  const day = deals.map((d) => d.reaction!.announcementVsMarketPct);
  const six = deals.map((d) => d.reaction!.m6VsMarketPct).filter((v): v is number => v != null);
  const enough = deals.length >= MIN_GROUP;
  return {
    label,
    count: deals.length,
    announcement: enough ? round1(median(day)) : null,
    beatPct: enough ? Math.round((day.filter((v) => v > 0).length / day.length) * 100) : null,
    sixMonths: six.length >= MIN_GROUP ? round1(median(six)) : null,
    sixMonthsCount: six.length,
  };
}

/** Deals that count: a listed buyer's reaction is known and the deal wasn't called off. */
export const withReaction = (deals: Deal[]) => deals.filter((d) => d.reaction && d.status !== "Terminated");

export function reactionSummary(deals: Deal[], { bigDealUsd = 1e9, listSize = 4 } = {}): ReactionSummary {
  const ds = withReaction(deals);
  const by = (f: (d: Deal) => boolean) => ds.filter(f);
  const size = (d: Deal) => d.enterpriseValueUsd ?? d.valueUsd;
  const big = ds.filter((d) => (size(d) ?? 0) >= bigDealUsd).sort((a, b) => b.reaction!.announcementVsMarketPct - a.reaction!.announcementVsMarketPct);
  return {
    all: group("All buyers", ds),
    groups: [
      {
        title: "How they paid",
        rows: [group("Cash", by((d) => d.consideration === "Cash")), group("Stock", by((d) => d.consideration === "Stock")), group("Cash and stock", by((d) => d.consideration === "Mixed"))],
      },
      {
        title: "What they bought",
        rows: [group("Listed company", by((d) => !d.privateTarget)), group("Private company", by((d) => !!d.privateTarget))],
      },
      {
        title: "Deal size",
        rows: [
          group("Under $1B", by((d) => size(d) != null && size(d)! < 1e9)),
          group("$1B – $10B", by((d) => size(d) != null && size(d)! >= 1e9 && size(d)! < 10e9)),
          group("$10B and up", by((d) => (size(d) ?? 0) >= 10e9)),
          group("Not disclosed", by((d) => size(d) == null)),
        ],
      },
    ],
    best: big.filter((d) => d.reaction!.announcementVsMarketPct > 0).slice(0, listSize),
    worst: big.filter((d) => d.reaction!.announcementVsMarketPct < 0).reverse().slice(0, listSize),
  };
}

const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

/** Short, number-led lines for the panel (2–3). */
export function reactionInsights(s: ReactionSummary): string[] {
  const out: string[] = [];
  const { all } = s;
  if (all.announcement == null) return out;
  out.push(`The median buyer moved ${pts(all.announcement)} against the S&P 500 in the two days after announcing; ${all.beatPct}% beat it.`);
  const [cash, stock] = s.groups[0].rows;
  if (cash.announcement != null && stock.announcement != null && Math.abs(cash.announcement - stock.announcement) >= 0.5)
    out.push(`Paying in stock: ${pts(stock.announcement)} at the median, against ${pts(cash.announcement)} for cash buyers.`);
  if (all.sixMonths != null) out.push(`Six months on, the median buyer was ${pts(all.sixMonths)} against the market (${all.sixMonthsCount} deals that old).`);
  return out;
}
