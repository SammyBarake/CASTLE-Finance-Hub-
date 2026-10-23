import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedBookView } from "@/components/books/SharedBookView";
import { getSharedBook } from "@/lib/data";
import { preloadHubData } from "@/components/data/preloadHubData";

// Edits by the author show up within a minute; each shared book is rendered on its first visit, then cached.
export const revalidate = 60;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

// Unlisted: reachable by its link only, never indexed (robots), and not in the sitemap.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const book = await getSharedBook((await params).id);
  if (!book) return { title: "Deal book · Castle", robots: { index: false, follow: false } };
  const n = book.items.length;
  const description = book.thesis.trim()
    ? book.thesis.trim().replace(/\s+/g, " ").slice(0, 157) + (book.thesis.length > 157 ? "…" : "")
    : `${n} ${n === 1 ? "deal" : "deals"}${book.byline ? ` chosen by ${book.byline}` : ""}, with live figures from SEC filings.`;
  return {
    title: `${book.title} · Deal book · Castle`,
    description,
    robots: { index: false, follow: false },
    openGraph: { title: book.title, description },
    twitter: { card: "summary_large_image", title: book.title, description },
  };
}

export default async function Page({ params }: Props) {
  preloadHubData(); // this page needs the full dataset before it can show anything
  const { id } = await params;
  const book = await getSharedBook(id);
  if (!book) notFound();
  return <SharedBookView id={id} book={book} />;
}
