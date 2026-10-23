/**
 * Personal workspace preferences, kept in this browser's localStorage. Signed out, nothing here leaves the browser;
 * signed in, components/account/sync.ts keeps a copy in the account and merges the two (lib/workspace.ts).
 * If storage is blocked (private mode), changes last for the session.
 *
 * Implemented as a tiny external store for useSyncExternalStore: the server (and the first
 * hydration pass) sees the defaults, then the client switches to the saved values.
 */
import { DEFAULT_PREFS, sanitize, stampChanges, type Prefs } from "@/lib/workspace";

export type { Prefs, SavedView } from "@/lib/workspace";
export { DEFAULT_PREFS };

const KEY = "castle-workspace-v1";

let state: Prefs = DEFAULT_PREFS;
let loaded = false;
let storageOk = true;
const listeners = new Set<() => void>();
/** Told about edits made in this tab (not merges or other tabs' changes), so the account sync can save them. */
const editListeners = new Set<() => void>();

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

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch {
    storageOk = false;
  }
  listeners.forEach((l) => l());
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

/** An edit: whatever changed is stamped with the time, so a merge with the account's copy keeps it. */
export function updatePrefs(fn: (p: Prefs) => Prefs) {
  load();
  const prev = state;
  const next = fn(prev);
  if (next === prev) return;
  state = { ...next, stamps: stampChanges(prev, next, Date.now()) };
  persist();
  editListeners.forEach((l) => l());
}

/** Replaces the whole workspace without counting it as an edit: a merged copy from the account, or a sign-out. */
export function replacePrefs(next: Prefs) {
  load();
  state = next;
  persist();
}

export function onEdit(listener: () => void) {
  editListeners.add(listener);
  return () => void editListeners.delete(listener);
}
