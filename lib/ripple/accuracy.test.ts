import { describe, expect, it } from "vitest";
import { accuracyInsights, addQuarters, forecastSeries, tuningChanges } from "./accuracy";
import type { BacktestFile } from "./backtest";
import backtestFile from "./backtest.json";
import { FEATURES } from "./links";
import { fadeOf } from "./engine";
import { TUNED } from "./settings";

const B = backtestFile as unknown as BacktestFile;

describe("accuracy page helpers", () => {
  it("adds quarters across year ends", () => {
    expect(addQuarters("2021Q3", 2)).toBe("2022Q1");
    expect(addQuarters("2019Q1", 0)).toBe("2019Q1");
  });

  it("lines up each forecast with the quarter it was for", () => {
    const s = forecastSeries(B, "ipoCount", 2);
    expect(s.labels.length).toBe(s.predicted.length);
    expect(s.labels.length).toBe(s.realized.length);
    expect(s.labels[0]).toBe(addQuarters(B.origins.from, 1));
  });

  it("writes short, number-led takeaways", () => {
    const lines = accuracyInsights(B);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);
    for (const l of lines) {
      expect(l).toMatch(/\d/);
      expect(l.length).toBeLessThan(140);
    }
  });

  it("lists what tuning changed, setting by setting", () => {
    const rows = tuningChanges(B);
    expect(rows.map((r) => r.setting)).toContain("Effects of effects");
    expect(rows.filter((r) => r.setting.endsWith("fade"))).toHaveLength(FEATURES.length);
  });
});

describe("the committed backtest", () => {
  it("covers every feature and quarter ahead, with the same quarter's valuation unscored", () => {
    for (const f of FEATURES) expect(B.features[f]).toHaveLength(B.horizon);
    expect(B.features.valuation[0].n).toBe(0);
  });

  it("drives the engine settings: tuned.json matches the backtest's choice", () => {
    expect(TUNED.linkSet).toBe(B.chosen.linkSet);
    expect(TUNED.rounds).toBe(B.chosen.rounds);
    expect(fadeOf(TUNED.lambda)).toEqual(fadeOf(B.chosen.lambda));
    // The chosen setup is the best one tried, and at least as good as the untuned one.
    expect(B.candidates[0].score).toBe(Math.max(...B.candidates.map((c) => c.score)));
    expect(B.summary.chosen.score).toBeGreaterThanOrEqual(B.summary.previous.score);
  });
});
