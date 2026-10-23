"use client";

import { useState } from "react";
import { SignInBody } from "@/components/account/AccountButton";
import { useAccount } from "@/components/account/AccountProvider";
import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/components/ui/UiProvider";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { BOOK_LIMITS } from "@/lib/books";
import { useDraft } from "./BookContent";

export const shareUrl = (shareId: string) => `${window.location.origin}/book/${shareId}`;

/** Sharing a book as a read-only link: who sees what, the link itself, and stopping it. */
export function ShareBookBody({ bookId }: { bookId: string }) {
  const account = useAccount();
  const { prefs, updateBook } = useWorkspace();
  const { openDialog, toast } = useUi();
  const book = prefs.books.find((b) => b.id === bookId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [byline, setByline] = useState(book?.byline || account.user?.name || "");
  const savedByline = useDraft(book?.byline ?? "", (v) => updateBook(bookId, (b) => ({ ...b, byline: v.slice(0, BOOK_LIMITS.byline) })));

  if (!book) return <p>This book no longer exists.</p>;
  if (account.status === "off") return <p>Sharing isn&apos;t available on this site yet.</p>;
  if (account.status !== "signedIn")
    return (
      <div className="account-panel">
        <p className="account-lead">Sharing a book needs a free account, so only you can change it or stop sharing it.</p>
        <p>Your books stay in this browser until then, and come with you when you sign in.</p>
        <div className="account-actions">
          <button type="button" className="button primary" onClick={() => openDialog({ eyebrow: "Optional account", title: "Save your work across devices", body: <SignInBody /> })}>
            Sign in to share
          </button>
        </div>
      </div>
    );

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(id));
      toast("Link copied.");
    } catch {
      toast("Couldn't copy: select the link and copy it.");
    }
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!book.shareId)
    return (
      <div className="account-panel">
        <p className="account-lead">Anyone with the link can open a read-only copy of this book. It isn&apos;t listed anywhere or shown to search engines.</p>
        <ul className="account-points">
          <li>
            <Icon name="book" />
            They see the title, thesis, deals and your comments, with live figures, and can export it to Excel.
          </li>
          <li>
            <Icon name="shield" />
            Not your email, your other books or anything else in your workspace. Stop sharing at any time.
          </li>
        </ul>
        <label className="share-label" htmlFor="share-byline">
          Shown as (optional)
        </label>
        <input id="share-byline" className="share-input" value={byline} maxLength={BOOK_LIMITS.byline} placeholder="Your name, or leave blank" onChange={(e) => setByline(e.target.value)} />
        {error && <p className="field-error">{error}</p>}
        <div className="account-actions">
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                updateBook(bookId, (b) => ({ ...b, byline: byline.trim().slice(0, BOOK_LIMITS.byline) }));
                const id = await account.shareBook(bookId);
                await copy(id);
              })
            }
          >
            <Icon name="link" />
            {busy ? "Creating link…" : "Create link and copy it"}
          </button>
        </div>
      </div>
    );

  const url = shareUrl(book.shareId);
  return (
    <div className="account-panel">
      <p className="account-lead">This book is shared. Changes you make show up on the link within a few seconds.</p>
      <div className="share-link-row">
        <input className="share-input" readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="button" onClick={() => copy(book.shareId!)}>
          <Icon name="copy" />
          Copy
        </button>
      </div>
      <label className="share-label" htmlFor="share-byline-edit">
        Shown as
      </label>
      <input id="share-byline-edit" className="share-input" maxLength={BOOK_LIMITS.byline} placeholder="No name shown" {...savedByline} />
      {error && <p className="field-error">{error}</p>}
      <div className="account-actions">
        <a className="button" href={url} target="_blank" rel="noopener">
          <Icon name="external" />
          Open shared page
        </a>
        <button
          type="button"
          className="account-delete"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await account.stopSharing(bookId);
              toast("Sharing stopped: the link no longer opens the book.");
            })
          }
        >
          {busy ? "Stopping…" : "Stop sharing"}
        </button>
      </div>
    </div>
  );
}
