import type { Metadata } from "next";
import { DealTermsView } from "@/components/views/DealTermsView";

export const metadata: Metadata = { title: "Deal Terms · Castle" };
export const revalidate = 900;

export default function Page() {
  return <DealTermsView />;
}
