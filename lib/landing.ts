/**
 * The landing page's live figures (app/(landing)/page.tsx, and the default link-preview card), computed on the server
 * from the cached dataset and reduced to a few strings, so the page never ships the dataset. The M&A value is the
 * Hub's own figure (the same matrix and year-to-date summary as HubDataProvider), so the two can't drift apart.
 * Pure; uses relative imports because Vitest doesn't resolve "@/".
 */
import { coverageStart } from "./aggregate";
import { considerationLabel, formatDateFull, formatDateLong, formatMonth, formatMultiple, formatPct, formatPrice, formatRaise, formatTimestampET, formatUsd, formatUsdB1 } from "./format";
import { dataDay } from "./freshness";
import { buildVolumeMatrix, completeMonths, headlineFigures, sum, ytdSummary, type VolumeMatrix, type YtdSummary } from "./metrics";
import { initials, isPlaceholderBuyer, withoutLegalForm } from "./names";
import { monthAngle, plateSeries, spokeTip } from "./plate";
import { dealSize, DEFAULT_PRECEDENTS, PRECEDENT_SPEC, screenPrecedents, summarizeComps, type PrecedentScreen } from "./precedents";
import { termsRows, termsStats } from "./terms";
import { SECTORS, type Deal, type HubData, type Ipo, type Sector } from "./types";
import { encodeState } from "./urlState";

/** "Latest deals" lists deals of this size and up (falling back to any disclosed value when there are too few). */
export const NOTABLE_DEAL_USD = 500e6;
/** Below this many deals the year's top bank isn't named (in January one mandate can lead the table). */
export const TOP_ADVISOR_MIN_DEALS = 10;
/** Below this many deals, or before April, the year to date is too thin to headline: the last 12 months stand in. */
export const YTD_MIN_DEALS = 25;
/** The record on the notes leaf is the newest fully stated deal of at least this size. */
export const RECORD_MIN_USD = 1e9;
/** The engraved league ring needs this much lettering to fill its circle (fewer scatters single letters around it). */
export const LEAGUE_RING_MIN_CHARS = 120;
/** A comps set needs this many deals stating both EV / EBITDA and a premium. */
export const COMPS_MIN = 8;

export interface LandingKpi {
  label: string;
  value: string;
  /** The value set large: "$652B", not "$652.21B" (hundredths at poster size read as false precision). */
  figure: string;
  note: string;
  /** Year-on-year change in %, or null for no change chip. */
  changePct: number | null;
  /** A name rather than a figure (smaller type, may wrap). */
  text: boolean;
  title?: string;
}

export interface LandingFiling {
  form: string;
  /** "Oct 15" */
  filed: string;
  url: string;
}

export interface LandingDeal {
  id: string;
  target: string;
  acquirer: string;
  /** The target's monogram. */
  mark: string;
  /** "Oct 21" */
  date: string;
  /** "October 21, 2026" */
  dateFull: string;
  /** "$5.71B", the card's title. */
  value: string;
  /** Set large, in at most three significant figures: "$115B", "$5.71B". */
  figure: string;
  /** "to acquire", or "acquired" once closed. */
  verb: string;
  /** The lead bank on each side, the target's first. */
  advisors: string[];
  /** How many more banks are credited: nobody's left out without saying so. */
  moreAdvisors: number;
  /** Every credited bank by side, for the card's title. */
  advisorsTitle: string;
  filing: LandingFiling | null;
}

/** One month on the plate's readout. */
export interface PlateMonth {
  key: string;
  /** "December 2025" */
  label: string;
  value: string;
  deals: number;
  largest: { label: string; value: string; id: string } | null;
}

export interface LandingPlate {
  /** Ties the image's URL to this dataset. */
  version: string;
  months: PlateMonth[];
  /** Where the readout rests: the last complete month. */
  rest: number;
  /** The largest month, labelled on the plate. */
  peak: { index: number; angle: number; radius: number; label: string };
  /** The month in progress, if the data ends with one. */
  partial: boolean;
  /** "January 2021" and "October 2026" */
  from: string;
  to: string;
  /** January ticks: where each year starts on the dial. */
  years: { label: string; angle: number }[];
  /** The year's banks by value, for the engraved ring. */
  league: string[];
  leaguePeriod: string;
}

export interface SpecimenDeal {
  id: string;
  date: string;
  acquirer: string;
  target: string;
  value: string;
  premium: string;
  payment: string;
}

