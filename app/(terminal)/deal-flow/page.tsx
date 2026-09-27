import type { Metadata } from "next";
import { DealFlowView } from "@/components/views/DealFlowView";

export const metadata: Metadata = { title: "Deal Flow · Castle" };
export const revalidate = 900;

export default function Page() {
  return <DealFlowView />;
}
