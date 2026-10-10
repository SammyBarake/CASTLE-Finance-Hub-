import { formatDateLong, formatPct, formatUsd } from "@/lib/format";
import { getDeal } from "@/lib/data";
import { OG_SIZE, ogCard } from "@/lib/ogCard";

// The preview a shared deal link shows: the parties, value, premium and status.
export const alt = "Deal summary from Castle";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 900;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const deal = await getDeal(decodeURIComponent((await params).id));
  if (!deal) return ogCard({ kicker: "Castle · M&A", title: "Deal not found" });
  return ogCard({
    kicker: `M&A · ${deal.sector}`,
    title: `${deal.acquirer.name} → ${deal.target.name}`,
    subtitle: `Announced ${formatDateLong(deal.announcedDate)}`,
    stats: [
      { label: "Deal value", value: formatUsd(deal.valueUsd) },
      { label: "Premium", value: formatPct(deal.premiumPct) },
      { label: "Status", value: deal.status },
      ...(deal.evEbitda != null ? [{ label: "EV / EBITDA", value: `${deal.evEbitda.toFixed(1)}x` }] : []),
    ],
  });
}