export interface LandingSpecimens {
  dealFlow: { rows: SpecimenDeal[] };
  precedents: {
    screen: string;
    href: string;
    n: number;
    rows: { id: string; target: string; acquirer: string; value: string; evEbitda: string; evRevenue: string; premium: string }[];
    summary: { label: string; value: string; evEbitda: string; evRevenue: string; premium: string }[];
  } | null;
  advisors: { period: string; rows: { rank: number; name: string; deals: number; value: string; share: number }[] };
  ipos: { filed: number; priced: number; trading: number; rows: { company: string; stage: string; date: string; raise: string; bank: string }[] };
  terms: { n: number; medianBreak: string; medianReverse: string; goShop: string; noFinancing: string; bands: { label: string; n: number; targetFee: string; reverseFee: string }[] } | null;
}

/** One fully stated deal, as Castle holds it. */
export interface LandingRecord {
  id: string;
  acquirer: string;
  target: string;
  date: string;
  verb: string;
  value: string;
  price: string;
  premium: string;
  payment: string;
  evEbitda: string;
  evRevenue: string;
  targetAdvisors: string;
  acquirerAdvisors: string;
  filing: LandingFiling;
  /** The linked document is the announcement's press release, which states the terms (a bare 8-K often states few of them). */
  isRelease: boolean;
}

/** The live counts where a contents page has its page numbers; null when the feed doesn't hold every deal. */
export interface LandingCounts {
  deals: number;
  multiples: number | null;
  banks: number;
  ipos: number;
  terms: number | null;
}

export interface LandingFigures {
  state: "live" | "sample" | "unavailable";
  /** ISO, for the freshness island. */
  asOf: string | null;
  /** The data's own time ("Oct 24, 2026 · 18:00 ET"), never the clock's. */
  asOfLabel: string | null;
  /** Exactly 4 (tracked, value, advisor, IPOs), or none when the data is unavailable. */
  kpis: LandingKpi[];
  /** 3–4, or none (the leaf is hidden). */
  deals: LandingDeal[];
  dealsNote: string;
  plate: LandingPlate | null;
  counts: LandingCounts | null;
  specimens: LandingSpecimens | null;
  record: LandingRecord | null;
  /** Three figures for the link-preview card. */
  ogStats: { label: string; value: string }[];
}

const monthValue = (matrix: VolumeMatrix, i: number) => sum(SECTORS.map((s) => matrix.bySector[s].value[i]));

/** Last year's value over the same span as this year's (complete months only, when the exact day isn't known). */
function priorYearValue(matrix: VolumeMatrix, ytd: YtdSummary, toDate: HubData["yearToDate"]): number {
  if (ytd.throughDay) return toDate?.priorValue ?? 0;
  const prior = String(ytd.year - 1);
  return sum(matrix.months.map((m, i) => (m.slice(0, 4) === prior && m.slice(5) <= ytd.throughMonth.slice(5) ? monthValue(matrix, i) : 0)));
}

/** "$652B", "$98.4B", "$5.71B", "$1.21T", "$980M": three significant figures, for figures set large. */
export function formatUsdShort(value: number | null): string {
  if (value == null) return "—";
  if (value === 0) return "$0";
  if (value < 5e5) return "<$1M";
  if (value >= 999.5e9) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 99.95e9) return `$${Math.round(value / 1e9)}B`;
  if (value >= 9.995e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 999.5e6) return `$${(value / 1e9).toFixed(2)}B`;
  return `$${Math.round(value / 1e6)}M`;
}

/** "Oct 8" */
const shortDay = (iso: string) => formatDateLong(iso).split(",")[0];

const filingOf = (d: Pick<Deal, "filings">): LandingFiling | null => {
  const f = d.filings[0];
  return f?.url ? { form: f.form.replace(/\s*\(.*\)$/, ""), filed: shortDay(f.filedDate), url: f.url } : null;
};

/**
 * A name fit to set large: a vehicle or a defined term is not (a parser slip that is harmless in a table is not on a
 * tombstone). A registrant's SEC name is always real ("Frontier Communications Parent, Inc."), so a target with a CIK passes.
 */
const fitForDisplay = (d: Deal) => !isPlaceholderBuyer(d.acquirer.name) && (!!d.target.cik || !isPlaceholderBuyer(d.target.name));

/** Words that say which company a name is; generic ones would join two unrelated deals. */
const NAME_NOISE = new Set(["inc", "incorporated", "corp", "corporation", "company", "holdings", "holding", "group", "partners", "capital", "the", "and", "ltd", "limited", "llc", "plc", "international", "technologies", "technology", "systems", "solutions", "services", "financial", "energy", "health", "healthcare"]);
const nameWords = (name: string) => name.toLowerCase().split(/[^a-z0-9&]+/).filter((w) => w.length >= 3 && !NAME_NOISE.has(w));

