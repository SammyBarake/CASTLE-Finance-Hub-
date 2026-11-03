import { getHubData } from "@/lib/data";
import { dataDay } from "@/lib/freshness";
import { buildVolumeMatrix } from "@/lib/metrics";
import { emptyPlateSvg, plateSeries, plateSvg, rosetteSvg } from "@/lib/plate";

const svgResponse = (body: string, cacheControl: string) =>
  new Response(body, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": cacheControl,
      // Art for the landing page, not a page for search results.
      "X-Robots-Tag": "noindex",
    },
  });

/**
 * The landing page's plate as an image (lib/plate.ts). ?v= is the data's own time, so a new dataset is a new URL and the
 * CDN keeps each one; it reads the cached dataset (no database read per request). ?d=phone is a lighter cut, ?d=rosette
 * and ?d=rosette-phone the lace layer alone (no data, so kept for a year). With no data the dial still draws, chartless.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const d = params.get("d");
  if (d === "rosette" || d === "rosette-phone") return svgResponse(rosetteSvg(d === "rosette" ? "full" : "phone"), "public, max-age=31536000, immutable");
  const data = await getHubData();
  if (data.dataError || !data.asOf) return svgResponse(emptyPlateSvg(), "public, max-age=60, s-maxage=60");
  const series = plateSeries(buildVolumeMatrix(data.monthlyVolume, dataDay(data.asOf).slice(0, 7)));
  // A page older than the data asks with its own version: answer, but don't keep this picture under that name for long.
  const current = params.get("v") === data.asOf;
  return svgResponse(plateSvg(series, d === "phone" ? "phone" : "full"), current ? "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" : "public, max-age=60, s-maxage=60");
}
