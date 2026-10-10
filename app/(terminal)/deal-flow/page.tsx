import type { Metadata } from "next";
import { Suspense } from "react";
import { DealFlowView } from "@/components/views/DealFlowView";

export const metadata: Metadata = { title: "Deal Flow · Castle" };
export const revalidate = 900;

export default function Page() {
  // The view reads its filters from the URL on the client, so the static page needs a Suspense boundary.
  return (
    <Suspense>
      <DealFlowView />
    </Suspense>
  );
}
