"use client";

import { useEffect, useRef } from "react";
import { useHubData } from "@/components/data/HubDataProvider";

const EVERY_MS = 60_000;
/** Reload attempts per new dataset: the cached /api/hub copy may take a few minutes to catch up. */
const MAX_TRIES = 4;

/**
 * Keeps an open tab current without a manual refresh, silently. Every minute (visible tabs only) it asks
 * /api/freshness when the database was last refreshed; if that's newer than the data in memory it reloads the
 * dataset in the background (no navigation: filters, scroll and drawers stay; KPIs count to their new values).
 *
 * It never invalidates the server's cache: an earlier version purged every cached page whenever it saw newer
 * data, which made each next click wait for a full rebuild.
 */
export function LiveUpdates() {
  const { data, ready, reload } = useHubData();
  const asOf = useRef(data.asOf);
  const tries = useRef<{ for: string; n: number }>({ for: "", n: 0 });

  useEffect(() => {
    asOf.current = data.asOf;
  }, [data.asOf]);

  useEffect(() => {
    if (data.isSample || !ready) return;
    let busy = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      try {
        const res = await fetch("/api/freshness", { cache: "no-store" });
        const { asOf: latest } = (await res.json()) as { asOf: string | null };
        if (!latest || Date.parse(latest) <= Date.parse(asOf.current)) return;
        if (tries.current.for !== latest) tries.current = { for: latest, n: 0 };
        if (tries.current.n >= MAX_TRIES) return;
        tries.current.n++;
        await reload();
      } catch {
        // Offline or a deploy in progress: try again next time.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [data.isSample, ready, reload]);

  return null;
}
