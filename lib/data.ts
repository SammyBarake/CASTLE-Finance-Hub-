import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { bankShortName } from "./banks";
import { buildHubData } from "./aggregate";
import { sampleHubData } from "./sampleData";
import type { Deal, HubData, Ipo } from "./types";

/**
 * The single entry point the UI uses to get data. Sources, in order:
 *
 * 1. Supabase, when NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set
 *    (production; read-only via row-level security).
 * 2. .data/castle.json, written by `npm run ingest -- --local` (local development).
 * 3. lib/sampleData.ts (fresh clone, nothing ingested yet).
 */
export async function getHubData(): Promise<HubData> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anonKey) {
    try {
      return await fromSupabase(url, anonKey);
    } catch (err) {
      console.error("Castle: Supabase read failed, falling back", err);
    }
  }
  const local = fromLocalFile();
  if (local) return local;
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
    db.from("meta").select("value").eq("key", "asOf").maybeSingle(),
  ]);
  if (!deals.length && !ipos.length) throw new Error("Supabase is empty; run the ingest first");
  return buildHubData({ deals, ipos, asOf: (meta.data?.value as string) ?? new Date().toISOString(), shortName: bankShortName });
}

function fromLocalFile(): HubData | null {
  const path = ".data/castle.json";
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as { deals: Deal[]; ipos: Ipo[]; asOf: string | null };
  if (!raw.deals?.length && !raw.ipos?.length) return null;
  return buildHubData({ deals: raw.deals, ipos: raw.ipos, asOf: raw.asOf ?? new Date().toISOString(), shortName: bankShortName });
}
