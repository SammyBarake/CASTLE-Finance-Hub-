import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFromSupabase, push } from "./historyStore";
import type { Markets } from "./markets";
import type { MacroMonthRow, SectorMonthRow } from "../lib/history";

/** A stand-in for the Supabase client: answers reads from `tables`, records writes, and fails the first `fails` calls. */
function fakeDb(tables: Record<string, object[]>, fails = 0, message = "JWT issued at future") {
  const written: Record<string, object[]> = {};
  let calls = 0;
  const answer = <T,>(data: T) => {
    calls++;
    return Promise.resolve(calls <= fails ? { data: null, error: { message } } : { data, error: null });
  };
  const db = {
    from: (table: string) => ({
      select: () => {
        const query = {
          eq: () => query,
          range: (from: number, to: number) => answer((tables[table] ?? []).slice(from, to + 1)),
          maybeSingle: () => answer(tables[table]?.[0] ?? null),
        };
        return query;
      },
      upsert: (rows: object[]) => {
        (written[table] ??= []).push(...rows);
        return answer(null);
      },
    }),
  };
  return { db: db as unknown as SupabaseClient, written, calls: () => calls };
}

const TABLES = {
  deals_history: [{ data: { id: "h" } }],
  ipo_history: [{ data: { id: "i" } }],
  deals: [{ data: { id: "d" } }],
  ipos: [{ data: { id: "p" } }],
  snapshots: [{ data: { fetchedAt: "2026-10-13", etf: {}, fred: {} } }],
};

describe("the monthly job's reads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("wait out a transient error on the first requests instead of dying (its first two runs on GitHub)", async () => {
    const { db } = fakeDb(TABLES, 3);
    const load = loadFromSupabase(db);
    await vi.runAllTimersAsync();
    const data = await load;
    expect(data.historyDeals).toEqual([{ id: "h" }]);
    expect(data.ipos.records).toEqual([{ id: "i" }]);
    expect(data.liveDeals).toEqual([{ id: "d" }]);
    expect(data.liveIpos).toEqual([{ id: "p" }]);
    expect(data.markets).toEqual({ fetchedAt: "2026-10-13", etf: {}, fred: {} });
  });

  it("don't take a failed snapshot read for no snapshot", async () => {
    // All five first requests fail, the markets snapshot's among them.
    const { db } = fakeDb(TABLES, 5);
    const load = loadFromSupabase(db);
    await vi.runAllTimersAsync();
    expect((await load).markets).not.toBeNull();
  });

  it("say which migration is missing, and don't wait for an error that won't pass", async () => {
    const { db, calls } = fakeDb(TABLES, 99, `relation "public.deals_history" does not exist`);
    await expect(loadFromSupabase(db)).rejects.toThrow(/0002_history\.sql/);
    expect(calls()).toBe(5); // no retries
  });
});

describe("what the history tables publish", () => {
  const sector = {
    sector: "Tech",
    month: "2026-09",
    etfTicker: "XLK",
    etfClose: 195.75,
    etfReturnPct: 2.5,
    dealCount: 3,
    dealValueKind: "transaction",
    dealValueUsd: 1e9,
    dealValueN: 1,
    dealValueNullN: 1,
    dealValueOtherKindN: 1,
    ipoCount: 2,
    cpiBaseMonth: "2026-08",
  } as SectorMonthRow;

  it("never carries a share price, even from a local file that has one, and keeps everything else", async () => {
    const { db, written } = fakeDb({});
    await push.sectorMonthly(db, [sector]);
    expect(written.sector_monthly).toEqual([
      {
        sector: "Tech",
        month: "2026-09-01",
        etf_ticker: "XLK",
        etf_close: null,
        etf_return_pct: null,
        deal_count: 3,
        deal_value_kind: "transaction",
        deal_value_usd: 1e9,
        deal_value_n: 1,
        deal_value_null_n: 1,
        deal_value_other_kind_n: 1,
        ipo_count: 2,
        cpi_base_month: "2026-08-01",
      },
    ]);
  });

  it("never carries a local file's share-price series in the markets snapshot, and keeps the FRED series", async () => {
    const { db, written } = fakeDb({});
    const month = { month: "2026-09", close: 195.75, adjClose: 195.75 };
    const local = { fetchedAt: "2026-11-02", etf: { Tech: [month] }, index: { biotech: [month] }, fred: { baaSpread: { "2026-09": 1.7 }, hySpread: { "2026-09": 3.1 } } } as unknown as Markets;
    await push.snapshots(db, [{ kind: "league_table", period: "2026-10", takenAt: "2026-11-02", data: { rows: [] } }], local);
    expect(written.snapshots).toEqual([
      { kind: "league_table", period: "2026-10", taken_at: "2026-11-02", data: { rows: [] } },
      { kind: "markets", period: "latest", taken_at: "2026-11-02", data: { fetchedAt: "2026-11-02", etf: {}, index: {}, fred: { baaSpread: { "2026-09": 1.7 } } } },
    ]);
  });

  it("never carries the ICE high-yield spread, and keeps the FRED series", async () => {
    const { db, written } = fakeDb({});
    const row: MacroMonthRow = { month: "2026-09", fedFundsPct: 4, treasury10yPct: 4.2, hySpreadPct: 3.1, baaSpreadPct: 1.7, vix: 16, cpi: 325 };
    await push.macroMonthly(db, [row]);
    expect(written.macro_monthly).toEqual([{ month: "2026-09-01", fed_funds_pct: 4, treasury_10y_pct: 4.2, hy_spread_pct: null, baa_spread_pct: 1.7, vix: 16, cpi: 325 }]);
  });
});
