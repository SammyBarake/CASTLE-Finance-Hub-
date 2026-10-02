import { describe, expect, it } from "vitest";
import { SECTORS, type Sector } from "../types";
import { addForecast, backtest, baselines, emptyScores, featureScore, indexPanel, pool, priorWords, realizedPath, scenarioAt, seasonality, summarize, type PanelRow } from "./backtest";
import { DEFAULT_LINKS, runRipple, type Links } from "./engine";
import { FEATURES } from "./links";

const NONE: Links = { features: [], sectors: [], macro: [] };

/** A flat panel: every sector grows `g` a quarter in every feature, macro unchanged; `patch` edits single cells. */
function panel(quarters: number, g = 1, patch: (r: PanelRow) => void = () => {}): PanelRow[] {
  const rows: PanelRow[] = [];
  for (let qi = 0; qi < quarters; qi++) {
    for (const sector of SECTORS) {
      const r = { sector, qi, quarter: `Q${qi}`, valuation: g, dealCount: g, dealValue: g, ipoCount: g, fedFunds: 0, treasury10y: 0, baaSpread: 0, vix: 0 } as PanelRow;
      patch(r);
      rows.push(r);
    }
  }
  return rows;
}

describe("backtest scoring", () => {
  it("measures each sector's average growth before the origin", () => {
    const p = panel(8, 2, (r) => r.sector === "Tech" && r.qi === 3 && (r.dealCount = 10));
    const b = baselines(p, 4);
    expect(b.Tech.dealCount).toBe(4); // (2 + 2 + 2 + 10) / 4
    expect(b.Energy.dealCount).toBe(2);
  });

  it("reads realised paths: valuations from the quarter before, flows from the average of the four before", () => {
    // Steady growth: no deviation from trend anywhere.
    const steady = indexPanel(panel(12, 3));
    const base = baselines(panel(12, 3), 6);
    expect(realizedPath(steady, "Tech", "valuation", 6, base)).toEqual([0, 0, 0, 0]);
    expect(realizedPath(steady, "Tech", "dealCount", 6, base)).toEqual([0, 0, 0, 0]);
    // A one-off +12 jump in deal count at the origin: the level stays 12 above trend afterwards.
    const jump = panel(12, 0, (r) => r.sector === "Tech" && r.qi === 6 && (r.dealCount = 12));
    expect(realizedPath(indexPanel(jump), "Tech", "dealCount", 6, baselines(jump, 6))).toEqual([12, 12, 12, 12]);
    // A missing quarter breaks the path from there on.
    const gap = panel(12, 0, (r) => r.qi === 8 && (r.ipoCount = null));
    expect(realizedPath(indexPanel(gap), "Tech", "ipoCount", 6, baselines(gap, 6))).toEqual([0, 0, null, null]);
  });

  it("takes the calendar pattern out of deal and IPO outcomes, but not out of valuations", () => {
    // IPOs jump 40 in every Q2 and give it back in Q3: a purely seasonal series with no surprises.
    const p = panel(24, 0, (r) => {
      if (r.qi % 4 === 1) r.ipoCount = 40;
      if (r.qi % 4 === 2) r.ipoCount = -40;
      if (r.qi % 4 === 1) r.valuation = 4;
      if (r.qi % 4 === 2) r.valuation = -4;
    });
    const base = baselines(p, 16);
    const season = seasonality(p, 16, base);
    expect(season.ipoCount.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
    expect(season.ipoCount[1] - season.ipoCount[0]).toBeCloseTo(40); // Q2 sits 40 above Q1
    const idx = indexPanel(p);
    expect(realizedPath(idx, "Tech", "ipoCount", 16, base, season).map((v) => Math.round(v! * 100) / 100 + 0)).toEqual([0, 0, 0, 0]);
    expect(realizedPath(idx, "Tech", "ipoCount", 16, base).some((v) => Math.abs(v!) > 1)).toBe(true);
    // Valuations are measured from the quarter before and left as they are.
    expect(realizedPath(idx, "Tech", "valuation", 16, base, season)).toEqual(realizedPath(idx, "Tech", "valuation", 16, base));
  });

  it("builds the engine's inputs from the macro changes and ETF moves versus trend", () => {
    const p = panel(8, 1, (r) => {
      if (r.qi === 5) r.vix = 10;
      if (r.qi === 5 && r.sector === "Energy") r.valuation = -9;
    });
    const shock = scenarioAt(indexPanel(p), 5, baselines(p, 5))!;
    expect(shock.macro).toEqual({ fedFunds: 0, treasury10y: 0, baaSpread: 0, vix: 10 });
    expect(shock.sectors!.Energy!.valuation).toBe(-10); // −9 against a trend of +1
    expect(shock.sectors!.Tech!.valuation).toBe(0);
    expect(scenarioAt(indexPanel(panel(8, 1, (r) => r.qi === 5 && (r.vix = null))), 5, baselines(p, 5))).toBeNull();
  });

  it("scores perfect, empty and backwards forecasts", () => {
    const s = emptyScores();
    for (const [p, r] of [[2, 2], [-3, -3], [1, 1]]) addForecast(s, "ipoCount", 1, p, r);
    expect(summarize(s.ipoCount[0])).toEqual({ n: 3, skill: 1, hitRate: 1, slope: 1 });
    for (const [p, r] of [[2, -2], [-3, 3]]) addForecast(s, "dealCount", 2, p, r);
    expect(summarize(s.dealCount[1])).toMatchObject({ hitRate: 0, slope: -1 });
    // Predicting nothing scores 0 skill and has no direction to score.
    for (const r of [5, -4]) addForecast(s, "dealValue", 1, 0, r);
    expect(summarize(s.dealValue[0])).toMatchObject({ skill: 0, hitRate: null });
    expect(pool([s.ipoCount[0], s.dealCount[1]]).n).toBe(5);
  });

  it("with no links predicts no deal or IPO moves, and valuations from the quarter's own move", () => {
    const p = panel(12, 0, (r) => r.qi === 6 && r.sector === "Tech" && (r.valuation = 10));
    const { scores, points } = backtest(p, [6], () => NONE, { lambda: 1 });
    expect(featureScore(scores, "dealCount")).toBe(0);
    const tech = points.find((x) => x.feature === "valuation")!;
    // Average over the five sectors: Tech's +10 persists (λ = 1), the others are flat.
    expect(tech.predicted).toEqual([2, 2, 2, 2]);
    expect(tech.realized).toEqual([2, 2, 2, 2]);
    expect(summarize(scores.valuation[1])).toMatchObject({ skill: 1 });
  });

  it("doesn't count the macro inputs twice: the part of the ETF move they explain is taken out of the valuation input", () => {
    // A VIX jump whose same-quarter valuation effect is exactly what happened: nothing is left to feed in as a valuation shock.
    const vixEffect = runRipple({ macro: { vix: 10 } }, { links: DEFAULT_LINKS, quarters: 1 }).quarters[0].sectors;
    const p = panel(12, 0, (r) => {
      if (r.qi === 6) {
        r.vix = 10;
        r.valuation = vixEffect[r.sector as Sector].valuation.mid;
      }
    });
    const { points } = backtest(p, [6], () => DEFAULT_LINKS, { lambda: 1, rounds: 1 });
    const q1 = points.find((x) => x.feature === "valuation")!.predicted[0]!;
    const avg = SECTORS.reduce((t, s) => t + vixEffect[s].valuation.mid, 0) / SECTORS.length;
    expect(q1).toBeCloseTo(avg, 1);
  });

  it("puts prior widths into words", () => {
    expect(priorWords("0.5")).toBe("priors ×0.5");
    expect(priorWords("f0.25/s0.5/m1")).toBe("priors ×0.25 links, ×0.5 spillovers, ×1 macro");
    expect(priorWords(null)).toBe("hand-set");
  });

  it("averages skill over the quarters ahead when choosing settings", () => {
    const s = emptyScores();
    addForecast(s, "ipoCount", 1, 1, 1); // skill 1
    addForecast(s, "ipoCount", 2, 0, 3); // skill 0
    expect(featureScore(s, "ipoCount")).toBe(0.5);
    expect(FEATURES.every((f) => typeof featureScore(s, f) === "number")).toBe(true);
  });
});
