import type { Metadata } from "next";
import { Suspense } from "react";
import { BooksView } from "@/components/books/BooksView";

export const metadata: Metadata = {
  title: "Deal Books · Castle",
  description: "Build your own precedent sets from SEC-sourced M&A deals: a thesis, a comment on each deal, live comps, Excel export and read-only share links.",
};
export const revalidate = 900;

export default function Page() {
  // The view reads ?b= (the open book) on the client, so the static page needs a Suspense boundary.
  return (
    <Suspense>
      <BooksView />
    </Suspense>
  );
}
