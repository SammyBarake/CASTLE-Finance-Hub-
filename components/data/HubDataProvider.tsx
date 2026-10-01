"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildVolumeMatrix, ipoPipelineSummary, medianPremium, ytdSummary, type VolumeMatrix, type YtdSummary } from "@/lib/metrics";
import type { HubData } from "@/lib/types";

interface HubDataValue {
  data: HubData;
  /** False until the full dataset has loaded (pages show a skeleton until then). */
  ready: boolean;
  /** Set when the dataset could not be loaded after retries. */
  loadError: string | null;
  /** Fetch the dataset again, bypassing caches (new data after an ingest, or a retry). */
  reload: () => Promise<string | null>;
  matrix: VolumeMatrix;
  ytd: YtdSummary | null;
  medianPremiumPct: number | null;
  ipoSummary: { filedCount: number; expectedRaiseUsd: number };
}

const HubDataContext = createContext<HubDataValue | null>(null);

// Kept outside React so it survives anything that remounts the provider during a visit.
let memory: HubData | null = null;

async function fetchHub(bust: boolean): Promise<HubData> {
  const res = await fetch(bust ? `/api/hub?t=${Date.now()}` : "/api/hub", { cache: bust ? "no-store" : "default" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as HubData;
}

/**
 * The dataset for every page. The layout passes a small "boot" copy (dates, totals, aggregates; no long lists)
 * so the shell renders at once; the full dataset loads ONCE per visit from /api/hub (a cached, compressed
 * response) and stays in memory. Page navigation therefore never re-downloads it; it used to ship with every
 * page, which on a slow connection meant minutes per click.
 */
export function HubDataProvider({ data: boot, children }: { data: HubData; children: ReactNode }) {
  const [full, setFull] = useState<HubData | null>(memory && memory.asOf >= boot.asOf ? memory : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loading = useRef(false);

  const load = useCallback(async (bust: boolean) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const next = await fetchHub(bust || attempt > 0);
        memory = next;
        setFull(next);
        setLoadError(null);
        return next.asOf;
      } catch (err) {
        if (attempt === 2) setLoadError((err as Error).message);
        else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    return null;
  }, []);

  useEffect(() => {
    if (full || loading.current) return;
    loading.current = true;
    load(false).finally(() => (loading.current = false));
  }, [full, load]);

  const data = full ?? boot;
  const value = useMemo(() => {
    const matrix = buildVolumeMatrix(data.monthlyVolume);
    return {
      data,
      ready: !!full,
      loadError,
      reload: () => load(true),
      matrix,
      ytd: ytdSummary(matrix),
      // The latest 25 deals that disclose a premium (private-company deals never do).
      medianPremiumPct: medianPremium(data.deals.filter((d) => d.premiumPct != null).slice(0, 25)),
      ipoSummary: ipoPipelineSummary(data.ipos),
    };
  }, [data, full, loadError, load]);
  return <HubDataContext.Provider value={value}>{children}</HubDataContext.Provider>;
}

export function useHubData() {
  const ctx = useContext(HubDataContext);
  if (!ctx) throw new Error("useHubData must be used inside <HubDataProvider>");
  return ctx;
}
