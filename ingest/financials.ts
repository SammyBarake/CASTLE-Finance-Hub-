/**
 * Target financials from SEC XBRL "company facts", used for transaction multiples.
 *
 * LTM (last twelve months) = last fiscal year + current YTD − prior-year YTD,
 * using only figures filed on or before the announcement date.
 */
import { getJson, NotFoundError, padCik } from "./edgar";

interface Fact {
  start?: string;
  end: string;
  val: number;
  form: string;
  filed: string;
}
export interface CompanyFacts {
  facts: Record<string, Record<string, { units: Record<string, Fact[]> }>>;
}

const REVENUE = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "RevenuesNetOfInterestExpense",
  "Revenue", // ifrs-full
];
const OPERATING_INCOME = ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"];
const DA = ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAmortizationAndImpairment"];
// Reported apart (Perficient: depreciation and intangibles amortization on separate lines).
const DEPRECIATION = ["Depreciation", "DepreciationNonproduction"];
const AMORTIZATION = ["AmortizationOfIntangibleAssets", "FiniteLivedIntangibleAssetsAmortizationExpense"];
// Other readings of D&A: they can raise a D&A figure, never supply the only one.
const DA_OTHER = ["OtherDepreciationAndAmortization", "AdjustmentForAmortization", "DepreciationAndAmortisationExpense"];
// What a banker adds back to reach adjusted EBITDA. Taken as the largest tag of each group, never a sum: AssetImpairmentCharges
// is usually the total of the others (CMC: 230 total, 227 goodwill), and Envision tags the same $500M three ways.
const IMPAIRMENT = [
  "GoodwillImpairmentLoss",
  "GoodwillAndIntangibleAssetImpairment",
  "ImpairmentOfGoodwillAndIntangibleAssets",
  "ImpairmentOfIntangibleAssetsExcludingGoodwill",
  "ImpairmentOfIntangibleAssetsFinitelived",
  "ImpairmentOfIntangibleAssetsIndefinitelivedExcludingGoodwill",
  "ImpairmentOfLongLivedAssetsHeldForUse",
  "ImpairmentOfLongLivedAssetsToBeDisposedOf",
  "TangibleAssetImpairmentCharges",
  "OtherAssetImpairmentCharges",
  "ImpairmentOfOilAndGasProperties",
  "AssetImpairmentCharges",
];
const RESTRUCTURING = ["RestructuringCharges", "RestructuringCosts", "SeveranceCosts1", "BusinessExitCosts1"];
// One tag for both: it stands instead of the two groups, never on top of them (Berry Global tags $161.0M both ways).
const RESTRUCTURING_AND_IMPAIRMENT = ["RestructuringCostsAndAssetImpairmentCharges", "RestructuringSettlementAndImpairmentProvisions"];
const DEAL_COSTS = ["BusinessCombinationAcquisitionRelatedCosts", "BusinessCombinationIntegrationRelatedCosts", "MergerRelatedCosts"];
const STOCK_COMP = ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"];
// What a banker takes out: the gain on selling a business or assets, a one-off like an impairment but the other way round.
const SALE_GAINS = [
  "GainLossOnSaleOfBusiness",
  "GainLossOnDispositionOfBusiness",
  "DisposalGroupNotDiscontinuedOperationGainLossOnDisposal",
  "GainLossOnDispositionOfAssets",
  "GainLossOnDispositionOfAssets1",
  "GainLossOnSaleOfPropertyPlantEquipment",
  "GainLossOnSaleOfOtherAssets",
  "GainLossOnDispositionOfIntangibleAssets",
  "GainLossOnSaleOfProperties",
  "GainLossOnSaleOfInterestInProjects",
  "BusinessCombinationBargainPurchaseGainRecognizedAmount",
  "GainLossOnSaleOfEquityInvestments",
  "GainLossOnSalesOfAssetsAndAssetImpairmentCharges",
];
const DISCONTINUED = [
  "DiscontinuedOperationGainLossFromDisposalOfDiscontinuedOperationBeforeIncomeTax",
  "DiscontinuedOperationGainLossOnDisposalOfDiscontinuedOperationNetOfTax",
  "IncomeLossFromDiscontinuedOperationsNetOfTax",
  "IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToReportingEntity",
  "IncomeLossFromDiscontinuedOperationsNetOfTaxIncludingPortionAttributableToNoncontrollingInterest",
];
const NET_INCOME = ["NetIncomeLoss", "ProfitLoss"];
// No operating-income line (ChampionX after 2018): pre-tax income plus interest expense.
const PRETAX = [
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  "ProfitLossBeforeTax",
];
const INTEREST = ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "FinanceCosts"];
const CASH = ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashAndCashEquivalents"];
const SHARES = ["EntityCommonStockSharesOutstanding"];

