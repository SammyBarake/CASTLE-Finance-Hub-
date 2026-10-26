import { AUTH_ENABLED } from "@/components/account/client";
import { LandingView } from "@/components/landing/LandingView";
import { getHubData } from "@/lib/data";
import { landingFigures } from "@/lib/landing";

// The same cached entries the terminal reads (no extra database read); the 60 s meta cache in lib/data.ts caps this.
export const revalidate = 900;

/**
 * The landing page at "/", outside the terminal shell (the Hub lives at /hub). Its figures are computed here and
 * passed down as a few strings: never pass HubData to a component, and never call preloadHubData() on this page.
 * Importing client.ts is safe: supabase-js loads only inside getClient(), which this page never calls.
 */
export default async function Page() {
  return <LandingView figures={landingFigures(await getHubData())} authEnabled={AUTH_ENABLED} />;
}
