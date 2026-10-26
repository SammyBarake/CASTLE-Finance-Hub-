import type { Metadata } from "next";
import { HubView } from "@/components/views/HubView";

export const metadata: Metadata = { title: "Hub · Castle" };
export const revalidate = 900;

export default function Page() {
  return <HubView />;
}
