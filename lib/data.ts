import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
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

/** When the database was last refreshed by the ingest (one tiny read), or null when Supabase isn't the source. */
export async function latestAsOf(): Promise<string | null> {
  const { url, anonKey, forceLocal } = sourceConfig();
  if (!url || !anonKey || forceLocal) return null;
  const db = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await db.from("meta").select("value").eq("key", "asOf").maybeSingle();
  return !error && typeof data?.value === "string" ? data.value : null;
}

async function loadHubData(): Promise<HubData> {
  const { url, anonKey, forceLocal } = sourceConfig();
  let dataError: string | undefined;
  if (url && anonKey && !forceLocal) {
    try {
      return await fromSupabase();
    } catch (err) {
      console.error("Castle: Supabase read failed", err);
      // On the live site a failed background refresh must not replace a good cached page with an empty one:
      // throwing makes Next keep serving the last good version. (At build time there is none, so fall through.)
      if (process.env.VERCEL && process.env.NEXT_PHASE !== "phase-production-build") throw err;
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

/*
 * Shared data cache. Every page used to read all ~2,000 deals from Supabase itself (about 8 seconds each), so
 * eleven pages regenerating together took up to a minute. Now one read is cached and shared by every page:
 *  - meta (asOf, macro, activists): re-checked every 5 minutes;
 *  - deals and IPOs: cached per `asOf`, so all chunks come from the same ingest snapshot and a new ingest
 *    simply starts new cache entries. Deals are cached in chunks of 500 (Next's data cache stores at most
 *    2 MB per entry).
 */
const CHUNK = 500;
/** The deal fields the site uses; ingest bookkeeping (checked-at dates, source lists) stays in the database. */
const DEAL_FIELDS = [
  "id", "announcedDate", "acquirer", "target", "valueUsd", "pricePerShare", "premiumPct", "consideration", "sector", "industry", "status", "statusDate",
  "enterpriseValueUsd", "evEbitda", "evRevenue", "acquirerAdvisors", "targetAdvisors", "filings", "milestones", "privateTarget", "terms", "fairness",
];
const DEAL_SELECT = DEAL_FIELDS.map((f) => `${f}:data->${f}`).join(",");

function supabase() {
  const { url, anonKey } = sourceConfig();
  return createClient(url!, anonKey!, { auth: { persistSession: false } });
}

/** Retry transient failures (many pages prerendering at once can drop a connection): 3 tries, 1s then 3s apart. */
async function withRetry<T>(read: () => PromiseLike<{ data: T; error: { message: string } | null }>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let message: string;
    try {
      const { data, error } = await read();
      if (!error) return data;
      message = error.message;
    } catch (err) {
      message = (err as Error).message;
    }
    if (attempt >= 2) throw new Error(`${label}: ${message}`);
    await new Promise((r) => setTimeout(r, attempt ? 3000 : 1000));
  }
}

const cachedMeta = unstable_cache(
  async () => {
    const data = await withRetry(() => supabase().from("meta").select("key, value").in("key", ["asOf", "macro", "activists"]), "meta");
    return data ?? [];
  },
  ["castle-meta-v1"],
  { revalidate: 300, tags: ["hub"] },
);

const cachedDealChunk = unstable_cache(
  async (_asOf: string, from: number) => {
    const data = await withRetry(() => supabase().from("deals").select(DEAL_SELECT).order("announced_date", { ascending: false }).range(from, from + CHUNK - 1), "deals");
    // Fields a record doesn't have come back as null; drop them so records keep their usual shape.
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null)) as unknown as Deal);
  },
  ["castle-deals-v1"],
  { revalidate: 86_400, tags: ["hub"] },
);

const cachedIpos = unstable_cache(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `asOf` is only part of the cache key
  async (_asOf: string) => {
    const data = await withRetry(() => supabase().from("ipos").select("data").order("filed_date", { ascending: false }), "ipos");
    return (data ?? []).map((r) => r.data as Ipo);
  },
  ["castle-ipos-v1"],
  { revalidate: 86_400, tags: ["hub"] },
);

async function fromSupabase(): Promise<HubData> {
  const meta = await cachedMeta();
  const metaValue = (key: string) => meta.find((m) => m.key === key)?.value;
  const asOf = (metaValue("asOf") as string | undefined) ?? "unknown";
  const deals: Deal[] = [];
  const seen = new Set<string>();
  // Four chunks at a time: a cold read takes one round of queries instead of five in a row.
  for (let from = 0; ; from += CHUNK * 4) {
    const batch = await Promise.all([0, 1, 2, 3].map((i) => cachedDealChunk(asOf, from + i * CHUNK)));
    for (const chunk of batch) for (const d of chunk) if (!seen.has(d.id) && seen.add(d.id)) deals.push(d);
    if (batch.some((c) => c.length < CHUNK)) break;
  }
  const ipos = await cachedIpos(asOf);
  if (!deals.length && !ipos.length) throw new Error("Supabase is empty; run the ingest first");
  return buildHubData({
    deals,
    ipos,
    asOf: asOf === "unknown" ? new Date().toISOString() : asOf,
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
