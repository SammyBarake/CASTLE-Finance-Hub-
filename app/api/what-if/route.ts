import { getWhatIfData } from "@/lib/whatIfData";

// Baselines and IPO-history status for the what-if screen, from the history tables (sector_monthly). The history
// changes once a month, so an hourly regeneration is plenty; the page works without it (percentages only).
export const revalidate = 3600;

export async function GET() {
  const data = await getWhatIfData();
  return Response.json(data, { headers: { "Cache-Control": "public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400" } });
}
