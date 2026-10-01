import { getHubData } from "@/lib/data";

// The full dataset, fetched once per visit by HubDataProvider and kept in memory. A static route regenerated
// every 2 minutes and served compressed from the CDN.
// Browsers keep it 10 minutes, then may show the stored copy instantly while fetching a newer one in the
// background, so a full page load (or a return visit) never waits for this download again. Open tabs still
// get new data within a couple of minutes of an ingest: HubDataProvider checks /api/freshness every 30 seconds
// and re-fetches this with a cache-busting query.
export const revalidate = 120;

export async function GET() {
  const data = await getHubData();
  return Response.json(data, { headers: { "Cache-Control": "public, max-age=600, s-maxage=120, stale-while-revalidate=604800" } });
}
