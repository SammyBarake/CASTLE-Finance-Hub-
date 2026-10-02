/**
 * The what-if "ripple engine" (v1, hand-set links). Pure functions, no UI.
 *
 * State: 20 variables = 4 features × 5 sectors, feature-major (index = feature * 5 + sector), each a % deviation
 * from what would have happened without the shock. Macro inputs (Fed funds, 10-year, Baa spread, VIX) can be
 * shocked but receive no feedback.
 *
 * Links: A_lag = C_lag ⊗ L for lags 0, 1, 2 (C = feature links, L = sector links), so entry
 * A[(f, s), (g, t)] = C[f][g] · L[s][t]: how feature g in sector t moves feature f in sector s. A variable does not
 * link to itself (the diagonal of A is zeroed); its own shock simply fades. M_lag maps macro shocks onto the 20.
 *
 * Dynamics: a shock hits in quarter 1 and fades by λ (0.7) a quarter. A lag-ℓ link fires ℓ quarters after the shock
 * and fades from then on:
 *
 *   y_k = λ^(k−1)·s  +  Σ_{ℓ=0..2, ℓ<k} λ^(k−1−ℓ) · (A_ℓ·s + M_ℓ·m)
 *
 * Each shock travels one link deep (direct effects plus sector spillovers). Second-round effects (effects of effects)
 * are left out in v1: with hand-set numbers they would compound one assumption on another. After the last lag
 * (quarter 3 onward) every response shrinks by exactly λ a quarter, so effects always fade.
 *
 * Range: every link's contribution is taken at ±50% of its hand-set value (low and high), the stated placeholder
 * until bootstrapped confidence ranges replace it.
 */
import { SECTORS, type Sector } from "../types";
import {
  ASSUMPTION,
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

export interface Matrices {
  /** C_lag[to][from], 4×4 per lag. */
  C: Matrix[];
  /** L[to][from], 5×5: 1 on the diagonal, spillovers off it. */
  L: Matrix;
  /** A_lag = C_lag ⊗ L with self-links removed, 20×20 per lag. */
  A: Matrix[];
  /** M_lag[(feature, sector)][macro]: % change per unit of the macro input as entered (pp, or VIX points), 20×4 per lag. */
  M: Matrix[];
}

export function buildMatrices(links: Links = DEFAULT_LINKS): Matrices {
  const C = LAGS.map(() => zeros(FEATURES.length, FEATURES.length));
  for (const l of links.features) C[l.lag][FEATURES.indexOf(l.to)][FEATURES.indexOf(l.from)] += signed(l.direction, STRENGTH_SCALE.feature[l.strength]);
  const L = zeros(SECTORS.length, SECTORS.length);
  SECTORS.forEach((_, i) => (L[i][i] = 1));
  for (const l of links.sectors) L[SECTORS.indexOf(l.to)][SECTORS.indexOf(l.from)] += signed(l.direction, STRENGTH_SCALE.sector[l.strength]);
  const A = C.map((c) => {
    const a = kron(c, L);
    for (let i = 0; i < N; i++) a[i][i] = 0;
    return a;
  });
  const M = LAGS.map(() => zeros(N, MACROS.length));
  for (const l of links.macro) {
    const per = signed(l.direction, STRENGTH_SCALE.macro[l.strength]) / MACRO_UNITS[l.from].size;
    for (const s of l.sectors === "all" ? SECTORS : l.sectors) M[l.lag][index(l.to, s)][MACROS.indexOf(l.from)] += per;
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
  /** The macro shock's own path (it fades by λ too). */
  macro: Record<Macro, number>;
}

export interface RippleResult {
  lambda: number;
  band: number;
  quarters: QuarterResult[];
  /** Every link behind these numbers is hand-set. */
  status: typeof ASSUMPTION;
}

export interface RippleOptions {
  quarters?: number;
  lambda?: number;
  /** Relative range on each link's contribution (0.5 = ±50%). */
  band?: number;
  links?: Links;
}

const round2 = (v: number) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0

function shockVector(shock: RippleShock): number[] {
  const s = new Array<number>(N).fill(0);
  for (const [sector, fs] of Object.entries(shock.sectors ?? {}) as [Sector, Partial<Record<Feature, number>>][]) {
    for (const [feature, v] of Object.entries(fs ?? {}) as [Feature, number][]) s[index(feature, sector)] += v ?? 0;
  }
  return s;
}

/** One contribution to a variable's response: the shock itself, a feature link (with its sector route) or a macro link. */
export interface Contribution {
  kind: "shock" | "feature" | "macro";
  /** Where it comes from: "Tech valuation" or a macro input. */
  source: string;
  lag: Lag | null;
  value: number;
}

/** Every contribution to each of the 20 variables in quarter k (1-based). */
function contributions(k: number, s: number[], m: number[], mats: Matrices, lambda: number): Contribution[][] {
  const out: Contribution[][] = Array.from({ length: N }, () => []);
  const own = lambda ** (k - 1);
  s.forEach((v, i) => v && out[i].push({ kind: "shock", source: label(i), lag: null, value: own * v }));
  for (const lag of LAGS) {
    if (lag > k - 1) continue;
    const w = lambda ** (k - 1 - lag);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const c = mats.A[lag][i][j] * s[j] * w;
        if (c) out[i].push({ kind: "feature", source: label(j), lag, value: c });
      }
      MACROS.forEach((macro, u) => {
        const c = mats.M[lag][i][u] * m[u] * w;
        if (c) out[i].push({ kind: "macro", source: macro, lag, value: c });
      });
    }
  }
  return out;
}

