"use client";

import { useEffect, useState } from "react";
import type { Deal } from "@/lib/types";

/**
 * The full record of a deal from /api/deal/[id]: the page feed leaves out fairness opinions and all but the first
 * filing. Fetched once per deal per visit (shared by the drawer's Valuation and Filings tabs and company pages).
 */
const cache = new Map<string, Promise<Deal>>();

export function fetchFullDeal(id: string): Promise<Deal> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/api/deal/${encodeURIComponent(id)}`).then((r) => (r.ok ? (r.json() as Promise<Deal>) : Promise.reject(new Error(String(r.status)))));
    p.catch(() => cache.delete(id)); // try again next time
    cache.set(id, p);
  }
  return p;
}

/** A record already complete (sample data, or one fetched before) needs no request. */
const isFull = (deal: Deal) => deal.filingCount == null && (!deal.hasFairness || !!deal.fairness);

export function useFullDeal(deal: Deal | null): { full: Deal | null; failed: boolean } {
  const [state, setState] = useState<{ id: string; full: Deal | null; failed: boolean }>({ id: "", full: null, failed: false });
  useEffect(() => {
    if (!deal || isFull(deal)) return;
    let live = true;
    fetchFullDeal(deal.id)
      .then((full) => live && setState({ id: deal.id, full, failed: false }))
      .catch(() => live && setState({ id: deal.id, full: null, failed: true }));
    return () => {
      live = false;
    };
  }, [deal]);
  if (!deal) return { full: null, failed: false };
  if (isFull(deal)) return { full: deal, failed: false };
  return state.id === deal.id ? state : { full: null, failed: false };
}