/** One deal read twice: the same value on the same day, with a party in common ("CD&R" → McKesson, "CD&R and McKesson" → Option Care). Round values collide, so the value alone proves nothing. */
export function sameDealTwice(a: Deal, b: Deal): boolean {
  if (a.announcedDate !== b.announcedDate || a.valueUsd !== b.valueUsd) return false;
  const words = new Set([...nameWords(a.acquirer.name), ...nameWords(a.target.name)]);
  return [...nameWords(b.acquirer.name), ...nameWords(b.target.name)].some((w) => words.has(w));
}

const distinctDeals = (deals: Deal[]) => deals.filter((d, i) => !deals.slice(0, i).some((e) => sameDealTwice(e, d)));

/**
 * Tombstones: the newest live deals of $500M and up, else the newest with any disclosed value; never fewer than 3. One
 * deal read twice appears once, the better documented record.
 */
function pickDeals(deals: Deal[]): { picked: Deal[]; note: string } {
  const credited = (d: Deal) => d.acquirerAdvisors.length + d.targetAdvisors.length;
  const open = [...deals]
    .sort((a, b) => b.announcedDate.localeCompare(a.announcedDate) || credited(b) - credited(a) || a.id.localeCompare(b.id))
    .filter((d) => d.status !== "Terminated" && d.valueUsd != null && fitForDisplay(d));
  const distinct = distinctDeals(open);
  let picked = distinct.filter((d) => d.valueUsd! >= NOTABLE_DEAL_USD).slice(0, 4);
  let note = `${formatUsd(NOTABLE_DEAL_USD)} and up`;
  if (picked.length < 3) {
    picked = distinct.slice(0, 4);
    note = "Newest with a disclosed value";
  }
  if (picked.length < 3) {
    picked = [];
    note = "";
  }
  return { picked, note };
}

const verbOf = (d: Deal) => (d.status === "Closed" ? "acquired" : "to acquire");

function landingDeal(d: Deal): LandingDeal {
  const lead = [...new Set([d.targetAdvisors[0], d.acquirerAdvisors[0]].filter(Boolean))];
  const all = new Set([...d.targetAdvisors, ...d.acquirerAdvisors]);
  return {
    id: d.id,
    target: withoutLegalForm(d.target.name),
    acquirer: withoutLegalForm(d.acquirer.name),
    mark: initials(d.target.name),
    date: shortDay(d.announcedDate),
    dateFull: formatDateFull(d.announcedDate),
    value: formatUsd(d.valueUsd),
    figure: formatUsdShort(d.valueUsd),
    verb: verbOf(d),
    advisors: lead,
    moreAdvisors: all.size - lead.length,
    advisorsTitle: [d.targetAdvisors.length ? `Target: ${d.targetAdvisors.join(", ")}.` : "", d.acquirerAdvisors.length ? `Acquirer: ${d.acquirerAdvisors.join(", ")}.` : ""].filter(Boolean).join(" "),
    filing: filingOf(d),
  };
}

const LONG_MONTH = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

function landingPlate(data: HubData, matrix: VolumeMatrix, asOf: string): LandingPlate | null {
  const { months } = matrix;
  if (months.length < 12) return null;
  const series = plateSeries(matrix);
  const totals = months.map((_, i) => monthValue(matrix, i));
  if (!Math.max(...totals)) return null;
  const peakIndex = totals.indexOf(Math.max(...totals));
  const ringNames = data.leagueTable.entries.slice(0, 14).map((e) => e.advisor.name);
  // The largest deal of each month, by the same rule as the chart (terminated deals don't count).
  const largest = new Map<string, Deal>();
  for (const d of data.deals) {
    if (d.status === "Terminated" || d.valueUsd == null) continue;
    const m = d.announcedDate.slice(0, 7);
    if (d.valueUsd > (largest.get(m)?.valueUsd ?? 0)) largest.set(m, d);
  }
  const plateMonths: PlateMonth[] = months.map((key, i) => {
    const top = largest.get(key);
    return {
      key,
      label: LONG_MONTH(key),
      value: formatUsdShort(totals[i]),
      deals: sum(SECTORS.map((s) => matrix.bySector[s].count[i])),
      // The month's total counts this deal, so it's always named; a buyer that's still a vehicle just isn't.
      largest: top ? { label: isPlaceholderBuyer(top.acquirer.name) ? withoutLegalForm(top.target.name) : `${withoutLegalForm(top.acquirer.name)} → ${withoutLegalForm(top.target.name)}`, value: formatUsdShort(top.valueUsd), id: top.id } : null,
    };
  });
  return {
    version: asOf,
    months: plateMonths,
    rest: Math.max(0, completeMonths(matrix) - 1),
    peak: { index: peakIndex, angle: monthAngle(peakIndex, months.length), radius: spokeTip(series, peakIndex), label: `${formatMonth(months[peakIndex])} · ${formatUsdShort(totals[peakIndex])}` },
    partial: series.partial,
    from: LONG_MONTH(months[0]),
    to: LONG_MONTH(months[months.length - 1]),
    years: months.flatMap((m, i) => (m.endsWith("-01") ? [{ label: m.slice(0, 4), angle: monthAngle(i, months.length) }] : [])),
    league: ringNames.join("").length >= LEAGUE_RING_MIN_CHARS ? ringNames : [],
    leaguePeriod: data.leagueTable.period,
  };
}

