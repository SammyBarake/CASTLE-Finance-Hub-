/**
 * The landing page's live figures (app/(landing)/page.tsx, and the default link-preview card), computed on the server
 * from the cached dataset and reduced to a few strings, so the page never ships the dataset. The M&A value is the
 * Hub's own figure (the same matrix and year-to-date summary as HubDataProvider), so the two can't drift apart.
 * Pure; uses relative imports because Vitest doesn't resolve "@/".
 */
import { coverageStart } from "./aggregate";
import { formatDate, formatDateLong, formatMonth, formatTimestampET, formatUsd, formatUsdB1 } from "./format";
import { buildVolumeMatrix, completeMonths, headlineFigures, sum, ytdSummary, type VolumeMatrix, type YtdSummary } from "./metrics";
import { initials } from "./names";
import { SECTORS, type HubData, type Sector } from "./types";

/** "Latest deals" lists deals of this size and up (falling back to any disclosed value when there are too few). */
export const NOTABLE_DEAL_USD = 500e6;
/** Below this many deals the year's top bank isn't named (in January one mandate can lead the table). */
export const TOP_ADVISOR_MIN_DEALS = 10;
/** Below this many deals, or before April, the year to date is too thin to headline: the last 12 months stand in. */
export const YTD_MIN_DEALS = 25;

export interface LandingKpi {
  label: string;
  value: string;
  note: string;
  /** Year-on-year change in %, or null for no change chip. */
  changePct: number | null;
  /** A name rather than a figure (smaller type, may wrap). */
  text: boolean;
  title?: string;
}

export interface LandingDeal {
  id: string;
  target: string;
  acquirer: string;
  /** The target's monogram. */
  mark: string;
  /** "Oct 21" */
  date: string;
  value: string;
  sector: Sector;
}

export interface LandingFigures {
  state: "live" | "sample" | "unavailable";
  /** ISO, for the freshness island. */
  asOf: string | null;
  /** The data's own time ("Oct 24, 2026 · 18:00 ET"), never the clock's. */
  asOfLabel: string | null;
  /** Exactly 4, or none when the data is unavailable. */
  kpis: LandingKpi[];
  /** 3–4, or none (the panel is hidden). */
  deals: LandingDeal[];
  dealsNote: string;
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

export function landingFigures(data: HubData): LandingFigures {
  if (data.dataError || !data.totalDeals || !data.asOf) return { state: "unavailable", asOf: null, asOfLabel: null, kpis: [], deals: [], dealsNote: "", ogStats: [] };
  const n = (x: number) => x.toLocaleString("en-US");

  // 1. Deals tracked: the whole dataset (the feed is capped, so never deals.length). The start month only when the
  //    feed holds every deal, since coverageStart needs them all.
  const since = data.deals.length === data.totalDeals ? coverageStart(data.deals) : null;
  const tracked: LandingKpi = {
    label: "Deals tracked",
    value: n(data.totalDeals),
    note: since ? `Public and private targets · from ${formatMonth(since.slice(0, 7))}` : "Public and private targets",
    changePct: null,
    text: false,
    title: "Every deal Castle has read from SEC filings, in any status",
  };

  // 2. Announced M&A value: the Hub's year to date, or the last 12 complete months while the year is young.
  const matrix = buildVolumeMatrix(data.monthlyVolume, data.asOf.slice(0, 7));
  const ytd = ytdSummary(matrix, data.yearToDate);
  let value: LandingKpi;
  let valueOgLabel: string;
  if (ytd && ytd.throughMonth.slice(5) >= "04" && ytd.count >= YTD_MIN_DEALS) {
    value = {
      label: "Announced M&A value",
      value: formatUsd(ytd.value),
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
    value = {
      label: "Announced M&A value",
      value: idx.length ? formatUsd(sum(idx.map((i) => monthValue(matrix, i)))) : "—",
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
          note: `${n(top.dealCount)} deals · ${formatUsdB1(top.dealValueUsd)}`,
          changePct: null,
          text: true,
          title: "Ranked by the value of deals advised, either side",
        }
      : {
          label: `Advisors credited · ${period}`,
          value: entries.length ? n(entries.length) : "—",
          note: entries.length ? "Banks named on this year's deals" : "None credited yet",
          changePct: null,
          text: false,
        };

  // 4. IPOs filed (the expected raise is left out: many filings don't state one yet, so it reads low).
  const headline = data.headline ?? headlineFigures(data.deals, data.ipos);
  const ipos: LandingKpi = {
    label: "IPOs filed",
    value: n(headline.ipoFiledCount),
    note: "Companies in registration, not yet priced",
    changePct: null,
    text: false,
  };

  // Latest deals: the newest live deals of $500M and up, else the newest with any disclosed value; never fewer than 3.
  const open = [...data.deals]
    .sort((a, b) => b.announcedDate.localeCompare(a.announcedDate) || a.id.localeCompare(b.id))
    .filter((d) => d.status !== "Terminated" && d.valueUsd != null);
  let picked = open.filter((d) => d.valueUsd! >= NOTABLE_DEAL_USD).slice(0, 4);
  let dealsNote = `${formatUsd(NOTABLE_DEAL_USD)} and up`;
  if (picked.length < 3) {
    picked = open.slice(0, 4);
    dealsNote = "Newest with a disclosed value";
  }
  if (picked.length < 3) {
    picked = [];
    dealsNote = "";
  }

  return {
    state: data.isSample ? "sample" : "live",
    asOf: data.asOf,
    asOfLabel: formatTimestampET(data.asOf),
    kpis: [tracked, value, advisor, ipos],
    deals: picked.map((d) => ({
      id: d.id,
      target: d.target.name,
      acquirer: d.acquirer.name,
      mark: initials(d.target.name),
      date: formatDate(d.announcedDate).slice(0, 6),
      value: formatUsd(d.valueUsd),
      sector: d.sector,
    })),
    dealsNote,
    ogStats: [
      { label: "Deals tracked", value: tracked.value },
      { label: valueOgLabel, value: value.value },
      { label: "IPOs filed", value: ipos.value },
    ],
  };
}
