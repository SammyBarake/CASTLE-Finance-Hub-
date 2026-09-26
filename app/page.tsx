import { Hub } from "@/components/hub/Hub";
import { UiProvider } from "@/components/ui/UiProvider";
import { getHubData } from "@/lib/data";

// Rebuild the page at most once an hour; the ingest job refreshes the data twice a day.
export const revalidate = 3600;

export default async function HomePage() {
  const data = await getHubData();
  return (
    <UiProvider>
      <Hub data={data} />
    </UiProvider>
  );
}
