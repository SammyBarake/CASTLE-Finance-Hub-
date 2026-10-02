/**
 * The what-if "ripple engine". Pure functions, no UI. Settings live in ./settings.ts.
 *
 * State: 20 variables = 4 features × 5 sectors, feature-major (index = feature * 5 + sector), each a % deviation
 * from what would have happened without the shock. Macro inputs (Fed funds, 10-year, Baa spread, VIX) can be
 * shocked but receive no feedback.
 *
 * Links: A_lag = C_lag ⊗ L for lags 0, 1, 2 (C = feature links, L = sector links), so entry
 * A[(f, s), (g, t)] = C[f][g] · L[s][t]: how feature g in sector t moves feature f in sector s. A variable does not
 * link to itself (the diagonal of A is zeroed); its own shock simply fades. M_lag maps macro shocks onto the 20.
 *
 * Dynamics: every effect is an impulse that lands in some quarter and then fades by λ a quarter. The shock lands in
 * quarter 1. An impulse on variable j landing in quarter q drives a lag-ℓ link to variable i: a new impulse of
 * A_ℓ[i][j] × its size, landing in quarter q + ℓ. Macro shocks land through M the same way. With one round
 * (the v1 default) only the shock's direct links fire:
 *
 *   y_k = λ^(k−1)·s  +  Σ_{ℓ=0..2, ℓ<k} λ^(k−1−ℓ) · (A_ℓ·s + M_ℓ·m)
 *
 * With `rounds: 2` the impulses those links create drive their own links once more (effects of effects).
 *
 * Range: each link step scales its contribution by ±band (hand-set links) or by the link's own estimated range;
 * positive and negative contributions are bounded separately. Each result also reports how much of its knock-on
 * effect runs through links that are still assumptions (`assumed`), so the screen can badge results one by one.
 */
import { SECTORS, type Sector } from "../types";
import {
  ASSUMPTION,
  ESTIMATED,
  FEATURE_LINKS,
  FEATURES,
  MACRO_LINKS,
  MACRO_UNITS,
  MACROS,
  SECTOR_LINKS,
  STRENGTH_SCALE,
  type Feature,
  type FeatureLink,
  type Lag,
  type Macro,
  type MacroLink,
  type SectorLink,
} from "./links";

export const LAGS: Lag[] = [0, 1, 2];
export const DEFAULT_LAMBDA = 0.7;
export const DEFAULT_BAND = 0.5;
export const MAX_ROUNDS = 3;
export const N = FEATURES.length * SECTORS.length;

export type Matrix = number[][];

export interface Links {
  features: FeatureLink[];
  sectors: SectorLink[];
  macro: MacroLink[];
}
export const DEFAULT_LINKS: Links = { features: FEATURE_LINKS, sectors: SECTOR_LINKS, macro: MACRO_LINKS };

export const index = (feature: Feature, sector: Sector) => FEATURES.indexOf(feature) * SECTORS.length + SECTORS.indexOf(sector);
export const variableAt = (i: number): { feature: Feature; sector: Sector } => ({ feature: FEATURES[Math.floor(i / SECTORS.length)], sector: SECTORS[i % SECTORS.length] });

const zeros = (rows: number, cols: number): Matrix => Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
const signed = (direction: "+" | "-", v: number) => (direction === "-" ? -v : v);

/** Kronecker product: (a ⊗ b)[i·p + k][j·q + l] = a[i][j] · b[k][l]. */
export function kron(a: Matrix, b: Matrix): Matrix {
  const p = b.length;
  const q = b[0]?.length ?? 0;
  const out = zeros(a.length * p, (a[0]?.length ?? 0) * q);
  a.forEach((row, i) => row.forEach((aij, j) => b.forEach((brow, k) => brow.forEach((bkl, l) => (out[i * p + k][j * q + l] = aij * bkl)))));
  return out;
}

/** A link's number: its estimated value if it has one, else direction × the strength scale. */
const featureValue = (l: FeatureLink) => l.value ?? signed(l.direction, STRENGTH_SCALE.feature[l.strength]);
const sectorValue = (l: SectorLink) => l.value ?? signed(l.direction, STRENGTH_SCALE.sector[l.strength]);
/** Per unit of the macro input as entered (pp, or VIX points). */
const macroValue = (l: MacroLink) => (l.value ?? signed(l.direction, STRENGTH_SCALE.macro[l.strength])) / MACRO_UNITS[l.from].size;

