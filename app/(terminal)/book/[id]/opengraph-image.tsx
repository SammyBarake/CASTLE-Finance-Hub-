import { bookRows, bookStats } from "@/lib/books";
import { getHubData, getSharedBook } from "@/lib/data";
import { formatMultiple, formatPct, formatUsd } from "@/lib/format";
import { OG_SIZE, ogCard } from "@/lib/ogCard";

// The preview a shared deal book shows in Slack, LinkedIn or iMessage: its title, author and headline comps.
export const alt = "Deal book on Castle";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const book = await getSharedBook((await params).id);
  if (!book) return ogCard({ kicker: "Castle · Deal book", title: "Deal book not found" });
  const data = await getHubData();
  const stats = bookStats(bookRows(book.items, new Map(data.deals.map((d) => [d.id, d]))));
  return ogCard({
    kicker: ["Deal book", book.byline ? `by ${book.byline}` : null].filter(Boolean).join(" · "),
    title: book.title,
    subtitle: book.thesis.trim() ? book.thesis.trim().replace(/\s+/g, " ").slice(0, 110) + (book.thesis.length > 110 ? "…" : "") : undefined,
    stats: [
      { label: "Deals", value: String(stats.count) },
      { label: "Median EV / EBITDA", value: formatMultiple(stats.evEbitda.median) },
      { label: "Median premium", value: formatPct(stats.premium.median) },
      { label: "Total value", value: formatUsd(stats.totalValueUsd) },
    ],
  });
}