const specimenDeal = (d: Deal): SpecimenDeal => ({
  id: d.id,
  date: shortDay(d.announcedDate),
  acquirer: withoutLegalForm(d.acquirer.name),
  target: withoutLegalForm(d.target.name),
  value: formatUsd(d.valueUsd),
  premium: formatPct(d.premiumPct),
  payment: d.consideration ? considerationLabel(d.consideration) : "—",
});

/**
 * The comps set the page leads with: one screen a banker would really run, not the sector with the most deals (Industrials
 * is the residual bucket: a payments processor, a boat retailer and a snack maker would be the "comparables"). The first
 * with enough deals that state both a multiple and a premium; the link opens that same screen on Precedents.
 */
const COMPS_SCREENS: { label: string; sector: Sector; industry: string }[] = [
  { label: "Software", sector: "Tech", industry: "software" },
  { label: "Pharmaceuticals", sector: "Healthcare", industry: "pharmaceutical" },
  { label: "Oil and gas", sector: "Energy", industry: "crude petroleum" },
  { label: "Semiconductors", sector: "Tech", industry: "semiconductor" },
];

function precedentsSpecimen(deals: Deal[], asOf: string): LandingSpecimens["precedents"] {
  for (const { label, sector, industry } of COMPS_SCREENS) {
    const screen: PrecedentScreen = { ...DEFAULT_PRECEDENTS, sector, industry, min: "1" };
    const all = screenPrecedents(deals, screen, asOf);
    const stated = all.filter((d) => d.evEbitda != null && d.premiumPct != null && fitForDisplay(d));
    if (stated.length < COMPS_MIN) continue;
    const comps = summarizeComps(all);
    const query = encodeState(screen, DEFAULT_PRECEDENTS, PRECEDENT_SPEC);
    return {
      screen: `${label}, $1B and up, past 24 months`,
      href: `/precedents${query ? `?${query}` : ""}`,
      n: all.length,
      rows: stated.slice(0, 5).map((d) => ({
        id: d.id,
        target: withoutLegalForm(d.target.name),
        acquirer: withoutLegalForm(d.acquirer.name),
        value: formatUsd(dealSize(d)),
        evEbitda: formatMultiple(d.evEbitda),
        evRevenue: formatMultiple(d.evRevenue),
        premium: formatPct(d.premiumPct),
      })),
      summary: (["p75", "median", "p25"] as const).map((key) => ({
        label: key === "p75" ? "75th percentile" : key === "median" ? "Median" : "25th percentile",
        value: formatUsd(comps.size[key]),
        evEbitda: formatMultiple(comps.evEbitda[key]),
        evRevenue: formatMultiple(comps.evRevenue[key]),
        premium: formatPct(comps.premium[key]),
      })),
    };
  }
  return null;
}

function ipoSpecimen(ipos: Ipo[]): LandingSpecimens["ipos"] {
  const stage = (s: Ipo["stage"]) => ipos.filter((i) => i.stage === s).length;
  const newest = [...ipos].sort((a, b) => (b.pricedDate ?? b.filedDate).localeCompare(a.pricedDate ?? a.filedDate) || a.id.localeCompare(b.id));
  return {
    filed: stage("Filed"),
    priced: stage("Priced"),
    trading: stage("Trading"),
    rows: newest.slice(0, 5).map((i) => ({
      company: withoutLegalForm(i.company.name),
      stage: i.stage,
      date: shortDay(i.pricedDate ?? i.filedDate),
      raise: formatRaise(i.expectedRaiseUsd),
      bank: i.underwriters[0] ?? "—",
    })),
  };
}

