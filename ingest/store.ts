/**
 * Where ingested data lives.
 *
 * - JsonStore: .data/castle.json (git-ignored). Used for local runs and dry runs,
 *   and read by the site in development when Supabase isn't configured.
 * - SupabaseStore: the production store. Writes need SUPABASE_SERVICE_ROLE_KEY,
 *   which only GitHub Actions (and your .env.local) should have.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ActivistStake, Deal, Ipo, Macro } from "../lib/types";

export interface StoredDeal extends Deal {
  valueKind: "enterprise" | "equity" | "transaction" | null;
  /** EDGAR documents this deal was built from ("adsh:file"). */
  sources: string[];
  /** Last time the target's filing history was checked for status changes. */
  statusCheckedAt: string | null;
  /** Set once XBRL financials were looked up (whether or not they were found). */
  financialsCheckedAt: string | null;
  /** Set once the target's merger proxy / 14D-9 was read for premium and advisors. */
  proxyCheckedAt?: string | null;
  /** Proxy the fairness opinions were read from, and when the search finished (final proxy read or deal over). */
  fairnessAdsh?: string | null;
  fairnessCheckedAt?: string | null;
  /** FAIRNESS_PARSER_VERSION the opinions were read with; a newer parser triggers a re-read. */
  fairnessParser?: number;
  /** Deal protections read (8-K + proxy) on this date; null = look again on the next run. */
  termsCheckedAt?: string | null;
  /** TERMS_PARSER_VERSION the terms were read with. */
  termsParser?: number;
  /** Private targets: when EDGAR was searched for a listed registrant of that name (and the roles checked). */
  registrantCheckedAt?: string | null;
}

export interface StoredIpo extends Ipo {
  /** Most recent filing date in the IPO's history (S-1/A, 424B4, ...). */
  lastActivity: string;
  checkedAt: string | null;
  /** Latest registration statement parsed, to avoid re-downloading it. */
  parsedAdsh: string | null;
}

export interface State {
  deals: StoredDeal[];
  ipos: StoredIpo[];
  /** EDGAR documents already processed. */
  seen: Set<string>;
  asOf: string | null;
  /** World Economies (IMF + BIS); kept from the last successful fetch. */
  macro: Macro | null;
  /** Schedule 13D activist stakes, newest first; stored in `meta` like macro. */
  activists: ActivistStake[];
  /** Deals removed this run (junk records, duplicates merged into another deal): deleted from the store on save. */
  dropped?: Set<string>;
}

export interface Store {
  load(): Promise<State>;
  /** `prune`: also delete stored deals / seen documents missing from `state` (end of a full rebuild). */
  save(state: State, opts?: { prune?: boolean }): Promise<void>;
  readonly label: string;
}

export const LOCAL_DATA_PATH = ".data/castle.json";

export class JsonStore implements Store {
  readonly label = `local file ${LOCAL_DATA_PATH}`;
  constructor(private path = LOCAL_DATA_PATH) {}

  async load(): Promise<State> {
    if (!existsSync(this.path)) return { deals: [], ipos: [], seen: new Set(), asOf: null, macro: null, activists: [] };
    const raw = JSON.parse(readFileSync(this.path, "utf8"));
    return { deals: raw.deals ?? [], ipos: raw.ipos ?? [], seen: new Set(raw.seen ?? []), asOf: raw.asOf ?? null, macro: raw.macro ?? null, activists: raw.activists ?? [] };
  }

  async save(state: State) {
    mkdirSync(dirname(this.path), { recursive: true });
    const out = { asOf: state.asOf, macro: state.macro, activists: state.activists, deals: state.deals, ipos: state.ipos, seen: [...state.seen] };
    writeFileSync(this.path, JSON.stringify(out, null, 1));
  }
}

const PAGE = 1000;

/** Errors worth retrying: Supabase clock skew ("JWT issued at future"), timeouts, network blips, 5xx. */
const TRANSIENT = /issued at future|fetch failed|timeout|timed out|ECONNRESET|ETIMEDOUT|socket|gateway|503|502|504|upstream/i;

/** Run a Supabase call, retrying transient failures for up to ~3.5 minutes (10s, 20s, 40s, 60s, 80s). */
async function withRetry<T>(label: string, call: () => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const waits = [10, 20, 40, 60, 80];
  for (let attempt = 0; ; attempt++) {
    let message: string;
    try {
      const { data, error } = await call();
      if (!error) return data;
      message = error.message;
    } catch (err) {
      message = (err as Error).message;
    }
    if (attempt >= waits.length || !TRANSIENT.test(message)) throw new Error(`Supabase ${label}: ${message}`);
    console.log(`  Supabase ${label} failed (${message}); retrying in ${waits[attempt]}s`);
    await new Promise((r) => setTimeout(r, waits[attempt] * 1000));
  }
}

