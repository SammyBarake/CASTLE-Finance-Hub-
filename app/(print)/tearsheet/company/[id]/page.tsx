import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyTearSheet } from "@/components/tearsheet/CompanyTearSheet";
import { SheetToolbar } from "@/components/tearsheet/SheetToolbar";
import { companyHref, findCompany } from "@/lib/companies";
import { getHubData } from "@/lib/data";

export const revalidate = 900;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = findCompany(await getHubData(), decodeURIComponent((await params).id));
  // One company's sheet can be reached by several addresses, like its page: this is the one the page links to.
  return profile ? { title: `${profile.company.name} · Tear sheet · Castle`, alternates: { canonical: `/tearsheet${companyHref(profile.company)}` } } : { title: "Tear sheet · Castle", alternates: null };
}

export default async function Page({ params }: Props) {
  const raw = (await params).id;
  const data = await getHubData();
  const profile = findCompany(data, decodeURIComponent(raw));
  if (!profile) notFound();
  return (
    <>
      <SheetToolbar backHref={`/company/${raw}`} backLabel={profile.company.name} />
      <CompanyTearSheet profile={profile} data={data} />
    </>
  );
}
