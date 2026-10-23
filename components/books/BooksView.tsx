"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { AUTH_ENABLED } from "@/components/account/client";
import { useHubData } from "@/components/data/HubDataProvider";
import { exportContext } from "@/components/export/excel";
import { Icon } from "@/components/ui/Icon";
import { AboutData, PageHeading, PanelHead } from "@/components/ui/primitives";
import { useUi } from "@/components/ui/UiProvider";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { BOOK_LIMITS, bookRows, removeDeal, setItemNote, type BookRow, type DealBook } from "@/lib/books";
import { dealsToCsv, downloadCsv } from "@/lib/csv";
import { bookWorkbook } from "@/lib/excel/workbooks";
import { formatDateLong } from "@/lib/format";
import { BookFigures, BookTable, useDraft } from "./BookContent";
import { ShareBookBody } from "./ShareBook";

const dealCount = (n: number) => `${n} ${n === 1 ? "deal" : "deals"}`;

/** Deal Books (/books): the user's own precedent sets, one open at a time (?b=<book id>). */
export function BooksView() {
  const { data } = useHubData();
  const ws = useWorkspace();
  const { toast } = useUi();
  const router = useRouter();
  const params = useSearchParams();
  const books = ws.prefs.books;
  const book = books.find((b) => b.id === params.get("b")) ?? books[0] ?? null;
  const byId = useMemo(() => new Map(data.deals.map((d) => [d.id, d])), [data.deals]);
  const rows = useMemo(() => (book ? bookRows(book.items, byId) : []), [book, byId]);
  const select = (id: string) => router.replace(`/books?b=${encodeURIComponent(id)}`, { scroll: false });

  const newBook = () => {
    const id = ws.createBook("Untitled book");
    if (id) select(id);
    else toast(`You have ${BOOK_LIMITS.books} books, the most Castle keeps. Delete one to start another.`);
  };
  const live = rows.flatMap((r) => (r.deal ? [r.deal] : []));

  return (
    <>
      <PageHeading
        title="Deal Books"
        subtitle="Your own precedent sets: the deals you pick, your thesis and a comment on each"
        onExport={
          book && live.length
            ? () => {
                downloadCsv(dealsToCsv(live, data.isSample), `Castle_Deal_book_${book.title.replace(/[^\w.-]+/g, "_")}${data.isSample ? "_Sample" : ""}.csv`);
                toast(`${dealCount(live.length)} exported.`);
              }
            : undefined
        }
        excel={book && rows.length ? () => bookWorkbook(book, rows, exportContext(data)) : undefined}
        exportLabel="Export this deal book"
        extra={
          <button type="button" className="button" onClick={newBook}>
            <Icon name="book" />
            New book
          </button>
        }
      />

      {!book ? (
        <BooksIntro onNew={newBook} />
      ) : (
        <div className="books-layout">
          <nav className="panel books-list" aria-label="Your deal books">
            <PanelHead title="Your books" subtitle={`${books.length} of ${BOOK_LIMITS.books}`} />
            <ul>
              {books.map((b) => (
                <li key={b.id}>
                  <button type="button" aria-current={b.id === book.id ? "true" : undefined} onClick={() => select(b.id)}>
                    <strong>{b.title}</strong>
                    <small>
                      {dealCount(b.items.length)}
                      {b.shareId && <span className="book-shared-tag">Shared</span>}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="books-main">
            <BookEditor key={book.id} book={book} rows={rows} />
          </div>
        </div>
      )}

      <AboutData>
        <p>
          A deal book is your own list of precedent transactions: up to {BOOK_LIMITS.items} deals, a thesis and a comment on each. Its figures are Castle&apos;s live
          data from SEC filings, so a pending deal&apos;s status, terms and multiples update as new filings arrive. The takeaways compare the book with every deal Castle
          tracked in the same sectors over the same dates.
        </p>
        <p>
          Books are kept in this browser{AUTH_ENABLED ? "; signed in, they're also saved to your account, follow you to any device and can be shared as a read-only link" : ""}.
          Export a book to Excel for a comps sheet with live summary formulas and your comments.
        </p>
      </AboutData>
    </>
  );
}

function BooksIntro({ onNew }: { onNew: () => void }) {
  return (
    <section className="panel books-intro">
      <PanelHead title="Build your own precedent sets" subtitle="Pick the deals, write the thesis, let the numbers update themselves" />
      <div className="books-intro-body">
        <ol className="books-ways">
          <li>
            <strong>From any deal</strong>
            <span>Open a deal, or its ⋯ menu in any table, and choose Add to book.</span>
          </li>
          <li>
            <strong>From a comps screen</strong>
            <span>
              Screen comparable deals on <Link href="/precedents">Precedents</Link>, untick the outliers, then Save as book.
            </span>
          </li>
          <li>
            <strong>From a selection</strong>
            <span>
              Tick several deals on <Link href="/deal-flow">Deal Flow</Link> and add them together.
            </span>
          </li>
        </ol>
        <p className="books-intro-then">
          Then write your thesis, comment on each deal, compare its multiples and premiums with the market, export it to Excel{AUTH_ENABLED ? ", or share it as a read-only link" : ""}.
        </p>
        <button type="button" className="button primary" onClick={onNew}>
          <Icon name="book" />
          Start an empty book
        </button>
      </div>
    </section>
  );
}

function BookEditor({ book, rows }: { book: DealBook; rows: BookRow[] }) {
  const ws = useWorkspace();
  const { data } = useHubData();
  const account = useAccount();
  const { openDialog, toast } = useUi();
  const [confirming, setConfirming] = useState(false);
  const title = useDraft(book.title, (v) => ws.updateBook(book.id, (b) => ({ ...b, title: v.trim().slice(0, BOOK_LIMITS.title) || "Untitled book" })));
  const thesis = useDraft(book.thesis, (v) => ws.updateBook(book.id, (b) => ({ ...b, thesis: v.slice(0, BOOK_LIMITS.thesis) })));

  const share = () => openDialog({ eyebrow: "Share deal book", title: book.title, body: <ShareBookBody bookId={book.id} /> });
  const remove = async () => {
    if (book.shareId) {
      // A shared book's link would outlive it: take the link down first.
      if (account.status !== "signedIn") return toast("This book is shared. Sign in to stop sharing it, then delete it.");
      try {
        await account.stopSharing(book.id);
      } catch (err) {
        return toast(`Couldn't stop sharing: ${(err as Error).message}`);
      }
    }
    ws.deleteBook(book.id);
    toast(`Deleted ${book.title}.`);
  };

  return (
    <>
      <section className="panel book-sheet">
        <div className="book-head">
          <input className="book-title-input" aria-label="Book title" maxLength={BOOK_LIMITS.title} {...title} />
          <div className="book-tools">
            {AUTH_ENABLED && (
              <button type="button" className={`button ${book.shareId ? "on" : ""}`} onClick={share}>
                <Icon name="link" />
                {book.shareId ? "Shared" : "Share"}
              </button>
            )}
            {confirming ? (
              <span className="book-confirm">
                Delete this book?
                <button type="button" className="button danger" onClick={() => void remove()}>
                  Delete
                </button>
                <button type="button" className="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="tool-icon" aria-label="Delete this book" title="Delete this book" onClick={() => setConfirming(true)}>
                <Icon name="trash" />
              </button>
            )}
          </div>
        </div>
        <p className="book-meta">
          {dealCount(book.items.length)}
          {book.createdAt > 0 && ` · started ${formatDateLong(new Date(book.createdAt).toISOString().slice(0, 10))}`}
          {" · "}
          {book.shareId ? "Shared by link" : "Private"}
        </p>
        <label className="book-thesis-label" htmlFor={`thesis-${book.id}`}>
          Thesis
        </label>
        <textarea
          id={`thesis-${book.id}`}
          className="book-thesis"
          rows={3}
          maxLength={BOOK_LIMITS.thesis}
          placeholder="What ties these deals together, and what do they say about valuation, buyers or timing?"
          {...thesis}
        />
      </section>

      {rows.length ? (
        <>
          <BookFigures rows={rows} all={data.deals} />
          <section className="panel">
            <PanelHead title="Deals" subtitle="In the book's order · your comment on each is saved as you type" />
            <BookTable rows={rows} onNote={(id, note) => ws.updateBook(book.id, (b) => setItemNote(b, id, note))} onRemove={(id) => ws.updateBook(book.id, (b) => removeDeal(b, id))} />
          </section>
        </>
      ) : (
        <section className="panel book-empty">
          <p>
            No deals yet. Add them from any deal&apos;s details or ⋯ menu, from a <Link href="/precedents">Precedents</Link> screen, or by ticking several on{" "}
            <Link href="/deal-flow">Deal Flow</Link>.
          </p>
        </section>
      )}
    </>
  );
}
