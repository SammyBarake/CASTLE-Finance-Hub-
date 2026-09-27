import type { Metadata } from "next";
import { CompanyView } from "@/components/views/CompanyView";
import { findCompany } from "@/lib/companies";
import { getHubData } from "@/lib/data";

export const revalidate = 3600;

// No pages at build time; each company page is rendered on first visit, then cached for an hour.
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = decodeURIComponent((await params).id);
  const profile = findCompany(await getHubData(), id);
  return { title: `${profile?.company.name ?? "Company"} · Castle` };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <CompanyView id={decodeURIComponent(id)} />;
}