/**
 * Bump when the figures or multiples change: every stored deal's are recomputed once.
 * 2: D&A and EBIT fallbacks, figures from the last 15 months only, notes as debt, no EV when debt can't be read.
 * 4: evEbitda on adjusted EBITDA (one-offs and stock compensation added back, 3-50x), the largest D&A reading, evEbitdaReported beside it.
 */
export const FINANCIALS_VERSION = 6; // 6: a total stated with its debt is an enterprise value; a goodwill charge no larger than the goodwill held.

const FORMS = /^(10-K|10-Q|20-F|40-F|10-KT|10-QT)(\/A)?$/;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/**
 * Pick the concept with the most recent data point; companies switch tags over time. With `largest`, a tie on the
 * latest date goes to the bigger figure: a REIT tags only its fee income as "RevenueFromContractWithCustomer…" and
 * its total (rents included) as "Revenues", and the total is the revenue a multiple should use.
 */
export function series(cf: CompanyFacts, concepts: string[], unit: string, asOf: string, largest = false): Fact[] {
  let best: Fact[] = [];
  let bestEnd = "";
  let bestVal = -Infinity;
  for (const taxonomy of ["us-gaap", "ifrs-full", "dei"]) {
    for (const c of concepts) {
      const rows = cf.facts[taxonomy]?.[c]?.units[unit]?.filter((f) => f.filed <= asOf && FORMS.test(f.form) && f.end <= asOf) ?? [];
      const end = rows.reduce((m, f) => (f.end > m ? f.end : m), "");
      const val = largest ? Math.max(...rows.filter((f) => f.end === end).map((f) => f.val)) : 0;
      if (end > bestEnd || (largest && end && end === bestEnd && val > bestVal)) {
        best = rows;
        bestEnd = end;
        bestVal = val;
      }
    }
  }
  return best;
}

/**
 * Last-twelve-months value of a flow concept (revenue, operating income, D&A). With `asOf`, only a fiscal year that
 * ended in the 15 months before it counts: ChampionX stopped tagging operating income in 2018, and a 2017 figure
 * made a 2024 multiple.
 */
export function ltm(rows: Fact[], asOf?: string): number | null {
  const p = ltmPeriods(rows, asOf);
  if (!p) return null;
  return p.ytd && p.prior ? p.annual.val + p.ytd.val - p.prior.val : p.annual.val;
}

/** The rows an LTM is built from: the last fiscal year, the year to date after it, and the same part of the year before. */
function ltmPeriods(rows: Fact[], asOf?: string) {
  const withDur = rows.filter((f) => f.start).map((f) => ({ ...f, dur: days(f.start!, f.end) }));
  const annual = withDur.filter((f) => f.dur > 340 && f.dur < 380).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
  if (!annual || (asOf && days(annual.end, asOf) > 460)) return null;
  // Year-to-date period that starts right after the last fiscal year ended.
  const ytd = withDur
    .filter((f) => f.dur < 340 && f.dur > 60 && Math.abs(days(annual.end, f.start!) - 1) <= 7 && f.end > annual.end)
    .sort((a, b) => b.end.localeCompare(a.end))[0];
  const prior = ytd && withDur.find((f) => Math.abs(f.dur - ytd.dur) <= 10 && Math.abs(days(f.end, ytd.end) - 365) <= 10);
  return { annual, ytd, prior };
}

/** The LTM window of the company's own latest figures, so that a tag can be read over the same months as its operating income. */
export interface Anchor {
  year: Fact;
  ytd?: Fact;
  prior?: Fact;
}

/**
 * Operating income, revenue and pre-tax income set the window: the latest fiscal year any has, then the latest year to
 * date. Pre-tax for a company with neither of the others in a tag we read (Solera; Mead Johnson tags SalesRevenueGoodsNet).
 */
