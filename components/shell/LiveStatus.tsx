"use client";

import { useEffect, useState } from "react";
import { useHubData } from "@/components/data/HubDataProvider";
import { formatTimestampET } from "@/lib/format";
import { ago, STALE_AFTER_MS } from "@/lib/freshness";

/**
 * The top bar's live indicator: when the data was last refreshed (ticking forward), a pulse each time the tab
 * checks for new filings, and a brief flash saying what arrived ("2 new deals") when an update lands.
 */
export function LiveStatus() {
  const { data, freshness } = useHubData();
  // No clock on the server: the page is rendered ahead of time, so "N min ago" would differ from the browser's and
  // break hydration (React error #418). The relative time appears once the page runs in the browser.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now()); // eslint-disable-line react-hooks/set-state-in-effect -- start the clock after hydration
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [freshness.checkedAt, data.asOf]); // eslint-disable-line react-hooks/set-state-in-effect -- refresh the label on news

  const justUpdated = now != null && freshness.updatedAt != null && now - freshness.updatedAt < 8_000;
  // Say what arrived: "2 new deals", "1 new IPO", or just "Updated" (statuses and figures changed).
  const plural = (n: number, w: string) => `${n} new ${w}${n === 1 ? "" : "s"}`;
  const newDeals = freshness.freshIds.size ? data.deals.filter((d) => freshness.freshIds.has(d.id)).length : 0;
  const newIpos = freshness.freshIds.size ? data.ipos.filter((i) => freshness.freshIds.has(i.id)).length : 0;
  const news = newDeals ? plural(newDeals, "deal") : newIpos ? plural(newIpos, "IPO") : "Updated";
  const stale = now != null && !data.isSample && now - Date.parse(data.asOf) > STALE_AFTER_MS;
  const checked =
    now != null && freshness.checkedAt ? `Checked for new filings ${ago(now - freshness.checkedAt)} · every 30 seconds while this tab is open.` : "Checks for new filings every 30 seconds while this tab is open.";
  return (
    <div
      className={`live-status ${freshness.checking ? "checking" : ""} ${justUpdated ? "updated" : ""} ${stale && !justUpdated ? "stale" : ""}`}
      title={`SEC EDGAR data, last refreshed ${formatTimestampET(data.asOf)}.${stale ? " Updates normally arrive at least every 6 hours: this one is late." : ""} ${checked}`}
      aria-live="polite"
    >
      <i aria-hidden="true" />
      {justUpdated ? news : stale ? "Delayed" : "Live"}
      <span>{now != null ? `updated ${ago(now - Date.parse(data.asOf))}` : " "}</span>
    </div>
  );
}
