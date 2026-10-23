import { getHubData } from "@/lib/data";
import { csvResponse, leagueForQuery, leagueTable, unavailableResponse } from "@/lib/live";

// The advisers' league table as a live CSV (?sort=deals ranks by deal count, as on /advisors).
export async function GET(request: Request) {
  const data = await getHubData();
  if (data.dataError) return unavailableResponse(data.dataError);
  return csvResponse(leagueTable(leagueForQuery(data.leagueTable.entries, new URL(request.url).searchParams)), "castle-league-table.csv", data);
}
