import type { Metadata } from "next";
import { AboutView } from "@/components/views/InfoViews";

export const metadata: Metadata = {
  title: "About · Castle",
  description: "What Castle tracks, how its data is read from SEC EDGAR filings, its sources and its limits.",
};
export const revalidate = 900;

export default function Page() {
  return <AboutView />;
}
