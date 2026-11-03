/**
 * How fresh the data is, shared by the terminal's live pill (components/shell/LiveStatus.tsx) and the landing page's
 * live line (components/landing/LandingLive.tsx). Both start their clock only after hydration: never on the server.
 */

/**
 * Full ingest runs every 6 hours (and hourly on weekdays): data older than this means updates have stopped, and the
 * live indicators say "Delayed" instead of "Live".
 */
export const STALE_AFTER_MS = 8 * 3_600_000;

const NEW_YORK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The calendar day the data is as of, in New York, the zone its label uses: a run at 22:08 ET is already tomorrow in UTC, and
 * "Jan 1 – Nov 3" beside "Nov 2 · 22:08 ET" would be a day ahead of every deal in the data.
 */
export function dataDay(asOf: string): string {
  const at = new Date(asOf);
  if (asOf.length <= 10 || Number.isNaN(at.getTime())) return asOf.slice(0, 10);
  const part = (type: string) => NEW_YORK.formatToParts(at).find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** "just now", "12 min ago", "3h 5m ago", "2d ago". */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60 ? `${m % 60}m ` : ""}ago` : `${Math.floor(h / 24)}d ago`;
}
