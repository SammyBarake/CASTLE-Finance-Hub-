import { findCompany } from "@/lib/companies";
import { getHubData } from "@/lib/data";
import { formatUsd } from "@/lib/format";
import { OG_SIZE, ogCard } from "@/lib/ogCard";

// The preview a shared company link shows: who it is and its deal record.
export const alt = "Company profile from Castle";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 900;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const profile = findCompany(await getHubData(), decodeURIComponent((await params).id));
  if (!profile) return ogCard({ kicker: "Castle · Company", title: "Company not found" });
  const bought = profile.deals.filter((d) => d.role === "Acquirer").length;
  const sold = profile.deals.find((d) => d.role === "Target");
  return ogCard({
    kicker: ["Company", profile.company.ticker, profile.sector].filter(Boolean).join(" · "),
    title: profile.company.name,
    subtitle: profile.latestActivity?.label,
    // A buyer shows its record; a company being (or already) bought shows that sale.
    stats: [
      ...(sold
        ? [
            { label: sold.deal.status === "Closed" ? "Acquired by" : "Being bought by", value: sold.deal.acquirer.name.slice(0, 22) },
            { label: "Deal value", value: formatUsd(sold.deal.valueUsd) },
            { label: "Status", value: sold.deal.status },
          ]
        : []),
      ...(bought || !sold ? [{ label: "Acquisitions", value: String(bought) }, { label: "Value acquired", value: bought ? formatUsd(profile.acquiredValueUsd) : "—" }] : []),
      ...(profile.ipos.length ? [{ label: "IPO", value: profile.ipos[0].stage }] : []),
    ],
  });
}
