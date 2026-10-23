import type { Cell, Workbook, Worksheet } from "exceljs";
import {
  aggregateResult,
  colLetter,
  DEFAULT_WIDTHS,
  NUMBER_FORMATS,
  numbersIn,
  sheetName,
  SUMMARY_ROWS,
  summaryResult,
  type CellValue,
  type Column,
  type SheetSpec,
  type WorkbookSpec,
} from "./spec";

/**
 * A spec (lib/excel/spec.ts) → a styled ExcelJS workbook, in the terminal's look: a black title band, a dark header
 * row, quiet banding, Arial throughout, no gridlines. Takes the ExcelJS module as an argument so the browser can load
 * it on demand (it is large) and tests can use the Node build.
 */
export type ExcelModule = { Workbook: new () => Workbook };

const INK = "FF0B0B0B";
const HEAD = "FF1B1B1B";
const BAND = "FFF6F6F6";
const RULE = "FFE4E4E4";
const MUTED = "FF8A8A8A";
const SAMPLE = "FFB23B3B";
const FONT = "Arial";
const TABLE_TOP = 4; // header row of a table sheet: title band (1–2), a gap (3)

const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
const font = (size = 10, extra: { bold?: boolean; italic?: boolean; color?: string; underline?: boolean } = {}) => ({
  name: FONT,
  size,
  bold: extra.bold,
  italic: extra.italic,
  underline: extra.underline,
  color: { argb: extra.color ?? "FF111111" },
});

const isLink = (v: CellValue): v is { text: string; link: string } => typeof v === "object" && v !== null && "link" in v;
/** "2026-10-15" → a UTC date, which Excel stores as that day. */
const toDate = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : v;
};
const asOfLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function setValue(cell: Cell, value: CellValue, column: Column) {
  if (value == null || value === "") return;
  if (isLink(value)) {
    cell.value = { text: value.text, hyperlink: value.link };
    cell.font = font(10, { underline: true, color: "FF1F3F66" });
    return;
  }
  cell.value = column.format === "date" && typeof value === "string" ? toDate(value) : value;
  const fmt = NUMBER_FORMATS[column.format];
  if (fmt) cell.numFmt = fmt;
}

/** The black band at the top of a table sheet: title and subtitle on the left, the wordmark and date on the right. */
function band(ws: Worksheet, width: number, title: string, subtitle: string, right: string) {
  const last = colLetter(Math.max(width, 2));
  ws.getRow(1).height = 32;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 8;
  for (let r = 1; r <= 2; r++) for (let c = 1; c <= Math.max(width, 2); c++) ws.getCell(r, c).fill = fill(INK);
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = font(15, { bold: true, color: "FFFFFFFF" });
  ws.getCell("A1").alignment = { vertical: "middle" };
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = font(9, { color: "FFA3A3A3" });
  ws.getCell(`${last}1`).value = "C A S T L E";
  ws.getCell(`${last}1`).font = font(11, { bold: true, color: "FFFFFFFF" });
  ws.getCell(`${last}1`).alignment = { horizontal: "right", vertical: "middle" };
  ws.getCell(`${last}2`).value = right;
  ws.getCell(`${last}2`).font = font(8, { color: "FFA3A3A3" });
  ws.getCell(`${last}2`).alignment = { horizontal: "right" };
}

