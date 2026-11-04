/**
 * Where the history data lives: local JSON files in .data/history/ (git-ignored), and the Supabase history tables
 * (supabase/migrations/0002_history.sql) when pushing. The live store (ingest/store.ts) is not involved.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IpoHistoryState } from "./ipoHistory";
import { publicMarkets, type Markets } from "./markets";
import { withRetry, type StoredDeal } from "./store";
import type { MacroMonthRow, SectorMonthRow } from "../lib/history";

export const HISTORY_DIR = ".data/history";
export const LOCAL = {
  deals: `${HISTORY_DIR}/deals.json`, // JsonStore format (deals + seen documents)
  ipos: `${HISTORY_DIR}/ipos.json`,
  markets: `${HISTORY_DIR}/markets.json`,
  sectorMonthly: `${HISTORY_DIR}/sector_monthly.json`,
  macroMonthly: `${HISTORY_DIR}/macro_monthly.json`,
  snapshots: `${HISTORY_DIR}/snapshots.json`,
  coverage: `${HISTORY_DIR}/coverage.json`,
  /** Weak years and sector-years (written by `report`; read by the link estimator in research/). */
  coverageFlags: `${HISTORY_DIR}/coverage_flags.json`,
};

export function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}
export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 1));
}

export type Snapshot = { kind: string; period: string; takenAt: string; data: unknown };

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

export function historyDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Pushing needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Every read and write retries transient errors, as the ingest's do (`withRetry`). This job, with no retries, died within
 * two seconds on its only two runs (October 2 and November 2 2026). The logs need a sign-in, so the likeliest cause is
 * inferred, not seen: GitHub's runners seem to get a transient error on their first requests. The monitor died the same
 * way on 5 of its 11 runs until it got retries, and 8 of its 12 runs since took the 10 seconds longer a first retry adds.
 * A failure now prints an `::error::` line, which shows on the run's page without a sign-in.
 */
async function reliably<T>(table: string, label: string, call: () => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  try {
    return await withRetry(`${label} ${table}`, call);
  } catch (err) {
    const message = (err as Error).message;
    throw /does not exist|schema cache/i.test(message) ? new Error(`Supabase table "${table}" is missing: run supabase/migrations/0002_history.sql in the Supabase SQL editor first`) : err;
  }
}

async function upsert(db: SupabaseClient, table: string, rows: object[], onConflict?: string) {
  for (let i = 0; i < rows.length; i += 500) {
    await reliably(table, "upsert", () => db.from(table).upsert(rows.slice(i, i + 500), onConflict ? { onConflict } : undefined));
  }
}

async function selectAll<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const data = await reliably(table, "select", () => db.from(table).select(columns).range(from, from + 999));
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

const firstOfMonth = (month: string) => `${month}-01`;

export const push = {
  deals: async (db: SupabaseClient, deals: StoredDeal[]) => {
    await upsert(db, "deals_history", deals.map((d) => ({ id: d.id, announced_date: d.announcedDate, status: d.status, data: d })));
    // Records the history no longer has (merged duplicates, junk dropped by tidy, a re-read) are deleted: an upsert
    // alone would keep them. Never with an empty file, which would wipe the table.
    if (!deals.length) return;
    const keep = new Set(deals.map((d) => d.id));
    const stale = (await selectAll<{ id: string }>(db, "deals_history", "id")).map((r) => r.id).filter((id) => !keep.has(id));
    for (let i = 0; i < stale.length; i += 200) {
      await reliably("deals_history", "delete", () => db.from("deals_history").delete().in("id", stale.slice(i, i + 200)));
    }
  },
  ipos: (db: SupabaseClient, state: IpoHistoryState) =>
    upsert(db, "ipo_history", state.records.map((r) => ({ id: r.id, priced_date: r.pricedDate, sector: r.sector, raise_usd: r.raiseUsd, data: r }))),
  sectorMonthly: (db: SupabaseClient, rows: SectorMonthRow[]) =>
    upsert(
      db,
      "sector_monthly",
      rows.map((r) => ({
        sector: r.sector,
        month: firstOfMonth(r.month),
        etf_ticker: r.etfTicker,
        // Never published, whatever a local file holds: they came from Yahoo Finance (ingest/markets.ts).
        etf_close: null,
        etf_return_pct: null,
        deal_count: r.dealCount,
        deal_value_kind: r.dealValueKind,
        deal_value_usd: r.dealValueUsd,
        deal_value_n: r.dealValueN,
        deal_value_null_n: r.dealValueNullN,
        deal_value_other_kind_n: r.dealValueOtherKindN,
        ipo_count: r.ipoCount,
        cpi_base_month: firstOfMonth(r.cpiBaseMonth),
      })),
      "sector,month",
    ),
  macroMonthly: (db: SupabaseClient, rows: MacroMonthRow[]) =>
    upsert(
      db,
      "macro_monthly",
      rows.map((r) => ({
        month: firstOfMonth(r.month),
        fed_funds_pct: r.fedFundsPct,
        treasury_10y_pct: r.treasury10yPct,
        // Never published, whatever a local file holds: ICE's licence (ingest/markets.ts).
        hy_spread_pct: null,
        baa_spread_pct: r.baaSpreadPct,
        vix: r.vix,
        cpi: r.cpi,
      })),
    ),
  /** `markets` goes through publicMarkets here, so no caller can publish a local file's old share prices. */
  snapshots: (db: SupabaseClient, snaps: Snapshot[], markets: Markets | null = null) =>
    upsert(
      db,
      "snapshots",
      [...snaps, ...(markets ? [{ kind: "markets", period: "latest", takenAt: markets.fetchedAt, data: publicMarkets(markets) }] : [])].map((s) => ({ kind: s.kind, period: s.period, taken_at: s.takenAt, data: s.data })),
      "kind,period",
    ),
};

/** What the monthly job needs from Supabase when it has no local files (GitHub Actions). */
export async function loadFromSupabase(db: SupabaseClient) {
  const [historyDeals, ipoRows, liveDeals, liveIpos, markets] = await Promise.all([
    selectAll<{ data: StoredDeal }>(db, "deals_history", "data"),
    selectAll<{ data: IpoHistoryState["records"][number] }>(db, "ipo_history", "data"),
    selectAll<{ data: StoredDeal }>(db, "deals", "data"),
    selectAll<{ data: unknown }>(db, "ipos", "data"),
    // Retried too: taking a failed read for "no snapshot yet" would lose the previous values a failed FRED series keeps.
    reliably("snapshots", "select", () => db.from("snapshots").select("data").eq("kind", "markets").eq("period", "latest").maybeSingle()),
  ]);
  return {
    historyDeals: historyDeals.map((r) => r.data),
    ipos: { records: ipoRows.map((r) => r.data), checked: [] } as IpoHistoryState,
    liveDeals: liveDeals.map((r) => r.data),
    liveIpos: liveIpos.map((r) => r.data),
    markets: (markets?.data as Markets | undefined) ?? null,
  };
}
