import type { Metadata } from "next";
import { TermsView } from "@/components/views/InfoViews";

export const metadata: Metadata = { title: "Terms of Use · Castle", description: "Castle's terms of use: informational only, not investment advice, no guarantee of accuracy." };

export default function Page() {
  return <TermsView />;
}
