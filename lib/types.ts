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

/** How a deal's headline value is stated. */
export type ValueKind = "transaction" | "equity" | "enterprise";

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
  /**
   * What `valueUsd` is: the stated transaction value, equity value or enterprise value. Internal (stored records and
   * the server-side read, for filtering by value type); `toPublicDeal` leaves it out of the browser feed.
   */
  valueKind?: ValueKind | null;
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
  /**
   * The target is a private company (bought by a US-listed acquirer). No share price, premium,
   * multiples or proxy: those stay null, and sector / industry are the acquirer's.
   */
  privateTarget?: boolean;
  /** Fairness opinions from the target's merger proxy (valuation ranges, DCF inputs, fees). Only on /api/deal/[id]. */
  fairness?: FairnessOpinion[];
  /** The page feed's stand-in for `fairness`: true when the full record has opinions. */
  hasFairness?: boolean;
  milestones?: DealMilestones;
  /** Deal protections and financing from the merger agreement summary (public targets only). */
  terms?: DealTerms;
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

/**
 * Deal protections from the merger agreement (the target's 8-K Item 1.01, else its merger proxy).
 * Every field is null / empty when the filing doesn't state it clearly.
 */
export interface DealTerms {
  /** Termination ("break") fee the target pays, e.g. if its board takes a superior proposal. */
  targetFeeUsd: number | null;
  /** Reverse termination fee the buyer pays, e.g. if financing or regulatory approval fails. */
  reverseFeeUsd: number | null;
  /** true: a go-shop lets the target seek better offers after signing; false: a no-shop; null: not stated. */
  goShop: boolean | null;
  /** Go-shop length in days, when stated. */
  goShopDays: number | null;
  /** false: "not subject to a financing condition"; true: conditioned on financing; null: not stated. */
  financingCondition: boolean | null;
  /** Banks that committed debt financing to the buyer (canonical names, lead first). */
  financingBanks: string[];
}

/** Feature 2: one row per sector per month of announced M&A. */
export interface MonthlySectorVolume {
  month: string;
  sector: Sector;
  dealValueUsd: number;
  dealCount: number;
}

/** Feature 3: a company in the IPO pipeline. */
/** Dates a deal passed through, from the target's SEC filing history. */
export interface DealMilestones {
  /** How shareholders approve: a tender offer (SC 14D9 / SC TO-T) or a vote on a merger proxy. */
  path: "tender" | "vote" | null;
  /** First merger proxy, 14D-9 or S-4 filed after the announcement. */
  firstFiling: { form: string; date: string } | null;
  /** Definitive proxy (DEFM14A) mailed to shareholders, for vote deals. */
  definitiveProxy: string | null;
  /** Shareholder vote results reported (8-K Item 5.07 after the definitive proxy). */
  voteHeld?: string | null;
  closed: string | null;
  terminated: string | null;
}

/** One valuation analysis from a fairness opinion: implied value per target share. */
export interface ValuationRange {
  /** "Discounted cash flow", "Trading comparables", "Precedent transactions", ... */
  method: string;
  low: number;
  high: number;
}

/** A bank's fairness opinion as summarised in the merger proxy / Schedule 14D-9. */
export interface FairnessOpinion {
  bank: string | null;
  /** Whose board the bank advised. */
  side: "target" | "acquirer";
  ranges: ValuationRange[];
  feeUsd: number | null;
  /** DCF assumptions, [low, high]. */
  discountRatePct: [number, number] | null;
  perpetuityGrowthPct: [number, number] | null;
  terminalMultiple: [number, number] | null;
}

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

/**
 * Feature 5: median transaction multiples for one sector, trailing twelve months to the end of `quarter`
 * (that quarter plus the three before). A median needs 3+ deals disclosing the figure, otherwise null.
 */
export interface SectorValuation {
  quarter: string;
  sector: Sector;
  medianEvEbitda: number | null;
  medianEvRevenue: number | null;
  medianPremiumPct: number | null;
  /** Deals announced in `quarter` itself. */
  dealCount: number;
  /** Deals behind each LTM median. */
  sample: { evEbitda: number; evRevenue: number; premium: number };
}

export type Region = "Americas" | "Europe" | "Asia-Pacific";

/** World Economies: one row per economy. Growth and inflation are annual %, from the IMF World Economic Outlook. */
export interface Economy {
  /** ISO-style code shown in the UI, e.g. "US", "EA". */
  code: string;
  name: string;
  region: Region;
  /** Real GDP growth for `forecastYear` (IMF estimate / projection). */
  gdpGrowth: number | null;
  /** Real GDP growth for the prior year. */
  gdpGrowthPrior: number | null;
  /** Average consumer-price inflation for `forecastYear`. */
  inflation: number | null;
  inflationPrior: number | null;
  /** Central-bank policy rate, % (BIS). */
  policyRate: number | null;
  policyRateDate: string | null;
}

export interface Macro {
  /** When the macro data was fetched. */
  asOf: string;
  /** Calendar year of the growth / inflation estimates. */
  forecastYear: number;
  economies: Economy[];
}

/** Everything the hub page needs, fetched in one call. */
export interface FeeRow {
  dealId: string;
  bank: string;
  feeUsd: number;
  side: "target" | "acquirer";
}

/** A 5%+ stake disclosed on Schedule 13D (investors who may seek to influence the company). */
export interface ActivistStake {
  /** Accession number of the initial 13D. */
  id: string;
  filedDate: string;
  /** Date the 5% threshold was crossed ("date of event"). */
  eventDate: string | null;
  investor: { name: string; cik: string | null };
  company: Company;
  /** Largest reported % of the class among the reporting persons (they overlap; not additive). */
  percent: number | null;
  shares: number | null;
  /** Tags from Item 4: "Board seats", "Sale or strategic review", "Capital return", ... */
  aims: string[];
  /** Short excerpt of Item 4, "Purpose of Transaction". */
  purpose: string;
  /** Known activist fund, or a campaign stated in Item 4. */
  activist: boolean;
  /** 13D/A amendments filed since. */
  amendments: number;
  lastAmended: string | null;
  url: string;
}

export interface HubData {
  /** When the underlying data was last refreshed (ISO timestamp). */
  asOf: string;
  /** True while running on lib/sampleData.ts; drives the "Sample data" badges. */
  isSample: boolean;
  /** Set when live data couldn't be loaded on the deployed site (which then shows no data, never sample data). */
  dataError?: string;
  /** Total deals in the dataset (HubData.deals may be only the latest slice). */
  totalDeals: number;
  deals: Deal[];
  monthlyVolume: MonthlySectorVolume[];
  ipos: Ipo[];
  leagueTable: LeagueTable;
  valuations: SectorValuation[];
  /** World Economies; null until the macro job has run. */
  macro: Macro | null;
  /** Recent Schedule 13D activist stakes, newest first (empty until the activists job has run). */
  activists?: ActivistStake[];
  /** Advisory fees from fairness opinions, one row per bank per deal (computed from all deals). */
  fees?: FeeRow[];
}
