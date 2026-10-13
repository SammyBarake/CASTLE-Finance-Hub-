/** Plain-English takeaways for a ripple result (for the what-if screen). */
import { SECTORS, type Sector } from "../types";
import type { Contribution, RippleResult, RippleShock } from "./engine";
import { FEATURES, type Feature } from "./links";
import { fadeSummary, FEATURE_NOUNS } from "./settings";

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
    // The fades themselves are in the grid's legend; one line here keeps the takeaway short.
    const uniform = new Set(Object.values(result.lambda)).size === 1;
    out.push(
      uniform
        ? `Once their links fire, ${fadeSummary(result.lambda)}: the largest move is ${peak.toFixed(1)}% at its peak and ${end.toFixed(1)}% by Q${last}.`
        : `The largest move peaks at ${peak.toFixed(1)}% and is still ${end.toFixed(1)}% by Q${last}.`,
    );
  }
  return out;
}

/** "the Baa spread widened 200bp", "the Fed funds rate fell 50bp", "the VIX jumped 15 points", "Tech valuation rose 20%". */
function cause(source: string, shock: RippleShock): string | null {
  const macro: Record<string, { name: string; up: string; down: string; unit: (v: number) => string }> = {
    fedFunds: { name: "the Fed funds rate", up: "rose", down: "fell", unit: (v) => `${Math.round(Math.abs(v) * 100)}bp` },
    treasury10y: { name: "the 10-year yield", up: "rose", down: "fell", unit: (v) => `${Math.round(Math.abs(v) * 100)}bp` },
    baaSpread: { name: "the Baa spread", up: "widened", down: "tightened", unit: (v) => `${Math.round(Math.abs(v) * 100)}bp` },
    vix: { name: "the VIX", up: "jumped", down: "fell", unit: (v) => `${Math.abs(v)} points` },
  };
  if (source in macro) {
    const v = shock.macro?.[source as keyof NonNullable<RippleShock["macro"]>];
    if (!v) return null;
    const m = macro[source];
    return `${m.name} ${v > 0 ? m.up : m.down} ${m.unit(v)}`;
  }
  const [sector, feature] = source.split(" ") as [Sector, Feature];
  const v = shock.sectors?.[sector]?.[feature];
  if (!v || !(feature in FEATURE_NOUNS)) return null;
  return `${sector} ${FEATURE_NOUNS[feature]} ${v > 0 ? "rose" : "fell"} ${Math.abs(v)}%`;
}

/**
 * One plain-English line for a result: which input drives it ("Financials deal value +3.2% by Q4, mainly because the Baa
 * spread widened 200bp (80% of the move)."). Paths are grouped by the input they started from.
 */
export function driverSentence(title: string, quarter: number, contributions: Contribution[], shock: RippleShock): string | null {
  const total = contributions.reduce((t, c) => t + c.value, 0);
  if (Math.abs(total) < 0.05) return contributions.length ? `${title} barely moves by Q${quarter}: its paths cancel out.` : null;
  const bySource = new Map<string, number>();
  for (const c of contributions) bySource.set(c.kind === "shock" ? "__shock__" : c.source, (bySource.get(c.kind === "shock" ? "__shock__" : c.source) ?? 0) + c.value);
  const [top, value] = [...bySource.entries()].filter(([, v]) => Math.sign(v) === Math.sign(total)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] ?? [];
  const head = `${title} ${pct(total)} by Q${quarter}`;
  if (!top || value == null) return `${head}.`;
  if (top === "__shock__") return `${head}: the move you set, ${Math.abs(total) < Math.abs(value) ? "partly offset by knock-on effects" : "plus its knock-on effects"}.`;
  const why = cause(top, shock);
  if (!why) return `${head}.`;
  const share = Math.min(100, Math.round((value / total) * 100));
  return `${head}, ${share >= 60 ? "mainly" : "partly"} because ${why}${share < 100 ? ` (${share}% of the move)` : ""}.`;
}
