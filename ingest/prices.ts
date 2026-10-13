/**
 * Share prices from Yahoo Finance's chart endpoint (free, no key; the same source as the sector ETFs in markets.ts):
 *
 * - Merger-arb spread: an open cash deal's offer against the target's latest close. A narrow spread means the market
 *   expects the deal to close; a wide one, doubt.
 * - Did it work?: the buyer's share price from the close before the announcement to the close after, and six months
 *   and a year on, each less the S&P 500's move over the same days (SPY, dividend-adjusted).
 *
 * Non-critical: a failure leaves the stored figures as they were. A quote is used only if Yahoo's company name shares a
 * word with ours (a delisted company's ticker can belong to someone else now) and, for a spread, sits between half the
 * offer and 1.2 times it: a target trading far above the offer usually means the stored offer is wrong (a price read
 * from a buyback line put Beazer at -31%), while a wide positive spread is real doubt (Intermex, its approval suspended).
 */
import { normalizeName } from "./parse/names";
import type { State, StoredDeal } from "./store";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; Castle research)" };
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Bar {
  date: string;
  close: number;
  adjClose: number;
}

export interface Chart {
  name: string;
  bars: Bar[];
  /** Yahoo's exchange name ("NasdaqGS", "NYSE", "OTC Markets OTCPK"). */
  exchange: string;
  /** Latest price and its date (the regular session). */
  price: number | null;
  priceDate: string | null;
}

