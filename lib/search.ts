import type { Deal, DealStatus, Ipo, LeagueTableEntry, Sector } from "./types";

export interface DealFilters {
  query: string;
  sector: Sector | "all";
  status: DealStatus | "all";
}

const haystack = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ").toLowerCase();

/** `query` is expected lowercased and trimmed. */
export function matchDeal(d: Deal, { query, sector, status }: DealFilters): boolean {
  if (sector !== "all" && d.sector !== sector) return false;
  if (status !== "all" && d.status !== status) return false;
  if (!query) return true;
  return haystack([
    d.acquirer.name,
    d.acquirer.ticker,
    d.target.name,
    d.target.ticker,
    d.sector,
    d.status,
    ...d.acquirerAdvisors,
    ...d.targetAdvisors,
  ]).includes(query);
}

export const matchIpo = (i: Ipo, query: string) =>
  !query || haystack([i.company.name, i.company.ticker, i.sector, i.stage, ...i.underwriters]).includes(query);

export const matchAdvisor = (e: LeagueTableEntry, query: string) =>
  !query || haystack([e.advisor.name, e.advisor.shortName]).includes(query);
