import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DealTearSheet } from "@/components/tearsheet/DealTearSheet";
import { SheetToolbar } from "@/components/tearsheet/SheetToolbar";
import { getDeal, getHubData } from "@/lib/data";

export const revalidate = 900;

// Rendered on first visit, then cached like the terminal pages.
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const deal = await getDeal(decodeURIComponent((await params).id));
  return { title: deal ? `${deal.target.name} · Tear sheet · Castle` : "Tear sheet · Castle" };
}

export default async function Page({ params }: Props) {
  const id = decodeURIComponent((await params).id);
  const [deal, data] = await Promise.all([getDeal(id), getHubData()]);
  if (!deal) notFound();
  return (
    <>
      <SheetToolbar backHref="/deal-flow" backLabel="Deal Flow" />
      <DealTearSheet deal={deal} data={data} />
    </>
  );
}
