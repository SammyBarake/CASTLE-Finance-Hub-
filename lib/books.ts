/**
 * Deal books: a person's own precedent sets. A book is a named list of deals with a thesis and a comment on each deal.
 * Books live in the workspace (lib/workspace.ts: kept in the browser, synced to an account and merged book by book),
 * and one can be shared as a read-only link: a snapshot of its title, thesis, comments and deal ids (Supabase
 * `shared_books`), so the shared page shows the deals' live figures. Pure and tested.
 */
import { summarize, summarizeComps, type Summary } from "./precedents";
import { formatMultiple, formatPct } from "./format";
import type { Deal } from "./types";

export interface BookItem {
  dealId: string;
  /** The author's comment on this deal: why it belongs in the book. */
  note: string;
  /** "Acquirer → Target" and the announcement date when it was added, shown if the deal ever leaves Castle's data. */
  label: string;
  date: string;
}

export interface DealBook {
  id: string;
  title: string;
  thesis: string;
  items: BookItem[];
  createdAt: number;
  /** The public link's id while the book is shared, else null. */
  shareId: string | null;
  /** The name shown on the shared page ("" for none). */
  byline: string;
}

export const BOOK_LIMITS = { books: 25, items: 60, title: 80, thesis: 2000, note: 500, byline: 60 };

/** A shared book's public id: 20 hex characters from a random UUID (supabase/migrations/0004_books.sql). */
export const SHARE_ID = /^[a-f0-9]{20}$/;

export const newBookId = () => `b${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "").slice(0, 20)}`;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function sanitizeItems(raw: unknown): BookItem[] {
  const seen = new Set<string>();
  const items: BookItem[] = [];
  for (const i of Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []) {
    if (!i || typeof i.dealId !== "string" || !i.dealId || i.dealId.length > 200 || seen.has(i.dealId)) continue;
    seen.add(i.dealId);
    items.push({ dealId: i.dealId, note: text(i.note, BOOK_LIMITS.note), label: text(i.label, 200), date: /^\d{4}-\d{2}-\d{2}$/.test(String(i.date)) ? String(i.date) : "" });
    if (items.length === BOOK_LIMITS.items) break;
  }
  return items;
}

/** Any stored or downloaded list of books, made safe: unknown fields dropped, sizes capped, one book per id. */
export function sanitizeBooks(raw: unknown): DealBook[] {
  const books: DealBook[] = [];
  const ids = new Set<string>();
  for (const b of Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []) {
    if (!b || typeof b.id !== "string" || !/^b[a-z0-9]{1,40}$/i.test(b.id) || ids.has(b.id)) continue;
    ids.add(b.id);
    books.push({
      id: b.id,
      title: text(b.title, BOOK_LIMITS.title).trim() || "Untitled book",
      thesis: text(b.thesis, BOOK_LIMITS.thesis),
      items: sanitizeItems(b.items),
      createdAt: typeof b.createdAt === "number" && Number.isFinite(b.createdAt) ? b.createdAt : 0,
      shareId: typeof b.shareId === "string" && SHARE_ID.test(b.shareId) ? b.shareId : null,
      byline: text(b.byline, BOOK_LIMITS.byline),
    });
    if (books.length === BOOK_LIMITS.books) break;
  }
  return books;
}

export const itemFor = (d: Deal): BookItem => ({ dealId: d.id, note: "", label: `${d.acquirer.name} → ${d.target.name}`, date: d.announcedDate });

export function makeBook(title: string, deals: Deal[] = [], now = Date.now(), id = newBookId()): DealBook {
  return addDeals({ id, title: title.trim().slice(0, BOOK_LIMITS.title) || "Untitled book", thesis: "", items: [], createdAt: now, shareId: null, byline: "" }, deals).book;
}

/** Adds the deals the book doesn't have yet, up to its size limit. */
export function addDeals(book: DealBook, deals: Deal[]): { book: DealBook; added: number; skipped: number } {
  const have = new Set(book.items.map((i) => i.dealId));
  const fresh = deals.filter((d, i) => !have.has(d.id) && deals.findIndex((x) => x.id === d.id) === i);
  const room = Math.max(0, BOOK_LIMITS.items - book.items.length);
  const take = fresh.slice(0, room);
  return { book: take.length ? { ...book, items: [...book.items, ...take.map(itemFor)] } : book, added: take.length, skipped: fresh.length - take.length };
}

export const removeDeal = (book: DealBook, dealId: string): DealBook => ({ ...book, items: book.items.filter((i) => i.dealId !== dealId) });

export const setItemNote = (book: DealBook, dealId: string, note: string): DealBook => ({
  ...book,
  items: book.items.map((i) => (i.dealId === dealId ? { ...i, note: note.slice(0, BOOK_LIMITS.note) } : i)),
});

export interface BookRow {
  item: BookItem;
  /** Null when the deal is no longer in Castle's data (a rebuild can retire a record). */
  deal: Deal | null;
}

export const bookRows = (items: BookItem[], byId: Map<string, Deal>): BookRow[] => items.map((item) => ({ item, deal: byId.get(item.dealId) ?? null }));

export interface BookStats {
  count: number;
  missing: number;
  totalValueUsd: number | null;
  size: Summary;
  evEbitda: Summary;
  evRevenue: Summary;
  premium: Summary;
}

