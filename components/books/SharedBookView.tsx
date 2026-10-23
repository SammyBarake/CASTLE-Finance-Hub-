"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useHubData } from "@/components/data/HubDataProvider";
import { exportContext } from "@/components/export/excel";
import { Icon } from "@/components/ui/Icon";
import { AboutData, PageHeading, PanelHead } from "@/components/ui/primitives";
import { useUi } from "@/components/ui/UiProvider";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { BOOK_LIMITS, bookRows, copyOfShared, type SharedBook } from "@/lib/books";
import { dealsToCsv, downloadCsv } from "@/lib/csv";
import { bookWorkbook } from "@/lib/excel/workbooks";
import { formatDateLong } from "@/lib/format";
import { reportIssueUrl } from "@/lib/site";
import { BookFigures, BookTable } from "./BookContent";

/** A shared deal book (/book/<link id>): read-only, with live figures, Excel export and a copy for the viewer. */
export function SharedBookView({ id, book }: { id: string; book: SharedBook }) {
  const { data } = useHubData();
  const ws = useWorkspace();
  const { toast } = useUi();
  const router = useRouter();
  const byId = useMemo(() => new Map(data.deals.map((d) => [d.id, d])), [data.deals]);
  const rows = useMemo(() => bookRows(book.items, byId), [book.items, byId]);
  const live = rows.flatMap((r) => (r.deal ? [r.deal] : []));
  const n = book.items.length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/book/${id}`);
      toast("Link copied.");
    } catch {
      toast("Couldn't copy the link.");
    }
  };
  const saveCopy = () => {
    const copy = copyOfShared(book);
    if (!ws.addBook(copy)) return toast(`You have ${BOOK_LIMITS.books} books, the most Castle keeps. Delete one to save this.`);
    toast("Saved to your deal books: it's your own copy to edit.");
    router.push(`/books?b=${copy.id}`);
  };

  return (
    <>
      <PageHeading
        title={book.title}
        subtitle={[`Deal book${book.byline ? ` by ${book.byline}` : ""}`, `${n} ${n === 1 ? "deal" : "deals"}`, book.updatedAt ? `updated ${formatDateLong(book.updatedAt.slice(0, 10))}` : null]
          .filter(Boolean)
          .join(" · ")}
        onExport={live.length ? () => downloadCsv(dealsToCsv(live, data.isSample), `Castle_Deal_book_${book.title.replace(/[^\w.-]+/g, "_")}.csv`) : undefined}
        excel={rows.length ? () => bookWorkbook(book, rows, exportContext(data)) : undefined}
        exportLabel="Export this deal book"
        extra={
          <>
            <button type="button" className="button" onClick={copyLink}>
              <Icon name="link" />
              Copy link
            </button>
            <button type="button" className="button" onClick={saveCopy}>
              <Icon name="book" />
              Save a copy
            </button>
          </>
        }
      />

      {book.thesis.trim() && (
        <section className="panel book-thesis-view">
          <PanelHead title="Thesis" />
          <p className="book-thesis-text">{book.thesis}</p>
        </section>
      )}

      {rows.length ? (
        <>
          <BookFigures rows={rows} all={data.deals} />
          <section className="panel">
            <PanelHead title="Deals" subtitle={`With ${book.byline ? `${book.byline}'s` : "the author's"} comment on each`} />
            <BookTable rows={rows} />
          </section>
        </>
      ) : (
        <section className="panel book-empty">
          <p>This book has no deals yet.</p>
        </section>
      )}

      <AboutData title="About this book">
        <p>
          A deal book made on Castle. The choice of deals, the thesis and the comments are {book.byline ? `${book.byline}'s` : "its author's"}; the figures are Castle&apos;s
          live data from public SEC filings, so they update as new filings arrive. Not investment advice.
        </p>
        <p>
          Save a copy to make your own version, or <a href={reportIssueUrl("Shared deal book", `Shared book: /book/${id}`)}>report this book</a>.
        </p>
      </AboutData>
    </>
  );
}
