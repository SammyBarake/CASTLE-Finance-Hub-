/**
 * Ripple engine links, set by hand from standard economic reasoning. NONE of these numbers has been estimated from
 * data yet: every entry is marked as an assumption, and results carry a ±50% band until bootstrapped ranges exist.
 *
 * Three kinds of link:
 * - FEATURE_LINKS (C): how a move in one feature changes another feature, at a lag of 0, 1 or 2 quarters.
 * - SECTOR_LINKS (L): how strongly a move in one sector reaches another sector. Each sector reaches itself in full;
 *   these entries are the spillovers between sectors. They have no lag of their own: a spillover arrives with the
 *   lag of the feature link it travels through.
 * - MACRO_LINKS (M): how a macro shock moves a feature in a sector, at a lag. Macro inputs can be shocked but
 *   receive no feedback in v1.
 *
 * Strengths become numbers through STRENGTH_SCALE below. Edit an entry's strength, direction or lag here; the engine
 * reads nothing else.
 */
import type { Sector } from "../types";

export const ASSUMPTION = "assumption — not yet estimated from data" as const;
/** Status of a link estimated from data (later): its `value` and `range` replace the strength scale and the ±band. */
export const ESTIMATED = "estimated from data" as const;
export type LinkStatus = typeof ASSUMPTION | typeof ESTIMATED;

/** Optional fields an estimated link carries; hand-set links leave them out. */
interface Estimate {
  /** Signed coefficient in the link's units (overrides direction × strength). */
  value?: number;
  /** Confidence range for `value` (e.g. a bootstrapped 90% interval), low to high. */
  range?: [number, number];
}

export const FEATURES = ["valuation", "dealCount", "dealValue", "ipoCount"] as const;
export type Feature = (typeof FEATURES)[number];

export const MACROS = ["fedFunds", "treasury10y", "baaSpread", "vix"] as const;
export type Macro = (typeof MACROS)[number];

export type Strength = "strong" | "moderate" | "weak";
export type Direction = "+" | "-";
export type Lag = 0 | 1 | 2;

/**
 * What a strength means:
 * - feature links: % change in the target per 1% change in the source (an elasticity);
 * - sector links: the share of a move that reaches the other sector (its own sector gets 1);
 * - macro links: % change in the target per macro unit (MACRO_UNITS).
 */
export const STRENGTH_SCALE = {
  feature: { strong: 1.0, moderate: 0.5, weak: 0.2 },
  sector: { strong: 0.5, moderate: 0.25, weak: 0.1 },
  macro: { strong: 10, moderate: 5, weak: 2 },
} as const;

/** One macro unit: +1 percentage point (100 bp) for rates and the spread, +10 points for the VIX. */
export const MACRO_UNITS: Record<Macro, { size: number; label: string }> = {
  fedFunds: { size: 1, label: "+1 percentage point (100 bp)" },
  treasury10y: { size: 1, label: "+1 percentage point (100 bp)" },
  baaSpread: { size: 1, label: "+1 percentage point (100 bp)" },
  vix: { size: 10, label: "+10 VIX points" },
};

export interface FeatureLink extends Estimate {
  from: Feature;
  to: Feature;
  direction: Direction;
  strength: Strength;
  lag: Lag;
  why: string;
  status: LinkStatus;
}

export interface SectorLink extends Estimate {
  from: Sector;
  to: Sector;
  direction: Direction;
  strength: Strength;
  /** Spillovers travel at the lag of the feature link they ride on. */
  lag: "inherits the feature link's lag";
  why: string;
  status: LinkStatus;
}

export interface MacroLink extends Estimate {
  from: Macro;
  to: Feature;
  sectors: readonly Sector[] | "all";
  direction: Direction;
  strength: Strength;
  lag: Lag;
  why: string;
  status: LinkStatus;
}

const ALL = "all" as const;
const inherit = "inherits the feature link's lag" as const;

