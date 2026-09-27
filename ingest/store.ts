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
import type { Deal, Ipo, Macro } from "../lib/types";

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
    if (!existsSync(this.path)) return { deals: [], ipos: [], seen: new Set(), asOf: null, macro: null };
    const raw = JSON.parse(readFileSync(this.path, "utf8"));
    return { deals: raw.deals ?? [], ipos: raw.ipos ?? [], seen: new Set(raw.seen ?? []), asOf: raw.asOf ?? null, macro: raw.macro ?? null };
  }

  async save(state: State) {
    mkdirSync(dirname(this.path), { recursive: true });
    const out = { asOf: state.asOf, macro: state.macro, deals: state.deals, ipos: state.ipos, seen: [...state.seen] };
    writeFileSync(this.path, JSON.stringify(out, null, 1));
  }
}

const PAGE = 1000;

async function selectAll<T>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase select ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function upsertChunks(db: SupabaseClient, table: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500));
    if (error) throw new Error(`Supabase upsert ${table}: ${error.message}`);
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
      this.db.from("meta").select("key, value").in("key", ["asOf", "macro"]),
    ]);
    this.loadedSeen = new Set(seen.map((s) => s.id));
    const metaValue = (key: string) => meta.data?.find((m) => m.key === key)?.value;
    return {
      deals: deals.map((d) => d.data),
      ipos: ipos.map((i) => i.data),
      seen: new Set(this.loadedSeen),
      asOf: (metaValue("asOf") as string | undefined) ?? null,
      macro: (metaValue("macro") as Macro | undefined) ?? null,
    };
  }

  async save(state: State, opts: { prune?: boolean } = {}) {
    await upsertChunks(
      this.db,
      "deals",
      state.deals.map((d) => ({ id: d.id, announced_date: d.announcedDate, status: d.status, data: d })),
    );
    // After a full rebuild (final save only), drop deals and seen documents the new run no longer has.
    if (opts.prune) {
      const keepDeals = new Set(state.deals.map((d) => d.id));
      const staleDeals = (await selectAll<{ id: string }>(this.db, "deals", "id")).map((r) => r.id).filter((id) => !keepDeals.has(id));
      for (let i = 0; i < staleDeals.length; i += 200) {
        const { error } = await this.db.from("deals").delete().in("id", staleDeals.slice(i, i + 200));
        if (error) throw new Error(`Supabase delete deals: ${error.message}`);
      }
      const staleSeen = [...this.loadedSeen].filter((id) => !state.seen.has(id));
      for (let i = 0; i < staleSeen.length; i += 200) {
        const { error } = await this.db.from("seen_docs").delete().in("id", staleSeen.slice(i, i + 200));
        if (error) throw new Error(`Supabase delete seen_docs: ${error.message}`);
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
      const { error } = await this.db.from("ipos").delete().in("id", stale.slice(i, i + 200));
      if (error) throw new Error(`Supabase delete ipos: ${error.message}`);
    }
    const newSeen = [...state.seen].filter((id) => !this.loadedSeen.has(id)).map((id) => ({ id }));
    await upsertChunks(this.db, "seen_docs", newSeen);
    const metaRows = [{ key: "asOf", value: state.asOf }, ...(state.macro ? [{ key: "macro", value: state.macro }] : [])];
    const { error } = await this.db.from("meta").upsert(metaRows);
    if (error) throw new Error(`Supabase upsert meta: ${error.message}`);
  }
}

export function storeFromEnv(opts: { local?: boolean } = {}): Store {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!opts.local && url && key) return new SupabaseStore(url, key);
  return new JsonStore();
}