function termsSpecimen(deals: Deal[]): LandingSpecimens["terms"] {
  const s = termsStats(termsRows(deals));
  if (s.count < 20) return null;
  return {
    n: s.count,
    medianBreak: formatPct(s.medianTargetFee),
    medianReverse: formatPct(s.medianReverseFee),
    goShop: s.goShopSharePct == null ? "—" : `${s.goShopSharePct}%`,
    noFinancing: s.noFinancingConditionPct == null ? "—" : `${s.noFinancingConditionPct}%`,
    bands: s.bySize.map((b) => ({ label: b.label, n: b.n, targetFee: formatPct(b.targetFee), reverseFee: formatPct(b.reverseFee) })),
  };
}

/**
 * The newest deal of $1B or more that states value, price, premium, payment and both sides' banks, with a filing to check
 * it against. One whose first filing is the press release wins, since that's the document that states the terms: a bare 8-K
 * states the price and little else, and the card invites the reader to check.
 */
function pickRecord(deals: Deal[]): LandingRecord | null {
  const full = [...deals]
    .sort((a, b) => b.announcedDate.localeCompare(a.announcedDate) || a.id.localeCompare(b.id))
    .filter(
      (x) =>
        x.status !== "Terminated" &&
        !x.privateTarget &&
        (x.valueUsd ?? 0) >= RECORD_MIN_USD &&
        x.pricePerShare != null &&
        x.premiumPct != null &&
        x.consideration != null &&
        x.targetAdvisors.length > 0 &&
        x.acquirerAdvisors.length > 0 &&
        fitForDisplay(x) &&
        !!filingOf(x),
    );
  const isRelease = (x: Deal) => /EX-99/i.test(x.filings[0]?.form ?? "");
  const d = full.find(isRelease) ?? full[0];
  if (!d) return null;
  return {
    id: d.id,
    acquirer: withoutLegalForm(d.acquirer.name),
    target: withoutLegalForm(d.target.name),
    date: formatDateFull(d.announcedDate),
    verb: verbOf(d),
    value: formatUsd(d.valueUsd),
    price: formatPrice(d.pricePerShare),
    premium: formatPct(d.premiumPct),
    payment: considerationLabel(d.consideration),
    evEbitda: formatMultiple(d.evEbitda),
    evRevenue: formatMultiple(d.evRevenue),
    targetAdvisors: d.targetAdvisors.join(", "),
    acquirerAdvisors: d.acquirerAdvisors.join(", "),
    filing: filingOf(d)!,
    isRelease: isRelease(d),
  };
}

