import type { Metadata } from "next";
import { TimelinesView } from "@/components/views/TimelinesView";

export const metadata: Metadata = { title: "Timelines · Castle" };
export const revalidate = 900;

export default function Page() {
  return <TimelinesView />;
}
