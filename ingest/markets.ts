/**
 * Market series for the history tables. Free, no API keys:
 *
 * - Sector ETFs (monthly, total return from the dividend- and split-adjusted close): Yahoo Finance's chart endpoint.
 *   Stooq now refuses downloads (HTTP 403); Alpha Vantage, Tiingo and Polygon need keys.
 * - FRED series (monthly averages): the public fredgraph CSV, which needs no key.
 *   ICE BofA indices (the high-yield OAS) are limited on FRED to the last three years by ICE's licence, so Moody's
 *   Baa minus 10-year Treasury (BAA10Y) is kept alongside as the full-history credit spread.
 */
import type { Sector } from "../lib/types";

export const SECTOR_ETFS: Record<Sector, string> = { Tech: "XLK", Healthcare: "XLV", Energy: "XLE", Financials: "XLF", Industrials: "XLI" };

export const FRED_SERIES = {
  fedFunds: "FEDFUNDS", // effective federal funds rate, %
  treasury10y: "GS10", // 10-year Treasury constant maturity, %
  hySpread: "BAMLH0A0HYM2", // ICE BofA US High Yield OAS, % (FRED keeps ~3 years)
  baaSpread: "BAA10Y", // Moody's Baa corporate yield minus 10-year Treasury, % (full history)
  vix: "VIXCLS", // CBOE VIX, index level
  cpi: "CPIAUCSL", // CPI-U, seasonally adjusted, 1982-84 = 100
  oil: "DCOILWTICO", // WTI crude, $ a barrel (daily; FRED averages it by month)
} as const;
export type FredKey = keyof typeof FRED_SERIES;

/** Index ETFs read like the sector ETFs: biotech (XBI, equal-weighted, mostly small biotechs, the IPO and deal pool). */
export const INDEX_ETFS = { biotech: "XBI" } as const;
export type IndexKey = keyof typeof INDEX_ETFS;

export interface EtfMonth {
  /** "2015-01" */
  month: string;
  close: number;
  /** Close adjusted for dividends and splits: month-to-month changes are total returns. */
  adjClose: number;
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; Castle research)" };

async function fetchText(url: string, tries = 3): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) return await res.text();
      if (i >= tries - 1 || ![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      if (i >= tries - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
}

/** Monthly bars from Yahoo's chart JSON, keyed by the exchange's local month; the unfinished month is left out. */
export function parseYahooChart(json: string, before: string): EtfMonth[] {
  const r = JSON.parse(json)?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error("no chart data");
  const close: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
  const adj: (number | null)[] = r.indicators?.adjclose?.[0]?.adjclose ?? [];
  const out: EtfMonth[] = [];
  (r.timestamp as number[]).forEach((ts, i) => {
    // Bars are stamped at New York midnight on the 1st (04:00 or 05:00 UTC). `meta.gmtoffset` is today's offset,
    // not the bar's, so it can push a winter bar into the previous month; a few hours' margin can't.
    const month = new Date((ts + 6 * 3600) * 1000).toISOString().slice(0, 7);
    if (month >= before || close[i] == null || adj[i] == null) return;
    const row = { month, close: Math.round(close[i]! * 100) / 100, adjClose: adj[i]! };
    // Yahoo can repeat the current month as an extra bar: keep the last one per month.
    if (out.at(-1)?.month === month) out[out.length - 1] = row;
    else out.push(row);
  });
  return out;
}

export async function fetchEtfMonthly(ticker: string, from: string, before: string): Promise<EtfMonth[]> {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 40 * 86_400; // one bar early, for the first return
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${p1}&period2=${Math.floor(Date.now() / 1000)}&interval=1mo&events=div,split`;
  return parseYahooChart(await fetchText(url), before);
}

/** FRED's CSV ("observation_date,FEDFUNDS" then "2015-01-01,0.11"; "." for a missing value) -> month -> value. */
export function parseFredCsv(csv: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    const v = Number(raw);
    if (/^\d{4}-\d{2}/.test(date ?? "") && raw !== "." && raw !== "" && Number.isFinite(v)) out.set(date.slice(0, 7), v);
  }
  return out;
}

export async function fetchFredMonthly(id: string, from: string): Promise<Map<string, number>> {
  return parseFredCsv(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}&fq=Monthly&fam=avg`));
}

export interface Markets {
  fetchedAt: string;
  etf: Partial<Record<Sector, EtfMonth[]>>;
  fred: Partial<Record<FredKey, Record<string, number>>>;
  /** Index ETFs (INDEX_ETFS); missing in markets snapshots saved before October 2026. */
  index?: Partial<Record<IndexKey, EtfMonth[]>>;
}

/**
 * Fetch everything; a series that fails keeps its previous values (`previous`), so one bad response never wipes
 * history. Returns the merged result and the names of series that failed.
 */
export async function fetchMarkets(from: string, before: string, previous: Markets | null, log: (s: string) => void): Promise<{ markets: Markets; failed: string[] }> {
  const markets: Markets = { fetchedAt: new Date().toISOString(), etf: { ...previous?.etf }, fred: { ...previous?.fred }, index: { ...previous?.index } };
  const failed: string[] = [];
  for (const [key, ticker] of Object.entries(INDEX_ETFS) as [IndexKey, string][]) {
    try {
      markets.index![key] = await fetchEtfMonthly(ticker, from, before);
      log(`  ${ticker}: ${markets.index![key]!.length} months`);
    } catch (err) {
      failed.push(ticker);
      log(`  ! ${ticker}: ${(err as Error).message} (keeping previous values)`);
    }
  }
  for (const [sector, ticker] of Object.entries(SECTOR_ETFS) as [Sector, string][]) {
    try {
      markets.etf[sector] = await fetchEtfMonthly(ticker, from, before);
      log(`  ${ticker}: ${markets.etf[sector]!.length} months`);
    } catch (err) {
      failed.push(ticker);
      log(`  ! ${ticker}: ${(err as Error).message} (keeping previous values)`);
    }
  }
  for (const [key, id] of Object.entries(FRED_SERIES) as [FredKey, string][]) {
    try {
      const series = await fetchFredMonthly(id, from);
      markets.fred[key] = Object.fromEntries([...series].filter(([m]) => m < before));
      log(`  ${id}: ${series.size} months (${[...series.keys()][0] ?? "none"} onward)`);
    } catch (err) {
      failed.push(id);
      log(`  ! ${id}: ${(err as Error).message} (keeping previous values)`);
    }
  }
  return { markets, failed };
}
