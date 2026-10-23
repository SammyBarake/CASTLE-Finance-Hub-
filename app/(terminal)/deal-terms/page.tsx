import type { Metadata } from "next";
import { DealTermsView } from "@/components/views/DealTermsView";
import { preloadHubData } from "@/components/data/preloadHubData";

export const metadata: Metadata = { title: "Deal Terms · Castle" };
export const revalidate = 900;

export default function Page() {
  preloadHubData(); // this page needs the full dataset before it can show anything
  return <DealTermsView />;
}
