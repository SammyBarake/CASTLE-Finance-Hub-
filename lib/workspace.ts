/**
 * The personal workspace (watchlist, notes, saved screens, columns, display settings) and how two copies of it merge.
 *
 * The browser's localStorage holds the working copy (components/workspace/store.ts); a signed-in user's account holds
 * another (Supabase `workspaces`, components/account/sync.ts). Every item records when it last changed (`stamps`), so
 * merging two copies keeps the newer version of each item, deletions included: a note edited on a laptop and a deal
 * starred on a phone both survive, instead of the last save wiping out the other. Pure and tested.
 */
import { sanitizeBooks, type DealBook } from "./books";
import { DEAL_COLUMNS, DEFAULT_COLUMNS, DEFAULT_SCREEN, type DealColumn, type DealScreen } from "./screen";

export interface SavedView {
  id: string;
  name: string;
  screen: DealScreen;
}

export interface Prefs {
  /** Watched records: "deal:<id>" / "ipo:<id>". */
  watch: string[];
  views: SavedView[];
  /** Research notes by record key. */
  notes: Record<string, string>;
  density: "comfortable" | "compact";
  motion: boolean;
  columns: DealColumn[];
  /** Deal books (lib/books.ts). */
  books: DealBook[];
  /**
   * When each item last changed (ms since 1970): "w:<record>" (watched), "n:<record>" (note), "v:<view id>", "b:<book id>", "density",
   * "motion", "columns". A stamp whose item is gone records a deletion, so another copy can't bring the item back.
   */
  stamps: Record<string, number>;
}

export const DEFAULT_PREFS: Prefs = { watch: [], views: [], notes: {}, density: "comfortable", motion: true, columns: DEFAULT_COLUMNS, books: [], stamps: {} };

/** Keeps one person's copy small (the database caps a row at 256 KB too). */
export const LIMITS = { watch: 1000, views: 50, notes: 1000, noteLength: 5000, viewName: 35 };

/** Items saved before stamps existed count as changed at time 1: older than any edit, newer than an empty default. */
const LEGACY = 1;
/** Deletions are remembered for this long; a copy left offline for longer could bring a deleted item back. */
const TOMBSTONE_MS = 180 * 86_400_000;

const COLUMN_KEYS = new Set<string>(DEAL_COLUMNS.map((c) => c.key));
const SCALARS = ["density", "motion", "columns"] as const;

