import { getHubData } from "@/lib/data";
import { landingFigures } from "@/lib/landing";
import { OG_SIZE, ogCard } from "@/lib/ogCard";

// The default link preview for every page without its own (the landing page, the Hub, …), with live figures.
export const alt = "Castle: U.S. M&A, IPOs and advisers from SEC filings";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  // Live figures only (the same as the landing page's); sample data, an outage or an error keep the plain card.
  let stats: { label: string; value: string }[] = [];
  try {
    const figures = landingFigures(await getHubData());
    if (figures.state === "live") stats = figures.ogStats;
  } catch {
    /* the plain card */
  }
  return ogCard({ kicker: "Castle", title: "Investment banking intelligence", subtitle: "U.S. M&A, IPOs, advisers and valuations from SEC EDGAR", stats });
}
