/**
 * Excel exports, described as data: a workbook is a cover sheet (title, selection, key figures, sources) and one or
 * more tables. Pure: `lib/excel/build.ts` turns a spec into an ExcelJS workbook, and the browser downloads it
 * (`components/export/excel.ts`). Values are stored the way an analyst would key them: money in $ millions, percentages
 * as fractions shown as %, multiples as numbers shown as "x", dates as real Excel dates, a blank where Castle has none.
 */

export type ColumnFormat = "text" | "date" | "usdM" | "price" | "pct" | "pct2" | "multiple" | "int" | "change";

export interface Column {
  header: string;
  format: ColumnFormat;
  /** Width in characters; a default follows the format. */
  width?: number;
  /** Include in the summary rows (High … Low) under the table. */
  summary?: boolean;
}

export type Link = { text: string; link: string };
export type CellValue = string | number | null | Link;

export interface SheetSpec {
  /** Tab name (at most 31 characters, no []:*?/\). */
  name: string;
  title: string;
  subtitle?: string;
  columns: Column[];
  rows: CellValue[][];
  /** High, 75th percentile, mean, median, 25th percentile and low of the summary columns, as live formulas. */
  summary?: boolean;
  /** Small print under the table. */
  notes?: string[];
}

/** A figure on the cover: a formula over a table column (kept live in Excel), or a fixed value. */
export type Figure =
  | { label: string; sheet: string; column: string; agg: "count" | "sum" | "median" | "average" | "max" | "min" }
  | { label: string; value: CellValue; format: ColumnFormat };

export interface WorkbookSpec {
  /** Without extension. */
  fileName: string;
  title: string;
  subtitle: string;
  /** ISO timestamp of the data. */
  asOf: string;
  isSample: boolean;
  /** The selection behind the export ("Sector: Tech", "Announced: last 3 years"). */
  selection?: string[];
  figures?: Figure[];
  sheets: SheetSpec[];
  /** Definitions for this export, on the cover. */
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Value helpers: Castle's units → spreadsheet units
// ---------------------------------------------------------------------------

/** USD → $ millions, one decimal. */
export const usdM = (usd: number | null | undefined): number | null => (usd == null || !Number.isFinite(usd) ? null : Math.round(usd / 1e5) / 10);
/** Castle's whole-number percent (34.2) → a fraction Excel shows as 34.2%. */
export const pctFrac = (pct: number | null | undefined): number | null => (pct == null || !Number.isFinite(pct) ? null : Math.round(pct * 10) / 1000);
export const num = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);
export const link = (text: string | null | undefined, url: string | null | undefined): CellValue => (text ? (url ? { text, link: url } : text) : null);

export const NUMBER_FORMATS: Record<ColumnFormat, string | undefined> = {
  text: undefined,
  date: "mmm d, yyyy",
  usdM: "#,##0.0",
  price: "$#,##0.00",
  pct: "0.0%",
  pct2: "0.00%",
  multiple: '0.0"x"',
  int: "#,##0",
  change: '[Color10]+0;[Red]-0;"–"',
};

export const DEFAULT_WIDTHS: Record<ColumnFormat, number> = { text: 22, date: 13, usdM: 13, price: 11, pct: 10, pct2: 10, multiple: 11, int: 9, change: 9 };

export const SUMMARY_ROWS = [
  { key: "high", label: "High", fn: (r: string) => `MAX(${r})` },
  { key: "p75", label: "75th percentile", fn: (r: string) => `PERCENTILE.INC(${r},0.75)` },
  { key: "mean", label: "Mean", fn: (r: string) => `AVERAGE(${r})` },
  { key: "median", label: "Median", fn: (r: string) => `MEDIAN(${r})` },
  { key: "p25", label: "25th percentile", fn: (r: string) => `PERCENTILE.INC(${r},0.25)` },
  { key: "low", label: "Low", fn: (r: string) => `MIN(${r})` },
] as const;

/** Column number (1-based) → letters: 1 → A, 27 → AA. */
export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** A tab name Excel accepts: at most 31 characters, none of []:*?/\, unique within the workbook. */
export function sheetName(name: string, taken: Set<string> = new Set()): string {
  const base = name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let out = base;
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  taken.add(out.toLowerCase());
  return out;
}

/** A safe file name: "Castle_Precedents_Tech_2026-10-19". */
export const fileName = (...parts: (string | null | undefined)[]) =>
  parts
    .filter(Boolean)
    .map((p) => p!.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean)
    .join("_");

/** The numbers in a column, for cached formula results. */
export const numbersIn = (rows: CellValue[][], col: number) => rows.map((r) => r[col]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));

/** Percentile like Excel's PERCENTILE.INC (linear interpolation between closest ranks). */
export function percentileInc(values: number[], p: number): number | null {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  const i = (xs.length - 1) * p;
  const lo = Math.floor(i);
  return xs[lo] + (xs[Math.ceil(i)] - xs[lo]) * (i - lo);
}

/** What Excel will show for a summary formula, written as the cached result so previews (Quick Look, mail) show it too. */
export function summaryResult(key: (typeof SUMMARY_ROWS)[number]["key"], values: number[]): number | null {
  if (!values.length) return null;
  switch (key) {
    case "high":
      return Math.max(...values);
    case "low":
      return Math.min(...values);
    case "mean":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "median":
      return percentileInc(values, 0.5);
    case "p75":
      return percentileInc(values, 0.75);
    case "p25":
      return percentileInc(values, 0.25);
  }
}

export function aggregateResult(agg: "count" | "sum" | "median" | "average" | "max" | "min", values: number[], rowCount: number): number | null {
  if (agg === "count") return rowCount;
  if (!values.length) return null;
  if (agg === "sum") return values.reduce((a, b) => a + b, 0);
  if (agg === "average") return values.reduce((a, b) => a + b, 0) / values.length;
  if (agg === "median") return percentileInc(values, 0.5);
  if (agg === "max") return Math.max(...values);
  return Math.min(...values);
}