export function landingFigures(data: HubData): LandingFigures {
  if (data.dataError || !data.totalDeals || !data.asOf)
    return { state: "unavailable", asOf: null, asOfLabel: null, kpis: [], deals: [], dealsNote: "", plate: null, counts: null, specimens: null, record: null, ogStats: [] };
  const n = (x: number) => x.toLocaleString("en-US");
  const fullFeed = data.deals.length === data.totalDeals;

  // 1. Deals tracked: the whole dataset (the feed is capped, so never deals.length). The start month only when the
  //    feed holds every deal, since coverageStart needs them all.
  const since = fullFeed ? coverageStart(data.deals) : null;
  const tracked: LandingKpi = {
    label: "Deals tracked",
    value: n(data.totalDeals),
    figure: n(data.totalDeals),
    note: since ? `Public and private targets · coverage from ${formatMonth(since.slice(0, 7))}` : "Public and private targets",
    changePct: null,
    text: false,
    title: "All deals Castle has read from SEC filings, in any status",
  };

  // 2. Announced M&A value: the Hub's year to date, or the last 12 complete months while the year is young.
  const matrix = buildVolumeMatrix(data.monthlyVolume, dataDay(data.asOf).slice(0, 7));
  const ytd = ytdSummary(matrix, data.yearToDate);
  let value: LandingKpi;
  let valueOgLabel: string;
  if (ytd && ytd.throughMonth.slice(5) >= "04" && ytd.count >= YTD_MIN_DEALS) {
    value = {
      label: "Announced M&A value",
      value: formatUsd(ytd.value),
      figure: formatUsdShort(ytd.value),
      // HubView's ytdNote, word for word.
      note: ytd.throughDay ? `Jan 1 – ${formatDateLong(ytd.throughDay)} · YoY` : `Jan–${formatMonth(ytd.throughMonth).split(" ")[0]} ${ytd.year} · YoY`,
      // Nothing to compare with last year: no change rather than "+0.0%".
      changePct: priorYearValue(matrix, ytd, data.yearToDate) ? ytd.valueChangePct : null,
      text: false,
      title: `${n(ytd.count)} deals, against the same days of ${ytd.year - 1}. Stated or implied (offer price × shares) values only.`,
    };
    valueOgLabel = `M&A value, ${ytd.year} YTD`;
  } else {
    const end = completeMonths(matrix);
    const start = Math.max(0, end - 12);
    const idx = Array.from({ length: end - start }, (_, k) => start + k);
    const span = idx.length === 1 ? "month" : `${idx.length} months`;
    const total = idx.length ? sum(idx.map((i) => monthValue(matrix, i))) : null;
    value = {
      label: "Announced M&A value",
      value: formatUsd(total),
      figure: formatUsdShort(total),
      note: idx.length ? `Last ${span} · ${formatMonth(matrix.months[start])} – ${formatMonth(matrix.months[end - 1])}` : "No complete month yet",
      changePct: null,
      text: false,
      title: "Stated or implied (offer price × shares) values only.",
    };
    valueOgLabel = `M&A value, last ${span}`;
  }

  // 3. The year's top advisor, ranked by value like the Hub's "Leading advisors"; just a count while the year is young.
  const { entries, period } = data.leagueTable;
  const top = entries[0];
  const advisor: LandingKpi =
    top && top.dealCount >= TOP_ADVISOR_MIN_DEALS
      ? {
          label: `Top advisor · ${period}`,
          value: top.advisor.name,
          figure: top.advisor.name,
          note: `${n(top.dealCount)} deals · ${formatUsdB1(top.dealValueUsd)}`,
          changePct: null,
          text: true,
          title: "Ranked by the value of deals advised, either side",
        }
      : {
          label: `Advisors credited · ${period}`,
          value: entries.length ? n(entries.length) : "—",
          figure: entries.length ? n(entries.length) : "—",
          note: entries.length ? "Banks named on this year's deals" : "None credited yet",
          changePct: null,
          text: false,
        };

  // 4. IPOs filed (the expected raise is left out: many filings don't state one yet, so it reads low).
  const headline = data.headline ?? headlineFigures(data.deals, data.ipos);
  const ipos: LandingKpi = {
    label: "IPOs filed",
    value: n(headline.ipoFiledCount),
    figure: n(headline.ipoFiledCount),
    note: "Companies in registration, not yet priced",
    changePct: null,
    text: false,
  };

  const { picked, note: dealsNote } = pickDeals(data.deals);
  const terms = termsRows(data.deals).length;
  const newest = distinctDeals([...data.deals].sort((a, b) => b.announcedDate.localeCompare(a.announcedDate) || a.id.localeCompare(b.id)).filter((d) => d.status !== "Terminated" && d.valueUsd != null && fitForDisplay(d)));

  return {
    state: data.isSample ? "sample" : "live",
    asOf: data.asOf,
    asOfLabel: formatTimestampET(data.asOf),
    kpis: [tracked, value, advisor, ipos],
    deals: picked.map(landingDeal),
    dealsNote,
    plate: landingPlate(data, matrix, data.asOf),
    counts: {
      deals: data.totalDeals,
      // What the row opens: Precedents' default screen.
      multiples: fullFeed ? screenPrecedents(data.deals, DEFAULT_PRECEDENTS, data.asOf).length : null,
      banks: entries.length,
      ipos: headline.ipoFiledCount,
      terms: fullFeed && terms ? terms : null,
    },
    specimens: {
      dealFlow: { rows: newest.slice(0, 6).map(specimenDeal) },
      precedents: precedentsSpecimen(data.deals, data.asOf),
      advisors: {
        period,
        rows: entries.slice(0, 6).map((e, i) => ({ rank: i + 1, name: e.advisor.name, deals: e.dealCount, value: formatUsdB1(e.dealValueUsd), share: top?.dealValueUsd ? e.dealValueUsd / top.dealValueUsd : 0 })),
      },
      ipos: ipoSpecimen(data.ipos),
      terms: termsSpecimen(data.deals),
    },
    record: pickRecord(data.deals),
    ogStats: [
      { label: "Deals tracked", value: tracked.value },
      { label: valueOgLabel, value: value.value },
      { label: "IPOs filed", value: ipos.value },
    ],
  };
}
