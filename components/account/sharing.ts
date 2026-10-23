"use client";

/**
 * Shared deal books (supabase/migrations/0004_books.sql): publishing a book as a read-only link, stopping it, and
 * keeping the link's snapshot in step with the book. The author edits the book as usual; a moment after a shared
 * book changes, its snapshot is republished, so the link always shows the current title, thesis and comments.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSnapshot, updatePrefs } from "@/components/workspace/store";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { sanitizeShared, snapshotKey, snapshotOf, type DealBook } from "@/lib/books";

const PUBLISH_DELAY_MS = 1500;

const setShareId = (bookId: string, shareId: string | null) =>
  updatePrefs((p) => ({ ...p, books: p.books.map((b) => (b.id === bookId ? { ...b, shareId } : b)) }));

function explain(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "You can share up to 25 books. Stop sharing one to share another.";
  if (error.code === "42P01" || error.code === "PGRST205") return "Sharing isn't set up on this site yet.";
  if (error.code?.startsWith("PGRST30")) return "Your sign-in has expired. Sign out and back in, then try again.";
  return error.message;
}

export function useBookSharing(db: SupabaseClient | null, userId: string | null) {
  const { prefs } = useWorkspace();
  /** What the server holds for each of this user's links (by snapshotKey), read once after sign-in. */
  const server = useRef<Map<string, string> | null>(null);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    server.current = null;
    if (!db || !userId) return;
    let cancelled = false;
    void db
      .from("shared_books")
      .select("id, data")
      .then(({ data, error }) => {
        if (cancelled || error) return; // e.g. before the migration: sharing just stays unavailable
        const map = new Map<string, string>();
        for (const row of (data ?? []) as { id: string; data: unknown }[]) {
          const s = sanitizeShared({ data: row.data });
          if (s) map.set(row.id, snapshotKey(s));
        }
        server.current = map;
        // A link stopped on another device no longer exists: the book here is private again.
        for (const b of getSnapshot().books) if (b.shareId && !map.has(b.shareId)) setShareId(b.id, null);
        setReady((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [db, userId]);

  // Republish shared books whose snapshot changed (debounced while typing).
  useEffect(() => {
    const map = server.current;
    if (!db || !userId || !map) return;
    const due = prefs.books.filter((b): b is DealBook & { shareId: string } => !!b.shareId && map.get(b.shareId) !== snapshotKey(snapshotOf(b)));
    if (!due.length) return;
    const timer = setTimeout(async () => {
      for (const b of due) {
        const { error } = await db.from("shared_books").update({ data: snapshotOf(b) }).eq("id", b.shareId);
        if (error) console.warn("Shared book:", error.message);
        else map.set(b.shareId, snapshotKey(snapshotOf(b)));
      }
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [db, userId, prefs.books, ready]);

  /** Publishes the book and returns its link id (an existing link is reused). */
  const shareBook = useCallback(
    async (bookId: string): Promise<string> => {
      const book = getSnapshot().books.find((b) => b.id === bookId);
      if (!db || !userId || !book) throw new Error("Sign in to share a book.");
      if (book.shareId) return book.shareId;
      const inserted = await db.from("shared_books").insert({ owner: userId, book_id: book.id, data: snapshotOf(book) }).select("id").single();
      let id = (inserted.data as { id: string } | null)?.id ?? null;
      if (inserted.error?.code === "23505") {
        // Already shared from another device: keep that link and bring it up to date.
        const existing = await db.from("shared_books").select("id").eq("book_id", book.id).single();
        if (existing.error) throw new Error(explain(existing.error));
        id = (existing.data as { id: string }).id;
        await db.from("shared_books").update({ data: snapshotOf(book) }).eq("id", id);
      } else if (inserted.error) throw new Error(explain(inserted.error));
      if (!id) throw new Error("No link came back. Please try again.");
      server.current?.set(id, snapshotKey(snapshotOf(book)));
      setShareId(bookId, id);
      return id;
    },
    [db, userId],
  );

  /** Takes the link down: anyone opening it afterwards gets "not found". */
  const stopSharing = useCallback(
    async (bookId: string): Promise<void> => {
      const book = getSnapshot().books.find((b) => b.id === bookId);
      if (!book?.shareId) return;
      if (!db || !userId) throw new Error("Sign in to stop sharing this book.");
      const { error } = await db.from("shared_books").delete().eq("id", book.shareId);
      if (error) throw new Error(explain(error));
      server.current?.delete(book.shareId);
      setShareId(bookId, null);
    },
    [db, userId],
  );

  return { shareBook, stopSharing };
}