export function anchorOf(cf: CompanyFacts, asOf: string): Anchor | null {
  let best: Anchor | null = null;
  for (const tag of [...OPERATING_INCOME, ...REVENUE, ...PRETAX]) {
    const p = ltmPeriods(series(cf, [tag], "USD", asOf), asOf);
    if (!p) continue;
    const ahead = !best || p.annual.end > best.year.end || (p.annual.end === best.year.end && (p.ytd?.end ?? "") > (best.ytd?.end ?? ""));
    if (ahead) best = { year: p.annual, ytd: p.ytd, prior: p.prior };
  }
  return best;
}

/**
 * One tag over the anchor's window. `sparse` is for one-offs, which aren't tagged every period: a missing piece counts
 * as zero, where ltm() would return the full year for a tag with no year to date (US Ecology's $404.9M goodwill
 * impairment was $300.3M of it in the nine months a year earlier, so $104.6M fell in the LTM).
 */
function tagLtm(cf: CompanyFacts, tag: string, an: Anchor, asOf: string, sparse = false): number | null {
  const rows = series(cf, [tag], "USD", asOf).filter((f) => f.start);
  const at = (w?: Fact) => {
    if (!w) return null;
    const hits = rows.filter((f) => Math.abs(days(f.start!, w.start!)) <= 7 && Math.abs(days(f.end, w.end)) <= 7);
    return hits.length ? hits.sort((a, b) => b.filed.localeCompare(a.filed))[0].val : null;
  };
  const year = at(an.year);
  const ytd = at(an.ytd);
  const prior = at(an.prior);
  if (sparse) return year == null && ytd == null && prior == null ? null : (year ?? 0) + (an.prior ? (ytd ?? 0) - (prior ?? 0) : 0);
  if (year == null) return null;
  return ytd != null && prior != null ? year + ytd - prior : year;
}

/** The year-to-date figure of one tag over the anchor's window. */
function tagYtd(cf: CompanyFacts, tag: string, an: Anchor, asOf: string): number | null {
  return an.ytd ? tagLtm(cf, tag, { year: an.ytd }, asOf) : null;
}

/**
 * Latest point-in-time value (balance-sheet items). Multiple share classes on the same date are summed. With `asOf`,
 * only a balance sheet from the 15 months before it (a tag dropped years ago is not today's debt).
 */
export function latestInstant(rows: Fact[], sumSameDate = false, asOf?: string): number | null {
  const instants = rows.filter((f) => !f.start || days(f.start, f.end) < 2);
  if (!instants.length) return null;
  const end = instants.reduce((m, f) => (f.end > m ? f.end : m), "");
  if (asOf && days(end, asOf) > 460) return null;
  const atEnd = instants.filter((f) => f.end === end);
  if (!sumSameDate) return atEnd.sort((a, b) => b.filed.localeCompare(a.filed))[0].val;
  // De-duplicate identical values reported in several filings, then sum classes.
  return [...new Set(atEnd.map((f) => f.val))].reduce((s, v) => s + v, 0);
}

export interface TargetFinancials {
  revenueLtm: number | null;
  /** Reported EBITDA: operating income + D&A. */
  ebitdaLtm: number | null;
  /** Reported EBITDA + one-offs + stock compensation (`adjustedEbitdaOf`); null when the one-offs are too large to trust. */
  adjustedEbitdaLtm: number | null;
  debt: number | null;
  cash: number | null;
  sharesOutstanding: number | null;
  /** LTM interest expense: a company paying interest has debt, even when its debt tags can't be read (AES). */
  interestLtm?: number | null;
}

