"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPage } from "@/components/shell/StatusPage";
import { AUTH_ENABLED, getClient, safeNext } from "./client";
import { JUST_SIGNED_IN } from "./AccountProvider";

/**
 * Where the sign-in provider sends the browser back. supabase-js exchanges the one-time code in the address for a
 * session (PKCE: only this browser holds the matching secret), then the user returns to the page they started from.
 */
export function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = safeNext(params.get("next"));
    const fail = (message: string) => setError(message);
    const providerError = params.get("error_description") ?? params.get("error");
    if (providerError) return fail(providerError);
    if (!AUTH_ENABLED) return fail("Sign-in isn't set up on this site.");
    getClient()
      .then(async (db) => {
        // getSession waits for the client to finish exchanging the code from the address.
        const { data, error: sessionError } = await db.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session) throw new Error("The sign-in provider didn't return a session. Please try again.");
        try {
          sessionStorage.setItem(JUST_SIGNED_IN, "1");
        } catch {
          /* the toast is a nicety */
        }
        window.location.replace(next);
      })
      .catch((err: Error) => fail(err.message));
  }, []);

  if (!error)
    return (
      <StatusPage code="Sign in" title="Signing you in…" actions={null}>
        <p>Bringing your watchlist, notes and saved screens with you.</p>
      </StatusPage>
    );
  return (
    <StatusPage
      code="Sign in"
      title="Sign-in didn't finish"
      actions={
        <Link className="button primary" href="/hub">
          Back to Castle
        </Link>
      }
    >
      <p>{error}</p>
      <p>Nothing was saved. You can keep using Castle without an account, or try signing in again.</p>
    </StatusPage>
  );
}
