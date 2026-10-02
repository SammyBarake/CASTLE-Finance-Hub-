import { describe, expect, it } from "vitest";
import { SECTORS } from "../types";
import { ipoHistoryReady } from "./baseline";
import { DEFAULT_LINKS, explain, MAX_ROUNDS, runRipple, type Links } from "./engine";
import { rippleInsights } from "./insights";
import { ESTIMATED, MACRO_LINKS, STRENGTH_SCALE } from "./links";
import { formatShock, LINK_SETS, linksAreHandSet, PRESETS, RIPPLE_SETTINGS, SHOCK_RANGES, toRippleShock, rangeFor } from "./settings";

const signed = (d: "+" | "-", v: number) => (d === "-" ? -v : v);

/** DEFAULT_LINKS as if estimated: each link keeps its hand-set value, with a ±20% range. */
const estimated = (): Links => ({
  features: DEFAULT_LINKS.features.map((l) => {
    const v = signed(l.direction, STRENGTH_SCALE.feature[l.strength]);
    return { ...l, status: ESTIMATED, value: v, range: [v * 0.8, v * 1.2] as [number, number] };
  }),
  sectors: DEFAULT_LINKS.sectors.map((l) => {
    const v = signed(l.direction, STRENGTH_SCALE.sector[l.strength]);
    return { ...l, status: ESTIMATED, value: v, range: [v * 0.8, v * 1.2] as [number, number] };
  }),
  macro: DEFAULT_LINKS.macro.map((l) => {
    const v = signed(l.direction, STRENGTH_SCALE.macro[l.strength]);
    return { ...l, status: ESTIMATED, value: v, range: [v * 0.8, v * 1.2] as [number, number] };
  }),
});

describe("second-round effects (rounds: 2)", () => {
  const shock = { sectors: { Tech: { valuation: 10 } } };

  it("adds effects of effects on top of the direct ones", () => {
    const one = runRipple(shock, { rounds: 1 });
    const two = runRipple(shock, { rounds: 2 });
    expect(runRipple(shock)).toEqual(one);
    expect(two.rounds).toBe(2);
    // Tech valuation → Tech deal count (1 quarter later) → Tech deal value (same quarter): only in round 2.
    expect(two.quarters[1].sectors.Tech.dealValue.mid).toBeGreaterThan(one.quarters[1].sectors.Tech.dealValue.mid);
    for (const q of two.quarters) for (const s of SECTORS) for (const b of Object.values(q.sectors[s])) expect(b.low).toBeLessThanOrEqual(b.high);
  });

  it("explains a second-round effect with the variable it passed through and both hops' links", () => {
    const parts = explain(shock, "Tech", "dealValue", 2, { rounds: 2 });
    const viaCount = parts.find((c) => c.round === 2 && c.via[0] === "Tech dealCount");
    expect(viaCount).toBeDefined();
    expect(viaCount!.steps).toHaveLength(2);
    expect(viaCount!.steps.every((s) => s.links.length > 0)).toBe(true);
    // Round 1 alone has no such path.
    expect(explain(shock, "Tech", "dealValue", 2).every((c) => c.round <= 1)).toBe(true);
  });

  it("caps the rounds at MAX_ROUNDS", () => {
    expect(runRipple(shock, { rounds: MAX_ROUNDS + 5 }).quarters).toEqual(runRipple(shock, { rounds: MAX_ROUNDS }).quarters);
  });
});

describe("estimated links", () => {
  it("drops the assumption status once every link is estimated", () => {
    const links = estimated();
    expect(linksAreHandSet(DEFAULT_LINKS)).toBe(true);
    expect(linksAreHandSet(links)).toBe(false);
    const r = runRipple({ macro: { vix: 10 } }, { links });
    expect(r.handSet).toBe(false);
    expect(r.status).toBe(ESTIMATED);
  });

  it("uses each link's estimated value and range instead of the strength scale and ±band", () => {
    const links = estimated();
    const i = links.macro.findIndex((l) => l.from === "vix" && l.to === "ipoCount" && l.lag === 0);
    expect(MACRO_LINKS[i]).toBeDefined();
    links.macro[i] = { ...links.macro[i], value: -6, range: [-9, -3] };
    // VIX +10 points (one unit) → Tech IPOs −6%, range −9% to −3%, in the quarter of the shock.
    expect(runRipple({ macro: { vix: 10 } }, { links }).quarters[0].sectors.Tech.ipoCount).toEqual({ mid: -6, low: -9, high: -3 });
    // With hand-set links the same cell is −10% ± 50%.
    expect(runRipple({ macro: { vix: 10 } }).quarters[0].sectors.Tech.ipoCount).toEqual({ mid: -10, low: -15, high: -5 });
  });
});

