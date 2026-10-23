import type { Metadata } from "next";
import { IpoView } from "@/components/views/IpoView";
import { preloadHubData } from "@/components/data/preloadHubData";

export const metadata: Metadata = { title: "IPO Pipeline · Castle" };
export const revalidate = 900;

export default function Page() {
  preloadHubData(); // this page needs the full dataset before it can show anything
  return <IpoView />;
}
