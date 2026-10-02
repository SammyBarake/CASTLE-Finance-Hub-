/**
 * The ripple engine's settings, in one place. The what-if screen reads everything from here, so the engine can change
 * without touching the UI:
 * - switch on second-round effects: `rounds: 2` (effects of effects; 3 is the most supported);
 * - swap in estimated links: set `links` to a link set whose entries carry `value`, `range` and
 *   `status: ESTIMATED` (the ±band then gives way to each link's own range, and the "assumption" badges go away);
 * - change how fast effects fade (`lambda`), the horizon (`quarters`) or the placeholder range (`band`).
 */
import type { Sector } from "../types";
import { DEFAULT_LINKS, type Links, type RippleShock } from "./engine";
import { ASSUMPTION, type Feature, type Macro } from "./links";

export interface RippleSettings {
  /** Shown on the screen so a reader knows which engine produced the numbers. */
  version: string;
  /** Fade per quarter. */
  lambda: number;
  /** Placeholder range on each hand-set link's contribution (0.5 = ±50%). */
  band: number;
  quarters: number;
  /** 1 = direct effects only (v1). 2 = also effects of effects. */
  rounds: number;
  links: Links;
  /** Years of deals behind each bank's sector shares. */
  adviserWindowYears: number;
}

export const RIPPLE_SETTINGS: RippleSettings = {
  version: "v1 · hand-set links",
  lambda: 0.7,
  band: 0.5,
  quarters: 4,
  rounds: 1,
  links: DEFAULT_LINKS,
  adviserWindowYears: 3,
};

/** True while any link in use is hand-set (the screen shows "assumption" badges). */
export const linksAreHandSet = (links: Links) => [...links.features, ...links.sectors, ...links.macro].some((l) => l.status === ASSUMPTION);

export type ShockTarget = { kind: "feature"; feature: Feature; sector: Sector } | { kind: "macro"; macro: Macro };

export interface ShockRange {
  min: number;
  max: number;
  step: number;
  /** "%" for features, "pp" for rates and the spread, "pts" for the VIX. */
  unit: "%" | "pp" | "pts";
}

/** Slider ranges. */
export const SHOCK_RANGES: Record<Feature | Macro, ShockRange> = {
  valuation: { min: -30, max: 30, step: 1, unit: "%" },
  dealCount: { min: -40, max: 40, step: 1, unit: "%" },
  dealValue: { min: -50, max: 50, step: 1, unit: "%" },
  ipoCount: { min: -60, max: 60, step: 1, unit: "%" },
  fedFunds: { min: -3, max: 3, step: 0.25, unit: "pp" },
  treasury10y: { min: -3, max: 3, step: 0.25, unit: "pp" },
  baaSpread: { min: -3, max: 3, step: 0.25, unit: "pp" },
  vix: { min: -20, max: 20, step: 1, unit: "pts" },
};

export const FEATURE_LABELS: Record<Feature, string> = { valuation: "Valuation", dealCount: "Deal count", dealValue: "Deal value", ipoCount: "IPO count" };
/** Mid-sentence form ("Tech IPO count", not "Tech ipo count"). */
export const FEATURE_NOUNS: Record<Feature, string> = { valuation: "valuation", dealCount: "deal count", dealValue: "deal value", ipoCount: "IPO count" };
export const MACRO_LABELS: Record<Macro, string> = { fedFunds: "Fed funds", treasury10y: "10-year yield", baaSpread: "Baa spread", vix: "VIX" };

/** One shock as the screen edits it. */
export interface ShockInput {
  target: ShockTarget;
  size: number;
}

export interface Preset {
  id: string;
  label: string;
  /** One line on what the preset represents. */
  note: string;
  shocks: ShockInput[];
}

export const PRESETS: Preset[] = [
  {
    id: "rates",
    label: "Rates +1%",
    note: "Policy rate and the 10-year both 100 bp higher.",
    shocks: [
      { target: { kind: "macro", macro: "fedFunds" }, size: 1 },
      { target: { kind: "macro", macro: "treasury10y" }, size: 1 },
    ],
  },
  { id: "vix", label: "VIX spike +15", note: "Volatility jumps 15 points.", shocks: [{ target: { kind: "macro", macro: "vix" }, size: 15 }] },
  { id: "tech", label: "Tech rally +20%", note: "Tech valuations 20% higher.", shocks: [{ target: { kind: "feature", feature: "valuation", sector: "Tech" }, size: 20 }] },
  { id: "oil", label: "Oil crash (Energy −25%)", note: "Energy valuations 25% lower.", shocks: [{ target: { kind: "feature", feature: "valuation", sector: "Energy" }, size: -25 }] },
  { id: "credit", label: "Credit crunch (Baa +2)", note: "Baa corporate spreads 200 bp wider.", shocks: [{ target: { kind: "macro", macro: "baaSpread" }, size: 2 }] },
];

export const rangeFor = (t: ShockTarget) => SHOCK_RANGES[t.kind === "feature" ? t.feature : t.macro];
export const targetLabel = (t: ShockTarget) => (t.kind === "feature" ? `${t.sector} ${FEATURE_NOUNS[t.feature]}` : MACRO_LABELS[t.macro]);
export const sameTarget = (a: ShockTarget, b: ShockTarget) =>
  a.kind === b.kind && (a.kind === "feature" ? b.kind === "feature" && a.feature === b.feature && a.sector === b.sector : b.kind === "macro" && a.macro === b.macro);

/** "+20%", "+1.00 pp", "+15 pts". */
export function formatShock(s: ShockInput): string {
  const r = rangeFor(s.target);
  const n = r.unit === "pp" ? s.size.toFixed(2) : String(Math.round(s.size));
  return `${s.size > 0 ? "+" : s.size < 0 ? "−" : ""}${n.replace("-", "")}${r.unit === "%" ? "%" : ` ${r.unit}`}`;
}

/** The screen's shock list as the engine's input (shocks on the same target add up). */
export function toRippleShock(shocks: ShockInput[]): RippleShock {
  const out: RippleShock = { sectors: {}, macro: {} };
  for (const s of shocks) {
    if (s.target.kind === "feature") {
      const sec = (out.sectors![s.target.sector] ??= {});
      sec[s.target.feature] = (sec[s.target.feature] ?? 0) + s.size;
    } else out.macro![s.target.macro] = (out.macro![s.target.macro] ?? 0) + s.size;
  }
  return out;
}
