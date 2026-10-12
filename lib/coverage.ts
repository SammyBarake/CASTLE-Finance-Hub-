/**
 * Data coverage: how complete each field is, for the Coverage page. Pure: computed in the browser from the feed.
 * A blank is often right (an undisclosed price, a loss-making target with no EV / EBITDA), so these are shares of
 * deals with the figure, not error rates.
 */
import type { Deal, Ipo } from "./types";

export interface Field<T> {
  key: string;
  label: string;
  has: (x: T) => boolean;
  /** Why a blank is common, shown under the label. */
  note?: string;
}

export interface Share {
  n: number;
  of: number;
  pct: number | null;
}

const share = (n: number, of: number): Share => ({ n, of, pct: of ? (n / of) * 100 : null });

export const PUBLIC_FIELDS: Field<Deal>[] = [
  { key: "value", label: "Deal value", has: (d) => d.valueUsd != null, note: "Mergers of equals often state only the combined size" },
  { key: "price", label: "Price per share", has: (d) => d.pricePerShare != null },
  { key: "premium", label: "Premium", has: (d) => d.premiumPct != null, note: "Only over the unaffected or last close; never over a VWAP" },
  { key: "evEbitda", label: "EV / EBITDA", has: (d) => d.evEbitda != null, note: "None for loss-making targets, banks and insurers" },
  { key: "evRevenue", label: "EV / Revenue", has: (d) => d.evRevenue != null },
  { key: "targetAdvisors", label: "Target adviser", has: (d) => d.targetAdvisors.length > 0 },
  { key: "acquirerAdvisors", label: "Buyer adviser", has: (d) => d.acquirerAdvisors.length > 0, note: "The target's proxy names only its own bank" },
  { key: "fairness", label: "Fairness opinion", has: (d) => !!d.hasFairness || !!d.fairness?.length },
  { key: "fee", label: "Break fee", has: (d) => d.terms?.targetFeeUsd != null },
  { key: "timeline", label: "Filing timeline", has: (d) => !!d.milestones?.firstFiling },
];

export const PRIVATE_FIELDS: Field<Deal>[] = [
  { key: "value", label: "Deal value", has: (d) => d.valueUsd != null, note: "Most releases say terms were not disclosed" },
  { key: "acquirerAdvisors", label: "Buyer adviser", has: (d) => d.acquirerAdvisors.length > 0 },
  { key: "targetAdvisors", label: "Seller adviser", has: (d) => d.targetAdvisors.length > 0 },
];

export const IPO_FIELDS: Field<Ipo>[] = [
  { key: "underwriters", label: "Bookrunner", has: (i) => i.underwriters.length > 0 },
  { key: "raise", label: "Expected raise", has: (i) => i.expectedRaiseUsd != null },
  { key: "price", label: "Offer price", has: (i) => i.offerPrice != null, note: "Set at pricing" },
];

export interface CoverageRow {
  key: string;
  label: string;
  note?: string;
  all: Share;
  byYear: Record<string, Share>;
}

export interface Coverage {
  /** Column groups: years for deals, stages for IPOs. */
  years: string[];
  total: number;
  totalByYear: Record<string, number>;
  rows: CoverageRow[];
}

/** Each field's share of `items`, overall and by group (`groupOf`: a year, or an IPO's stage), groups in `order` if given. */
export function coverage<T>(items: T[], fields: Field<T>[], groupOf: (x: T) => string, order?: string[]): Coverage {
  const seen = new Set(items.map(groupOf));
  const years = order ? order.filter((g) => seen.has(g)) : [...seen].sort();
  const byYear = Object.fromEntries(years.map((y) => [y, items.filter((x) => groupOf(x) === y)]));
  return {
    years,
    total: items.length,
    totalByYear: Object.fromEntries(years.map((y) => [y, byYear[y].length])),
    rows: fields.map((f) => ({
      key: f.key,
      label: f.label,
      note: f.note,
      all: share(items.filter(f.has).length, items.length),
      byYear: Object.fromEntries(years.map((y) => [y, share(byYear[y].filter(f.has).length, byYear[y].length)])),
    })),
  };
}

/** Public-target deals the coverage counts: from `start`, not terminated (an abandoned bid rarely gets a proxy). */
export const publicDeals = (deals: Deal[], start: string) => deals.filter((d) => !d.privateTarget && d.status !== "Terminated" && d.announcedDate >= start);
export const privateDeals = (deals: Deal[], start: string) => deals.filter((d) => d.privateTarget && d.announcedDate >= start);

/** Number-led takeaways: the best- and least-covered public fields, and private values. */
export function coverageTakeaways(pub: Coverage, priv: Coverage): string[] {
  const out: string[] = [];
  const pct = (r: CoverageRow | undefined) => (r?.all.pct == null ? null : Math.round(r.all.pct));
  const get = (c: Coverage, key: string) => c.rows.find((r) => r.key === key);
  const value = pct(get(pub, "value"));
  const premium = pct(get(pub, "premium"));
  if (value != null && premium != null) out.push(`${value}% of public-target deals have a deal value and ${premium}% a premium over the unaffected price.`);
  const ev = pct(get(pub, "evEbitda"));
  if (ev != null) out.push(`EV / EBITDA is known for ${ev}%: loss-making targets, banks and insurers have none by design.`);
  const tgt = pct(get(pub, "targetAdvisors"));
  const buyer = pct(get(pub, "acquirerAdvisors"));
  if (tgt != null && buyer != null) out.push(`Target advisers are named for ${tgt}% of deals, buyer advisers for ${buyer}%.`);
  const privValue = pct(get(priv, "value"));
  if (privValue != null && priv.total) out.push(`${priv.total.toLocaleString("en-US")} private-company purchases; ${privValue}% disclose a price.`);
  return out;
}
