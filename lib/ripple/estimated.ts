/**
 * The estimated link set: the hand-set links' structure and reasons, with numbers estimated from Castle's history
 * (research/estimate_links.py writes estimated.json; the method and the link-by-link comparison are in
 * research/link-estimates.md).
 *
 * Every link carries its estimate, 90% range, sample size and data weight. It drops the "assumption" status only when
 * the data outweighs its hand-set prior (data weight ≥ meta.enoughData); a link that is still mostly prior keeps the
 * badge. A macro effect the data finds sector-specific becomes one link per sector, each with its own estimate.
 */
import type { Sector } from "../types";
import { DEFAULT_LINKS, type Links } from "./engine";
import data from "./estimated.json";
import { ASSUMPTION, ESTIMATED, linkKey, STRENGTH_SCALE, type Feature, type FeatureLink, type Lag, type Macro, type MacroLink, type SectorLink, type Strength } from "./links";

interface EstimateRow {
  key: string;
  value: number;
  range: number[];
  n: number;
  weight: number;
  prior: number;
  /** Feature links the data finds differ by sector: one value per target sector. */
  bySector?: Partial<Record<Sector, number>>;
}

interface MacroRow extends EstimateRow {
  from: Macro;
  to: Feature;
  lag: Lag;
  sectors: Sector[] | "all";
  /** The hand-set link whose reason this estimate inherits. */
  basedOn: string;
}

export interface EstimatesFile {
  meta: {
    generatedAt: string;
    window: { from: string; to: string; quarters: number };
    ipoHistory: boolean;
    /** Data weight at which a link counts as estimated. */
    enoughData: number;
    bootstrapRuns: number;
  };
  features: EstimateRow[];
  sectors: EstimateRow[];
  macro: MacroRow[];
}

type Kind = keyof typeof STRENGTH_SCALE;

/** The strength word nearest to a value (boundaries halfway between the scale's steps, on a log scale). */
export function strengthOf(kind: Kind, value: number): Strength {
  const s = STRENGTH_SCALE[kind];
  const a = Math.abs(value);
  return a >= Math.sqrt(s.strong * s.moderate) ? "strong" : a >= Math.sqrt(s.moderate * s.weak) ? "moderate" : "weak";
}

function withEstimate<T extends FeatureLink | SectorLink | MacroLink>(link: T, row: EstimateRow, kind: Kind, enough: number): T {
  return {
    ...link,
    value: row.value,
    range: [row.range[0], row.range[1]],
    n: row.n,
    weight: row.weight,
    prior: row.prior,
    direction: row.value < 0 ? "-" : "+",
    strength: strengthOf(kind, row.value),
    status: row.weight >= enough ? ESTIMATED : ASSUMPTION,
    ...(row.bySector ? { bySector: row.bySector } : {}),
  };
}

/**
 * The hand-set links with the file's estimates applied. Feature and sector links the file doesn't cover stay as they
 * are. Macro links come from the file alone: it lists every hand-set macro link except those the data put at zero
 * (a separate sector effect it found no sign of), which are left out on purpose.
 */
export function applyEstimates(hand: Links, file: EstimatesFile): Links {
  const enough = file.meta.enoughData;
  const rows = (list: EstimateRow[]) => new Map(list.map((r) => [r.key, r]));
  const features = rows(file.features);
  const sectors = rows(file.sectors);
  const handMacro = new Map(hand.macro.map((l) => [linkKey(l), l]));
  return {
    features: hand.features.map((l) => (features.has(linkKey(l)) ? withEstimate(l, features.get(linkKey(l))!, "feature", enough) : l)),
    sectors: hand.sectors.map((l) => (sectors.has(linkKey(l)) ? withEstimate(l, sectors.get(linkKey(l))!, "sector", enough) : l)),
    macro: file.macro.length
      ? file.macro.flatMap((r) => {
          const base = handMacro.get(r.basedOn);
          return base ? [withEstimate({ ...base, sectors: r.sectors }, r, "macro", enough)] : [];
        })
      : hand.macro,
  };
}

export const ESTIMATES = data as unknown as EstimatesFile;
export const ESTIMATED_LINKS: Links = applyEstimates(DEFAULT_LINKS, ESTIMATES);
