import type { Deal } from "./types";

const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function dealsToCsv(deals: Deal[], isSample: boolean): string {
  const headers = [
    "Data type",
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
    "Acquirer advisors",
    "Target advisors",
  ];
  const rows = deals.map((d) => [
    isSample ? "SAMPLE (FICTIONAL)" : "SEC EDGAR",
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
    d.acquirerAdvisors.join("; "),
    d.targetAdvisors.join("; "),
  ]);
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
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
