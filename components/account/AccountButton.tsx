"use client";

import type { Provider } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/components/ui/UiProvider";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { AUTH_PROVIDERS } from "./client";
import { useAccount, type AccountUser } from "./AccountProvider";
import type { SyncState } from "./sync";

const initials = (u: AccountUser) =>
  (u.name ?? u.email ?? "?")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const PROVIDER_NAMES: Record<string, string> = { google: "Google", github: "GitHub", linkedin_oidc: "LinkedIn", azure: "Microsoft" };

function syncLabel(state: SyncState | null, at: number | null): string {
  if (state === "syncing") return "Saving to your account…";
  if (state === "offline") return "Offline · changes save when you're back online";
  if (state === "error") return "Couldn't reach your account · it retries on your next change";
  if (!at) return "Saved to your account";
  const mins = Math.floor((Date.now() - at) / 60_000);
  return `Saved to your account · ${mins < 1 ? "just now" : `${mins} min ago`}`;
}

/** The top bar's account control: "Sign in" when signed out, the user's initials when signed in. Hidden if accounts are off. */
export function AccountButton() {
  const { status, user, notice } = useAccount();
  const { openDialog, toast } = useUi();

  useEffect(() => {
    if (notice) toast(notice.text);
  }, [notice, toast]);

  if (status === "off") return null;
  if (status !== "signedIn" || !user)
    return (
      <button
        type="button"
        className="account-signin"
        disabled={status === "starting"}
        onClick={() => openDialog({ eyebrow: "Optional account", title: "Save your work across devices", body: <SignInBody /> })}
      >
        {status === "starting" ? "Signing in…" : "Sign in"}
      </button>
    );
  return (
    <button
      type="button"
      className="account-avatar"
      aria-label={`Account: ${user.name ?? user.email ?? "signed in"}`}
      title={user.email ?? undefined}
      onClick={() => openDialog({ eyebrow: "Account", title: user.name ?? user.email ?? "Your account", body: <AccountBody /> })}
    >
      {initials(user)}
    </button>
  );
}

export function SignInBody() {
  const { signIn } = useAccount();
  const [leaving, setLeaving] = useState<Provider | null>(null);
  return (
    <div className="account-panel">
      <p className="account-lead">Optional. Every page on Castle works without an account.</p>
      <ul className="account-points">
        <li>
          <Icon name="star" />
          Your watchlist, notes, saved screens and display settings follow you to any device.
        </li>
        <li>
          <Icon name="shield" />
          Only you can read them. No cookies, no trackers, no emails.
        </li>
      </ul>
      <div className="account-providers">
        {AUTH_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="button account-provider"
            disabled={leaving != null}
            onClick={() => {
              setLeaving(p.id);
              void signIn(p.id).finally(() => setLeaving(null));
            }}
          >
            {leaving === p.id ? `Opening ${p.label}…` : `Continue with ${p.label}`}
          </button>
        ))}
      </div>
      <p className="account-fine">
        Castle receives your name and email address from {AUTH_PROVIDERS.length === 1 ? AUTH_PROVIDERS[0].label : "the provider"}, nothing else. Delete your account at any
        time. <Link href="/privacy">Privacy</Link>
      </p>
    </div>
  );
}

function AccountBody() {
  const { user, sync, syncedAt, signOut, deleteAccount, exportData } = useAccount();
  const { closeDialog } = useUi();
  const { prefs } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return <p>You&apos;re signed out.</p>;
  const counts = [
    `${prefs.watch.length} watched`,
    `${Object.keys(prefs.notes).length} ${Object.keys(prefs.notes).length === 1 ? "note" : "notes"}`,
    `${prefs.views.length} saved ${prefs.views.length === 1 ? "screen" : "screens"}`,
    `${prefs.books.length} deal ${prefs.books.length === 1 ? "book" : "books"}`,
  ].join(" · ");
  const act = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    await fn();
    setBusy(false);
    closeDialog();
  };

  return (
    <div className="account-panel">
      <dl className="account-facts">
        <div>
          <dt>Signed in with</dt>
          <dd>
            {PROVIDER_NAMES[user.provider ?? ""] ?? "—"}
            {user.email && <small> · {user.email}</small>}
          </dd>
        </div>
        <div>
          <dt>Saved</dt>
          <dd>{counts}</dd>
        </div>
        <div>
          <dt>Sync</dt>
          <dd className={`account-sync ${sync ?? "saved"}`}>
            <i aria-hidden="true" />
            {syncLabel(sync, syncedAt)}
          </dd>
        </div>
      </dl>
      {!confirming ? (
        <div className="account-actions">
          <button type="button" className="button" onClick={exportData}>
            <Icon name="download" />
            Export my data
          </button>
          <button type="button" className="button" disabled={busy} onClick={act(signOut)}>
            Sign out
          </button>
          <button type="button" className="account-delete" onClick={() => setConfirming(true)}>
            Delete account…
          </button>
        </div>
      ) : (
        <div className="account-confirm" role="alert">
          <p>
            <strong>Delete your account?</strong> Your account and everything saved in it are removed for good. This browser keeps nothing either.
          </p>
          <div className="account-actions">
            <button type="button" className="button danger" disabled={busy} onClick={act(deleteAccount)}>
              {busy ? "Deleting…" : "Delete my account"}
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
