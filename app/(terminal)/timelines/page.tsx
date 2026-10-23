import type { Metadata } from "next";
import { TimelinesView } from "@/components/views/TimelinesView";
import { preloadHubData } from "@/components/data/preloadHubData";

export const metadata: Metadata = { title: "Timelines · Castle" };
export const revalidate = 900;

export default function Page() {
  preloadHubData(); // this page needs the full dataset before it can show anything
  return <TimelinesView />;
}