describe("screen settings", () => {
  it("keeps every preset inside the slider ranges and on their steps", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.shocks.length).toBeGreaterThan(0);
      for (const s of p.shocks) {
        const r = rangeFor(s.target);
        expect(s.size).toBeGreaterThanOrEqual(r.min);
        expect(s.size).toBeLessThanOrEqual(r.max);
        expect(Math.abs(s.size / r.step - Math.round(s.size / r.step))).toBeLessThan(1e-9);
      }
    }
    for (const r of Object.values(SHOCK_RANGES)) expect(r.min).toBe(-r.max);
  });

  it("runs on the estimated links, direct effects only (second rounds wait for the backtest)", () => {
    expect(RIPPLE_SETTINGS).toMatchObject({ linkSet: "estimated", lambda: 0.7, band: 0.5, quarters: 4, rounds: 1 });
    expect(RIPPLE_SETTINGS.links).toBe(LINK_SETS.estimated);
    expect(LINK_SETS["hand-set"]).toBe(DEFAULT_LINKS);
    expect(RIPPLE_SETTINGS.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
  });

  it("turns the screen's shock list into an engine shock, adding shocks on the same target", () => {
    expect(
      toRippleShock([
        { target: { kind: "feature", feature: "valuation", sector: "Tech" }, size: 10 },
        { target: { kind: "feature", feature: "valuation", sector: "Tech" }, size: 5 },
        { target: { kind: "macro", macro: "fedFunds" }, size: 1 },
      ]),
    ).toEqual({ sectors: { Tech: { valuation: 15 } }, macro: { fedFunds: 1 } });
    expect(toRippleShock(PRESETS.find((p) => p.id === "rates")!.shocks)).toEqual({ sectors: {}, macro: { fedFunds: 1, treasury10y: 1 } });
  });

  it("formats shocks in their units", () => {
    expect(formatShock({ target: { kind: "feature", feature: "valuation", sector: "Energy" }, size: -25 })).toBe("−25%");
    expect(formatShock({ target: { kind: "macro", macro: "baaSpread" }, size: 2 })).toBe("+2.00 pp");
    expect(formatShock({ target: { kind: "macro", macro: "vix" }, size: 15 })).toBe("+15 pts");
  });
});

describe("ipoHistoryReady", () => {
  const months = (n: number, year: number) => Array.from({ length: n }, (_, i) => ({ month: `${year + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, ipoCount: 3 }));

  it("needs a year of IPO months before 2021", () => {
    expect(ipoHistoryReady(months(11, 2019))).toBe(false);
    expect(ipoHistoryReady(months(12, 2019))).toBe(true);
    // Recent months (the live data) don't count, and neither do empty ones.
    expect(ipoHistoryReady(months(36, 2022))).toBe(false);
    expect(ipoHistoryReady(months(24, 2018).map((r) => ({ ...r, ipoCount: 0 })))).toBe(false);
  });
});

describe("rippleInsights", () => {
  // The wording is under test, so pin the numbers to the hand-set links.
  const run = (id: string) => {
    const shock = toRippleShock(PRESETS.find((p) => p.id === id)!.shocks);
    return { shock, result: runRipple(shock, { ...RIPPLE_SETTINGS, links: DEFAULT_LINKS }) };
  };

  it("names the biggest knock-on move and the strongest spillover, leaving the shocked cell out", () => {
    const { shock, result } = run("tech");
    const lines = rippleInsights(result, shock, false);
    expect(lines[0]).toMatch(/^Biggest knock-on rise: Tech deal value \+\d+\.\d% in Q\d\.$/);
    expect(lines.some((l) => l.startsWith("Strongest spillover:") && !l.includes("Tech"))).toBe(true);
    expect(lines.join(" ")).not.toMatch(/Tech valuation/);
  });

  it("skips IPO cells until the IPO history is in", () => {
    const { shock, result } = run("tech");
    expect(rippleInsights(result, shock, false).join(" ")).not.toMatch(/IPO/);
    expect(rippleInsights(result, shock, true)[0]).toMatch(/Tech IPO count/);
  });

  it("describes a move shared by every sector once, not as one sector's", () => {
    const { shock, result } = run("credit");
    const lines = rippleInsights(result, shock, false);
    expect(lines[0]).toBe("Biggest knock-on fall: deal value −20.0% in every sector in Q1.");
    expect(lines[1]).toMatch(/^Effects fade 30% a quarter/);
  });

  it("says nothing for a zero shock", () => {
    expect(rippleInsights(runRipple({}), {}, true)).toEqual([]);
  });
});
