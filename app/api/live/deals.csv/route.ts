import { getHubData } from "@/lib/data";
import { csvResponse, dealsForQuery, dealsTable, unavailableResponse } from "@/lib/live";

// Deal Flow as a live CSV for Excel and Google Sheets, filtered like /deal-flow?<same query> (lib/live.ts).
export async function GET(request: Request) {
  const data = await getHubData();
  if (data.dataError) return unavailableResponse(data.dataError);
  const url = new URL(request.url);
  return csvResponse(dealsTable(dealsForQuery(data.deals, url.searchParams, data.asOf), url.origin), "castle-deal-flow.csv", data);
}
