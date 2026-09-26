import type { Metadata } from "next";
import { DealFlowView } from "@/components/views/DealFlowView";

export const metadata: Metadata = { title: "Deal Flow · Castle" };
export const revalidate = 3600;

export default function Page() {
  return <DealFlowView />;
}
