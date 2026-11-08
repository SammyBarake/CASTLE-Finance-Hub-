/** The site's own domain (bought November 2026); castle-finance-hub.vercel.app redirects to it. */
export const SITE_DOMAIN = "castleterminal.com";

/**
 * The site's public address, for absolute URLs in link previews, the sitemap, robots.txt and canonical tags: the domain in
 * production, NEXT_PUBLIC_SITE_URL to override, and a preview deployment's or the local server's own address otherwise.
 */
export const SITE_URL = (
  // || not ??: .env.example ships it blank, and a blank metadataBase is a 500 on every page.
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_ENV === "production" ? `https://${SITE_DOMAIN}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

/** The public source repository (the site is built in the open). */
export const REPO_URL = "https://github.com/SammyBarake/CASTLE-Finance-Hub-";

/** Where visitors report a wrong figure (NEXT_PUBLIC_CONTACT_EMAIL overrides; empty falls back to a GitHub issue). */
export const CONTACT_EMAIL: string | null = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? `hello@${SITE_DOMAIN}`;

export function reportIssueUrl(subject = "Data issue on Castle", body = ""): string {
  if (CONTACT_EMAIL) return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
  return `${REPO_URL}/issues/new?title=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
}
