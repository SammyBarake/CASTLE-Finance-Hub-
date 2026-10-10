import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DealTearSheet } from "@/components/tearsheet/DealTearSheet";
import { SheetToolbar } from "@/components/tearsheet/SheetToolbar";
import { getDeal, getHubData } from "@/lib/data";
import { formatDateLong, formatPct, formatUsd } from "@/lib/format";

export const revalidate = 900;

// Rendered on first visit, then cached like the terminal pages.
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const deal = await getDeal(decodeURIComponent((await params).id));
  if (!deal) return { title: "Tear sheet · Castle" };
  const title = `${deal.acquirer.name} → ${deal.target.name}`;
  const description = [
    `Announced ${formatDateLong(deal.announcedDate)}`,
    deal.valueUsd != null ? `${formatUsd(deal.valueUsd)} deal value` : null,
    deal.premiumPct != null ? `${formatPct(deal.premiumPct)} premium` : null,
    deal.status,
  ]
    .filter(Boolean)
    .join(" · ");
  return { title: `${deal.target.name} · Tear sheet · Castle`, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
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
