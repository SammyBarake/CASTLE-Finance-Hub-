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
interface CompanyFacts {
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
const CASH = ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashAndCashEquivalents"];
const SHARES = ["EntityCommonStockSharesOutstanding"];

const FORMS = /^(10-K|10-Q|20-F|40-F|10-KT|10-QT)(\/A)?$/;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

function series(cf: CompanyFacts, concepts: string[], unit: string, asOf: string): Fact[] {
  // Pick the concept with the most recent data point; companies switch tags over time.
  let best: Fact[] = [];
  let bestEnd = "";
  for (const taxonomy of ["us-gaap", "ifrs-full", "dei"]) {
    for (const c of concepts) {
      const rows = cf.facts[taxonomy]?.[c]?.units[unit]?.filter((f) => f.filed <= asOf && FORMS.test(f.form) && f.end <= asOf) ?? [];
      const end = rows.reduce((m, f) => (f.end > m ? f.end : m), "");
      if (end > bestEnd) {
        best = rows;
        bestEnd = end;
      }
    }
  }
  return best;
}

/** Last-twelve-months value of a flow concept (revenue, operating income, D&A). */
export function ltm(rows: Fact[]): number | null {
  const withDur = rows.filter((f) => f.start).map((f) => ({ ...f, dur: days(f.start!, f.end) }));
  const annual = withDur.filter((f) => f.dur > 340 && f.dur < 380).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
  if (!annual) return null;
  // Year-to-date period that starts right after the last fiscal year ended.
  const ytd = withDur
    .filter((f) => f.dur < 340 && f.dur > 60 && Math.abs(days(annual.end, f.start!) - 1) <= 7 && f.end > annual.end)
    .sort((a, b) => b.end.localeCompare(a.end))[0];
  if (!ytd) return annual.val;
  const prior = withDur.find((f) => Math.abs(f.dur - ytd.dur) <= 10 && Math.abs(days(f.end, ytd.end) - 365) <= 10);
  return prior ? annual.val + ytd.val - prior.val : annual.val;
}

/** Latest point-in-time value (balance-sheet items). Multiple share classes on the same date are summed. */
export function latestInstant(rows: Fact[], sumSameDate = false): number | null {
  const instants = rows.filter((f) => !f.start || days(f.start, f.end) < 2);
  if (!instants.length) return null;
  const end = instants.reduce((m, f) => (f.end > m ? f.end : m), "");
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
}

export async function getTargetFinancials(cik: string, asOf: string): Promise<TargetFinancials | null> {
  let cf: CompanyFacts;
  try {
    cf = await getJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
  const usd = (concepts: string[]) => series(cf, concepts, "USD", asOf);

  const revenueLtm = ltm(usd(REVENUE));
  const opInc = ltm(usd(OPERATING_INCOME));
  const da = ltm(usd(DA));
  const ebitdaLtm = opInc != null && da != null ? opInc + da : null;

  const ltd = latestInstant(usd(["LongTermDebt"]));
  const ltdNon = latestInstant(usd(["LongTermDebtNoncurrent"]));
  const ltdCur = latestInstant(usd(["LongTermDebtCurrent", "DebtCurrent"]));
  const stb = latestInstant(usd(["ShortTermBorrowings", "CommercialPaper"]));
  const debtCore = ltd ?? (ltdNon != null || ltdCur != null ? (ltdNon ?? 0) + (ltdCur ?? 0) : null);
  const debt = debtCore != null || stb != null ? (debtCore ?? 0) + (stb ?? 0) : null;

  return {
    revenueLtm,
    ebitdaLtm,
    debt,
    cash: latestInstant(usd(CASH)),
    sharesOutstanding: latestInstant(series(cf, SHARES, "shares", asOf), true),
  };
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
export function computeMultiples(
  deal: { valueUsd: number | null; valueKind: "enterprise" | "equity" | "transaction" | null; pricePerShare: number | null },
  fin: TargetFinancials | null,
): Multiples {
  const impliedEquityUsd = deal.pricePerShare != null && fin?.sharesOutstanding ? deal.pricePerShare * fin.sharesOutstanding : null;
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
