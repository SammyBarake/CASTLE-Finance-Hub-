import type { Metadata } from "next";
import { WhatIfView } from "@/components/views/WhatIfView";
import { preloadHubData } from "@/components/data/preloadHubData";

export const metadata: Metadata = { title: "What-if · Castle" };
export const revalidate = 900;

export default function Page() {
  preloadHubData(); // this page needs the full dataset before it can show anything
  return <WhatIfView />;
}
