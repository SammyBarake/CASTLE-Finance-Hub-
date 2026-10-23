import type { Metadata } from "next";
import { AboutView } from "@/components/views/InfoViews";
import { preloadHubData } from "@/components/data/preloadHubData";

export const metadata: Metadata = {
  title: "About · Castle",
  description: "What Castle tracks, how its data is read from SEC EDGAR filings, its sources and its limits.",
};
export const revalidate = 900;

export default function Page() {
  preloadHubData(); // this page needs the full dataset before it can show anything
  return <AboutView />;
}