/** C: feature → feature. Matrix C_lag[to][from]. A feature never links to itself in its own sector (its shock fades by λ instead). */
export const FEATURE_LINKS: FeatureLink[] = [
  { from: "valuation", to: "ipoCount", direction: "+", strength: "strong", lag: 1, status: ASSUMPTION,
    why: "Rich valuations open the IPO window: companies and their backers file while prices are high, and pricings follow about a quarter later." },
  { from: "valuation", to: "ipoCount", direction: "+", strength: "moderate", lag: 2, status: ASSUMPTION,
    why: "Listings prepared during a rally keep reaching the market in the second quarter, as registrations filed earlier clear review." },
  { from: "valuation", to: "ipoCount", direction: "+", strength: "weak", lag: 0, status: ASSUMPTION,
    why: "Offerings already on file are pulled forward when prices jump." },
  { from: "valuation", to: "dealValue", direction: "+", strength: "moderate", lag: 0, status: ASSUMPTION,
    why: "Higher share prices raise the price tag of the same deals: targets cost more and acquirer stock buys more." },
  { from: "valuation", to: "dealValue", direction: "+", strength: "moderate", lag: 1, status: ASSUMPTION,
    why: "Rising markets lift boardroom confidence and stock-funded bids, so larger deals get signed the next quarter." },
  { from: "valuation", to: "dealCount", direction: "+", strength: "moderate", lag: 1, status: ASSUMPTION,
    why: "Confidence and a stronger acquisition currency bring more deals to signing, after a quarter of negotiation." },
  { from: "valuation", to: "valuation", direction: "+", strength: "weak", lag: 0, status: ASSUMPTION,
    why: "A rally in one sector lifts broad risk appetite and nudges other sectors' valuations up the same quarter." },
  { from: "dealCount", to: "dealValue", direction: "+", strength: "strong", lag: 0, status: ASSUMPTION,
    why: "More deals add up to more total value: the count drives the sum almost one for one." },
  { from: "dealValue", to: "valuation", direction: "+", strength: "weak", lag: 0, status: ASSUMPTION,
    why: "Takeover activity makes investors price a takeover premium into the remaining companies in the sector." },
  { from: "dealCount", to: "ipoCount", direction: "-", strength: "weak", lag: 1, status: ASSUMPTION,
    why: "Companies sold to buyers don't list: a busy M&A market takes some candidates out of the IPO pipeline." },
  { from: "ipoCount", to: "valuation", direction: "-", strength: "weak", lag: 1, status: ASSUMPTION,
    why: "A wave of new listings adds share supply to the sector and weighs a little on its valuations." },
  { from: "ipoCount", to: "dealCount", direction: "+", strength: "weak", lag: 1, status: ASSUMPTION,
    why: "Fresh listings set public price benchmarks, which makes private targets easier to value and sell." },
];

/** L: sector → sector spillovers (each sector reaches itself with 1). Matrix L[to][from]. */
export const SECTOR_LINKS: SectorLink[] = [
  { from: "Energy", to: "Industrials", direction: "+", strength: "strong", lag: inherit, status: ASSUMPTION,
    why: "Oil and gas activity drives demand for equipment, pipelines, chemicals and transport, so energy shocks spill straight into industrials." },
  { from: "Industrials", to: "Energy", direction: "+", strength: "moderate", lag: inherit, status: ASSUMPTION,
    why: "Factories, freight and construction are major energy users, so industrial activity feeds back into energy demand." },
  { from: "Financials", to: "Tech", direction: "+", strength: "moderate", lag: inherit, status: ASSUMPTION,
    why: "Banks and investors fund deals and listings, so strength or stress in finance changes how much capital reaches tech." },
  { from: "Financials", to: "Healthcare", direction: "+", strength: "moderate", lag: inherit, status: ASSUMPTION,
    why: "Healthcare deals and biotech listings depend on the same financing and underwriting capacity that Financials provide." },
  { from: "Financials", to: "Energy", direction: "+", strength: "moderate", lag: inherit, status: ASSUMPTION,
    why: "Energy is capital-intensive and leans on bank lending and bond markets for deals and projects." },
  { from: "Financials", to: "Industrials", direction: "+", strength: "moderate", lag: inherit, status: ASSUMPTION,
    why: "Industrial buyouts and capex are financed by banks and credit funds, so financial conditions travel into the sector." },
  { from: "Tech", to: "Healthcare", direction: "+", strength: "moderate", lag: inherit, status: ASSUMPTION,
    why: "Tech and healthcare share growth investors and venture backers, so appetite for one carries over to the other." },
  { from: "Healthcare", to: "Tech", direction: "+", strength: "weak", lag: inherit, status: ASSUMPTION,
    why: "Healthcare is a smaller part of growth portfolios, so its moves reach tech only a little." },
  { from: "Tech", to: "Industrials", direction: "+", strength: "weak", lag: inherit, status: ASSUMPTION,
    why: "Automation, chips and software tie technology demand to industrial investment." },
  { from: "Tech", to: "Financials", direction: "+", strength: "weak", lag: inherit, status: ASSUMPTION,
    why: "Tech activity lifts fintech, trading and advisory revenue at financial firms." },
  { from: "Industrials", to: "Financials", direction: "+", strength: "weak", lag: inherit, status: ASSUMPTION,
    why: "Industrial activity drives loan demand and corporate banking business." },
];

