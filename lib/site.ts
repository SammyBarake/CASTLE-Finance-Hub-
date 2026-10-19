/**
 * The site's public address, for absolute URLs in link previews, the sitemap and robots.txt. Set NEXT_PUBLIC_SITE_URL
 * once a custom domain exists; on Vercel the production domain is known without it.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

/** The public source repository (the site is built in the open). */
export const REPO_URL = "https://github.com/SammyBarake/CASTLE-Finance-Hub-";

/**
 * Where visitors report a wrong figure: an e-mail once NEXT_PUBLIC_CONTACT_EMAIL is set, else a new issue on the public
 * repository (needs a GitHub account, so set the e-mail before launch).
 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || null;

export function reportIssueUrl(subject = "Data issue on Castle", body = ""): string {
  if (CONTACT_EMAIL) return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
  return `${REPO_URL}/issues/new?title=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
}
