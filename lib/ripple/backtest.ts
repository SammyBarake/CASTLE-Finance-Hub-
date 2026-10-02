/**
 * Backtest scoring for the ripple engine (pure; ingest/backtest.ts runs it and writes lib/ripple/backtest.json).
 *
 * At each origin quarter t the engine gets that quarter's real inputs: the four macro changes and each sector's ETF
 * move (versus its average growth before t), less the part of that move the engine already attributes to the macro
 * changes (otherwise it would count them twice). It predicts four quarters, t to t+3. Its number for a feature in quarter
 * k is a level deviation; the realised one is the cumulative log change from t to t+k−1 minus the sector's average
 * growth before t (so a sector that always grows isn't credited for growing). The same quarter's valuation is the input
 * itself and isn't scored.
 *
 * Skill = 1 − squared error / squared error of predicting no deviation ("no change" from trend): above 0 the engine
 * beats it. Direction = how often a prediction of at least MIN_MOVE points has the right sign. Slope = the regression
 * of what happened on what was predicted, through zero: 1 means effects are sized right, under 1 that they're overstated.
 */
import type { Sector } from "../types";
import { SECTORS } from "../types";
import { runRipple, type Fade, type Links, type RippleOptions, type RippleShock } from "./engine";
import { FEATURES, MACROS, type Feature, type Macro } from "./links";

export type PanelRow = { sector: Sector; qi: number; quarter: string } & Record<Feature, number | null> & Record<Macro, number | null>;

export const HORIZON = 4;
/** Predictions smaller than this (percentage points) have no direction to score. */
export const MIN_MOVE = 0.5;

export type Baselines = Record<Sector, Record<Feature, number>>;

/** Each sector's average quarterly change per feature over the quarters before `before`. */
export function baselines(panel: PanelRow[], before: number): Baselines {
  const out = {} as Baselines;
  for (const s of SECTORS) {
    out[s] = {} as Record<Feature, number>;
    for (const f of FEATURES) {
      const xs = panel.filter((r) => r.sector === s && r.qi < before && r[f] != null).map((r) => r[f]!);
      out[s][f] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    }
  }
  return out;
}

const key = (s: Sector, qi: number) => `${s}|${qi}`;
export const indexPanel = (panel: PanelRow[]) => new Map(panel.map((r) => [key(r.sector, r.qi), r]));

/** The engine's inputs at quarter t: macro changes and ETF moves versus trend. Null when any is missing. */
export function scenarioAt(index: Map<string, PanelRow>, t: number, base: Baselines): RippleShock | null {
  const any = index.get(key(SECTORS[0], t));
  if (!any || MACROS.some((m) => any[m] == null)) return null;
  const sectors: RippleShock["sectors"] = {};
  for (const s of SECTORS) {
    const v = index.get(key(s, t))?.valuation;
    if (v == null) return null;
    sectors[s] = { valuation: v - base[s].valuation };
  }
  return { sectors, macro: Object.fromEntries(MACROS.map((m) => [m, any[m]!])) };
}

/**
 * Realised level deviation in quarter t+k−1 (k = 1 … HORIZON); null where a quarter is missing.
 * Prices behave like a random walk, so valuation is measured from the quarter before t. Deals and IPOs are noisy flows,
 * so they're measured from the average of the four quarters before t (one odd quarter doesn't set the yardstick), with
 * the sector's trend carried forward from the middle of that window.
 */
export function realizedPath(index: Map<string, PanelRow>, s: Sector, f: Feature, t: number, base: Baselines): (number | null)[] {
  const change = (q: number) => {
    const v = index.get(key(s, q))?.[f];
    return v == null ? null : v - base[s][f];
  };
  let start = 0;
  if (f !== "valuation") {
    // Level at t−1 minus the average level over t−4 … t−1, from the changes in between.
    const [c1, c2, c3] = [change(t - 1), change(t - 2), change(t - 3)];
    if (c1 == null || c2 == null || c3 == null) return new Array(HORIZON).fill(null);
    start = (3 * c1 + 2 * c2 + c3) / 4;
  }
  const out: (number | null)[] = [];
  let sum = start;
  let broken = false;
  for (let k = 0; k < HORIZON; k++) {
    const c = change(t + k);
    if (c == null) broken = true;
    else sum += c;
    out.push(broken ? null : sum);
  }
  return out;
}

export interface CellScore {
  n: number;
  /** Squared error of the engine, and of predicting zero deviation. */
  sse: number;
  sse0: number;
  /** Σ predicted × realised and Σ predicted² (for the calibration slope). */
  spr: number;
  spp: number;
  hits: number;
  directional: number;
}

export type Scores = Record<Feature, CellScore[]>;

export const emptyScores = (): Scores =>
  Object.fromEntries(FEATURES.map((f) => [f, Array.from({ length: HORIZON }, () => ({ n: 0, sse: 0, sse0: 0, spr: 0, spp: 0, hits: 0, directional: 0 }))])) as Scores;

export function addForecast(scores: Scores, f: Feature, k: number, predicted: number, realized: number) {
  const c = scores[f][k - 1];
  c.n++;
  c.sse += (predicted - realized) ** 2;
  c.sse0 += realized ** 2;
  c.spr += predicted * realized;
  c.spp += predicted ** 2;
  if (Math.abs(predicted) >= MIN_MOVE) {
    c.directional++;
    if (Math.sign(predicted) === Math.sign(realized)) c.hits++;
  }
}

