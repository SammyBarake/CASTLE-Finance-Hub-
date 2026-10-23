import { bookRows } from "@/lib/books";
import { getHubData, getSharedBook } from "@/lib/data";
import { bookTable, csvResponse, unavailableResponse } from "@/lib/live";

// A shared deal book as a live CSV (/api/live/book/<link id>.csv): the author's deals and comments, live figures.
export async function GET(request: Request, ctx: RouteContext<"/api/live/book/[file]">) {
  const id = (await ctx.params).file.replace(/\.csv$/i, "");
  let book;
  try {
    book = await getSharedBook(id);
  } catch (err) {
    return unavailableResponse((err as Error).message);
  }
  if (!book)
    return new Response("There's no shared deal book at this link: its author may have stopped sharing it.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=60" },
    });
  const data = await getHubData();
  if (data.dataError) return unavailableResponse(data.dataError);
  const rows = bookRows(book.items, new Map(data.deals.map((d) => [d.id, d])));
  const slug = book.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "deal-book";
  return csvResponse(bookTable(rows, new URL(request.url).origin), `castle-${slug}.csv`, data);
}
