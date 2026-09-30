"use server";

import { revalidatePath } from "next/cache";
import { latestAsOf } from "@/lib/data";

// At most one site-wide regeneration per 30 seconds per server instance, however many tabs ask.
let lastRevalidated = 0;

/**
 * Called by open tabs (LiveUpdates). If the database has been refreshed since the page was built, mark every
 * terminal page stale; because this runs as a Server Function, the calling tab re-renders with the new data
 * straight away. Only newer data can trigger a regeneration, so the check is safe to expose.
 */
export async function checkForUpdates(pageAsOf: string): Promise<"current" | "revalidated" | "stale"> {
  const pageTime = Date.parse(pageAsOf);
  if (!Number.isFinite(pageTime)) return "current";
  const latest = await latestAsOf();
  if (!latest || Date.parse(latest) <= pageTime) return "current";
  if (Date.now() - lastRevalidated > 30_000) {
    lastRevalidated = Date.now();
    revalidatePath("/", "layout");
    return "revalidated";
  }
  // Another tab just triggered the regeneration: the caller refreshes to pick it up.
  return "stale";
}