export interface ForecastPoint {
  /** Origin quarter ("2021Q3"). */
  quarter: string;
  feature: Feature;
  /** Average over the sectors with data, per quarter ahead (index k − 1). */
  predicted: (number | null)[];
  realized: (number | null)[];
}

/**
 * Run the engine at every origin and score it. `links(t)` gives the links known at t (re-estimated out of sample).
 * Every origin's forecast is also returned, averaged over sectors, for charts.
 */
export function backtest(panel: PanelRow[], origins: number[], links: (t: number) => Links, opts: RippleOptions = {}): { scores: Scores; points: ForecastPoint[] } {
  const index = indexPanel(panel);
  const scores = emptyScores();
  const points: ForecastPoint[] = [];
  for (const t of origins) {
    const base = baselines(panel, t);
    const shock = scenarioAt(index, t, base);
    if (!shock) continue;
    const linkSet = links(t);
    // The quarter's ETF move already contains the macro inputs' same-quarter effect: feed the engine only the rest,
    // so Q1 valuations match what happened and nothing is counted twice.
    const macroPart = runRipple({ macro: shock.macro }, { ...opts, links: linkSet, quarters: 1 }).quarters[0].sectors;
    for (const s of SECTORS) shock.sectors![s]!.valuation! -= macroPart[s].valuation.mid;
    const result = runRipple(shock, { ...opts, links: linkSet, quarters: HORIZON });
    const quarter = index.get(key(SECTORS[0], t))!.quarter;
    for (const f of FEATURES) {
      const pSum = new Array<number>(HORIZON).fill(0);
      const rSum = new Array<number>(HORIZON).fill(0);
      const count = new Array<number>(HORIZON).fill(0);
      for (const s of SECTORS) {
        const real = realizedPath(index, s, f, t, base);
        for (let k = 1; k <= HORIZON; k++) {
          const r = real[k - 1];
          if (r == null) continue;
          const p = result.quarters[k - 1].sectors[s][f].mid;
          pSum[k - 1] += p;
          rSum[k - 1] += r;
          count[k - 1]++;
          if (!(f === "valuation" && k === 1)) addForecast(scores, f, k, p, r);
        }
      }
      points.push({
        quarter,
        feature: f,
        predicted: count.map((c, i) => (c ? round(pSum[i] / c) : null)),
        realized: count.map((c, i) => (c ? round(rSum[i] / c) : null)),
      });
    }
  }
  return { scores, points };
}

const round = (v: number) => Math.round(v * 100) / 100 + 0;

export interface CellSummary {
  n: number;
  /** 1 − SSE / SSE of "no change"; null without data. */
  skill: number | null;
  /** Share of predictions (≥ MIN_MOVE) with the right sign; null when none qualified. */
  hitRate: number | null;
  /** Realised on predicted, through zero. */
  slope: number | null;
}

export function summarize(c: CellScore): CellSummary {
  return {
    n: c.n,
    skill: c.n && c.sse0 ? round(1 - c.sse / c.sse0) : null,
    hitRate: c.directional ? round(c.hits / c.directional) : null,
    slope: c.spp ? round(c.spr / c.spp) : null,
  };
}

/** Pool cells (e.g. every horizon of a feature, or everything). */
export function pool(cells: CellScore[]): CellScore {
  return cells.reduce((a, c) => ({ n: a.n + c.n, sse: a.sse + c.sse, sse0: a.sse0 + c.sse0, spr: a.spr + c.spr, spp: a.spp + c.spp, hits: a.hits + c.hits, directional: a.directional + c.directional }), {
    n: 0, sse: 0, sse0: 0, spr: 0, spp: 0, hits: 0, directional: 0,
  });
}

/** lib/ripple/tuned.json: the setup that forecast best (settings.ts reads it). */
export interface TunedSettings {
  generatedAt: string;
  linkSet: "hand-set" | "estimated";
  priorScale: number | null;
  rounds: number;
  lambda: Fade;
  score: number;
  previousScore: number;
  /** Share of predicted moves with the right sign, all features. */
  hitRate: number | null;
  quarters: number;
  window: { from: string; to: string };
}

type SetupSummary = { label: string; score: number; all: CellSummary; flows: CellSummary };

/** lib/ripple/backtest.json: everything the Accuracy page shows (written by ingest/backtest.ts). */
export interface BacktestFile {
  generatedAt: string;
  origins: { from: string; to: string; count: number };
  ipoHistory: boolean;
  horizon: number;
  chosen: Pick<TunedSettings, "linkSet" | "priorScale" | "rounds" | "lambda"> & { label: string };
  summary: {
    chosen: { score: number; all: CellSummary; flows: CellSummary; valuation: CellSummary };
    previous: SetupSummary;
    handSet: SetupSummary;
    noLinks: { score: number; flows: CellSummary };
  };
  features: Record<Feature, (CellSummary & { k: number })[]>;
  halves: { from: string; to: string; chosen: number; previous: number; handSet: number }[];
  candidates: { label: string; linkSet: "hand-set" | "estimated"; priorScale: number | null; rounds: number; lambda: Fade; score: number; perFeature: Record<Feature, number> }[];
  points: ForecastPoint[];
}

/**
 * One number per feature to choose settings by: the average skill over the quarters ahead that have data. Averaging
 * skills (rather than pooling errors) keeps the noisy, longer horizons from drowning out the first quarters.
 */
export function featureScore(scores: Scores, f: Feature): number {
  const skills = scores[f].map(summarize).map((s) => s.skill).filter((s): s is number => s != null);
  return skills.length ? skills.reduce((a, b) => a + b, 0) / skills.length : 0;
}
