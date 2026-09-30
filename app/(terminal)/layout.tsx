import type { ReactNode } from "react";
import { HubDataProvider } from "@/components/data/HubDataProvider";
import { LiveUpdates } from "@/components/data/LiveUpdates";
import { AppShell } from "@/components/shell/AppShell";
import { UiProvider } from "@/components/ui/UiProvider";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import { getHubData } from "@/lib/data";

// Rebuild pages at most every 15 minutes; the ingest job refreshes the data every 3 hours.
export const revalidate = 900;

/** Every terminal page shares one data load, the shell (sidebar / top bar) and the dialog layer. */
export default async function TerminalLayout({ children }: { children: ReactNode }) {
  const data = await getHubData();
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
