/**
 * Keeps a signed-in user's workspace in their account (Supabase `workspaces`, supabase/migrations/0003_accounts.sql).
 * The browser's copy stays the working copy, so everything is instant and works offline; this saves edits to the
 * account a moment after they happen and merges the account's copy back in on sign-in, when the tab comes back into
 * view and when the network returns (lib/workspace.ts does the merging).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSnapshot, onEdit, replacePrefs } from "@/components/workspace/store";
import { syncWorkspace, type WorkspaceStore } from "@/lib/workspace";

export type SyncState = "syncing" | "saved" | "offline" | "error";

const SAVE_DELAY_MS = 1200;
const REFRESH_AFTER_MS = 30_000;

function accountStore(db: SupabaseClient, userId: string): WorkspaceStore {
  return {
    async read() {
      const { data, error } = await db.from("workspaces").select("prefs, rev").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data as { prefs: unknown; rev: number } | null;
    },
    async create(prefs) {
      const { error } = await db.from("workspaces").insert({ user_id: userId, prefs });
      if (!error) return true;
      if (error.code === "23505") return false; // another device created it first
      throw error;
    },
    async update(prefs, rev) {
      // Only if nobody saved since we read it: the database bumps rev on every update.
      const { data, error } = await db.from("workspaces").update({ prefs }).eq("user_id", userId).eq("rev", rev).select("rev");
      if (error) throw error;
      return data?.length ? (data[0] as { rev: number }).rev : null;
    },
  };
}

export interface Sync {
  /** Saves any pending edit now (before signing out). */
  flush(): Promise<void>;
  stop(): void;
}

/** Starts syncing. `report` hears every state change. */
export function startSync(db: SupabaseClient, userId: string, report: (state: SyncState, at?: number) => void): Sync {
  const store = accountStore(db, userId);
  let current: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A round still in flight after a sign-out must not write the old workspace back into the browser.
  const local = { get: getSnapshot, set: (p: Parameters<typeof replacePrefs>[0]) => void (!stopped && replacePrefs(p)) };

  const round = async () => {
    lastRun = Date.now();
    report("syncing");
    try {
      await syncWorkspace(store, local);
      if (!stopped) report("saved", Date.now());
    } catch (err) {
      console.warn("Workspace sync:", err);
      if (!stopped) report(navigator.onLine ? "error" : "offline");
    }
  };
  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (current) {
      again = true;
      return current;
    }
    current = round().finally(() => {
      current = null;
      if (again && !stopped) {
        again = false;
        void run();
      }
    });
    return current;
  };

  let pending = false;
  const offEdit = onEdit(() => {
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = false;
      void run();
    }, SAVE_DELAY_MS);
  });
  const onVisible = () => {
    if (document.visibilityState === "visible" && Date.now() - lastRun > REFRESH_AFTER_MS) void run();
  };
  const onOnline = () => void run();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  void run();

  return {
    async flush() {
      clearTimeout(timer);
      if (pending) again = true;
      pending = false;
      // Wait out the round in flight, then run one more if an edit is still unsaved.
      while (current || again) {
        if (current) await current;
        else {
          again = false;
          await run();
        }
      }
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      offEdit();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    },
  };
}