/** Daily bars from Yahoo's chart JSON (pure). */
export function parseDailyChart(json: string): Chart {
  const r = JSON.parse(json)?.chart?.result?.[0];
  if (!r) throw new Error("no chart data");
  const ts: number[] = r.timestamp ?? [];
  const close: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
  const adj: (number | null)[] = r.indicators?.adjclose?.[0]?.adjclose ?? close;
  const bars: Bar[] = [];
  ts.forEach((t, i) => {
    if (close[i] == null || adj[i] == null) return;
    bars.push({ date: new Date((t + (r.meta?.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10), close: close[i]!, adjClose: adj[i]! });
  });
  const price = typeof r.meta?.regularMarketPrice === "number" ? r.meta.regularMarketPrice : null;
  const priceDate = typeof r.meta?.regularMarketTime === "number" ? new Date(r.meta.regularMarketTime * 1000).toISOString().slice(0, 10) : null;
  return { name: String(r.meta?.longName ?? r.meta?.shortName ?? ""), exchange: String(r.meta?.fullExchangeName ?? r.meta?.exchangeName ?? ""), bars, price, priceDate };
}

async function chart(ticker: string, from: string, to: string): Promise<Chart | null> {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d&events=div,split`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: UA }).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) return parseDailyChart(await res.text());
    await sleep(2000 * (i + 1));
  }
  return null;
}

/** Yahoo's name and ours share a distinctive word ("Warner Bros. Discovery, Inc." / "Warner Bros. Discovery"). */
export function sameIssuer(yahooName: string, ours: string): boolean {
  const words = (s: string) => normalizeName(s).split(" ").filter((w) => w.length >= 3);
  const ys = new Set(words(yahooName));
  return words(ours).some((w) => ys.has(w));
}

/**
 * Quoted on a US exchange. OTC quotes are thin and their history can miss a split: SoftBank's ordinary shares (SFTBF)
 * read as -75% across its 4-for-1 split, while its ADR was adjusted.
 */
export const onUsExchange = (c: Pick<Chart, "exchange">) => !!c.exchange && !/\bOTC\b|Pink|PNK/i.test(c.exchange);

/** Spread to an offer: +2.1 means the target trades 2.1% below the offer price. */
export const spreadPct = (offer: number, price: number) => (offer / price - 1) * 100;

/** Index of the last bar on or before `date` (-1 if none), and of the first bar after it. */
const before = (bars: Bar[], date: string) => bars.findLastIndex((b) => b.date < date);

/**
 * The buyer's move around the announcement: the close before `date` to the close of the next trading day after it (the
 * news often lands before the open), and to ~126 / ~252 trading days later, each less SPY over the same bars. Null parts
 * where the bars don't reach that far yet.
 */
export function reactionFrom(stock: Bar[], spy: Bar[], date: string) {
  const i0 = before(stock, date);
  if (i0 < 0 || i0 + 2 > stock.length - 1) return null;
  const at = (k: number) => stock[i0 + k];
  const ret = (from: Bar, to: Bar) => (to.adjClose / from.adjClose - 1) * 100;
  const spyAt = (d: string) => spy.findLast((b) => b.date <= d);
  const excess = (k: number) => {
    const end = at(k);
    const s0 = spyAt(at(0).date);
    const s1 = end && spyAt(end.date);
    return end && s0 && s1 ? ret(at(0), end) - ret(s0, s1) : null;
  };
  const day = ret(at(0), at(2));
  const dayVs = excess(2);
  if (dayVs == null) return null;
  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    announcementPct: round1(day)!,
    announcementVsMarketPct: round1(dayVs)!,
    m6VsMarketPct: round1(excess(126)),
    y1VsMarketPct: round1(excess(252)),
  };
}

const OPEN = new Set(["Announced", "Pending"]);

export async function updatePrices(state: State, opts: { today: string; log: (s: string) => void; maxReactions?: number }) {
  const { today, log } = opts;
  let spreads = 0;
  let reactions = 0;

  // Merger-arb spreads: open cash deals with an offer price and a listed target.
  for (const d of state.deals) {
    if (!OPEN.has(d.status) || d.privateTarget || d.consideration !== "Cash" || !d.pricePerShare || !d.target.ticker) {
      delete d.arb; // closed, ended or no longer an all-cash offer: no spread to show
      continue;
    }
    const c = await chart(d.target.ticker, new Date(Date.parse(today) - 10 * DAY).toISOString().slice(0, 10), today);
    await sleep(250);
    if (!c?.price || !c.priceDate) continue; // no quote today: keep the last one
    if (!sameIssuer(c.name, d.target.name) || !onUsExchange(c) || c.price < d.pricePerShare * 0.5 || c.price > d.pricePerShare * 1.2) {
      delete d.arb;
      continue;
    }
    d.arb = { priceUsd: Math.round(c.price * 100) / 100, spreadPct: Math.round(spreadPct(d.pricePerShare, c.price) * 10) / 10, asOf: c.priceDate };
    spreads++;
  }

  // Did it work?: listed buyers, once the bars reach two trading days past the announcement, again at 6 and 12 months.
  const due = (d: StoredDeal) => {
    if (!d.acquirer.ticker || !d.acquirer.cik || d.announcedDate < "2021-01-01") return false;
    const age = (Date.parse(today) - Date.parse(d.announcedDate)) / DAY;
    if (age < 4) return false;
    const checked = d.reactionCheckedAt ? (Date.parse(today) - Date.parse(d.reactionCheckedAt)) / DAY : Infinity;
    // No usable quote (OTC, a foreign line, a renamed ticker): try again weekly, not every run.
    if (!d.reaction) return checked >= 7;
    return checked >= 1 && ((d.reaction.y1VsMarketPct == null && age > 370) || (d.reaction.m6VsMarketPct == null && age > 190));
  };
  const queue = state.deals.filter(due).sort((a, b) => b.announcedDate.localeCompare(a.announcedDate)).slice(0, opts.maxReactions ?? 300);
  if (queue.length) {
    const spy = await chart("SPY", "2020-12-01", today);
    if (!spy?.bars.length) {
      log("prices: SPY unavailable; reactions skipped");
    } else {
      for (const d of queue) {
        d.reactionCheckedAt = today;
        const from = new Date(Date.parse(d.announcedDate) - 10 * DAY).toISOString().slice(0, 10);
        const to = new Date(Math.min(Date.parse(today), Date.parse(d.announcedDate) + 380 * DAY)).toISOString().slice(0, 10);
        const c = await chart(d.acquirer.ticker!, from, to);
        await sleep(250);
        if (!c?.bars.length) continue;
        if (!sameIssuer(c.name, d.acquirer.name) || !onUsExchange(c)) {
          delete d.reaction;
          continue;
        }
        const r = reactionFrom(c.bars, spy.bars, d.announcedDate);
        if (!r) continue;
        d.reaction = r;
        reactions++;
      }
    }
  }
  log(`prices: ${spreads} merger-arb spreads, ${reactions} buyer reactions (${queue.length} looked up)`);
  return { spreads, reactions };
}
