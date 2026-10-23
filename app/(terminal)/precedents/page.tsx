import type { Metadata } from "next";
import { Suspense } from "react";
import { PrecedentsView } from "@/components/views/PrecedentsView";
import { preloadHubData } from "@/components/data/preloadHubData";

export const metadata: Metadata = { title: "Precedents · Castle" };
export const revalidate = 900;

export default function Page() {
  preloadHubData(); // this page needs the full dataset before it can show anything
  // The view reads ?deal= on the client, so the static page needs a Suspense boundary.
  return (
    <Suspense>
      <PrecedentsView />
    </Suspense>
  );
}
