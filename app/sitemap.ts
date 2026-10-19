import type { MetadataRoute } from "next";
import { INFO_ROUTES, ROUTES } from "@/components/shell/routes";
import { companyHref, hasCompanyPage } from "@/lib/companies";
import { getHubData } from "@/lib/data";
import { SITE_URL } from "@/lib/site";

// Every terminal page, every company page and every deal tear sheet, so search engines can find them.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await getHubData();
  const lastModified = new Date(data.asOf);
  const pages = ROUTES.map((r) => ({ url: `${SITE_URL}${r.href}`, lastModified, changeFrequency: "hourly" as const, priority: r.href === "/" ? 1 : 0.8 }));
  const info = INFO_ROUTES.map((r) => ({ url: `${SITE_URL}${r.href}`, lastModified, changeFrequency: "monthly" as const, priority: r.id === "about" ? 0.6 : 0.2 }));
  const companies = new Map<string, Date>();
  for (const d of data.deals)
    for (const c of [d.acquirer, d.target]) if (hasCompanyPage(c)) companies.set(companyHref(c), new Date(Math.max(companies.get(companyHref(c))?.getTime() ?? 0, Date.parse(d.statusDate ?? d.announcedDate))));
  for (const i of data.ipos) if (hasCompanyPage(i.company)) companies.set(companyHref(i.company), new Date(i.pricedDate ?? i.filedDate));
  const companyPages = [...companies].map(([href, date]) => ({ url: `${SITE_URL}${href}`, lastModified: date, changeFrequency: "daily" as const, priority: 0.5 }));
  const sheets = data.deals.map((d) => ({ url: `${SITE_URL}/tearsheet/deal/${encodeURIComponent(d.id)}`, lastModified: new Date(d.statusDate ?? d.announcedDate), changeFrequency: "weekly" as const, priority: 0.4 }));
  return [...pages, ...info, ...companyPages, ...sheets];
}
