/**
 * Market series for the history tables: FRED's public CSV (monthly averages), free, no API key.
 *
 * Nothing here fetches share prices any more. The sector ETF and index series came from Yahoo Finance's chart endpoint
 * until November 2026, when Castle stopped calling it: Yahoo's terms bar collecting its data by automated means without
 * permission (legal.yahoo.com, section 2(d) item 9) and distributing it or derivative works without written permission
 * (2(h)), its robots.txt disallows that host, and no free source does the job (Stooq refuses downloads; Alpha Vantage,
 * Tiingo and Polygon need keys; IEX HIST is 14.6 GB a day of partial trades). Don't add it back without a licence.
 *
 * The ICE BofA high-yield spread (BAMLH0A0HYM2) was dropped at the same time. FRED labels it "Copyrighted: Pre-Approval
 * Required" and ICE prohibits reproducing it without written permission, nothing on the site needs it, and Moody's Baa
 * minus 10-year Treasury (BAA10Y) already covers the full history.
 *
 * A local .data/history/markets.json keeps its old ETF, index and high-yield values for research: fetchMarkets passes on
 * whatever it is given, and publicMarkets takes them out before anything is published.
 */
import type { Sector } from "../lib/types";

/** Names only: sector_monthly's etf_ticker column. The prices are gone (above). */
export const SECTOR_ETFS: Record<Sector, string> = { Tech: "XLK", Healthcare: "XLV", Energy: "XLE", Financials: "XLF", Industrials: "XLI" };

export const FRED_SERIES = {
  fedFunds: "FEDFUNDS", // effective federal funds rate, %
  treasury10y: "GS10", // 10-year Treasury constant maturity, %
  baaSpread: "BAA10Y", // Moody's Baa corporate yield minus 10-year Treasury, % (full history)
  vix: "VIXCLS", // CBOE VIX, index level
  cpi: "CPIAUCSL", // CPI-U, seasonally adjusted, 1982-84 = 100
  oil: "DCOILWTICO", // WTI crude, $ a barrel (daily; FRED averages it by month)
} as const;
export type FredKey = keyof typeof FRED_SERIES;

/** Old index series in a local markets file: biotech (XBI). */
export type IndexKey = "biotech";

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
  /** Old series in a local file only (no longer fetched; see above). */
  etf: Partial<Record<Sector, EtfMonth[]>>;
  fred: Partial<Record<FredKey, Record<string, number>>>;
  /** Old series in a local file only (no longer fetched; see above). */
  index?: Partial<Record<IndexKey, EtfMonth[]>>;
}

/**
 * Fetch everything; a series that fails keeps its previous values (`previous`), so one bad response never wipes
 * history. What isn't fetched any more (old ETF, index and high-yield values) is passed on untouched. Returns the merged
 * result and the names of series that failed.
 */
export async function fetchMarkets(from: string, before: string, previous: Markets | null, log: (s: string) => void): Promise<{ markets: Markets; failed: string[] }> {
  const markets: Markets = { fetchedAt: new Date().toISOString(), etf: { ...previous?.etf }, fred: { ...previous?.fred }, index: { ...previous?.index } };
  const failed: string[] = [];
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

/** What may leave this machine: the FRED_SERIES only. No share prices (Yahoo's terms) and no high-yield index (ICE's). */
export function publicMarkets(m: Markets): Markets {
  const fred: Markets["fred"] = {};
  for (const key of Object.keys(FRED_SERIES) as FredKey[]) if (m.fred[key]) fred[key] = m.fred[key];
  return { fetchedAt: m.fetchedAt, etf: {}, fred, index: {} };
}
