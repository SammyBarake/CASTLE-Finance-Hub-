/**
 * Castle data contract.
 *
 * These types are the shape of everything the UI renders. Today they're filled
 * from lib/sampleData.ts; in Task 2 the SEC EDGAR pipeline writes rows of the
 * same shape to Supabase and lib/data.ts reads them instead. The UI never
 * imports sample data directly, so the swap touches only lib/data.ts.
 *
 * Conventions:
 * - Money is plain USD (not thousands, not millions): 8.4B is 8_400_000_000.
 * - Dates are ISO strings: "YYYY-MM-DD" for days, "YYYY-MM" for months,
 *   "YYYY-Qn" for quarters, full ISO 8601 for timestamps.
 * - Percentages are whole numbers: 34.2 means 34.2%.
 * - `null` means "not disclosed / not yet known", never zero.
 */

export const SECTORS = ["Tech", "Healthcare", "Energy", "Financials", "Industrials"] as const;
export type Sector = (typeof SECTORS)[number];

/**
 * Announced: definitive agreement signed.
 * Pending:   proxy / tender offer / S-4 on file (shareholder or regulatory stage).
 * Closed:    completed (target delisted or change-of-control 8-K).
 * Terminated: agreement terminated.
 */
export const DEAL_STATUSES = ["Announced", "Pending", "Closed", "Terminated"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const IPO_STAGES = ["Filed", "Priced", "Trading"] as const;
export type IpoStage = (typeof IPO_STAGES)[number];

/** How the target's shareholders are paid. */
export type Consideration = "Cash" | "Stock" | "Mixed";

/** A link to a source document on EDGAR (8-K, DEFM14A, S-4, S-1, 424B4...). */
export interface Filing {
  form: string;
  filedDate: string;
  url: string;
}

export interface Company {
  name: string;
  ticker: string | null;
  /** SEC Central Index Key; null until matched to EDGAR. */
  cik: string | null;
}

/** Feature 1: an announced M&A transaction involving a US public company. */
export interface Deal {
  id: string;
  announcedDate: string;
  acquirer: Company;
  target: Company;
  /** Headline transaction (equity) value in USD. */
  valueUsd: number | null;
  /** Offer price per target share in USD. */
  pricePerShare: number | null;
  /** Premium of offer price over the unaffected share price, in %. */
  premiumPct: number | null;
  consideration: Consideration | null;
  sector: Sector;
  /** Target's SEC industry (SIC description), e.g. "Services-Prepackaged Software". */
  industry: string | null;
  status: DealStatus;
  /** Date the current status was reached (closing / termination / proxy filing). */
  statusDate: string | null;
  /** Target enterprise value in USD (stated, or equity value + debt − cash). */
  enterpriseValueUsd: number | null;
  /** EV / last-twelve-months EBITDA of the target. */
  evEbitda: number | null;
  /** EV / last-twelve-months revenue of the target. */
  evRevenue: number | null;
  /** Financial advisors, lead first. */
  acquirerAdvisors: string[];
  targetAdvisors: string[];
  filings: Filing[];
}

/** Feature 2: one row per sector per month of announced M&A. */
export interface MonthlySectorVolume {
  month: string;
  sector: Sector;
  dealValueUsd: number;
  dealCount: number;
}

/** Feature 3: a company in the IPO pipeline. */
export interface Ipo {
  id: string;
  company: Company;
  sector: Sector;
  industry: string | null;
  stage: IpoStage;
  /** Date of the initial S-1 / F-1. */
  filedDate: string;
  pricedDate: string | null;
  /** Expected gross proceeds from the registration statement, in USD. */
  expectedRaiseUsd: number | null;
  /** Final offer price per share once priced. */
  offerPrice: number | null;
  /** Bookrunners, lead first. */
  underwriters: string[];
  description: string;
  filings: Filing[];
}

export interface Advisor {
  name: string;
  /** Monogram shown in the league table, e.g. "GS". */
  shortName: string;
}

/** Feature 4: one bank's row in the M&A league table. */
export interface LeagueTableEntry {
  advisor: Advisor;
  dealCount: number;
  dealValueUsd: number;
  /** Positions gained (+) or lost (-) versus the prior period. */
  rankChange: number;
}

export interface LeagueTable {
  /** Human label for the period, e.g. "2026 YTD". */
  period: string;
  entries: LeagueTableEntry[];
}

/** Feature 5: median transaction multiples for one sector in one quarter. */
export interface SectorValuation {
  quarter: string;
  sector: Sector;
  medianEvEbitda: number | null;
  medianEvRevenue: number | null;
  medianPremiumPct: number | null;
  dealCount: number;
}

/** Everything the hub page needs, fetched in one call. */
export interface HubData {
  /** When the underlying data was last refreshed (ISO timestamp). */
  asOf: string;
  /** True while running on lib/sampleData.ts; drives the "Sample data" badges. */
  isSample: boolean;
  /** Total deals in the dataset (HubData.deals may be only the latest slice). */
  totalDeals: number;
  deals: Deal[];
  monthlyVolume: MonthlySectorVolume[];
  ipos: Ipo[];
  leagueTable: LeagueTable;
  valuations: SectorValuation[];
}
