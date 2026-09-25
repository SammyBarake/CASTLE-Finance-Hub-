import "server-only";
import { sampleHubData } from "./sampleData";
import type { HubData } from "./types";

/**
 * The single entry point the UI uses to get data.
 *
 * Task 2 replaces the body with Supabase queries that return the same HubData
 * shape (and sets isSample to false). No component should need to change.
 */
export async function getHubData(): Promise<HubData> {
  return sampleHubData;
}
