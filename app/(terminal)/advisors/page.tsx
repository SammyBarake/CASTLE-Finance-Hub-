import type { Metadata } from "next";
import { AdvisorsView } from "@/components/views/AdvisorsView";

export const metadata: Metadata = { title: "Advisors · Castle" };
export const revalidate = 900;

export default function Page() {
  return <AdvisorsView />;
}