const label = (i: number) => {
  const { feature, sector } = variableAt(i);
  return `${sector} ${feature}`;
};

export function runRipple(shock: RippleShock, opts: RippleOptions = {}): RippleResult {
  const quarters = opts.quarters ?? 4;
  const lambda = opts.lambda ?? DEFAULT_LAMBDA;
  const band = opts.band ?? DEFAULT_BAND;
  const mats = buildMatrices(opts.links);
  const s = shockVector(shock);
  const m = MACROS.map((k) => shock.macro?.[k] ?? 0);
  const result: QuarterResult[] = [];
  for (let k = 1; k <= quarters; k++) {
    const parts = contributions(k, s, m, mats, lambda);
    const sectors = Object.fromEntries(SECTORS.map((sec) => [sec, {} as Record<Feature, Band>])) as Record<Sector, Record<Feature, Band>>;
    parts.forEach((list, i) => {
      // The shock itself is given, not estimated; links carry the ± band.
      const own = list.filter((c) => c.kind === "shock").reduce((t, c) => t + c.value, 0);
      const pos = list.filter((c) => c.kind !== "shock" && c.value > 0).reduce((t, c) => t + c.value, 0);
      const neg = list.filter((c) => c.kind !== "shock" && c.value < 0).reduce((t, c) => t + c.value, 0);
      const { feature, sector } = variableAt(i);
      sectors[sector][feature] = {
        mid: round2(own + pos + neg),
        low: round2(own + (1 - band) * pos + (1 + band) * neg),
        high: round2(own + (1 + band) * pos + (1 - band) * neg),
      };
    });
    result.push({ quarter: k, sectors, macro: Object.fromEntries(MACROS.map((k2, u) => [k2, round2(lambda ** (k - 1) * m[u])])) as Record<Macro, number> });
  }
  return { lambda, band, quarters: result, status: ASSUMPTION };
}

/** Why a variable moves in quarter k: its contributions, largest first (for explaining a result). */
export function explain(shock: RippleShock, sector: Sector, feature: Feature, quarter: number, opts: RippleOptions = {}): Contribution[] {
  const parts = contributions(quarter, shockVector(shock), MACROS.map((k) => shock.macro?.[k] ?? 0), buildMatrices(opts.links), opts.lambda ?? DEFAULT_LAMBDA);
  return parts[index(feature, sector)].map((c) => ({ ...c, value: round2(c.value) })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}