/** M: macro → feature in a sector. Matrix M_lag[(feature, sector)][macro]. */
export const MACRO_LINKS: MacroLink[] = [
  // Policy rate
  { from: "fedFunds", to: "dealCount", sectors: ALL, direction: "-", strength: "moderate", lag: 1, status: ASSUMPTION,
    why: "Higher policy rates make acquisition financing dearer, leveraged buyouts above all, so fewer deals are signed a quarter later." },
  { from: "fedFunds", to: "dealValue", sectors: ALL, direction: "-", strength: "moderate", lag: 1, status: ASSUMPTION,
    why: "Costlier debt caps what buyers can pay and shrinks the largest leveraged deals." },
  { from: "fedFunds", to: "ipoCount", sectors: ALL, direction: "-", strength: "moderate", lag: 1, status: ASSUMPTION,
    why: "Tighter money cools risk appetite for new listings, especially unprofitable growth companies." },
  // Long rates
  { from: "treasury10y", to: "valuation", sectors: ["Tech"], direction: "-", strength: "strong", lag: 0, status: ASSUMPTION,
    why: "Tech value sits in profits far in the future, so higher long-term discount rates cut its valuations the most." },
  { from: "treasury10y", to: "valuation", sectors: ["Healthcare"], direction: "-", strength: "moderate", lag: 0, status: ASSUMPTION,
    why: "Biotech and other long-dated healthcare cash flows are discounted harder when long rates rise." },
  { from: "treasury10y", to: "valuation", sectors: ["Industrials", "Energy"], direction: "-", strength: "weak", lag: 0, status: ASSUMPTION,
    why: "Nearer-term, cyclical cash flows make these sectors less sensitive to the discount rate." },
  { from: "treasury10y", to: "valuation", sectors: ["Financials"], direction: "+", strength: "weak", lag: 0, status: ASSUMPTION,
    why: "Higher long rates widen banks' lending margins, which offsets the discount-rate hit." },
  // Credit spread
  { from: "baaSpread", to: "dealValue", sectors: ALL, direction: "-", strength: "strong", lag: 0, status: ASSUMPTION,
    why: "Wider credit spreads make acquisition debt expensive or unavailable, and the largest financed deals stall first." },
  { from: "baaSpread", to: "dealCount", sectors: ALL, direction: "-", strength: "moderate", lag: 0, status: ASSUMPTION,
    why: "When credit tightens, sponsors and strategic buyers alike postpone deals they would have financed." },
  { from: "baaSpread", to: "ipoCount", sectors: ALL, direction: "-", strength: "moderate", lag: 1, status: ASSUMPTION,
    why: "Credit stress signals risk aversion, and IPO investors step back a quarter later." },
  { from: "baaSpread", to: "valuation", sectors: ALL, direction: "-", strength: "moderate", lag: 0, status: ASSUMPTION,
    why: "Wider spreads mean investors demand more compensation for risk, which lowers equity valuations." },
  { from: "baaSpread", to: "valuation", sectors: ["Financials"], direction: "-", strength: "moderate", lag: 0, status: ASSUMPTION,
    why: "Lenders hold the credit risk directly, so spreads hit financial valuations on top of the market-wide effect." },
  // Volatility
  { from: "vix", to: "ipoCount", sectors: ALL, direction: "-", strength: "strong", lag: 0, status: ASSUMPTION,
    why: "Volatility shuts the IPO window: underwriters won't price a new listing while markets swing." },
  { from: "vix", to: "dealCount", sectors: ALL, direction: "-", strength: "moderate", lag: 0, status: ASSUMPTION,
    why: "Boards delay agreeing a price when share prices are unstable, so fewer deals are signed." },
  { from: "vix", to: "valuation", sectors: ALL, direction: "-", strength: "moderate", lag: 0, status: ASSUMPTION,
    why: "Fear raises the risk premium investors require, pushing valuations down." },
];
