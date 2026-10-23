import { getHubData } from "@/lib/data";
import { hubDetails } from "@/lib/wire";

// The second download (lib/wire.ts): per-deal details (deal protections, buyer reactions, the banks' DCFs, filing
// milestones), activist stakes and advisory fees. Cached like /api/hub.
export const revalidate = 120;

export async function GET() {
  const data = await getHubData();
  return Response.json(hubDetails(data), { headers: { "Cache-Control": "public, max-age=600, s-maxage=120, stale-while-revalidate=604800" } });
}
