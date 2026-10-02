import type { Metadata } from "next";
import { WhatIfView } from "@/components/views/WhatIfView";

export const metadata: Metadata = { title: "What-if · Castle" };
export const revalidate = 900;

export default function Page() {
  return <WhatIfView />;
}