async function selectAll<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const data = await withRetry(`select ${table}`, () => db.from(table).select(columns).range(from, from + PAGE - 1));
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function upsertChunks(db: SupabaseClient, table: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await withRetry(`upsert ${table}`, () => db.from(table).upsert(rows.slice(i, i + 500)));
  }
}

export class SupabaseStore implements Store {
  readonly label = "Supabase";
  private db: SupabaseClient;
  private loadedSeen = new Set<string>();

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async load(): Promise<State> {
    const [deals, ipos, seen, meta] = await Promise.all([
      selectAll<{ data: StoredDeal }>(this.db, "deals", "data"),
      selectAll<{ data: StoredIpo }>(this.db, "ipos", "data"),
      selectAll<{ id: string }>(this.db, "seen_docs", "id"),
      withRetry("select meta", () => this.db.from("meta").select("key, value").in("key", ["asOf", "macro", "activists"])),
    ]);
    this.loadedSeen = new Set(seen.map((s) => s.id));
    const metaValue = (key: string) => meta?.find((m) => m.key === key)?.value;
    return {
      deals: deals.map((d) => d.data),
      ipos: ipos.map((i) => i.data),
      seen: new Set(this.loadedSeen),
      asOf: (metaValue("asOf") as string | undefined) ?? null,
      macro: (metaValue("macro") as Macro | undefined) ?? null,
      activists: (metaValue("activists") as ActivistStake[] | undefined) ?? [],
    };
  }

  async save(state: State, opts: { prune?: boolean } = {}) {
    await upsertChunks(
      this.db,
      "deals",
      state.deals.map((d) => ({ id: d.id, announced_date: d.announcedDate, status: d.status, data: d })),
    );
    const live = new Set(state.deals.map((d) => d.id));
    const dropped = [...(state.dropped ?? [])].filter((id) => !live.has(id));
    for (let i = 0; i < dropped.length; i += 200) {
      await withRetry("delete deals", () => this.db.from("deals").delete().in("id", dropped.slice(i, i + 200)));
    }
    state.dropped?.clear();
    // After a full rebuild (final save only), drop deals and seen documents the new run no longer has.
    if (opts.prune) {
      const keepDeals = new Set(state.deals.map((d) => d.id));
      const staleDeals = (await selectAll<{ id: string }>(this.db, "deals", "id")).map((r) => r.id).filter((id) => !keepDeals.has(id));
      for (let i = 0; i < staleDeals.length; i += 200) {
        await withRetry("delete deals", () => this.db.from("deals").delete().in("id", staleDeals.slice(i, i + 200)));
      }
      const staleSeen = [...this.loadedSeen].filter((id) => !state.seen.has(id));
      for (let i = 0; i < staleSeen.length; i += 200) {
        await withRetry("delete seen_docs", () => this.db.from("seen_docs").delete().in("id", staleSeen.slice(i, i + 200)));
      }
      this.loadedSeen = new Set([...this.loadedSeen].filter((id) => state.seen.has(id)));
    }
    await upsertChunks(
      this.db,
      "ipos",
      state.ipos.map((i) => ({ id: i.id, filed_date: i.filedDate, stage: i.stage, data: i })),
    );
    // Remove IPOs that dropped out of the pipeline (withdrawn / stale).
    const keep = new Set(state.ipos.map((i) => i.id));
    const existing = await selectAll<{ id: string }>(this.db, "ipos", "id");
    const stale = existing.map((r) => r.id).filter((id) => !keep.has(id));
    for (let i = 0; i < stale.length; i += 200) {
      await withRetry("delete ipos", () => this.db.from("ipos").delete().in("id", stale.slice(i, i + 200)));
    }
    const newSeen = [...state.seen].filter((id) => !this.loadedSeen.has(id)).map((id) => ({ id }));
    await upsertChunks(this.db, "seen_docs", newSeen);
    const metaRows = [
      { key: "asOf", value: state.asOf },
      ...(state.macro ? [{ key: "macro", value: state.macro }] : []),
      ...(state.activists.length ? [{ key: "activists", value: state.activists }] : []),
    ];
    await withRetry("upsert meta", () => this.db.from("meta").upsert(metaRows));
  }
}

export function storeFromEnv(opts: { local?: boolean } = {}): Store {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!opts.local && url && key) return new SupabaseStore(url, key);
  return new JsonStore();
}