function tableSheet(wb: Workbook, spec: SheetSpec, name: string, ctx: { asOf: string; isSample: boolean }) {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: "FF5A5A5A" } }, views: [{ state: "frozen", ySplit: TABLE_TOP, showGridLines: false }] });
  const n = spec.columns.length;
  ws.columns = spec.columns.map((c) => ({ width: c.width ?? DEFAULT_WIDTHS[c.format] }));
  band(ws, n, spec.title, spec.subtitle ?? "", `${ctx.isSample ? "SAMPLE DATA · " : ""}SEC EDGAR · as of ${asOfLabel(ctx.asOf)}`);

  const header = ws.getRow(TABLE_TOP);
  header.height = 30;
  spec.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.fill = fill(HEAD);
    cell.font = font(9, { bold: true, color: "FFFFFFFF" });
    cell.alignment = { vertical: "middle", horizontal: c.format === "text" || c.format === "date" ? "left" : "right", wrapText: true };
  });

  const first = TABLE_TOP + 1;
  spec.rows.forEach((values, r) => {
    const row = ws.getRow(first + r);
    spec.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = font(10);
      setValue(cell, values[i] ?? null, c);
      if (r % 2 === 1) cell.fill = fill(BAND);
      cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
      if (c.format !== "text" && c.format !== "date") cell.alignment = { horizontal: "right" };
    });
  });
  const lastRow = first + spec.rows.length - 1;
  if (spec.rows.length) ws.autoFilter = { from: { row: TABLE_TOP, column: 1 }, to: { row: TABLE_TOP, column: n } };

  let next = lastRow + 2;
  if (spec.summary && spec.rows.length) {
    SUMMARY_ROWS.forEach((s, k) => {
      const row = ws.getRow(next + k);
      const label = row.getCell(1);
      label.value = s.label;
      label.font = font(10, { bold: true });
      spec.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (k === 0) cell.border = { top: { style: "medium", color: { argb: INK } } };
        if (s.key === "median") {
          cell.fill = fill("FFEDEDED");
          cell.font = font(10, { bold: true });
        }
        if (!c.summary) return;
        const range = `${colLetter(i + 1)}${first}:${colLetter(i + 1)}${lastRow}`;
        const values = numbersIn(spec.rows, i);
        cell.value = { formula: `IFERROR(${s.fn(range)},"")`, result: summaryResult(s.key, values) ?? "" };
        const fmt = NUMBER_FORMATS[c.format];
        if (fmt) cell.numFmt = fmt;
        cell.alignment = { horizontal: "right" };
      });
    });
    next += SUMMARY_ROWS.length + 1;
  }
  for (const note of spec.notes ?? []) {
    const cell = ws.getCell(next, 1);
    cell.value = note;
    cell.font = font(8, { italic: true, color: MUTED });
    next++;
  }

  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${TABLE_TOP}:${TABLE_TOP}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  ws.headerFooter.oddFooter = "&L&8Castle · &A&R&8Page &P of &N";
  return { ws, first, lastRow };
}

