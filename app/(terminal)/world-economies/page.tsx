import type { Metadata } from "next";
import { EconomiesView } from "@/components/views/EconomiesView";

export const metadata: Metadata = { title: "World Economies · Castle" };
export const revalidate = 900;

export default function Page() {
  return <EconomiesView />;
}