/** A stable id for a screen saved before screens had ids (FNV-1a of its name and filters). */
export function legacyViewId(name: string, screen: DealScreen): string {
  let h = 0x811c9dc5;
  for (const ch of `${name}\u0000${JSON.stringify(screen)}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `v${h.toString(36)}`;
}

export const newViewId = () => `v${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "").slice(0, 20)}`;

/** Any stored or downloaded copy, made safe to use: unknown fields dropped, sizes capped, defaults filled in. */
export function sanitize(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);

  const views: SavedView[] = [];
  const ids = new Set<string>();
  for (const v of Array.isArray(r.views) ? (r.views as Record<string, unknown>[]) : []) {
    if (!v || typeof v.name !== "string" || !v.screen || typeof v.screen !== "object") continue;
    const name = v.name.slice(0, LIMITS.viewName);
    const screen = { ...DEFAULT_SCREEN, ...(v.screen as Partial<DealScreen>) };
    const id = typeof v.id === "string" && /^v[a-z0-9]{1,40}$/i.test(v.id) ? v.id : legacyViewId(name, screen);
    if (ids.has(id)) continue;
    ids.add(id);
    views.push({ id, name, screen });
  }

  const notes: Record<string, string> = {};
  if (r.notes && typeof r.notes === "object")
    for (const [k, v] of Object.entries(r.notes as Record<string, unknown>).slice(0, LIMITS.notes)) if (typeof v === "string" && v) notes[k] = v.slice(0, LIMITS.noteLength);

  const stamps: Record<string, number> = {};
  if (r.stamps && typeof r.stamps === "object")
    for (const [k, v] of Object.entries(r.stamps as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v > 0 && k.length <= 400) stamps[k] = v;

  const columns = strings(r.columns).filter((c): c is DealColumn => COLUMN_KEYS.has(c));
  return {
    watch: [...new Set(strings(r.watch))].slice(0, LIMITS.watch),
    views: views.slice(0, LIMITS.views),
    notes,
    density: r.density === "compact" ? "compact" : "comfortable",
    motion: r.motion !== false,
    columns: columns.length ? columns : DEFAULT_COLUMNS,
    books: sanitizeBooks(r.books),
    stamps,
  };
}

const json = (v: unknown) => JSON.stringify(v);

/** Is the item a stamp key names still there? (Display settings always are.) */
function present(p: Prefs, key: string): boolean {
  if (key.startsWith("w:")) return p.watch.includes(key.slice(2));
  if (key.startsWith("n:")) return key.slice(2) in p.notes;
  if (key.startsWith("v:")) return p.views.some((v) => v.id === key.slice(2));
  if (key.startsWith("b:")) return p.books.some((b) => b.id === key.slice(2));
  return true;
}

/**
 * Forgets deletions made TOMBSTONE_MS before the workspace's latest change. Measured from the stamps themselves, not
 * this device's clock, so every device prunes the same copy the same way (a clock-based cut-off could keep two
 * devices handing an old deletion back and forth).
 */
function prune(stamps: Record<string, number>, p: Prefs): Record<string, number> {
  const latest = Math.max(0, ...Object.values(stamps));
  const out: Record<string, number> = {};
  for (const [k, t] of Object.entries(stamps)) if (t >= latest - TOMBSTONE_MS || present(p, k)) out[k] = t;
  return out;
}

/**
 * The stamps after an edit from `prev` to `next`: every item that appeared, disappeared or changed gets `now`
 * (always later than its previous stamp, even if the clock went back).
 */
export function stampChanges(prev: Prefs, next: Prefs, now: number): Record<string, number> {
  const stamps = { ...prev.stamps, ...next.stamps };
  const mark = (key: string) => (stamps[key] = Math.max(now, (stamps[key] ?? 0) + 1));

  const pw = new Set(prev.watch);
  const nw = new Set(next.watch);
  for (const k of new Set([...pw, ...nw])) if (pw.has(k) !== nw.has(k)) mark(`w:${k}`);
  for (const k of new Set([...Object.keys(prev.notes), ...Object.keys(next.notes)])) if (prev.notes[k] !== next.notes[k]) mark(`n:${k}`);
  const pv = new Map(prev.views.map((v) => [v.id, json(v)]));
  const nv = new Map(next.views.map((v) => [v.id, json(v)]));
  for (const id of new Set([...pv.keys(), ...nv.keys()])) if (pv.get(id) !== nv.get(id)) mark(`v:${id}`);
  const pb = new Map(prev.books.map((b) => [b.id, json(b)]));
  const nb = new Map(next.books.map((b) => [b.id, json(b)]));
  for (const id of new Set([...pb.keys(), ...nb.keys()])) if (pb.get(id) !== nb.get(id)) mark(`b:${id}`);
  for (const k of SCALARS) if (json(prev[k]) !== json(next[k])) mark(k);
  return prune(stamps, next);
}

/** Gives items saved before stamps existed the LEGACY stamp (display settings only when changed from the default). */
function withLegacyStamps(p: Prefs): Prefs {
  const stamps = { ...p.stamps };
  const legacy = (key: string) => (stamps[key] ??= LEGACY);
  p.watch.forEach((k) => legacy(`w:${k}`));
  Object.keys(p.notes).forEach((k) => legacy(`n:${k}`));
  p.views.forEach((v) => legacy(`v:${v.id}`));
  p.books.forEach((b) => legacy(`b:${b.id}`));
  for (const k of SCALARS) if (json(p[k]) !== json(DEFAULT_PREFS[k])) legacy(k);
  return { ...p, stamps };
}

/**
 * Merges two copies of a workspace item by item: the more recently changed side wins each watch, note, saved screen
 * and display setting, and a newer deletion beats an older copy. Equal stamps (two copies from before syncing) keep
 * an item either side has, and otherwise the larger value, so every device settles on the same result whichever way
 * round it merges. Order follows `a` (this device), with `b`'s new items after it.
 */
export function mergePrefs(a: Prefs, b: Prefs): Prefs {
  a = withLegacyStamps(a);
  b = withLegacyStamps(b);
  const stamps: Record<string, number> = { ...a.stamps };
  for (const [k, t] of Object.entries(b.stamps)) stamps[k] = Math.max(stamps[k] ?? 0, t);

  const winner = (key: string, value: (p: Prefs) => unknown): Prefs => {
    const sa = a.stamps[key] ?? 0;
    const sb = b.stamps[key] ?? 0;
    if (sa !== sb) return sa > sb ? a : b;
    const va = value(a);
    const vb = value(b);
    if (va === undefined) return b;
    if (vb === undefined) return a;
    return json(va) >= json(vb) ? a : b;
  };

  const watch = [...new Set([...a.watch, ...b.watch])].filter((k) => winner(`w:${k}`, (p) => (p.watch.includes(k) ? true : undefined)).watch.includes(k));

  const notes: Record<string, string> = {};
  for (const k of new Set([...Object.keys(a.notes), ...Object.keys(b.notes)])) {
    const text = winner(`n:${k}`, (p) => p.notes[k]).notes[k];
    if (text !== undefined) notes[k] = text;
  }

  const viewOf = (p: Prefs, id: string) => p.views.find((v) => v.id === id);
  const views: SavedView[] = [];
  for (const id of new Set([...a.views.map((v) => v.id), ...b.views.map((v) => v.id)])) {
    const view = viewOf(
      winner(`v:${id}`, (p) => viewOf(p, id)),
      id,
    );
    if (view) views.push(view);
  }

  // A book merges as one item: the side that changed it last wins it whole (title, thesis, deals and comments).
  const bookOf = (p: Prefs, id: string) => p.books.find((b) => b.id === id);
  const books: DealBook[] = [];
  for (const id of new Set([...a.books.map((x) => x.id), ...b.books.map((x) => x.id)])) {
    const book = bookOf(
      winner(`b:${id}`, (p) => bookOf(p, id)),
      id,
    );
    if (book) books.push(book);
  }

  const merged: Prefs = {
    watch,
    views,
    notes,
    density: winner("density", (p) => p.density).density,
    motion: winner("motion", (p) => p.motion).motion,
    columns: winner("columns", (p) => p.columns).columns,
    books,
    stamps: {},
  };
  merged.stamps = prune(stamps, merged);
  return merged;
}

/** The same workspace, whatever the order of its lists and keys (the order is each device's own). */
export function prefsEqual(a: Prefs, b: Prefs): boolean {
  const canon = (p: Prefs) =>
    json({
      watch: [...p.watch].sort(),
      views: [...p.views].sort((x, y) => x.id.localeCompare(y.id)),
      notes: Object.entries(p.notes).sort(([x], [y]) => x.localeCompare(y)),
      density: p.density,
      motion: p.motion,
      columns: p.columns,
      books: [...p.books].sort((x, y) => x.id.localeCompare(y.id)),
      stamps: Object.entries(p.stamps).sort(([x], [y]) => x.localeCompare(y)),
    });
  return canon(a) === canon(b);
}

/** The account's copy as the sync engine needs it: read, create and a conditional update. */
export interface WorkspaceStore {
  /** The stored copy and its revision, or null when the account has none yet. */
  read(): Promise<{ prefs: unknown; rev: number } | null>;
  /** Creates the account's copy; false if one already exists (another device got there first). */
  create(prefs: Prefs): Promise<boolean>;
  /** Saves only if the stored copy is still at `rev`; the new revision, or null if another device saved in between. */
  update(prefs: Prefs, rev: number): Promise<number | null>;
}

/**
 * One sync round between this browser and the account: read the account's copy, merge it into the browser's, and
 * save the result back if the account was missing anything. The merge and the local write happen together after
 * the read (no edit can slip in between); if another device saved in the meantime the round reads and merges again.
 */
export async function syncWorkspace(store: WorkspaceStore, local: { get: () => Prefs; set: (p: Prefs) => void }): Promise<"unchanged" | "saved"> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const remote = await store.read();
    if (!remote) {
      if (await store.create(local.get())) return "saved";
      continue;
    }
    const theirs = sanitize(remote.prefs);
    const mine = local.get();
    const merged = mergePrefs(mine, theirs);
    if (!prefsEqual(merged, mine)) local.set(merged);
    if (prefsEqual(merged, theirs)) return "unchanged";
    if ((await store.update(merged, remote.rev)) != null) return "saved";
  }
  throw new Error("Your workspace kept changing on another device. It will sync on the next change.");
}
