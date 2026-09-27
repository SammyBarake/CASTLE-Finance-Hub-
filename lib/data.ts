import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { bankShortName } from "./banks";
import { buildHubData, toPublicDeal } from "./aggregate";
import { sampleHubData } from "./sampleData";
import type { ActivistStake, Deal, HubData, Ipo, Macro } from "./types";

/**
 * The single entry point the UI uses to get data. Sources, in order:
 *
 * 1. Supabase, when NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set
 *    (production; read-only via row-level security).
 * 2. .data/castle.json, written by `npm run ingest -- --local` (local development).
 * 3. lib/sampleData.ts (fresh clone, nothing ingested yet).
 */
/** Memoized per request, so the layout and page metadata share one read. */
export const getHubData = cache(loadHubData);

// Pasted dashboard values often carry stray spaces, newlines or quotes; any of them breaks the request.
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "").trim() || undefined;
// `process.env.NEXT_PUBLIC_X` is frozen into the bundle at build time; a dynamic lookup reads the server's
// environment when the page is (re)generated, so keys added after a build still take effect on the next refresh.
const env = (name: string) => clean((process.env as Record<string, string | undefined>)[name]);

function sourceConfig() {
  return {
    url: (clean(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? env("NEXT_PUBLIC_SUPABASE_URL") ?? env("SUPABASE_URL"))?.replace(/\/+$/, ""),
    anonKey: clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? env("SUPABASE_ANON_KEY"),
    // CASTLE_DATA_SOURCE=local forces the local file (development with Supabase keys present).
    forceLocal: process.env.CASTLE_DATA_SOURCE === "local",
  };
}

/** One deal with its full detail (fairness opinions), for the drawer. Same sources as getHubData. */
export async function getDeal(id: string): Promise<Deal | null> {
  const { url, anonKey, forceLocal } = sourceConfig();
  if (url && anonKey && !forceLocal) {
    const db = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await db.from("deals").select("data").eq("id", id).maybeSingle();
    if (!error && data) return toPublicDeal(data.data as Deal, { withFairness: true });
  }
  if (existsSync(".data/castle.json")) {
    const raw = JSON.parse(readFileSync(".data/castle.json", "utf8")) as { deals: Deal[] };
    const d = raw.deals?.find((x) => x.id === id);
    if (d) return toPublicDeal(d, { withFairness: true });
  }
  return sampleHubData.deals.find((d) => d.id === id) ?? null;
}

async function loadHubData(): Promise<HubData> {
  const { url, anonKey, forceLocal } = sourceConfig();
  let dataError: string | undefined;
  if (url && anonKey && !forceLocal) {
    try {
      return await fromSupabase(url, anonKey);
    } catch (err) {
      console.error("Castle: Supabase read failed", err);
      dataError = `the database read failed (${(err as Error).message})`;
    }
  } else if (!forceLocal && process.env.VERCEL) {
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter(Boolean).join(", ");
    console.error(`Castle: ${missing} not set for this deployment`);
    dataError = `${missing} not set for this deployment (Vercel environment: ${env("VERCEL_ENV") ?? "unknown"})`;
  }
  const local = fromLocalFile();
  if (local) return local;
  // The deployed site never shows fictional numbers: without live data it says so and stays empty.
  // Sample data is only for local development before anything has been ingested.
  if (process.env.VERCEL) {
    return { ...buildHubData({ deals: [], ipos: [], asOf: new Date().toISOString(), macro: null, activists: [], shortName: bankShortName }), dataError: dataError ?? "no data source is configured" };
  }
  return sampleHubData;
}

const PAGE = 1000;

async function fromSupabase(url: string, anonKey: string): Promise<HubData> {
  const db = createClient(url, anonKey, { auth: { persistSession: false } });
  const readAll = async <T,>(table: string, order: string): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select("data").order(order, { ascending: false }).range(from, from + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data ?? []).map((r) => r.data as T));
      if (!data || data.length < PAGE) return out;
    }
  };
  const [deals, ipos, meta] = await Promise.all([
    readAll<Deal>("deals", "announced_date"),
    readAll<Ipo>("ipos", "filed_date"),
    db.from("meta").select("key, value").in("key", ["asOf", "macro", "activists"]),
  ]);
  if (!deals.length && !ipos.length) throw new Error("Supabase is empty; run the ingest first");
  const metaValue = (key: string) => meta.data?.find((m) => m.key === key)?.value;
  return buildHubData({
    deals,
    ipos,
    asOf: (metaValue("asOf") as string) ?? new Date().toISOString(),
    macro: (metaValue("macro") as Macro | undefined) ?? null,
    activists: (metaValue("activists") as ActivistStake[] | undefined) ?? [],
    shortName: bankShortName,
  });
}

function fromLocalFile(): HubData | null {
  const path = ".data/castle.json";
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as { deals: Deal[]; ipos: Ipo[]; asOf: string | null; macro?: Macro | null; activists?: ActivistStake[] };
  if (!raw.deals?.length && !raw.ipos?.length) return null;
  return buildHubData({ deals: raw.deals, ipos: raw.ipos, asOf: raw.asOf ?? new Date().toISOString(), macro: raw.macro ?? null, activists: raw.activists ?? [], shortName: bankShortName });
}
