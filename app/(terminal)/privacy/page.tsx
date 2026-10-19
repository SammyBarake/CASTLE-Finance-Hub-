import type { Metadata } from "next";
import { PrivacyView } from "@/components/views/InfoViews";

export const metadata: Metadata = { title: "Privacy · Castle", description: "Castle has no accounts, sets no cookies and runs no trackers; your workspace stays in your browser." };

export default function Page() {
  return <PrivacyView />;
}
