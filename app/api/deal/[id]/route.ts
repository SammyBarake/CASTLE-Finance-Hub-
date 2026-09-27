import { getDeal } from "@/lib/data";

/**
 * Full record for one deal (including fairness opinions), loaded when the deal drawer needs it.
 * The page feed leaves the heavy detail out so thousands of deals stay light.
 */
export const revalidate = 900;

export function generateStaticParams() {
  return [];
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const deal = await getDeal(decodeURIComponent((await params).id));
  if (!deal) return Response.json({ error: "Deal not found" }, { status: 404 });
  return Response.json(deal, { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" } });
}
