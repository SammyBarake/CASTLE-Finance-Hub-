import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyTearSheet } from "@/components/tearsheet/CompanyTearSheet";
import { SheetToolbar } from "@/components/tearsheet/SheetToolbar";
import { findCompany } from "@/lib/companies";
import { getHubData } from "@/lib/data";

export const revalidate = 900;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = findCompany(await getHubData(), decodeURIComponent((await params).id));
  return { title: profile ? `${profile.company.name} · Tear sheet · Castle` : "Tear sheet · Castle" };
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
