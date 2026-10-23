"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { useUi, type MenuItem, type MenuPosition } from "@/components/ui/UiProvider";
import { getSnapshot } from "@/components/workspace/store";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { BOOK_LIMITS, removeDeal } from "@/lib/books";
import type { Deal } from "@/lib/types";

const dealCount = (n: number) => `${n} ${n === 1 ? "deal" : "deals"}`;

/** Putting deals into books: a quick tick-list menu for one deal, a dialog for several (or a new book). */
export function useBookActions() {
  const { openMenu, openDialog, toast } = useUi();
  const ws = useWorkspace();
  const router = useRouter();

  const openAddToBook = (deals: Deal[], suggestedTitle = "") =>
    openDialog({
      eyebrow: "Deal books",
      title: deals.length === 1 ? "Add to a deal book" : `Add ${dealCount(deals.length)} to a book`,
      body: <AddToBookBody deals={deals} suggestedTitle={suggestedTitle} />,
    });

  /** One deal: tick the books it belongs in, in place (the drawer stays open). */
  function openBookMenu(deal: Deal, at: MenuPosition) {
    const books = getSnapshot().books; // fresh after each tick, as the menu re-opens itself
    const items: MenuItem[] = [
      { kind: "title", label: "Deal books" },
      ...books.map(
        (b): MenuItem => ({
          kind: "check",
          label: `${b.title} (${b.items.length})`,
          checked: b.items.some((i) => i.dealId === deal.id),
          disabled: !b.items.some((i) => i.dealId === deal.id) && b.items.length >= BOOK_LIMITS.items,
          onToggle: (on) => {
            if (on) ws.addToBook(b.id, [deal]);
            else ws.updateBook(b.id, (x) => removeDeal(x, deal.id));
            toast(on ? `Added to ${b.title}.` : `Removed from ${b.title}.`);
            openBookMenu(deal, at);
          },
        }),
      ),
      ...(books.length ? [{ kind: "rule" } as MenuItem] : []),
      { kind: "action", label: "New book with this deal…", icon: "book", onSelect: () => openAddToBook([deal], `${deal.sector} deals`) },
      ...(books.length ? [{ kind: "action", label: "Open deal books", icon: "right", onSelect: () => router.push("/books") } as MenuItem] : []),
    ];
    openMenu(items, at);
  }

  return { openAddToBook, openBookMenu };
}

function AddToBookBody({ deals, suggestedTitle }: { deals: Deal[]; suggestedTitle: string }) {
  const { prefs, createBook, addToBook } = useWorkspace();
  const { closeDialog } = useUi();
  const { status } = useAccount();
  const [title, setTitle] = useState(suggestedTitle);
  const [added, setAdded] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ id: string; title: string; n: number; skipped: number } | null>(null);
  const ids = deals.map((d) => d.id);
  const atLimit = prefs.books.length >= BOOK_LIMITS.books;
  const lead =
    deals.length === 1
      ? `${deals[0].acquirer.name} → ${deals[0].target.name}`
      : `${dealCount(deals.length)}: ${deals
          .slice(0, 3)
          .map((d) => d.target.name)
          .join(", ")}${deals.length > 3 ? ` and ${deals.length - 3} more` : ""}`;

  const create = (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) return;
    const id = createBook(name, deals);
    if (!id) return;
    const n = Math.min(deals.length, BOOK_LIMITS.items);
    setCreated({ id, title: name, n, skipped: deals.length - n });
  };

  if (created)
    return (
      <div className="book-add">
        <p className="book-add-done-lead">
          Created <strong>{created.title}</strong> with {dealCount(created.n)}.
          {created.skipped > 0 && ` ${created.skipped} didn't fit: a book holds up to ${BOOK_LIMITS.items}.`}
        </p>
        <div className="account-actions">
          <Link className="button primary" href={`/books?b=${created.id}`} onClick={closeDialog}>
            Open book
          </Link>
          <button type="button" className="button" onClick={closeDialog}>
            Done
          </button>
        </div>
      </div>
    );

  return (
    <div className="book-add">
      <p className="book-add-lead">{lead}</p>
      {prefs.books.length > 0 && (
        <ul className="book-add-list" aria-label="Your deal books">
          {prefs.books.map((b) => {
            const missing = ids.filter((id) => !b.items.some((i) => i.dealId === id)).length;
            const full = b.items.length >= BOOK_LIMITS.items;
            return (
              <li key={b.id}>
                <span className="book-add-name">
                  <strong>{b.title}</strong>
                  <small>{added[b.id] ?? dealCount(b.items.length)}</small>
                </span>
                <button
                  type="button"
                  className="button"
                  disabled={!missing || full}
                  onClick={() => {
                    const r = addToBook(b.id, deals);
                    setAdded((m) => ({ ...m, [b.id]: `${dealCount(r.added)} added${r.skipped ? `, ${r.skipped} didn't fit` : ""}` }));
                  }}
                >
                  {!missing ? "In this book" : full ? "Full" : missing === ids.length ? "Add" : `Add ${missing} more`}
                </button>
                <Link className="small-link" href={`/books?b=${b.id}`} onClick={closeDialog}>
                  Open
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <form className="book-add-new" onSubmit={create}>
        <label htmlFor="book-new-title">{prefs.books.length ? "Or start a new book" : "Name your first book"}</label>
        <div>
          <input id="book-new-title" value={title} maxLength={BOOK_LIMITS.title} placeholder="e.g. Software take-privates 2025" onChange={(e) => setTitle(e.target.value)} disabled={atLimit} autoFocus={!prefs.books.length} />
          <button type="submit" className="button primary" disabled={!title.trim() || atLimit}>
            Create book
          </button>
        </div>
        {atLimit && <p className="field-error">You have {BOOK_LIMITS.books} books, the most Castle keeps. Delete one to start another.</p>}
      </form>
      <p className="account-fine">
        Books are saved in this browser{status === "signedIn" ? " and your account" : status === "off" ? "" : "; sign in to keep them on every device and share them"}. Up to{" "}
        {BOOK_LIMITS.items} deals each.
      </p>
    </div>
  );
}
