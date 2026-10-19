"use client";

import type { WorkbookSpec } from "@/lib/excel/spec";

/**
 * Builds and downloads an Excel workbook in the browser. ExcelJS (~1 MB) and the builder load on the first export,
 * never with the page.
 */

let logo: Promise<string | undefined> | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The white crest and wordmark, drawn on the cover's black band. */
const loadLogo = () =>
  (logo ??= fetch("/castle-logo.png")
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => (buf ? toBase64(buf) : undefined))
    .catch(() => undefined));

export async function downloadWorkbook(spec: WorkbookSpec): Promise<void> {
  const [mod, { buildWorkbook }, logoBase64] = await Promise.all([import("exceljs"), import("@/lib/excel/build"), loadLogo()]);
  const ExcelJS = ((mod as unknown as { default?: unknown }).default ?? mod) as Parameters<typeof buildWorkbook>[0];
  const wb = buildWorkbook(ExcelJS, spec, { logoBase64, origin: window.location.origin });
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${spec.fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Dates, sample flag and the address the workbook's links point to (this site). */
export const exportContext = (data: { asOf: string; isSample: boolean }) => ({ asOf: data.asOf, isSample: data.isSample, site: window.location.origin });