export function bookStats(rows: BookRow[]): BookStats {
  const deals = rows.flatMap((r) => (r.deal ? [r.deal] : []));
  const values = deals.map((d) => d.valueUsd).filter((v): v is number => v != null);
  return { count: rows.length, missing: rows.length - deals.length, totalValueUsd: values.length ? values.reduce((a, b) => a + b, 0) : null, ...summarizeComps(deals) };
}

/**
 * Two to four short, number-led lines the KPIs don't show: how the book's valuations and premiums compare with every
 * deal Castle tracked in the same sectors over the same dates, how the deals were paid for, the bank that keeps
 * turning up, and what's still open.
 */
export function bookTakeaways(rows: BookRow[], all: Deal[]): string[] {
  const deals = rows.flatMap((r) => (r.deal ? [r.deal] : []));
  if (deals.length < 2) return [];
  const out: string[] = [];
  const sectors = [...new Set(deals.map((d) => d.sector))];
  const dates = deals.map((d) => d.announcedDate).sort();
  const ids = new Set(deals.map((d) => d.id));
  const market = all.filter((d) => !ids.has(d.id) && sectors.includes(d.sector) && d.status !== "Terminated" && d.announcedDate >= dates[0] && d.announcedDate <= dates.at(-1)!);
  const scope = sectors.length === 1 ? `${sectors[0]} deals` : "deals in these sectors";

  const compare = (label: string, pick: (d: Deal) => number | null, fmt: (v: number) => string) => {
    const mine = summarize(deals.map(pick));
    const theirs = summarize(market.map(pick));
    if (mine.n < 3 || theirs.n < 5 || mine.median == null || theirs.median == null) return;
    const gap = mine.median - theirs.median;
    const side = Math.abs(gap) < 0.05 * Math.abs(theirs.median) ? "in line with" : gap > 0 ? `${fmt(Math.abs(gap))} above` : `${fmt(Math.abs(gap))} below`;
    out.push(`Median ${label} ${fmt(mine.median)}, ${side} the ${fmt(theirs.median)} for all ${scope} Castle tracked over the same dates.`);
  };
  compare("EV / EBITDA", (d) => d.evEbitda, formatMultiple);
  compare("premium", (d) => d.premiumPct, (v) => formatPct(v));

  const paid = deals.filter((d) => d.consideration);
  if (paid.length >= 3) {
    const n = (c: string) => paid.filter((d) => d.consideration === c).length;
    const parts = [
      [n("Cash"), "all cash"],
      [n("Stock"), "all stock"],
      [n("Mixed"), "cash and stock"],
    ].filter(([k]) => (k as number) > 0) as [number, string][];
    out.push(`Paid for: ${parts.map(([k, what]) => `${k} ${what}`).join(", ")} (of ${paid.length} with terms disclosed).`);
  }

  const banks = new Map<string, number>();
  for (const d of deals) for (const b of new Set([...d.acquirerAdvisors, ...d.targetAdvisors])) banks.set(b, (banks.get(b) ?? 0) + 1);
  const [bank, times] = [...banks].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
  if (bank && times >= 2) out.push(`${bank} advised on ${times} of the ${deals.length} deals, more than any other bank.`);

  const open = deals.filter((d) => d.status === "Announced" || d.status === "Pending").length;
  const ended = deals.filter((d) => d.status === "Terminated").length;
  if (open || ended) out.push([open ? `${open} still open` : "", ended ? `${ended} terminated` : ""].filter(Boolean).join(", ") + ".");
  return out.slice(0, 4).map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

/** What a share link shows: no workspace ids, no account details beyond the byline the author chose. */
export interface SharedBook {
  title: string;
  thesis: string;
  byline: string;
  items: BookItem[];
  /** When the author last changed it (from the database). */
  updatedAt: string | null;
}

export const snapshotOf = (b: DealBook): Omit<SharedBook, "updatedAt"> => ({ title: b.title, thesis: b.thesis, byline: b.byline, items: b.items });

/** Compares a book with its published copy whatever order the database keeps the JSON keys in. */
export const snapshotKey = (s: Pick<SharedBook, "title" | "thesis" | "byline" | "items">) =>
  JSON.stringify([s.title, s.thesis, s.byline, s.items.map((i) => [i.dealId, i.note, i.label, i.date])]);

/** A shared book as the database returns it (`get_shared_book`), checked like any untrusted input. */
export function sanitizeShared(raw: unknown): SharedBook | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const d = (r.data && typeof r.data === "object" ? r.data : null) as Record<string, unknown> | null;
  if (!d) return null;
  return {
    title: text(d.title, BOOK_LIMITS.title).trim() || "Untitled book",
    thesis: text(d.thesis, BOOK_LIMITS.thesis),
    byline: text(d.byline, BOOK_LIMITS.byline),
    items: sanitizeItems(d.items),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
}

/** A viewer's own copy of a shared book. */
export const copyOfShared = (s: SharedBook, now = Date.now()): DealBook => ({
  id: newBookId(),
  title: s.title.slice(0, BOOK_LIMITS.title),
  thesis: s.thesis,
  items: s.items.map((i) => ({ ...i })),
  createdAt: now,
  shareId: null,
  byline: "",
});
