import type { Metadata } from "next";
import { CoverageView } from "@/components/views/CoverageView";

export const metadata: Metadata = { title: "Data Coverage · Castle", description: "How complete Castle's SEC-derived deal, valuation and IPO data is, field by field." };
export const revalidate = 900;

export default function Page() {
  return <CoverageView />;
}
