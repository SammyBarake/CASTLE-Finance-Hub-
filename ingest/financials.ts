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
 */
export const FINANCIALS_VERSION = 2;

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
  const withDur = rows.filter((f) => f.start).map((f) => ({ ...f, dur: days(f.start!, f.end) }));
  const annual = withDur.filter((f) => f.dur > 340 && f.dur < 380).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
  if (!annual || (asOf && days(annual.end, asOf) > 460)) return null;
  // Year-to-date period that starts right after the last fiscal year ended.
  const ytd = withDur
    .filter((f) => f.dur < 340 && f.dur > 60 && Math.abs(days(annual.end, f.start!) - 1) <= 7 && f.end > annual.end)
    .sort((a, b) => b.end.localeCompare(a.end))[0];
  if (!ytd) return annual.val;
  const prior = withDur.find((f) => Math.abs(f.dur - ytd.dur) <= 10 && Math.abs(days(f.end, ytd.end) - 365) <= 10);
  return prior ? annual.val + ytd.val - prior.val : annual.val;
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
  ebitdaLtm: number | null;
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
  let da = flowLtm(cf, DA, asOf);
  if (da == null) {
    const dep = flowLtm(cf, DEPRECIATION, asOf);
    const amort = flowLtm(cf, AMORTIZATION, asOf);
    if (dep != null && (amort != null || !reports(cf, AMORTIZATION, asOf))) da = dep + (amort ?? 0);
  }
  return opInc != null && da != null ? opInc + da : null;
}

export interface Multiples {
  enterpriseValueUsd: number | null;
  impliedEquityUsd: number | null;
  evEbitda: number | null;
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
  if (isBalanceSheetBusiness(target?.sic, target?.name)) return { enterpriseValueUsd: null, impliedEquityUsd, evEbitda: null, evRevenue: null };
  // Debt that can't be read (AES tags its own) while the company pays real interest: an equity value plus "no debt"
  // would understate EV badly, so there is no EV unless the deal states one.
  const equity = impliedEquityUsd ?? (deal.valueKind !== "enterprise" ? deal.valueUsd : null);
  if (fin && fin.debt == null && equity && (fin.interestLtm ?? 0) > 0.005 * equity && deal.valueKind !== "enterprise")
    return { enterpriseValueUsd: null, impliedEquityUsd, evEbitda: null, evRevenue: null };
  const netDebt = fin && (fin.debt != null || fin.cash != null) ? (fin.debt ?? 0) - (fin.cash ?? 0) : null;

  let ev: number | null = null;
  if (deal.valueKind === "enterprise" && deal.valueUsd) ev = deal.valueUsd;
  else if (impliedEquityUsd != null && netDebt != null) ev = impliedEquityUsd + netDebt;
  else if (deal.valueKind === "equity" && deal.valueUsd && netDebt != null) ev = deal.valueUsd + netDebt;
  else if (deal.valueUsd) ev = deal.valueUsd;
  if (ev != null && ev <= 0) ev = null;

  // Outside these bands a multiple is almost always a units / tagging problem, not a real price.
  const ratio = (num: number | null, den: number | null | undefined, min: number, max: number) => {
    if (num == null || den == null || den <= 0) return null;
    const r = num / den;
    return r >= min && r <= max ? Math.round(r * 10) / 10 : null;
  };
  return {
    enterpriseValueUsd: ev,
    impliedEquityUsd,
    evEbitda: ratio(ev, fin?.ebitdaLtm, 3, 75),
    evRevenue: ratio(ev, fin?.revenueLtm, 0.05, 60),
  };
}
