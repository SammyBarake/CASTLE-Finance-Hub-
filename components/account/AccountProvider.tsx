"use client";

import type { Provider, Session, SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PREFS, getSnapshot, replacePrefs } from "@/components/workspace/store";
import { AUTH_ENABLED, getClient, hasStoredSession, signInWith } from "./client";
import { startSync, type Sync, type SyncState } from "./sync";

export interface AccountUser {
  id: string;
  email: string | null;
  name: string | null;
  /** "google", "github", "linkedin_oidc", "azure". */
  provider: string | null;
}

/** off: accounts aren't set up on this site · signedOut · starting: a stored session is being restored · signedIn */
export type AccountStatus = "off" | "signedOut" | "starting" | "signedIn";

interface AccountValue {
  status: AccountStatus;
  user: AccountUser | null;
  sync: SyncState | null;
  syncedAt: number | null;
  signIn: (provider: Provider) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  exportData: () => void;
  /** The latest message for the user (the account button shows it as a toast: this provider sits above the toast layer). */
  notice: { id: number; text: string } | null;
}

const AccountContext = createContext<AccountValue | null>(null);

/** Set by /auth/callback, so the first page after signing in can say what just happened. */
export const JUST_SIGNED_IN = "castle-just-signed-in";

/** Signing out leaves nothing personal in this browser (the workspace is saved in the account first); display settings stay. */
function clearLocal() {
  const { density, motion } = getSnapshot();
  replacePrefs({ ...DEFAULT_PREFS, density, motion });
}

/** Reads and removes a one-time sessionStorage flag. */
function takeFlag(key: string): boolean {
  try {
    const set = sessionStorage.getItem(key) != null;
    sessionStorage.removeItem(key);
    return set;
  } catch {
    return false;
  }
}

function userOf(session: Session | null): AccountUser | null {
  const u = session?.user;
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    id: u.id,
    email: u.email ?? text(meta.email),
    name: text(meta.full_name) ?? text(meta.name) ?? text(meta.user_name),
    provider: text(u.app_metadata?.provider),
  };
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<AccountValue["notice"]>(null);
  const toast = useCallback((text: string) => setNotice((n) => ({ id: (n?.id ?? 0) + 1, text })), []);
  const [status, setStatus] = useState<AccountStatus>(AUTH_ENABLED ? "signedOut" : "off");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const dbRef = useRef<SupabaseClient | null>(null);
  const syncRef = useRef<Sync | null>(null);

  const apply = useCallback((session: Session | null) => {
    const next = userOf(session);
    setUser((prev) => (prev?.id === next?.id && prev?.email === next?.email && prev?.name === next?.name ? prev : next));
    setStatus(next ? "signedIn" : "signedOut");
  }, []);

  // A returning user's session is restored (and the library loaded) only if one is stored in this browser.
  const start = useCallback(async () => {
    if (dbRef.current) return dbRef.current;
    const db = await getClient();
    dbRef.current = db;
    db.auth.onAuthStateChange((_event, session) => apply(session));
    const { data } = await db.auth.getSession();
    apply(data.session);
    // "Signed in" once, on the page the sign-in came back to.
    if (data.session && takeFlag(JUST_SIGNED_IN)) {
      const email = userOf(data.session)?.email;
      toast(`Signed in${email ? ` as ${email}` : ""}. Your watchlist, notes and saved screens now sync to your account.`);
    }
    return db;
  }, [apply, toast]);

  useEffect(() => {
    if (!AUTH_ENABLED || !hasStoredSession()) return;
    setStatus("starting"); // eslint-disable-line react-hooks/set-state-in-effect -- the stored session is only visible in the browser
    start().catch(() => setStatus("signedOut"));
  }, [start]);

  // Sync while signed in.
  const userId = user?.id;
  useEffect(() => {
    const db = dbRef.current;
    if (!userId || !db) return;
    const s = startSync(db, userId, (state, at) => {
      setSync(state);
      if (at) setSyncedAt(at);
    });
    syncRef.current = s;
    return () => {
      s.stop();
      syncRef.current = null;
      setSync(null);
    };
  }, [userId]);

  const signIn = useCallback(
    async (provider: Provider) => {
      try {
        await signInWith(provider);
      } catch (err) {
        toast(`Couldn't start sign-in: ${(err as Error).message}`);
      }
    },
    [toast],
  );

  const signOut = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    await syncRef.current?.flush();
    syncRef.current?.stop();
    const { error } = await db.auth.signOut({ scope: "local" });
    if (error) return toast(`Couldn't sign out: ${error.message}`);
    clearLocal();
    toast("Signed out. Your watchlist, notes and saved screens are saved to your account.");
  }, [toast]);

  const deleteAccount = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    syncRef.current?.stop();
    const { error } = await db.rpc("delete_my_account");
    if (error) return toast(`Couldn't delete the account: ${error.message}`);
    await db.auth.signOut({ scope: "local" });
    clearLocal();
    toast("Account deleted, with everything saved in it.");
  }, [toast]);

  const exportData = useCallback(() => {
    const file = {
      exportedAt: new Date().toISOString(),
      account: user ? { email: user.email, name: user.name, signInWith: user.provider } : null,
      workspace: getSnapshot(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Castle_my_data_${file.exportedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [user]);

  const value = useMemo<AccountValue>(
    () => ({ status, user, sync, syncedAt, signIn, signOut, deleteAccount, exportData, notice }),
    [status, user, sync, syncedAt, signIn, signOut, deleteAccount, exportData, notice],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}
