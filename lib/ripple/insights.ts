/** Plain-English takeaways for a ripple result (for the what-if screen). */
import { SECTORS, type Sector } from "../types";
import type { RippleResult, RippleShock } from "./engine";
import { FEATURES, type Feature } from "./links";
import { FEATURE_NOUNS } from "./settings";

interface Cell {
  sector: Sector;
  feature: Feature;
  quarter: number;
  mid: number;
}

const pct = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const list = (a: string[]) => (a.length <= 2 ? a.join(" and ") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

/** "Tech deal value −20.0%", or "deal value −20.0% in every sector" when sectors move alike (a macro shock). */
function describe(c: Cell, among: Cell[]): string {
  const feature = FEATURE_NOUNS[c.feature];
  const alike = among.filter((d) => d.feature === c.feature && d.quarter === c.quarter && Math.abs(d.mid - c.mid) < 0.05).map((d) => d.sector);
  if (alike.length === SECTORS.length) return `${feature} ${pct(c.mid)} in every sector`;
  if (alike.length > 1) return `${list(alike)} ${feature} ${pct(c.mid)} each`;
  return `${c.sector} ${feature} ${pct(c.mid)}`;
}

/**
 * Up to three lines: the biggest knock-on rise and fall (the shocked cells themselves left out), and the strongest
 * spillover into a sector that wasn't shocked. IPO cells are skipped while `ipoReady` is false.
 */
export function rippleInsights(result: RippleResult, shock: RippleShock, ipoReady: boolean): string[] {
  const shocked = new Set(Object.entries(shock.sectors ?? {}).flatMap(([s, fs]) => Object.entries(fs ?? {}).filter(([, v]) => v).map(([f]) => `${s}|${f}`)));
  const shockedSectors = new Set([...shocked].map((k) => k.split("|")[0]));
  const cells: Cell[] = result.quarters.flatMap((q) =>
    SECTORS.flatMap((sector) => FEATURES.map((feature) => ({ sector, feature, quarter: q.quarter, mid: q.sectors[sector][feature].mid }))),
  );
  const knockOn = cells.filter((c) => !shocked.has(`${c.sector}|${c.feature}`) && (ipoReady || c.feature !== "ipoCount") && Math.abs(c.mid) >= 0.5);
  if (!knockOn.length) return [];
  const out: string[] = [];
  const rise = [...knockOn].sort((a, b) => b.mid - a.mid)[0];
  const fall = [...knockOn].sort((a, b) => a.mid - b.mid)[0];
  if (rise.mid > 0) out.push(`Biggest knock-on rise: ${describe(rise, knockOn)} in Q${rise.quarter}.`);
  if (fall.mid < 0) out.push(`Biggest knock-on fall: ${describe(fall, knockOn)} in Q${fall.quarter}.`);
  const spills = knockOn.filter((c) => shockedSectors.size && !shockedSectors.has(c.sector));
  const spill = [...spills].sort((a, b) => Math.abs(b.mid) - Math.abs(a.mid))[0];
  if (spill) out.push(`Strongest spillover: ${describe(spill, spills)} in Q${spill.quarter}, through the sector links.`);
  else if (!shockedSectors.size) {
    const last = result.quarters.length;
    const peak = Math.max(...knockOn.map((c) => Math.abs(c.mid)));
    const end = Math.max(0, ...knockOn.filter((c) => c.quarter === last).map((c) => Math.abs(c.mid)));
    out.push(`Effects fade ${Math.round((1 - result.lambda) * 100)}% a quarter once their links have fired: the largest move is ${peak.toFixed(1)}% at its peak and ${end.toFixed(1)}% by Q${last}.`);
  }
  return out;
}
