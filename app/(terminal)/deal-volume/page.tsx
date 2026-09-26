import type { Metadata } from "next";
import { DealVolumeView } from "@/components/views/DealVolumeView";

export const metadata: Metadata = { title: "Deal Volume · Castle" };
export const revalidate = 3600;

export default function Page() {
  return <DealVolumeView />;
}
