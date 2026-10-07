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
import { runRipple, type Fade, type Links, type QuarterResult, type RippleOptions, type RippleShock } from "./engine";
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

/** Per feature, the level a quarter of the year sits above or below the annual average (index = qi % 4; mean 0). */
export type Seasonal = Record<Feature, number[]>;

/**
 * Calendar pattern of each feature from the quarters before `before`, pooled over sectors (more data than one
 * sector's few years): deals dip in Q1, IPOs bunch in Q2. A predictable seasonal swing shouldn't count as a surprise.
 */
export function seasonality(panel: PanelRow[], before: number, base: Baselines): Seasonal {
  const out = {} as Seasonal;
  for (const f of FEATURES) {
    const sums = [0, 0, 0, 0];
    const counts = [0, 0, 0, 0];
    for (const r of panel) {
      if (r.qi >= before || r[f] == null) continue;
      sums[r.qi % 4] += r[f]! - base[r.sector][f];
      counts[r.qi % 4]++;
    }
    const m = sums.map((s, q) => (counts[q] ? s / counts[q] : 0));
    const avg = m.reduce((a, b) => a + b, 0) / 4;
    // Level steps from quarter to quarter are the seasonal changes less their average; then centre on zero.
    const level = [0, 0, 0, 0];
    for (let q = 1; q < 4; q++) level[q] = level[q - 1] + m[q] - avg;
    const centre = level.reduce((a, b) => a + b, 0) / 4;
    out[f] = level.map((v) => v - centre);
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
export function realizedPath(index: Map<string, PanelRow>, s: Sector, f: Feature, t: number, base: Baselines, season?: Seasonal): (number | null)[] {
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
    // Flows: take out the quarter's calendar level (the four-quarter baseline averages it out already).
    const seasonal = season && f !== "valuation" ? season[f][(t + k) % 4] : 0;
    out.push(broken ? null : sum - seasonal);
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
export interface BacktestOptions extends RippleOptions {
  /**
   * Quarters of earlier shocks fed in as well (0 = this quarter's only). A move one or two quarters ago is still
   * rippling through the lagged links at t; its part still to come counts, measured from the same baseline as the
   * realised outcome (the quarter before t for valuations, the four quarters before t for flows).
   */
  history?: number;
  /**
   * Earlier quarters also bring their deal and IPO surprises (the change versus trend, calendar pattern taken out), not
   * only prices and macro: the engine propagates them like any shock, and its fade decides how much persists.
   * The forecast quarter's own deals and IPOs are never an input (they're what is scored).
   */
  flowHistory?: boolean;
  /** Take the macro-explained part out of each ETF move (default; false only for experiments). */
  netOfMacro?: boolean;
  /** Trend an ETF move is measured against as an input: the sector's own (default), the all-sector average, or none. */
  inputTrend?: "sector" | "pooled" | "none";
  /** Cap on each input ETF move, in points (experiments; default none). */
  inputCap?: number;
  /** Called with every scored forecast (diagnostics). */
  trace?: (row: { t: number; sector: Sector; feature: Feature; k: number; predicted: number; realized: number }) => void;
}

export function backtest(panel: PanelRow[], origins: number[], links: (t: number) => Links, opts: BacktestOptions = {}): { scores: Scores; points: ForecastPoint[] } {
  const index = indexPanel(panel);
  const scores = emptyScores();
  const points: ForecastPoint[] = [];
  const { history = 0, flowHistory = false, netOfMacro = true, inputTrend = "sector", inputCap, trace, ...engineOpts } = opts;
  for (const t of origins) {
    const base = baselines(panel, t);
    const season = seasonality(panel, t, base);
    const linkSet = links(t);
    // A quarter's ETF move already contains the macro inputs' same-quarter effect: feed the engine only the rest,
    // so Q1 valuations match what happened and nothing is counted twice.
    const pooledTrend = SECTORS.reduce((a, s) => a + base[s].valuation, 0) / SECTORS.length;
    const inputBase: Baselines =
      inputTrend === "sector"
        ? base
        : (Object.fromEntries(SECTORS.map((s) => [s, { ...base[s], valuation: inputTrend === "pooled" ? pooledTrend : 0 }])) as Baselines);
    const inputsAt = (q: number) => {
      const shock = scenarioAt(index, q, inputBase);
      if (!shock) return null;
      const macroPart = runRipple({ macro: shock.macro }, { ...engineOpts, links: linkSet, quarters: 1 }).quarters[0].sectors;
      if (netOfMacro) for (const s of SECTORS) shock.sectors![s]!.valuation! -= macroPart[s].valuation.mid;
      if (inputCap) for (const s of SECTORS) shock.sectors![s]!.valuation = Math.max(-inputCap, Math.min(inputCap, shock.sectors![s]!.valuation!));
      if (flowHistory && q < t) {
        for (const s of SECTORS) {
          for (const f of FEATURES) {
            if (f === "valuation") continue;
            const v = index.get(key(s, q))?.[f];
            // The quarter's calendar step (seasonal level change) is expected, not a surprise.
            if (v != null) shock.sectors![s]![f] = v - base[s][f] - (season[f][q % 4] - season[f][(q + 3) % 4]);
          }
        }
      }
      return shock;
    };
    const shock = inputsAt(t);
    if (!shock) continue;
    const result = runRipple(shock, { ...engineOpts, links: linkSet, quarters: HORIZON });
    // Earlier shocks: quarter offset x from the shock (x < 0 is before it, no effect yet).
    const past: { j: number; path: QuarterResult[] }[] = [];
    for (let j = 1; j <= history; j++) {
      const earlier = inputsAt(t - j);
      if (earlier) past.push({ j, path: runRipple(earlier, { ...engineOpts, links: linkSet, quarters: j + HORIZON }).quarters });
    }
    const pastEffect = (s: Sector, f: Feature, k: number) =>
      past.reduce((sum, { j, path }) => {
        const level = (x: number) => (x >= 0 ? path[x].sectors[s][f].mid : 0);
        const from = f === "valuation" ? level(j - 1) : (level(j - 1) + level(j - 2) + level(j - 3) + level(j - 4)) / 4;
        return sum + level(j + k - 1) - from;
      }, 0);
    const quarter = index.get(key(SECTORS[0], t))!.quarter;
    for (const f of FEATURES) {
      const pSum = new Array<number>(HORIZON).fill(0);
      const rSum = new Array<number>(HORIZON).fill(0);
      const count = new Array<number>(HORIZON).fill(0);
      for (const s of SECTORS) {
        const real = realizedPath(index, s, f, t, base, season);
        for (let k = 1; k <= HORIZON; k++) {
          const r = real[k - 1];
          if (r == null) continue;
          const p = result.quarters[k - 1].sectors[s][f].mid + pastEffect(s, f, k);
          pSum[k - 1] += p;
          rSum[k - 1] += r;
          count[k - 1]++;
          if (!(f === "valuation" && k === 1)) {
            addForecast(scores, f, k, p, r);
            trace?.({ t, sector: s, feature: f, k, predicted: p, realized: r });
          }
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

/** "0.5" → "priors ×0.5"; "f0.25/s0.5/m1" → "priors ×0.25 links, ×0.5 spillovers, ×1 macro"; null → "hand-set". */
export function priorWords(scale: string | null): string {
  if (scale == null) return "hand-set";
  if (!scale.includes("/")) return `priors ×${scale}`;
  const p = Object.fromEntries(scale.split("/").map((x) => [x[0], x.slice(1)]));
  return `priors ×${p.f} links, ×${p.s} spillovers, ×${p.m} macro`;
}

/** lib/ripple/tuned.json: the setup that forecast best (settings.ts reads it). */
export interface TunedSettings {
  generatedAt: string;
  linkSet: "hand-set" | "estimated";
  /** Prior width label for estimated links ("0.5" or "f0.25/s0.5/m1"); null for hand-set. */
  priorScale: string | null;
  rounds: number;
  lambda: Fade;
  /** Quarters of earlier shocks the backtest fed in at each forecast (the scenario screen runs one scenario). */
  history: number;
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
  chosen: Pick<TunedSettings, "linkSet" | "priorScale" | "rounds" | "lambda" | "history"> & { label: string };
  summary: {
    chosen: { score: number; all: CellSummary; flows: CellSummary; valuation: CellSummary };
    previous: SetupSummary;
    handSet: SetupSummary;
    /** The best setup fed only the forecast quarter's shocks. */
    thisQuarterOnly: SetupSummary;
    noLinks: { score: number; flows: CellSummary };
  };
  features: Record<Feature, (CellSummary & { k: number })[]>;
  halves: { from: string; to: string; chosen: number; previous: number; handSet: number }[];
  candidates: { label: string; linkSet: "hand-set" | "estimated"; priorScale: string | null; rounds: number; lambda: Fade; history: number; score: number; perFeature: Record<Feature, number> }[];
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
