import { getHubData } from "@/lib/data";
import { csvResponse, precedentsForQuery, precedentsTable, unavailableResponse } from "@/lib/live";

// A Precedents screen as a live CSV: /precedents?<same query>, with ?deal= and the unticked outliers (?x=).
export async function GET(request: Request) {
  const data = await getHubData();
  if (data.dataError) return unavailableResponse(data.dataError);
  const url = new URL(request.url);
  return csvResponse(precedentsTable(precedentsForQuery(data.deals, url.searchParams, data.asOf), url.origin), "castle-precedents.csv", data);
}
