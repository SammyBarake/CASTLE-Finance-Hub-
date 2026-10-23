import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // The JSON feeds are for the pages, not for search results; nor is the sign-in return page. The live CSV links are
  // allowed (the longer rule wins) so spreadsheet importers that honour robots.txt can fetch them; they send noindex.
  return { rules: { userAgent: "*", allow: ["/", "/api/live/"], disallow: ["/api/", "/auth/"] }, sitemap: `${SITE_URL}/sitemap.xml` };
}
