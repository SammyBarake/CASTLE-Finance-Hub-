"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { addDeals, BOOK_LIMITS, makeBook, type DealBook } from "@/lib/books";
import type { DealColumn, DealScreen } from "@/lib/screen";
import type { Deal } from "@/lib/types";
import { LIMITS, newViewId } from "@/lib/workspace";
import { getServerSnapshot, getSnapshot, isStorageOk, subscribe, updatePrefs, type Prefs } from "./store";

export type RecordKind = "deal" | "ipo";
export const recordKey = (kind: RecordKind, id: string) => `${kind}:${id}`;

interface WorkspaceValue {
  prefs: Prefs;
  storageOk: boolean;
  isWatched: (kind: RecordKind, id: string) => boolean;
  /** Returns true if the record is now watched. */
  toggleWatch: (kind: RecordKind, id: string) => boolean;
  note: (kind: RecordKind, id: string) => string;
  setNote: (kind: RecordKind, id: string, text: string) => void;
  saveView: (name: string, screen: DealScreen) => number;
  deleteView: (index: number) => void;
  setDensity: (d: Prefs["density"]) => void;
  setMotion: (on: boolean) => void;
  setColumns: (cols: DealColumn[]) => void;
  /** A new deal book holding these deals; its id, or null at the book limit. */
  createBook: (title: string, deals?: Deal[]) => string | null;
  /** Adds deals a book doesn't have yet (up to its size limit). */
  addToBook: (id: string, deals: Deal[]) => { added: number; skipped: number };
  updateBook: (id: string, fn: (b: DealBook) => DealBook) => void;
  deleteBook: (id: string) => void;
  /** Adds a ready-made book (a copy of a shared one); false at the book limit. */
  addBook: (book: DealBook) => boolean;
  /** Deals selected for comparison / bulk export (not persisted). */
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  setSelected: (ids: Set<string>) => void;
  /** A saved view chosen elsewhere (settings menu) for Deal Flow to apply. */
  pendingView: number | null;
  setPendingView: (index: number | null) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingView, setPendingView] = useState<number | null>(null);

  // Display preferences act on the whole page (the root layout applies them before first paint too).
  useEffect(() => {
    document.documentElement.classList.toggle("density-compact", prefs.density === "compact");
    document.documentElement.classList.toggle("reduce-motion", !prefs.motion);
  }, [prefs.density, prefs.motion]);

  const toggleWatch = useCallback((kind: RecordKind, id: string) => {
    const key = recordKey(kind, id);
    let nowWatched = false;
    updatePrefs((p) => {
      nowWatched = !p.watch.includes(key);
      return { ...p, watch: nowWatched ? [...p.watch, key] : p.watch.filter((k) => k !== key) };
    });
    return nowWatched;
  }, []);

  const toggleSelected = useCallback(
    (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      prefs,
      storageOk: isStorageOk(),
      isWatched: (kind, id) => prefs.watch.includes(recordKey(kind, id)),
      toggleWatch,
      note: (kind, id) => prefs.notes[recordKey(kind, id)] ?? "",
      setNote: (kind, id, text) =>
        updatePrefs((p) => {
          const notes = { ...p.notes };
          if (text.trim()) notes[recordKey(kind, id)] = text;
          else delete notes[recordKey(kind, id)];
          return { ...p, notes };
        }),
      saveView: (name, screen) => {
        let index = 0;
        updatePrefs((p) => {
          index = p.views.length;
          return { ...p, views: [...p.views, { id: newViewId(), name: name.slice(0, LIMITS.viewName), screen }] };
        });
        return index;
      },
      deleteView: (index) => updatePrefs((p) => ({ ...p, views: p.views.filter((_, i) => i !== index) })),
      setDensity: (density) => updatePrefs((p) => ({ ...p, density })),
      setMotion: (motion) => updatePrefs((p) => ({ ...p, motion })),
      setColumns: (columns) => updatePrefs((p) => ({ ...p, columns })),
      createBook: (title, deals = []) => {
        if (prefs.books.length >= BOOK_LIMITS.books) return null;
        const book = makeBook(title, deals);
        updatePrefs((p) => ({ ...p, books: [...p.books, book] }));
        return book.id;
      },
      addToBook: (id, deals) => {
        let result = { added: 0, skipped: 0 };
        updatePrefs((p) => ({
          ...p,
          books: p.books.map((b) => {
            if (b.id !== id) return b;
            const r = addDeals(b, deals);
            result = { added: r.added, skipped: r.skipped };
            return r.book;
          }),
        }));
        return result;
      },
      updateBook: (id, fn) => updatePrefs((p) => ({ ...p, books: p.books.map((b) => (b.id === id ? fn(b) : b)) })),
      deleteBook: (id) => updatePrefs((p) => ({ ...p, books: p.books.filter((b) => b.id !== id) })),
      addBook: (book) => {
        if (prefs.books.length >= BOOK_LIMITS.books) return false;
        updatePrefs((p) => ({ ...p, books: [...p.books, book] }));
        return true;
      },
      selected,
      toggleSelected,
      setSelected,
      pendingView,
      setPendingView,
    }),
    [prefs, selected, toggleWatch, toggleSelected, pendingView],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}
