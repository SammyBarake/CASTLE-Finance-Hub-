import type { Metadata } from "next";
import { ValuationsView } from "@/components/views/ValuationsView";

export const metadata: Metadata = { title: "Valuations · Castle" };
export const revalidate = 3600;

export default function Page() {
  return <ValuationsView />;
}
