import type { Metadata } from "next";
import { CoverageView } from "@/components/views/CoverageView";
import { preloadHubData } from "@/components/data/preloadHubData";

export const metadata: Metadata = { title: "Data Coverage · Castle", description: "How complete Castle's SEC-derived deal, valuation and IPO data is, field by field." };
export const revalidate = 900;

export default function Page() {
  preloadHubData({ details: true }); // this page needs the dataset and its details before it can show anything
  return <CoverageView />;
}
