import type { Metadata } from "next";
import { ValuationsView } from "@/components/views/ValuationsView";
import { preloadHubData } from "@/components/data/preloadHubData";

export const metadata: Metadata = { title: "Valuations · Castle" };
export const revalidate = 900;

export default function Page() {
  preloadHubData(); // this page needs the full dataset before it can show anything
  return <ValuationsView />;
}