export interface Matrices {
  /** C_lag[to][from], 4×4 per lag. */
  C: Matrix[];
  /** L[to][from], 5×5: 1 on the diagonal, spillovers off it. */
  L: Matrix;
  /** A_lag = C_lag ⊗ L with self-links removed, 20×20 per lag. */
  A: Matrix[];
  /** M_lag[(feature, sector)][macro], 20×4 per lag. */
  M: Matrix[];
}

export function buildMatrices(links: Links = DEFAULT_LINKS): Matrices {
  const C = LAGS.map(() => zeros(FEATURES.length, FEATURES.length));
  for (const l of links.features) C[l.lag][FEATURES.indexOf(l.to)][FEATURES.indexOf(l.from)] += featureValue(l);
  const L = zeros(SECTORS.length, SECTORS.length);
  SECTORS.forEach((_, i) => (L[i][i] = 1));
  for (const l of links.sectors) L[SECTORS.indexOf(l.to)][SECTORS.indexOf(l.from)] += sectorValue(l);
  const A = C.map((c) => {
    const a = kron(c, L);
    for (let i = 0; i < N; i++) a[i][i] = 0;
    return a;
  });
  const M = LAGS.map(() => zeros(N, MACROS.length));
  for (const l of links.macro) {
    for (const s of l.sectors === "all" ? SECTORS : l.sectors) M[l.lag][index(l.to, s)][MACROS.indexOf(l.from)] += macroValue(l);
  }
  return { C, L, A, M };
}

export interface RippleShock {
  /** % shocks to sector variables, e.g. { Tech: { valuation: 10 } } = Tech valuations 10% higher. */
  sectors?: Partial<Record<Sector, Partial<Record<Feature, number>>>>;
  /** Macro shocks in natural units: percentage points for rates and the spread (1 = 100 bp), index points for the VIX. */
  macro?: Partial<Record<Macro, number>>;
}

export interface Band {
  mid: number;
  low: number;
  high: number;
}

export interface QuarterResult {
  quarter: number;
  sectors: Record<Sector, Record<Feature, Band>>;
  /**
   * Share of each variable's knock-on effect (the shock itself left out) that travels through at least one link
   * still marked as an assumption, 0–1. The screen badges a result as an assumption above one half.
   */
  assumed: Record<Sector, Record<Feature, number>>;
  /** The macro shock's own path (it fades by λ too). */
  macro: Record<Macro, number>;
}

export interface RippleResult {
  lambda: number;
  band: number;
  rounds: number;
  quarters: QuarterResult[];
  /** True while any link in use is an assumption ("assumption — not yet estimated from data"). */
  handSet: boolean;
  status: typeof ASSUMPTION | typeof ESTIMATED;
}

export interface RippleOptions {
  quarters?: number;
  lambda?: number;
  /** Relative range on each hand-set link step (0.5 = ±50%). */
  band?: number;
  /** 1 = direct effects only; 2 = also effects of effects (at most MAX_ROUNDS). */
  rounds?: number;
  links?: Links;
}

/** One hop of an effect: a feature link (with its sector route) or a macro link. */
export type Step = { kind: "feature"; from: number; to: number; lag: Lag } | { kind: "macro"; macro: Macro; to: number; lag: Lag };

interface Impulse {
  quarter: number;
  i: number;
  value: number;
  /** Hops from the shock (0 = the shock itself). */
  round: number;
  path: Step[];
  /** Where the chain started: a shocked variable's index or a macro input. */
  origin: number | Macro;
  /** Multipliers giving the low and high end of this contribution. */
  factor: [number, number];
  /** Some link on the way is still an assumption. */
  assumed: boolean;
}

/** The config entries behind one step. */
export function linksFor(step: Step, links: Links = DEFAULT_LINKS): (FeatureLink | SectorLink | MacroLink)[] {
  const to = variableAt(step.to);
  if (step.kind === "macro") return links.macro.filter((l) => l.from === step.macro && l.to === to.feature && l.lag === step.lag && (l.sectors === "all" || l.sectors.includes(to.sector)));
  const from = variableAt(step.from);
  return [
    ...links.features.filter((l) => l.from === from.feature && l.to === to.feature && l.lag === step.lag),
    ...(from.sector !== to.sector ? links.sectors.filter((l) => l.from === from.sector && l.to === to.sector) : []),
  ];
}

