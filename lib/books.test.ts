import { describe, expect, it } from "vitest";
import { addDeals, BOOK_LIMITS, bookRows, bookStats, bookTakeaways, copyOfShared, makeBook, removeDeal, sanitizeBooks, sanitizeShared, setItemNote, snapshotOf } from "./books";
import type { Deal } from "./types";
import { mergePrefs, sanitize, stampChanges, type Prefs } from "./workspace";

const deal = (id: string, over: Partial<Deal> = {}): Deal =>
  ({
    id,
    announcedDate: "2025-03-01",
    acquirer: { name: `Buyer ${id}`, ticker: null, cik: null },
    target: { name: `Target ${id}`, ticker: null, cik: null },
    valueUsd: 1e9,
    pricePerShare: null,
    premiumPct: null,
    consideration: "Cash",
    sector: "Tech",
    industry: "Software",
    status: "Closed",
    statusDate: null,
    enterpriseValueUsd: null,
    evEbitda: null,
    evRevenue: null,
    acquirerAdvisors: [],
    targetAdvisors: [],
    filings: [],
    targetFeeUsd: null,
    reverseFeeUsd: null,
    goShop: null,
    goShopDays: null,
    ...over,
  }) as Deal;

describe("books", () => {
  it("adds each deal once, keeps a label for deals that later leave the data, and respects the size limit", () => {
    const b = makeBook("  Software take-privates ", [deal("a"), deal("a"), deal("b")], 1, "bone");
    expect(b.title).toBe("Software take-privates");
    expect(b.items.map((i) => i.dealId)).toEqual(["a", "b"]);
    expect(b.items[0]).toMatchObject({ label: "Buyer a → Target a", date: "2025-03-01", note: "" });
    const many = Array.from({ length: BOOK_LIMITS.items + 5 }, (_, i) => deal(`d${i}`));
    const r = addDeals(b, many);
    expect(r.book.items).toHaveLength(BOOK_LIMITS.items);
    expect(r.added).toBe(BOOK_LIMITS.items - 2);
    expect(r.skipped).toBe(7);
    expect(removeDeal(setItemNote(b, "a", "Anchor comp"), "b").items).toEqual([{ dealId: "a", note: "Anchor comp", label: "Buyer a → Target a", date: "2025-03-01" }]);
  });

  it("drops anything invalid from stored or downloaded books", () => {
    const books = sanitizeBooks([
      { id: "bgood", title: "", items: [{ dealId: "x", note: 5, date: "nope" }, { dealId: "x" }], shareId: "not-a-share-id" },
      { id: "bgood", title: "Duplicate" },
      { id: "../../etc", title: "Bad id" },
    ]);
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({ title: "Untitled book", shareId: null, items: [{ dealId: "x", note: "", label: "", date: "" }] });
    expect(sanitizeShared({ data: { title: "T", items: [{ dealId: "x", note: "n" }] }, updatedAt: "2026-10-22T00:00:00Z" })).toMatchObject({ title: "T", items: [{ dealId: "x", note: "n" }], updatedAt: "2026-10-22T00:00:00Z" });
    expect(sanitizeShared(null)).toBeNull();
  });

  it("summarises the book's live deals and says when one is no longer in the data", () => {
    const b = makeBook("Comps", [deal("a", { evEbitda: 10, valueUsd: 2e9 }), deal("b", { evEbitda: 14, valueUsd: 1e9 }), deal("gone")], 1, "bx");
    const byId = new Map([deal("a", { evEbitda: 10, valueUsd: 2e9 }), deal("b", { evEbitda: 14, valueUsd: 1e9 })].map((d) => [d.id, d]));
    const stats = bookStats(bookRows(b.items, byId));
    expect(stats).toMatchObject({ count: 3, missing: 1, totalValueUsd: 3e9 });
    expect(stats.evEbitda.median).toBe(12);
  });

  it("compares the book with the market, the payment mix, the busiest bank and what's still open", () => {
    const mine = [
      deal("a", { evEbitda: 20, premiumPct: 40, acquirerAdvisors: ["Goldman Sachs"], announcedDate: "2025-01-10" }),
      deal("b", { evEbitda: 18, premiumPct: 35, targetAdvisors: ["Goldman Sachs"], consideration: "Stock", announcedDate: "2025-06-01" }),
      deal("c", { evEbitda: 22, premiumPct: 50, status: "Pending", announcedDate: "2025-09-01" }),
    ];
    const market = [10, 11, 12, 13, 14].map((m, i) => deal(`m${i}`, { evEbitda: m, premiumPct: 25, announcedDate: "2025-05-01" }));
    const lines = bookTakeaways(bookRows(makeBook("x", mine, 1, "by").items, new Map(mine.map((d) => [d.id, d]))), [...mine, ...market]);
    expect(lines[0]).toBe("Median EV / EBITDA 20.0x, 8.0x above the 12.0x for all Tech deals Castle tracked over the same dates.");
    expect(lines[1]).toBe("Median premium 40.0%, 15.0% above the 25.0% for all Tech deals Castle tracked over the same dates.");
    expect(lines).toContain("Goldman Sachs advised on 2 of the 3 deals, more than any other bank.");
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it("shares only the title, thesis, byline and comments, and a viewer's copy is their own", () => {
    const b = { ...makeBook("Comps", [deal("a")], 1, "bshare"), thesis: "Why", byline: "J. Analyst", shareId: "0123456789abcdef0123" };
    expect(snapshotOf(b)).toEqual({ title: "Comps", thesis: "Why", byline: "J. Analyst", items: b.items });
    const copy = copyOfShared({ ...snapshotOf(b), updatedAt: null });
    expect(copy).toMatchObject({ title: "Comps", shareId: null, byline: "" });
    expect(copy.id).not.toBe(b.id);
  });

  it("merges book by book across devices, and keeps both devices' new books", () => {
    const edit = (p: Prefs, fn: (p: Prefs) => Prefs, now: number): Prefs => {
      const next = fn(p);
      return { ...next, stamps: stampChanges(p, next, now) };
    };
    const base = edit(sanitize({}), (p) => ({ ...p, books: [makeBook("Shared", [deal("a")], 1, "bshared")] }), 100);
    const laptop = edit(base, (p) => ({ ...p, books: p.books.map((b) => ({ ...b, thesis: "Laptop thesis" })) }), 200);
    const phone = edit(base, (p) => ({ ...p, books: [...p.books, makeBook("Phone book", [], 1, "bphone")] }), 210);
    const m = mergePrefs(laptop, phone);
    expect(m.books.map((b) => b.id).sort()).toEqual(["bphone", "bshared"]);
    expect(m.books.find((b) => b.id === "bshared")?.thesis).toBe("Laptop thesis");
  });
});
