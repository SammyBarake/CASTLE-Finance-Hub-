import type { ReactNode } from "react";
import { HubDataProvider } from "@/components/data/HubDataProvider";
import { AppShell } from "@/components/shell/AppShell";
import { UiProvider } from "@/components/ui/UiProvider";
import { getHubData } from "@/lib/data";

// Rebuild pages at most once an hour; the ingest job refreshes the data twice a day.
export const revalidate = 3600;

/** Every terminal page shares one data load, the shell (sidebar / top bar) and the dialog layer. */
export default async function TerminalLayout({ children }: { children: ReactNode }) {
  const data = await getHubData();
  return (
    <HubDataProvider data={data}>
      <UiProvider>
        <AppShell>{children}</AppShell>
      </UiProvider>
    </HubDataProvider>
  );
}
