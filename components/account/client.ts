/**
 * Optional accounts: the Supabase Auth client, loaded only when someone signs in or comes back signed in, so visitors
 * who never do download none of it. Everything stays in the browser (the session in localStorage, no cookies), so
 * the server never reads who is signed in and every page stays a cached static page.
 *
 * Which sign-in buttons show is set by NEXT_PUBLIC_AUTH_PROVIDERS ("google,github", later "linkedin,microsoft"),
 * once each provider is turned on in Supabase (SETUP.md). Without it there is no sign-in button at all.
 */
import type { Provider, SupabaseClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const ALL_PROVIDERS: { id: Provider; label: string; aliases: string[] }[] = [
  { id: "google", label: "Google", aliases: ["google"] },
  { id: "linkedin_oidc", label: "LinkedIn", aliases: ["linkedin", "linkedin_oidc"] },
  { id: "azure", label: "Microsoft", aliases: ["microsoft", "azure"] },
  { id: "github", label: "GitHub", aliases: ["github"] },
];

const wanted = new Set(
  (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
export const AUTH_PROVIDERS = ALL_PROVIDERS.filter((p) => p.aliases.some((a) => wanted.has(a))).map(({ id, label }) => ({ id, label }));
export const AUTH_ENABLED = !!URL_ && !!KEY && AUTH_PROVIDERS.length > 0;

/** supabase-js's own storage key for the session, so a returning user is noticed without loading the library. */
function sessionKey(): string {
  try {
    return `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;
  } catch {
    return "";
  }
}

export function hasStoredSession(): boolean {
  try {
    const key = sessionKey();
    return !!key && window.localStorage.getItem(key) != null;
  } catch {
    return false;
  }
}

let client: Promise<SupabaseClient> | null = null;

export function getClient(): Promise<SupabaseClient> {
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(URL_, KEY, {
      // PKCE: the provider sends back a one-time code that only this browser can exchange (/auth/callback).
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }),
  );
  return client;
}

/** Only a path on this site may follow sign-in (never "//elsewhere" or a full URL: no open redirect). */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

/** Leaves for the provider's sign-in page; it comes back to /auth/callback, then to the page the user was on. */
export async function signInWith(provider: Provider) {
  const db = await getClient();
  const next = safeNext(window.location.pathname + window.location.search);
  const { error } = await db.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      // Microsoft gives the email address only when asked.
      ...(provider === "azure" ? { scopes: "email" } : {}),
    },
  });
  if (error) throw error;
}
