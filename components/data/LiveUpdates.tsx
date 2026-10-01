"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useHubData } from "@/components/data/HubDataProvider";

const EVERY_MS = 60_000;
/** Refresh attempts per new dataset: the cached page may take a minute or two to regenerate in the background. */
const MAX_TRIES = 4;

/**
 * Keeps an open tab current without a manual refresh, silently. Every minute (visible tabs only) it asks
 * /api/freshness when the database was last refreshed; if that's newer than this page's data it re-fetches the
 * page in the background (no reload: filters, scroll and drawers stay; KPIs count to their new values).
 *
 * It never invalidates the server's page cache: pages regenerate on their own schedule (every 15 minutes,
 * served instantly while they do), so nobody ever waits on a click. An earlier version purged every cached page
 * whenever it saw newer data, which made each next click wait for a full rebuild.
 */
export function LiveUpdates() {
  const { data } = useHubData();
  const router = useRouter();
  const asOf = useRef(data.asOf);
  const tries = useRef<{ for: string; n: number }>({ for: "", n: 0 });

  useEffect(() => {
    asOf.current = data.asOf;
  }, [data.asOf]);

  useEffect(() => {
    if (data.isSample) return;
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
        startTransition(() => router.refresh());
      } catch {
        // Offline or a deploy in progress: try again next time.
      } finally {
        busy = false;
      }
    };
    // First look shortly after load, once the page has settled.
    const first = setTimeout(check, 8_000);
    const timer = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [data.isSample, router]);

  return null;
}
