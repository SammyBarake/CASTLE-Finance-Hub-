import type { Deal } from "./types";

type Cell = string | number | null | undefined;

const cell = (v: Cell) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** CSV text with a leading "Data type" column so sample exports are never mistaken for real data. */
export function toCsv(headers: string[], rows: Cell[][], isSample: boolean): string {
  const source = isSample ? "SAMPLE (FICTIONAL)" : "SEC EDGAR";
  return [["Data type", ...headers], ...rows.map((r) => [source, ...r])].map((r) => r.map(cell).join(",")).join("\r\n");
}

export function dealsToCsv(deals: Deal[], isSample: boolean): string {
  return toCsv(
    [
      "Announced date",
      "Acquirer",
      "Acquirer ticker",
      "Target",
      "Target ticker",
      "Deal value (USD)",
      "Price per share (USD)",
      "Premium (%)",
      "Consideration",
      "Sector",
      "Status",
      "Enterprise value (USD)",
      "EV/EBITDA",
      "EV/Revenue",
      "Acquirer advisors",
      "Target advisors",
    ],
    deals.map((d) => [
      d.announcedDate,
      d.acquirer.name,
      d.acquirer.ticker,
      d.target.name,
      d.target.ticker,
      d.valueUsd,
      d.pricePerShare,
      d.premiumPct,
      d.consideration,
      d.sector,
      d.status,
      d.enterpriseValueUsd,
      d.evEbitda,
      d.evRevenue,
      d.acquirerAdvisors.join("; "),
      d.targetAdvisors.join("; "),
    ]),
    isSample,
  );
}

export function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
