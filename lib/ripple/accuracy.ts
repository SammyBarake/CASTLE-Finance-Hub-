/**
 * The What-if Accuracy page's numbers and sentences, from the backtest (lib/ripple/backtest.json). Pure.
 */
import type { BacktestFile, CellSummary } from "./backtest";
import { FEATURES, type Feature } from "./links";

export const FEATURE_NAMES: Record<Feature, string> = { valuation: "Valuations", dealCount: "Deal counts", dealValue: "Deal values", ipoCount: "IPO counts" };
const AHEAD = ["the same quarter", "one quarter after a shock", "two quarters after", "three quarters after"];
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** "2021Q3" + 2 quarters → "2022Q1". */
export function addQuarters(label: string, n: number): string {
  const qi = Number(label.slice(0, 4)) * 4 + Number(label.slice(5)) - 1 + n;
  return `${Math.floor(qi / 4)}Q${(qi % 4) + 1}`;
}

/** Predicted and realised deviation (average over sectors) for one feature, k quarters into each forecast, by the quarter forecast. */
export function forecastSeries(file: BacktestFile, feature: Feature, k: number) {
  const rows = file.points.filter((p) => p.feature === feature && (p.predicted[k - 1] != null || p.realized[k - 1] != null));
  return {
    labels: rows.map((p) => addQuarters(p.quarter, k - 1)),
    predicted: rows.map((p) => p.predicted[k - 1]),
    realized: rows.map((p) => p.realized[k - 1]),
  };
}

/** The best-scored horizon for a feature (by direction, with enough cases). */
function best(file: BacktestFile, f: Feature, min = 50): (CellSummary & { k: number }) | null {
  return file.features[f].filter((c) => c.n >= min && c.hitRate != null).sort((a, b) => b.hitRate! - a.hitRate! || (b.skill ?? 0) - (a.skill ?? 0))[0] ?? null;
}

/** Three or four number-led lines for the page's takeaways. */
export function accuracyInsights(file: BacktestFile): string[] {
  const out: string[] = [];
  const flows = (["ipoCount", "dealCount"] as Feature[]).map((f) => ({ f, c: best(file, f) })).filter((x) => x.c);
  const top = flows.sort((a, b) => b.c!.hitRate! - a.c!.hitRate!)[0];
  if (top) out.push(`${FEATURE_NAMES[top.f]}: direction right ${pct(top.c!.hitRate!)} of the time ${AHEAD[top.c!.k - 1]}, against 50% for a coin flip.`);
  const val = file.summary.chosen.valuation;
  if (val.hitRate != null) out.push(`Valuations: right ${pct(val.hitRate)} of the time; most of that skill is price moves persisting rather than reversing.`);
  const dv = pool(file.features.dealValue);
  if (dv != null && dv < 0.56) out.push(`Deal values are close to a coin flip (${pct(dv)} right): one megadeal can make or break a sector's quarter.`);
  const held = file.halves.every((h) => h.chosen > h.previous);
  out.push(
    `Tuning lifted average skill from ${file.summary.previous.score.toFixed(3)} to ${file.summary.chosen.score.toFixed(3)}${held ? ", and it held in both halves of the period" : ""}.`,
  );
  return out;
}

/** Pooled direction rate over a feature's horizons. */
function pool(cells: (CellSummary & { k: number })[]): number | null {
  const scored = cells.filter((c) => c.hitRate != null && c.n);
  const n = scored.reduce((t, c) => t + c.n, 0);
  return n ? scored.reduce((t, c) => t + c.hitRate! * c.n, 0) / n : null;
}

/** Rows for "what tuning changed": before and after for each setting. */
export function tuningChanges(file: BacktestFile): { setting: string; before: string; after: string }[] {
  const fade = (l: number) => (l >= 0.995 ? "persist" : `${Math.round((1 - l) * 100)}%/qtr`);
  const ch = file.chosen;
  return [
    { setting: "Links", before: "estimated, normal priors", after: ch.linkSet === "hand-set" ? "hand-set" : `estimated, priors ×${ch.priorScale}` },
    { setting: "Effects of effects", before: "off", after: ch.rounds === 1 ? "off" : `${ch.rounds} rounds` },
    ...FEATURES.map((f) => ({ setting: `${FEATURE_NAMES[f]} fade`, before: "30%/qtr", after: fade(ch.lambda[f]) })),
    { setting: "Average skill", before: file.summary.previous.score.toFixed(3), after: file.summary.chosen.score.toFixed(3) },
  ];
}
