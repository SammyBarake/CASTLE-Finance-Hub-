import { latestAsOf } from "@/lib/data";

// When the database was last refreshed. Open tabs poll this (LiveUpdates) to know when to pull new data.
// A plain GET outside the router queue, so a slow answer can never hold up a click.
export const dynamic = "force-dynamic";

export async function GET() {
  const asOf = await latestAsOf();
  return Response.json({ asOf }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
}
