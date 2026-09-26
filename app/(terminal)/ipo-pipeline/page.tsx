import type { Metadata } from "next";
import { IpoView } from "@/components/views/IpoView";

export const metadata: Metadata = { title: "IPO Pipeline · Castle" };
export const revalidate = 3600;

export default function Page() {
  return <IpoView />;
}
