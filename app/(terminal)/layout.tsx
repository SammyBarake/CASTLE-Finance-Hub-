import type { ReactNode } from "react";
import { HubDataProvider } from "@/components/data/HubDataProvider";
import { LiveUpdates } from "@/components/data/LiveUpdates";
import { AppShell } from "@/components/shell/AppShell";
import { UiProvider } from "@/components/ui/UiProvider";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { bootHubData } from "@/lib/aggregate";
import { getHubData } from "@/lib/data";

// Rebuild pages at most every 15 minutes; the ingest job refreshes the data every 3 hours.
export const revalidate = 900;

/**
 * Every terminal page shares the shell (sidebar / top bar), the dialog layer and one dataset. Pages carry only a
 * small boot copy of the data; the full dataset loads once per visit from /api/hub (see HubDataProvider).
 */
export default async function TerminalLayout({ children }: { children: ReactNode }) {
  const data = bootHubData(await getHubData());
  return (
    <HubDataProvider data={data}>
      <WorkspaceProvider>
        <UiProvider>
          <AppShell>{children}</AppShell>
          <LiveUpdates />
        </UiProvider>
      </WorkspaceProvider>
    </HubDataProvider>
  );
}
