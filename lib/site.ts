/**
 * The site's public address, for absolute URLs in link previews, the sitemap and robots.txt. Set NEXT_PUBLIC_SITE_URL
 * once a custom domain exists; on Vercel the production domain is known without it.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/$/, "");
