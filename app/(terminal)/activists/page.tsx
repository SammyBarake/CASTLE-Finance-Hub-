import type { Metadata } from "next";
import { ActivistsView } from "@/components/views/ActivistsView";

export const metadata: Metadata = { title: "Activists · Castle" };
export const revalidate = 3600;

export default function Page() {
  return <ActivistsView />;
}