/** The cover: logo, title, the selection behind the export, key figures (live formulas), contents, notes and sources. */
function cover(wb: Workbook, spec: WorkbookSpec, sheets: { name: string; spec: SheetSpec; first: number; lastRow: number }[], opts: { logoBase64?: string; origin: string }) {
  const ws = wb.getWorksheet("Summary")!;
  ws.columns = [{ width: 3 }, { width: 30 }, { width: 58 }, { width: 14 }, { width: 14 }, { width: 14 }];
  for (let r = 1; r <= 6; r++) {
    ws.getRow(r).height = r === 1 || r === 6 ? 10 : 22;
    for (let c = 1; c <= 6; c++) ws.getCell(r, c).fill = fill(INK);
  }
  if (opts.logoBase64) {
    const id = wb.addImage({ base64: opts.logoBase64, extension: "png" });
    ws.addImage(id, { tl: { col: 1.05, row: 1.15 }, ext: { width: 96, height: 74 }, editAs: "absolute" });
  }
  ws.getCell("C2").value = spec.title;
  ws.getCell("C2").font = font(18, { bold: true, color: "FFFFFFFF" });
  ws.getCell("C3").value = spec.subtitle;
  ws.getCell("C3").font = font(10, { color: "FFC4C4C4" });
  ws.getCell("C4").value = `Data as of ${asOfLabel(spec.asOf)} · exported ${asOfLabel(new Date().toISOString())}`;
  ws.getCell("C4").font = font(9, { color: "FF8F8F8F" });
  ws.getCell("C5").value = { text: opts.origin.replace(/^https?:\/\//, ""), hyperlink: opts.origin };
  ws.getCell("C5").font = font(9, { color: "FF8F8F8F", underline: true });

  let r = 8;
  if (spec.isSample) {
    ws.mergeCells(`B${r}:F${r}`);
    const cell = ws.getCell(`B${r}`);
    cell.value = "SAMPLE DATA · fictional transactions for local development, not real deals";
    cell.fill = fill(SAMPLE);
    cell.font = font(10, { bold: true, color: "FFFFFFFF" });
    r += 2;
  }
  const heading = (text: string) => {
    const cell = ws.getCell(`B${r}`);
    cell.value = text;
    cell.font = font(8, { bold: true, color: MUTED });
    for (let c = 2; c <= 6; c++) ws.getCell(r, c).border = { bottom: { style: "thin", color: { argb: RULE } } };
    r++;
  };
  const pair = (label: string, value: CellValue | { formula: string; result: number | string }, numFmt?: string) => {
    ws.getCell(`B${r}`).value = label;
    ws.getCell(`B${r}`).font = font(10, { color: "FF555555" });
    const cell = ws.getCell(`C${r}`);
    if (value && typeof value === "object" && "formula" in value) cell.value = value;
    else if (value != null && !(typeof value === "object" && "link" in value)) cell.value = value;
    else if (value) cell.value = { text: value.text, hyperlink: value.link };
    cell.font = font(10, { bold: true });
    cell.alignment = { horizontal: "left" };
    if (numFmt) cell.numFmt = numFmt;
    r++;
  };

  if (spec.intro?.text.trim()) {
    heading(spec.intro.heading);
    for (const para of spec.intro.text.split(/\n+/).filter((p) => p.trim())) {
      ws.mergeCells(`B${r}:F${r}`);
      const cell = ws.getCell(`B${r}`);
      cell.value = para.trim();
      cell.font = font(10);
      cell.alignment = { wrapText: true, vertical: "top" };
      ws.getRow(r).height = Math.max(16, Math.ceil(para.length / 95) * 14);
      r++;
    }
    r++;
  }
  if (spec.selection?.length) {
    heading("SELECTION");
    for (const s of spec.selection) {
      const [label, ...rest] = s.split(": ");
      pair(rest.length ? label : "Filter", rest.length ? rest.join(": ") : s);
    }
    r++;
  }
  if (spec.figures?.length) {
    heading("KEY FIGURES");
    for (const f of spec.figures) {
      if ("value" in f) {
        pair(f.label, f.value ?? "—", NUMBER_FORMATS[f.format]);
        continue;
      }
      const sheet = sheets.find((s) => s.spec.name === f.sheet);
      const col = sheet?.spec.columns.findIndex((c) => c.header === f.column) ?? -1;
      if (!sheet || col < 0 || !sheet.spec.rows.length) {
        pair(f.label, "—");
        continue;
      }
      const range = `'${sheet.name}'!${colLetter(col + 1)}${sheet.first}:${colLetter(col + 1)}${sheet.lastRow}`;
      const fn = { count: "ROWS", sum: "SUM", median: "MEDIAN", average: "AVERAGE", max: "MAX", min: "MIN" }[f.agg];
      const result = aggregateResult(f.agg, numbersIn(sheet.spec.rows, col), sheet.spec.rows.length);
      const format = f.agg === "count" ? NUMBER_FORMATS.int : NUMBER_FORMATS[sheet.spec.columns[col].format];
      pair(f.label, { formula: `IFERROR(${fn}(${range}),"")`, result: result ?? "" }, format);
    }
    r++;
  }
  heading("CONTENTS");
  for (const s of sheets) pair(s.spec.title, { text: s.name, link: `#'${s.name}'!A1` });
  r++;
  const notes = [
    ...(spec.notes ?? []),
    "Money is in U.S. dollars, millions ($M). Percentages are shown as %, multiples as x. A blank means the filings don't state the figure: Castle never estimates one.",
    "Summary rows and key figures are live formulas: edit or delete rows and they recalculate.",
  ];
  heading("NOTES");
  for (const note of notes) {
    ws.mergeCells(`B${r}:F${r}`);
    const cell = ws.getCell(`B${r}`);
    cell.value = note;
    cell.font = font(9, { color: "FF555555" });
    cell.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = Math.max(15, Math.ceil(note.length / 105) * 13);
    r++;
  }
  r++;
  heading("SOURCE");
  for (const line of [
    "Castle · free investment banking data, read automatically from public SEC EDGAR filings.",
    "Figures are extracted automatically and may contain errors; check the source filings (linked on each row) before relying on them. Not investment advice.",
  ]) {
    ws.mergeCells(`B${r}:F${r}`);
    const cell = ws.getCell(`B${r}`);
    cell.value = line;
    cell.font = font(9, { color: "FF555555" });
    cell.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(r).height = Math.max(15, Math.ceil(line.length / 105) * 13);
    r++;
  }
  ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
}

export function buildWorkbook(ExcelJS: ExcelModule, spec: WorkbookSpec, opts: { logoBase64?: string; origin: string }): Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Castle";
  wb.created = new Date();
  wb.title = spec.title;
  wb.company = "Castle";
  const taken = new Set<string>(["summary"]);
  // The cover comes first; its figures need the tables' names and row ranges, so it is filled in last.
  wb.addWorksheet("Summary", { properties: { tabColor: { argb: INK } }, views: [{ showGridLines: false }] });
  const sheets = spec.sheets.map((s) => {
    const name = sheetName(s.name, taken);
    const { first, lastRow } = tableSheet(wb, s, name, { asOf: spec.asOf, isSample: spec.isSample });
    return { name, spec: s, first, lastRow };
  });
  cover(wb, spec, sheets, opts);
  return wb;
}