/**
 * A step's low and high multipliers (the links' estimated ranges when all have one, else ±band), and whether any
 * of its links is still an assumption.
 */
function stepInfo(step: Step, links: Links, band: number): { factor: [number, number]; assumed: boolean } {
  const ls = linksFor(step, links);
  const assumed = ls.some((l) => l.status === ASSUMPTION);
  if (!ls.length || ls.some((l) => l.range == null || l.value == null || l.value === 0)) return { factor: [1 - band, 1 + band], assumed };
  if (step.kind === "macro") {
    const total = ls.reduce((t, l) => t + l.value!, 0);
    const lo = ls.reduce((t, l) => t + l.range![0], 0) / total;
    const hi = ls.reduce((t, l) => t + l.range![1], 0) / total;
    return { factor: [Math.min(lo, hi), Math.max(lo, hi)], assumed };
  }
  // A feature step multiplies a feature link by a sector link: multiply their ranges.
  const fs = ls.map((l) => [l.range![0] / l.value!, l.range![1] / l.value!].sort((a, b) => a - b));
  return { factor: [fs.reduce((t, f) => t * f[0], 1), fs.reduce((t, f) => t * f[1], 1)], assumed };
}

function shockVector(shock: RippleShock): number[] {
  const s = new Array<number>(N).fill(0);
  for (const [sector, fs] of Object.entries(shock.sectors ?? {}) as [Sector, Partial<Record<Feature, number>>][]) {
    for (const [feature, v] of Object.entries(fs ?? {}) as [Feature, number][]) s[index(feature, sector)] += v ?? 0;
  }
  return s;
}

/** Every impulse the shock sets off within the horizon. */
function propagate(shock: RippleShock, quarters: number, rounds: number, links: Links, band: number): Impulse[] {
  const { A, M } = buildMatrices(links);
  const s = shockVector(shock);
  const m = MACROS.map((k) => shock.macro?.[k] ?? 0);
  const all: Impulse[] = [];
  let frontier: Impulse[] = s.flatMap((v, j) => (v ? [{ quarter: 1, i: j, value: v, round: 0, path: [], origin: j, factor: [1, 1] as [number, number], assumed: false }] : []));
  all.push(...frontier);
  const macroImpulses: Impulse[] = [];
  MACROS.forEach((macro, u) => {
    if (!m[u]) return;
    for (const lag of LAGS) {
      if (1 + lag > quarters) continue;
      for (let i = 0; i < N; i++) {
        const v = M[lag][i][u] * m[u];
        if (!v) continue;
        const step: Step = { kind: "macro", macro, to: i, lag };
        const info = stepInfo(step, links, band);
        macroImpulses.push({ quarter: 1 + lag, i, value: v, round: 1, path: [step], origin: macro, factor: info.factor, assumed: info.assumed });
      }
    }
  });
  for (let round = 1; round <= Math.min(rounds, MAX_ROUNDS); round++) {
    const next: Impulse[] = [];
    for (const imp of frontier) {
      for (const lag of LAGS) {
        const quarter = imp.quarter + lag;
        if (quarter > quarters) continue;
        for (let i = 0; i < N; i++) {
          const v = A[lag][i][imp.i] * imp.value;
          if (Math.abs(v) < 1e-9) continue;
          const step: Step = { kind: "feature", from: imp.i, to: i, lag };
          const { factor: f, assumed } = stepInfo(step, links, band);
          next.push({ quarter, i, value: v, round, path: [...imp.path, step], origin: imp.origin, factor: [imp.factor[0] * f[0], imp.factor[1] * f[1]], assumed: imp.assumed || assumed });
        }
      }
    }
    // Macro links fire directly (round 1); their impulses drive further links from round 2 on.
    if (round === 1) next.push(...macroImpulses);
    all.push(...next);
    frontier = next;
  }
  return all;
}

const round2 = (v: number) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0

