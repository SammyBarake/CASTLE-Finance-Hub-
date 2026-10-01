import { getHubData } from "@/lib/data";

// The full dataset, fetched once per visit by HubDataProvider and kept in memory. A static route regenerated
// every 5 minutes and served compressed from the CDN.
// Browsers keep it 10 minutes, then may show the stored copy instantly while fetching a newer one in the
// background, so a full page load (or a return visit) never waits for this download again. New data still
// arrives within minutes through LiveUpdates.
export const revalidate = 300;

export async function GET() {
  const data = await getHubData();
  return Response.json(data, { headers: { "Cache-Control": "public, max-age=600, s-maxage=300, stale-while-revalidate=604800" } });
}
