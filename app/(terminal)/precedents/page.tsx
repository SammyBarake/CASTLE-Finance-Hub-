import type { Metadata } from "next";
import { Suspense } from "react";
import { PrecedentsView } from "@/components/views/PrecedentsView";

export const metadata: Metadata = { title: "Precedents · Castle" };
export const revalidate = 3600;

export default function Page() {
  // The view reads ?deal= on the client, so the static page needs a Suspense boundary.
  return (
    <Suspense>
      <PrecedentsView />
    </Suspense>
  );
}
