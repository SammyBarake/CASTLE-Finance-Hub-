import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // The JSON feeds are for the pages, not for search results; nor is the sign-in return page.
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }, sitemap: `${SITE_URL}/sitemap.xml` };
}
