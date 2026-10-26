"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ago, STALE_AFTER_MS } from "@/lib/freshness";

/**
 * The landing page's only client island: "Live data · updated 12 min ago". No clock on the server (the page is
 * rendered ahead of time, so a relative time would break hydration): the server HTML and the first render say "as of"
 * the data's own time, and the relative time starts after hydration. No aria-live, so screen readers don't hear it tick.
 *
 * The label always describes the figures on screen (the page's own asOf). A cached copy of the page can be older than
 * the data, so it asks once (edge-cached 30 s, same origin, no cookies); when the data is newer, the page re-renders on
 * the server (router.refresh), and the figures, the latest deals and this label move together. Never a newer time
 * beside older figures, and never a tear-sheet link to a deal a later run removed.
 */
export function LandingLive({ asOf, asOfLabel }: { asOf: string; asOfLabel: string }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const refreshed = useRef(false);

  useEffect(() => {
    setNow(Date.now()); // eslint-disable-line react-hooks/set-state-in-effect -- start the clock after hydration
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (refreshed.current) return;
    const ctrl = new AbortController();
    fetch("/api/freshness", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { asOf?: string | null } | null) => {
        if (j?.asOf && Date.parse(j.asOf) > Date.parse(asOf) && !refreshed.current) {
          refreshed.current = true; // once per visit: the regenerated page may take a moment to be served
          router.refresh();
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [asOf, router]);

  const age = now == null ? null : now - Date.parse(asOf);
  const stale = age != null && age > STALE_AFTER_MS;
  return (
    <p className={`landing-live${stale ? " stale" : ""}`} title={`SEC EDGAR data, last refreshed ${asOfLabel}.`}>
      <span className="whatif-meta-dot" aria-hidden="true" />
      {stale ? "Delayed" : "Live data"} · {age == null ? `as of ${asOfLabel}` : `updated ${ago(age)}`}
    </p>
  );
}
