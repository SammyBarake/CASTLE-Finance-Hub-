"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildVolumeMatrix, ipoPipelineSummary, medianPremium, ytdSummary, type VolumeMatrix, type YtdSummary } from "@/lib/metrics";
import type { HubData } from "@/lib/types";

/** How often an open tab asks whether the database has newer data. */
const CHECK_EVERY_MS = 30_000;
/** Reload attempts per new dataset: the cached /api/hub copy may take a few minutes to catch up. */
const MAX_TRIES = 6;
/** How long rows that arrived in an update stay highlighted. */
const FRESH_FOR_MS = 12_000;

export interface Freshness {
  /** When this tab last asked the server for news (ms since epoch), null before the first check. */
  checkedAt: number | null;
  /** A check is in flight. */
  checking: boolean;
  /** Ids of deals and IPOs that arrived in the most recent update (highlighted briefly). */
  freshIds: ReadonlySet<string>;
  /** When the most recent update landed in this tab. */
  updatedAt: number | null;
}

interface HubDataValue {
  data: HubData;
  /** False until the full dataset has loaded (pages show a skeleton until then). */
  ready: boolean;
  /** Set when the dataset could not be loaded after retries. */
  loadError: string | null;
  /** Fetch the dataset again, bypassing caches (a retry). */
  reload: () => Promise<string | null>;
  freshness: Freshness;
  matrix: VolumeMatrix;
  ytd: YtdSummary | null;
  medianPremiumPct: number | null;
  ipoSummary: { filedCount: number; expectedRaiseUsd: number };
}

const HubDataContext = createContext<HubDataValue | null>(null);
const NO_IDS: ReadonlySet<string> = new Set();

// Kept outside React so it survives anything that remounts the provider during a visit.
let memory: HubData | null = null;
let lastUpdateAt = 0;
/** True for a moment after new data arrived from the server (figures then flash up / down as they count). */
export const isLiveUpdate = () => Date.now() - lastUpdateAt < 2500;

async function fetchHub(bust: boolean): Promise<HubData> {
  const res = await fetch(bust ? `/api/hub?t=${Date.now()}` : "/api/hub", { cache: bust ? "no-store" : "default" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as HubData;
}

/**
 * The dataset for every page.
 *
 * - The layout passes a small "boot" copy (dates, totals, aggregates; no long lists) so the shell renders at
 *   once; the full dataset loads ONCE per visit from /api/hub (cached, compressed) and stays in memory, so
 *   page navigation never re-downloads it.
 * - While the tab is visible it asks /api/freshness every 30 seconds whether the database has newer data and,
 *   if so, swaps the new dataset in place: figures count to their new values, charts ease, new rows glow.
 *   It never invalidates the server's caches (an earlier version did, and every click then waited for a rebuild).
 */
export function HubDataProvider({ data: boot, children }: { data: HubData; children: ReactNode }) {
  const [full, setFull] = useState<HubData | null>(memory && memory.asOf >= boot.asOf ? memory : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Freshness>({ checkedAt: null, checking: false, freshIds: NO_IDS, updatedAt: null });
  const loading = useRef(false);
  const current = useRef<HubData | null>(full);
  const tries = useRef<{ for: string; n: number }>({ for: "", n: 0 });

  const apply = useCallback((next: HubData) => {
    const prev = current.current;
    if (prev && next.asOf !== prev.asOf) lastUpdateAt = Date.now();
    memory = next;
    current.current = next;
    setFull(next);
    setLoadError(null);
    if (prev && next.asOf !== prev.asOf) {
      // Remember what's new so lists can highlight it.
      const seen = new Set([...prev.deals.map((d) => d.id), ...prev.ipos.map((i) => i.id)]);
      const fresh = new Set([...next.deals.map((d) => d.id), ...next.ipos.map((i) => i.id)].filter((id) => !seen.has(id)));
      setFreshness((f) => ({ ...f, freshIds: fresh, updatedAt: Date.now() }));
    }
  }, []);

  const load = useCallback(
    async (bust: boolean) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const next = await fetchHub(bust || attempt > 0);
          apply(next);
          return next.asOf;
        } catch (err) {
          if (attempt === 2) setLoadError((err as Error).message);
          else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      return null;
    },
    [apply],
  );

  // First load.
  useEffect(() => {
    if (full || loading.current) return;
    loading.current = true;
    load(false).finally(() => (loading.current = false));
  }, [full, load]);

  // Keep checking while the tab is open and visible.
  const ready = !!full;
  useEffect(() => {
    if (!ready || boot.isSample) return;
    let busy = false;
    const check = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      setFreshness((f) => ({ ...f, checking: true }));
      try {
        const res = await fetch("/api/freshness", { cache: "no-store" });
        const { asOf: latest } = (await res.json()) as { asOf: string | null };
        const have = current.current?.asOf ?? boot.asOf;
        if (latest && Date.parse(latest) > Date.parse(have)) {
          if (tries.current.for !== latest) tries.current = { for: latest, n: 0 };
          if (tries.current.n < MAX_TRIES) {
            tries.current.n++;
            await load(true);
          }
        }
      } catch {
        // Offline or a deploy in progress: try again next time.
      } finally {
        busy = false;
        setFreshness((f) => ({ ...f, checking: false, checkedAt: Date.now() }));
      }
    };
    const first = setTimeout(check, 3_000);
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, [ready, boot.isSample, boot.asOf, load]);

  // New-row highlights fade after a few seconds.
  useEffect(() => {
    if (!freshness.freshIds.size) return;
    const t = setTimeout(() => setFreshness((f) => ({ ...f, freshIds: NO_IDS })), FRESH_FOR_MS);
    return () => clearTimeout(t);
  }, [freshness.freshIds]);

  const data = full ?? boot;
  const value = useMemo(() => {
    // The data's own month is still in progress: shown, but marked and kept out of month-on-month comparisons.
    const matrix = buildVolumeMatrix(data.monthlyVolume, data.asOf ? data.asOf.slice(0, 7) : null);
    return {
      data,
      ready: !!full,
      loadError,
      reload: () => load(true),
      freshness,
      matrix,
      ytd: ytdSummary(matrix, data.yearToDate),
      // The latest 25 deals that disclose a premium (private-company deals never do).
      medianPremiumPct: medianPremium(data.deals.filter((d) => d.premiumPct != null).slice(0, 25)),
      ipoSummary: ipoPipelineSummary(data.ipos),
    };
  }, [data, full, loadError, load, freshness]);
  return <HubDataContext.Provider value={value}>{children}</HubDataContext.Provider>;
}

export function useHubData() {
  const ctx = useContext(HubDataContext);
  if (!ctx) throw new Error("useHubData must be used inside <HubDataProvider>");
  return ctx;
}
