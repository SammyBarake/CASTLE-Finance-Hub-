import type { Metadata } from "next";
import { CompanyView } from "@/components/views/CompanyView";
import { companyHref, findCompany } from "@/lib/companies";
import { getHubData } from "@/lib/data";
import { preloadHubData } from "@/components/data/preloadHubData";

export const revalidate = 900;

// No pages at build time; each company page is rendered on first visit, then cached for 15 minutes.
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = decodeURIComponent((await params).id);
  const profile = findCompany(await getHubData(), id);
  // No such company: the page says so (with a 200, it renders in the browser), so it mustn't be indexed under that address.
  if (!profile) return { title: "Company · Castle", robots: { index: false, follow: false }, alternates: null };
  const bought = profile.deals.filter((d) => d.role === "Acquirer").length;
  const description = [profile.company.ticker, profile.sector, `${bought} acquisition${bought === 1 ? "" : "s"} tracked`, profile.latestActivity?.label].filter(Boolean).join(" · ");
  return {
    title: `${profile.company.name} · Castle`,
    description,
    // One company can be reached by several addresses (its CIK, padded or not, or its name): this is the one it links to.
    alternates: { canonical: companyHref(profile.company) },
    openGraph: { title: profile.company.name, description },
    twitter: { card: "summary_large_image", title: profile.company.name, description },
  };
}

export default async function Page({ params }: Props) {
  preloadHubData({ details: true }); // this page needs the dataset and its details before it can show anything
  const { id } = await params;
  return <CompanyView id={decodeURIComponent(id)} />;
}
