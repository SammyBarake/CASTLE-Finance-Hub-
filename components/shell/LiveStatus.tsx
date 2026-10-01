"use client";

import { useEffect, useState } from "react";
import { useHubData } from "@/components/data/HubDataProvider";
import { formatTimestampET } from "@/lib/format";

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60 ? `${m % 60}m ` : ""}ago` : `${Math.floor(h / 24)}d ago`;
}

/**
 * The top bar's live indicator: when the data was last refreshed (ticking forward), a pulse each time the tab
 * checks for new filings, and a brief flash saying what arrived ("2 new deals") when an update lands.
 */
export function LiveStatus() {
  const { data, freshness } = useHubData();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [freshness.checkedAt, data.asOf]); // eslint-disable-line react-hooks/set-state-in-effect -- refresh the label on news

  const justUpdated = freshness.updatedAt != null && now - freshness.updatedAt < 8_000;
  // Say what arrived: "2 new deals", "1 new IPO", or just "Updated" (statuses and figures changed).
  const plural = (n: number, w: string) => `${n} new ${w}${n === 1 ? "" : "s"}`;
  const newDeals = freshness.freshIds.size ? data.deals.filter((d) => freshness.freshIds.has(d.id)).length : 0;
  const newIpos = freshness.freshIds.size ? data.ipos.filter((i) => freshness.freshIds.has(i.id)).length : 0;
  const news = newDeals ? plural(newDeals, "deal") : newIpos ? plural(newIpos, "IPO") : "Updated";
  const checked = freshness.checkedAt ? `Checked for new filings ${ago(now - freshness.checkedAt)} · every 30 seconds while this tab is open.` : "Checks for new filings every 30 seconds while this tab is open.";
  return (
    <div
      className={`live-status ${freshness.checking ? "checking" : ""} ${justUpdated ? "updated" : ""}`}
      title={`SEC EDGAR data, last refreshed ${formatTimestampET(data.asOf)}. ${checked}`}
      aria-live="polite"
    >
      <i aria-hidden="true" />
      {justUpdated ? news : "Live"}
      <span>updated {ago(now - Date.parse(data.asOf))}</span>
    </div>
  );
}