export async function getTargetFinancials(cik: string, asOf: string): Promise<TargetFinancials | null> {
  let cf: CompanyFacts;
  try {
    cf = await getJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
  return financialsFrom(cf, asOf);
}

/** The target's LTM figures and latest balance sheet as of `asOf` (pure: tested on fixtures). */
export function financialsFrom(cf: CompanyFacts, asOf: string): TargetFinancials {
  const usd = (concepts: string[]) => series(cf, concepts, "USD", asOf);
  const at = (concepts: string[]) => latestInstant(usd(concepts), false, asOf);
  const ltd = at(["LongTermDebt", "DebtLongtermAndShorttermCombinedAmount", "DebtAndCapitalLeaseObligations"]);
  const ltdNon = at(["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"]);
  const ltdCur = at(["LongTermDebtCurrent", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"]);
  const stb = at(["ShortTermBorrowings", "CommercialPaper"]);
  // Notes without a debt total: convertibles (Mandiant), notes payable (McGrath RentCorp).
  const notesNon = at(["ConvertibleLongTermNotesPayable", "ConvertibleNotesPayable", "ConvertibleDebtNoncurrent", "ConvertibleDebt", "SeniorNotes", "SeniorLongTermNotes", "LongTermNotesPayable", "NotesPayable"]);
  const notesCur = at(["ConvertibleNotesPayableCurrent", "ConvertibleDebtCurrent", "NotesPayableCurrent"]);
  const notes = notesNon != null || notesCur != null ? (notesNon ?? 0) + (notesCur ?? 0) : null;
  const debtCore = ltd ?? (ltdNon != null || ltdCur != null ? (ltdNon ?? 0) + (ltdCur ?? 0) : notes);
  const debt = debtCore != null || stb != null ? (debtCore ?? 0) + (stb ?? 0) : null;
  return {
    revenueLtm: flowLtm(cf, REVENUE, asOf, true),
    ebitdaLtm: ebitdaOf(cf, asOf),
    adjustedEbitdaLtm: adjustedEbitdaOf(cf, asOf),
    debt,
    cash: at(CASH),
    sharesOutstanding: latestInstant(series(cf, SHARES, "shares", asOf), true, asOf),
    interestLtm: flowLtm(cf, INTEREST, asOf),
  };
}

/**
 * Recent LTM of the first concept that has one: the concept with the latest data first (`series`), then each in order
 * (a company that started a new tag mid-year has no full year under it yet).
 */
function flowLtm(cf: CompanyFacts, concepts: string[], asOf: string, largest = false): number | null {
  const best = ltm(series(cf, concepts, "USD", asOf, largest), asOf);
  if (best != null) return best;
  for (const c of concepts) {
    const v = ltm(series(cf, [c], "USD", asOf), asOf);
    if (v != null) return v;
  }
  return null;
}

const reports = (cf: CompanyFacts, concepts: string[], asOf: string) => concepts.some((c) => series(cf, [c], "USD", asOf).some((f) => days(f.end, asOf) <= 460));

/**
 * LTM EBITDA = operating income + depreciation & amortization. Operating income, else pre-tax income plus interest
 * expense (ChampionX); D&A as one figure, else depreciation plus intangibles amortization (Perficient), the latter
 * only left out when the company reports none at all. Null when a part is missing: blank beats wrong.
 */
export function ebitdaOf(cf: CompanyFacts, asOf: string): number | null {
  let opInc = flowLtm(cf, OPERATING_INCOME, asOf);
  if (opInc == null) {
    const pretax = flowLtm(cf, PRETAX, asOf);
    const interest = flowLtm(cf, INTEREST, asOf);
    if (pretax != null && (interest != null || !reports(cf, INTEREST, asOf))) opInc = pretax + (interest ?? 0);
  }
  const da = fullDa(cf, asOf);
  return opInc != null && da != null ? opInc + da : null;
}

/**
 * Another D&A reading above this share of revenue doesn't count: Chart Industries tags 2,772 where its D&A is 270. The
 * first figure stands whatever its share: a wind operator's D&A is that large (Pattern Energy, 68%), and "Revenues" can
 * be a sub-line (Triton: $148M beside $1,044M of operating income).
 */
const DA_MAX_OF_REVENUE = 0.6;

/**
 * The company's full D&A: the first figure on record, raised to the largest other reading of the same window. A first
 * tag on a tie can be a small part of the total (RealPage: $30M beside $115M; Informatica: $15M beside $126M), and a D&A
 * tag reported only in quarters still sets a floor through its year to date (Citrix: $247M against $65M of depreciation).
 * With no first figure there is no D&A, as before: an amortization line alone isn't one.
 *
 * Two readings don't count. A tag with no year to date only has a full year, which can't stand against a company's LTM
 * unless it exceeds that company's own full year (Warner Bros. Discovery: FY2024's $7,037M against a true LTM of $6,012M).
 * And depreciation plus amortization, when the depreciation tag equals a D&A tag and the amortization is a large part of
 * it: that tag already holds the amortization (Bally's: $350M both ways, $236M of amortization, and the balance sheet's
 * accumulated depreciation and amortization together rise by the $350M).
 */
function fullDa(cf: CompanyFacts, asOf: string): number | null {
  let first = flowLtm(cf, DA, asOf);
  if (first == null) {
    const dep = flowLtm(cf, DEPRECIATION, asOf);
    const amort = flowLtm(cf, AMORTIZATION, asOf);
    if (dep != null && (amort != null || !reports(cf, AMORTIZATION, asOf))) first = dep + (amort ?? 0);
  }
  const an = anchorOf(cf, asOf);
  if (first == null || !an) return first;
  const known = (values: (number | null)[]) => values.filter((v): v is number => v != null);
  const tags = [...DA, ...DA_OTHER];
  // The D&A tags' own full years, where they have an LTM: a year-only reading must beat these.
  const fullYears = DA.map((t) => ltmPeriods(series(cf, [t], "USD", asOf), asOf)).flatMap((p) => (p?.ytd && p.prior ? [p.annual.val] : []));
  const yearFloor = fullYears.length ? Math.max(...fullYears) * 1.01 : 0;
  const yearOnly = (t: string) => !!(an.ytd && an.prior) && tagYtd(cf, t, an, asOf) == null;
  const ltmOf = (t: string) => tagLtm(cf, t, an, asOf);
  const dep = known(DEPRECIATION.map(ltmOf));
  const amort = known(AMORTIZATION.map(ltmOf));
  const depTop = dep.length ? Math.max(...dep) : 0;
  const amortTop = amort.length ? Math.max(...amort) : 0;
  const whole = known(DA.map(ltmOf));
  const amortAlreadyIn = amortTop > 0.4 * depTop && amortTop < depTop && whole.some((v) => Math.abs(v - depTop) <= 0.005 * depTop);
  const partsYearOnly = [...DEPRECIATION, ...AMORTIZATION].some((t) => ltmOf(t) != null && yearOnly(t));
  const sum = depTop + amortTop;
  const parts = (dep.length || amort.length) && !amortAlreadyIn && !(partsYearOnly && sum <= yearFloor) ? [sum] : [];
  const tagged = tags.flatMap((t) => {
    const v = ltmOf(t);
    return v != null && !(yearOnly(t) && v <= yearFloor) ? [v] : [];
  });
  const readings = [...parts, ...tagged, ...known(tags.map((t) => tagYtd(cf, t, an, asOf)))];
  const revenue = flowLtm(cf, REVENUE, asOf, true);
  const fit = revenue != null && revenue > 0 ? readings.filter((v) => v <= DA_MAX_OF_REVENUE * revenue) : readings;
  return Math.max(first, ...fit);
}

/** One-offs over this many times the rest of EBITDA: the windows don't line up, or the business isn't what the figure says. */
const ONE_OFFS_MAX = 4;

/** A gain under this share of adjusted EBITDA stays: small asset sales are routine, and taking them out moved figures both ways. */
const SALE_GAIN_MIN = 0.05;

/**
 * The gain on a sale that sits inside operating income over the company's own window, the largest tag; otherwise 0. Only
 * where the filings show it's there: operating and pre-tax income must both be read, and what lies between them (beyond
 * interest) must not hold the gain (below the line: Pattern Energy). A company reporting discontinued operations of a
 * like size has the gain there, out of operating income altogether (Compuware; Terminix has no operating income to test),
 * and so does one whose net income runs far above its pre-tax income from continuing operations, whatever it tags
 * (MagnaChip: $345M against $11M beside a $287M gain, and no discontinued-operations tag).
 */
function saleGainInOperatingIncome(cf: CompanyFacts, an: Anchor, asOf: string, adjusted: number): number {
  const read = (tag: string) => tagLtm(cf, tag, an, asOf, true);
  const gain = Math.max(0, ...SALE_GAINS.map((t) => read(t) ?? 0));
  if (gain === 0 || gain < SALE_GAIN_MIN * adjusted) return 0;
  const operating = OPERATING_INCOME.map(read).find((v) => v != null);
  const pretax = PRETAX.map(read).find((v) => v != null);
  if (operating == null || pretax == null) return 0;
  const belowTheLine = pretax - (operating - (flowLtm(cf, INTEREST, asOf) ?? 0));
  if (Math.abs(belowTheLine - gain) <= Math.abs(belowTheLine)) return 0;
  if (DISCONTINUED.some((t) => Math.abs(read(t) ?? 0) >= 0.25 * gain)) return 0;
  const net = NET_INCOME.map(read).find((v) => v != null);
  return net != null && net - pretax >= 0.5 * gain ? 0 : gain;
}

/**
 * Adjusted EBITDA, what a bank's precedents table prints: reported EBITDA + the largest impairment tag + restructuring
 * + deal costs + stock compensation, less a large gain on a sale inside operating income. US Ecology: 59.7x reported,
 * 14.1x adjusted, 14.1x in the bank's table; Acacia: 66.6x, 43.9x, 39.0x; Cornerstone Building Brands, $831M of gain on
 * selling a division: 4.1x reported, 8.6x adjusted, 8.4x in the bank's table. Null when the company's window can't be set
 * or the one-offs dwarf the rest (`ONE_OFFS_MAX`). At or below zero once a gain is out, which leaves the multiple blank.
 */
export function adjustedEbitdaOf(cf: CompanyFacts, asOf: string): number | null {
  const reported = ebitdaOf(cf, asOf);
  const an = anchorOf(cf, asOf);
  if (reported == null || !an) return null;
  const largest = (tags: string[]) => Math.max(0, ...tags.map((t) => tagLtm(cf, t, an, asOf, true) ?? 0));
  // A goodwill charge can't exceed the goodwill held when the window opened: Pacira tags its accumulated $163.2M as a 2026 period (about $20M of goodwill left).
  const windowStart = an.prior?.end ?? an.year.start ?? an.year.end;
  const held = Math.max(0, ...series(cf, ["Goodwill"], "USD", asOf).filter((r) => r.end >= windowStart && r.val > 0).map((r) => r.val));
  const impairmentTags = IMPAIRMENT.filter((t) => t !== "GoodwillImpairmentLoss" || !held || (tagLtm(cf, t, an, asOf, true) ?? 0) <= held);
  const oneOffs = Math.max(largest(impairmentTags) + largest(RESTRUCTURING), largest(RESTRUCTURING_AND_IMPAIRMENT)) + largest(DEAL_COSTS);
  const firstOf = (sparse: boolean) => STOCK_COMP.map((t) => tagLtm(cf, t, an, asOf, sparse)).find((v) => v != null);
  const rest = reported + Math.max(0, firstOf(false) ?? firstOf(true) ?? 0);
  if (rest > 0 && oneOffs > ONE_OFFS_MAX * rest) return null;
  const adjusted = rest + oneOffs;
  return adjusted - saleGainInOperatingIncome(cf, an, asOf, adjusted);
}

export interface Multiples {
  enterpriseValueUsd: number | null;
  impliedEquityUsd: number | null;
  /** EV / adjusted EBITDA. Blank for a loss-maker: its adjusted figure is mostly add-backs. */
  evEbitda: number | null;
  /** EV / reported EBITDA (operating income + D&A). */
  evEbitdaReported: number | null;
  evRevenue: number | null;
}

/**
 * EV from the deal terms plus the target's balance sheet.
 * - stated enterprise value: used as is
 * - otherwise equity value (offer price × shares, or the stated equity value) + debt − cash
 * - a bare "transaction value" with nothing better is treated as EV
 */
/**
 * Banks, lenders, brokers and insurers (SIC 6000-6499), and mortgage REITs: deposits, policy reserves and repo
 * funding look like debt, so EV and EV multiples mean nothing for them (they are valued on book value and earnings).
 */
export function isBalanceSheetBusiness(sic: string | null | undefined, name = ""): boolean {
  const n = Number(sic);
  if (n >= 6000 && n < 6500) return true;
  return n === 6798 && /\b(?:mortgage|finance|financial|lending|credit|investment corp|capital (?:corp|trust))\b/i.test(name);
}

/**
 * EBITDA near or above revenue holds something that isn't operating: a REIT's gains on sales it tags no other way
 * (Apartment Income, Spirit Realty, LXP, Plymouth), or net operating income tagged as operating income, which then counts
 * D&A twice (AvalonBay: 2,956 on revenue of 3,065). Blank, not a multiple a bank would never print.
 */
const notOperating = (fin: TargetFinancials | null | undefined) => {
  const revenue = fin?.revenueLtm;
  if (!revenue || revenue <= 0) return false;
  const adjusted = fin?.adjustedEbitdaLtm ?? 0;
  // (Duke Realty's reported figure is as high, but with its sale gains out it's 68% of revenue, an ordinary REIT margin.)
  return adjusted >= 0.9 * revenue || ((fin?.ebitdaLtm ?? 0) >= 0.9 * revenue && adjusted >= 0.75 * revenue);
};

export function computeMultiples(
  deal: { valueUsd: number | null; valueKind: "enterprise" | "equity" | "transaction" | null; pricePerShare: number | null },
  fin: TargetFinancials | null,
  target?: { sic?: string | null; name?: string },
): Multiples {
  // A listed company has at least ~500k shares; fewer means the cover-page figure is in thousands or another class.
  // More than 15 billion means the figure was tagged a thousand times too big (Sun Healthcare's 25 million shares read as
  // 25 billion, a $215M deal as $215B): no target has had that many.
  const shares = fin?.sharesOutstanding && fin.sharesOutstanding >= 500_000 && fin.sharesOutstanding <= 15e9 ? fin.sharesOutstanding : null;
  let impliedEquityUsd = deal.pricePerShare != null && shares ? deal.pricePerShare * shares : null;
  // A deal that big always states its value; price × shares alone never makes one.
  if (impliedEquityUsd != null && !deal.valueUsd && impliedEquityUsd > 100e9) impliedEquityUsd = null;
  // A share count that doesn't fit the stated deal value is stale (a reverse split since the last filing) or the
  // wrong class: trust the stated value instead.
  if (impliedEquityUsd != null && deal.valueUsd && deal.valueKind !== "enterprise" && (impliedEquityUsd / deal.valueUsd > 2 || impliedEquityUsd / deal.valueUsd < 0.5))
    impliedEquityUsd = null;
  if (isBalanceSheetBusiness(target?.sic, target?.name)) return { enterpriseValueUsd: null, impliedEquityUsd, evEbitda: null, evEbitdaReported: null, evRevenue: null };
  // Debt that can't be read (AES tags its own) while the company pays real interest: an equity value plus "no debt"
  // would understate EV badly, so there is no EV unless the deal states one.
  const equity = impliedEquityUsd ?? (deal.valueKind !== "enterprise" ? deal.valueUsd : null);
  if (fin && fin.debt == null && equity && (fin.interestLtm ?? 0) > 0.005 * equity && deal.valueKind !== "enterprise")
    return { enterpriseValueUsd: null, impliedEquityUsd, evEbitda: null, evEbitdaReported: null, evRevenue: null };
  const netDebt = fin && (fin.debt != null || fin.cash != null) ? (fin.debt ?? 0) - (fin.cash ?? 0) : null;

  let ev: number | null = null;
  if (deal.valueKind === "enterprise" && deal.valueUsd) ev = deal.valueUsd;
  // A stated equity value before price × cover-page shares, which miss options and awards.
  else if (deal.valueKind === "equity" && deal.valueUsd && netDebt != null) ev = deal.valueUsd + netDebt;
  else if (impliedEquityUsd != null && netDebt != null) ev = impliedEquityUsd + netDebt;
  else if (deal.valueUsd) ev = deal.valueUsd;
  if (ev != null && ev <= 0) ev = null;

  // Outside these bands a multiple is almost always a units / tagging problem, not a real price.
  const ratio = (num: number | null, den: number | null | undefined, min: number, max: number) => {
    if (num == null || den == null || den <= 0) return null;
    const r = num / den;
    return r >= min && r <= max ? Math.round(r * 10) / 10 : null;
  };
  const evEbitdaReported = ratio(ev, fin?.ebitdaLtm, 3, 75);
  return {
    enterpriseValueUsd: ev,
    impliedEquityUsd,
    // Only where reported EBITDA gives a multiple of its own. A loss-maker's add-backs, or a 75x+ company's, fill a
    // blank with what is mostly a guess: under half of such figures came within 15% of a bank's.
    evEbitda: evEbitdaReported != null && !notOperating(fin) ? ratio(ev, fin?.adjustedEbitdaLtm, 3, 50) : null,
    evEbitdaReported,
    evRevenue: ratio(ev, fin?.revenueLtm, 0.05, 60),
  };
}
