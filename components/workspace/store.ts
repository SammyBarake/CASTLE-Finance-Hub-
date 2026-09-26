/**
 * Personal workspace preferences, kept in this browser's localStorage.
 * Nothing here is sent anywhere. If storage is blocked (private mode), changes last for the session.
 *
 * Implemented as a tiny external store for useSyncExternalStore: the server (and the first
 * hydration pass) sees the defaults, then the client switches to the saved values.
 */
import { DEAL_COLUMNS, DEFAULT_COLUMNS, DEFAULT_SCREEN, type DealColumn, type DealScreen } from "@/lib/screen";

export interface SavedView {
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
}

export const DEFAULT_PREFS: Prefs = { watch: [], views: [], notes: {}, density: "comfortable", motion: true, columns: DEFAULT_COLUMNS };

const KEY = "castle-workspace-v1";
const COLUMN_KEYS = new Set(DEAL_COLUMNS.map((c) => c.key));

let state: Prefs = DEFAULT_PREFS;
let loaded = false;
let storageOk = true;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Prefs>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
  return {
    watch: strings(r.watch),
    views: Array.isArray(r.views)
      ? r.views
          .filter((v): v is SavedView => !!v && typeof v.name === "string" && !!v.screen)
          .map((v) => ({ name: v.name.slice(0, 35), screen: { ...DEFAULT_SCREEN, ...v.screen } }))
      : [],
    notes: r.notes && typeof r.notes === "object" ? Object.fromEntries(Object.entries(r.notes).filter(([, v]) => typeof v === "string")) : {},
    density: r.density === "compact" ? "compact" : "comfortable",
    motion: r.motion !== false,
    columns: (() => {
      const cols = strings(r.columns).filter((c): c is DealColumn => COLUMN_KEYS.has(c as DealColumn));
      return cols.length ? cols : DEFAULT_COLUMNS;
    })(),
  };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) state = sanitize(JSON.parse(raw));
  } catch {
    storageOk = false;
  }
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keep several open tabs in sync.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    try {
      state = sanitize(JSON.parse(e.newValue ?? "{}"));
      listener();
    } catch {
      /* ignore malformed */
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const getSnapshot = () => {
  load();
  return state;
};
export const getServerSnapshot = () => DEFAULT_PREFS;
export const isStorageOk = () => storageOk;

export function updatePrefs(fn: (p: Prefs) => Prefs) {
  load();
  state = fn(state);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch {
    storageOk = false;
  }
  listeners.forEach((l) => l());
}
