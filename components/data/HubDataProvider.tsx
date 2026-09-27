"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { buildVolumeMatrix, ipoPipelineSummary, medianPremium, ytdSummary, type VolumeMatrix, type YtdSummary } from "@/lib/metrics";
import type { HubData } from "@/lib/types";

interface HubDataValue {
  data: HubData;
  matrix: VolumeMatrix;
  ytd: YtdSummary | null;
  medianPremiumPct: number | null;
  ipoSummary: { filedCount: number; expectedRaiseUsd: number };
}

const HubDataContext = createContext<HubDataValue | null>(null);

/** Makes the page data (fetched once in the layout) and common derived figures available to every page. */
export function HubDataProvider({ data, children }: { data: HubData; children: ReactNode }) {
  const value = useMemo(() => {
    const matrix = buildVolumeMatrix(data.monthlyVolume);
    return {
      data,
      matrix,
      ytd: ytdSummary(matrix),
      // Headline premium: median across the latest 25 deals.
      // The latest 25 deals that disclose a premium (private-company deals never do).
      medianPremiumPct: medianPremium(data.deals.filter((d) => d.premiumPct != null).slice(0, 25)),
      ipoSummary: ipoPipelineSummary(data.ipos),
    };
  }, [data]);
  return <HubDataContext.Provider value={value}>{children}</HubDataContext.Provider>;
}

export function useHubData() {
  const ctx = useContext(HubDataContext);
  if (!ctx) throw new Error("useHubData must be used inside <HubDataProvider>");
  return ctx;
}
