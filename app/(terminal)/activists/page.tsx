import type { Metadata } from "next";
import { ActivistsView } from "@/components/views/ActivistsView";
import { preloadHubData } from "@/components/data/preloadHubData";

export const metadata: Metadata = { title: "Activists · Castle" };
export const revalidate = 900;

export default function Page() {
  preloadHubData({ details: true }); // this page needs the dataset and its details before it can show anything
  return <ActivistsView />;
}
