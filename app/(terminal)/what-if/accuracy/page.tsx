import type { Metadata } from "next";
import { WhatIfAccuracyView } from "@/components/views/WhatIfAccuracyView";

export const metadata: Metadata = { title: "What-if accuracy · Castle" };
export const revalidate = 900;

export default function Page() {
  return <WhatIfAccuracyView />;
}
