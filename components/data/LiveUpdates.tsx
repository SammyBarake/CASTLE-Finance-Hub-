"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { checkForUpdates } from "@/app/actions/freshness";
import { useHubData } from "@/components/data/HubDataProvider";

const EVERY_MS = 60_000;

/**
 * Keeps an open tab current without a manual refresh, silently: checks right away (a cached page can be a few
 * hours old) and then every minute while the tab is visible. When the ingest has written newer data, the page
 * re-renders in the background (no reload: filters, scroll and open drawers stay), charts ease to their new
 * values and KPI figures count to theirs (AnimatedNumber).
 */
export function LiveUpdates() {
  const { data } = useHubData();
  const router = useRouter();
  const asOf = useRef(data.asOf);
  const pending = useRef(false);

  useEffect(() => {
    asOf.current = data.asOf;
  }, [data.asOf]);

  useEffect(() => {
    if (data.isSample) return;
    const check = async () => {
      if (document.visibilityState !== "visible" || pending.current) return;
      pending.current = true;
      try {
        // The Server Function re-renders this page when it revalidates; refresh() covers a throttled call.
        if ((await checkForUpdates(asOf.current)) === "stale") router.refresh();
      } catch {
        // Offline or a deploy in progress: try again next time.
      } finally {
        pending.current = false;
      }
    };
    check();
    const timer = setInterval(check, EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [data.isSample, router]);

  return null;
}
