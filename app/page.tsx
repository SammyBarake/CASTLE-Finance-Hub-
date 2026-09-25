import { Hub } from "@/components/hub/Hub";
import { UiProvider } from "@/components/ui/UiProvider";
import { getHubData } from "@/lib/data";

export default async function HomePage() {
  const data = await getHubData();
  return (
    <UiProvider>
      <Hub data={data} />
    </UiProvider>
  );
}