export function runRipple(shock: RippleShock, opts: RippleOptions = {}): RippleResult {
  const quarters = opts.quarters ?? 4;
  const lambda = opts.lambda ?? DEFAULT_LAMBDA;
  const band = opts.band ?? DEFAULT_BAND;
  const rounds = opts.rounds ?? 1;
  const links = opts.links ?? DEFAULT_LINKS;
  const impulses = propagate(shock, quarters, rounds, links, band);
  const result: QuarterResult[] = [];
  for (let k = 1; k <= quarters; k++) {
    const own = new Array<number>(N).fill(0);
    const lo = new Array<number>(N).fill(0);
    const hi = new Array<number>(N).fill(0);
    const knockOn = new Array<number>(N).fill(0);
    const viaAssumption = new Array<number>(N).fill(0);
    for (const imp of impulses) {
      if (imp.quarter > k) continue;
      const v = lambda ** (k - imp.quarter) * imp.value;
      if (imp.round === 0) {
        // The shock itself is given, not estimated.
        own[imp.i] += v;
        continue;
      }
      lo[imp.i] += v > 0 ? v * imp.factor[0] : v * imp.factor[1];
      hi[imp.i] += v > 0 ? v * imp.factor[1] : v * imp.factor[0];
      knockOn[imp.i] += Math.abs(v);
      if (imp.assumed) viaAssumption[imp.i] += Math.abs(v);
    }
    const mids = impulses.reduce((acc, imp) => {
      if (imp.quarter <= k) acc[imp.i] += lambda ** (k - imp.quarter) * imp.value;
      return acc;
    }, new Array<number>(N).fill(0));
    const sectors = Object.fromEntries(SECTORS.map((sec) => [sec, {} as Record<Feature, Band>])) as Record<Sector, Record<Feature, Band>>;
    const assumed = Object.fromEntries(SECTORS.map((sec) => [sec, {} as Record<Feature, number>])) as Record<Sector, Record<Feature, number>>;
    for (let i = 0; i < N; i++) {
      const { feature, sector } = variableAt(i);
      sectors[sector][feature] = { mid: round2(mids[i]), low: round2(own[i] + lo[i]), high: round2(own[i] + hi[i]) };
      assumed[sector][feature] = knockOn[i] ? round2(viaAssumption[i] / knockOn[i]) : 0;
    }
    const m = MACROS.map((key) => shock.macro?.[key] ?? 0);
    result.push({ quarter: k, sectors, assumed, macro: Object.fromEntries(MACROS.map((key, u) => [key, round2(lambda ** (k - 1) * m[u])])) as Record<Macro, number> });
  }
  const handSet = [...links.features, ...links.sectors, ...links.macro].some((l) => l.status === ASSUMPTION);
  return { lambda, band, rounds, quarters: result, handSet, status: handSet ? ASSUMPTION : ESTIMATED };
}

/** One contribution to a variable's response, with the links that carried it. */
export interface Contribution {
  kind: "shock" | "feature" | "macro";
  /** Where the chain started: "Tech valuation" or a macro input. */
  source: string;
  /** Lag of the last hop (null for the shock itself). */
  lag: Lag | null;
  /** Hops from the shock: 1 = a direct link, 2 = an effect of an effect. */
  round: number;
  /** Intermediate variables for effects of effects ("Tech deal value"). */
  via: string[];
  value: number;
  /** Some link on the way is still an assumption. */
  assumed: boolean;
  /** The config entries behind each hop, first hop first. */
  steps: { step: Step; links: (FeatureLink | SectorLink | MacroLink)[] }[];
}

const label = (i: number) => {
  const { feature, sector } = variableAt(i);
  return `${sector} ${feature}`;
};

/** Why a variable moves in quarter k: its contributions, largest first. */
export function explain(shock: RippleShock, sector: Sector, feature: Feature, quarter: number, opts: RippleOptions = {}): Contribution[] {
  const links = opts.links ?? DEFAULT_LINKS;
  const lambda = opts.lambda ?? DEFAULT_LAMBDA;
  const target = index(feature, sector);
  return propagate(shock, opts.quarters ?? Math.max(4, quarter), opts.rounds ?? 1, links, opts.band ?? DEFAULT_BAND)
    .filter((imp) => imp.i === target && imp.quarter <= quarter)
    .map((imp): Contribution => {
      const first = imp.path[0];
      return {
        kind: imp.round === 0 ? "shock" : first?.kind === "macro" ? "macro" : "feature",
        source: typeof imp.origin === "number" ? label(imp.origin) : imp.origin,
        lag: imp.path.at(-1)?.lag ?? null,
        round: imp.round,
        via: imp.path.slice(0, -1).map((s) => label(s.to)),
        value: round2(lambda ** (quarter - imp.quarter) * imp.value),
        assumed: imp.assumed,
        steps: imp.path.map((step) => ({ step, links: linksFor(step, links) })),
      };
    })
    .filter((c) => c.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}
