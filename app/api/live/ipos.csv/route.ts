import { getHubData } from "@/lib/data";
import { csvResponse, iposForQuery, iposTable, unavailableResponse } from "@/lib/live";

// The IPO pipeline as a live CSV (?stage=, ?sector=, ?bank=, ?min= in $M, ?sort=raise; as filtered on /ipo-pipeline).
export async function GET(request: Request) {
  const data = await getHubData();
  if (data.dataError) return unavailableResponse(data.dataError);
  return csvResponse(iposTable(iposForQuery(data.ipos, new URL(request.url).searchParams)), "castle-ipo-pipeline.csv", data);
}
