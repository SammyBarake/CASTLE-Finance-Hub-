import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { SectorMonthRow } from "./history";
import { ipoHistoryReady, sectorBaselines, type SectorBaseline } from "./ripple/baseline";
import type { Sector } from "./types";

/** What the what-if screen needs from the history tables: baselines for levels, and whether IPO history is in. */
export interface WhatIfData {
  /** Quarterly averages over the last four complete quarters, per sector; null before sector_monthly exists. */
  baselines: Record<Sector, SectorBaseline> | null;
  ipoHistoryReady: boolean;
  /** Latest month in sector_monthly. */
  throughMonth: string | null;
}

const LOCAL_SECTOR_MONTHLY = ".data/history/sector_monthly.json";

/** sector_monthly from Supabase (anon, read-only), else the local history file. Missing table → no rows. */
async function sectorMonthly(): Promise<SectorMonthRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key && process.env.CASTLE_DATA_SOURCE !== "local") {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const rows: SectorMonthRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("sector_monthly")
        .select("sector, month, etf_ticker, etf_close, etf_return_pct, deal_count, deal_value_kind, deal_value_usd, deal_value_n, deal_value_null_n, deal_value_other_kind_n, ipo_count, cpi_base_month")
        .range(from, from + 999);
      if (error) {
        // The history migration hasn't been run yet: fall back to the local file (none on Vercel).
        rows.length = 0;
        break;
      }
      rows.push(
        ...(data ?? []).map((r) => ({
          sector: r.sector as Sector,
          month: String(r.month).slice(0, 7),
          etfTicker: r.etf_ticker,
          etfClose: r.etf_close == null ? null : Number(r.etf_close),
          etfReturnPct: r.etf_return_pct == null ? null : Number(r.etf_return_pct),
          dealCount: r.deal_count,
          dealValueKind: r.deal_value_kind,
          dealValueUsd: Number(r.deal_value_usd),
          dealValueN: r.deal_value_n,
          dealValueNullN: r.deal_value_null_n,
          dealValueOtherKindN: r.deal_value_other_kind_n,
          ipoCount: r.ipo_count,
          cpiBaseMonth: String(r.cpi_base_month ?? "").slice(0, 7),
        })),
      );
      if (!data || data.length < 1000) break;
    }
    if (rows.length) return rows;
  }
  return existsSync(LOCAL_SECTOR_MONTHLY) ? (JSON.parse(readFileSync(LOCAL_SECTOR_MONTHLY, "utf8")) as SectorMonthRow[]) : [];
}

export async function getWhatIfData(): Promise<WhatIfData> {
  const rows = await sectorMonthly();
  if (!rows.length) return { baselines: null, ipoHistoryReady: false, throughMonth: null };
  return { baselines: sectorBaselines(rows), ipoHistoryReady: ipoHistoryReady(rows), throughMonth: rows.map((r) => r.month).sort().at(-1) ?? null };
}
