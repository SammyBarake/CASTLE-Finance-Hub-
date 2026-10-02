import { describe, expect, it } from "vitest";
import { SECTORS } from "../types";
import { DEFAULT_LINKS, explain, runRipple, type Links } from "./engine";
import { applyEstimates, ESTIMATED_LINKS, ESTIMATES, strengthOf, type EstimatesFile } from "./estimated";
import { ASSUMPTION, ESTIMATED, FEATURES, linkKey } from "./links";

const meta: EstimatesFile["meta"] = { generatedAt: "2026-10-01T00:00:00Z", window: { from: "2015Q1", to: "2026Q3", quarters: 47 }, ipoHistory: true, enoughData: 0.5, bootstrapRuns: 1000 };
const row = (key: string, value: number, weight: number, prior: number) => ({ key, value, range: [value - 0.1, value + 0.1], n: 150, weight, prior });

describe("applyEstimates", () => {
  const file: EstimatesFile = {
    meta,
    features: [row("C:valuation>ipoCount@1", 1.6, 0.8, 1), row("C:dealCount>dealValue@0", 0.9, 0.3, 1)],
    sectors: [row("L:Energy>Industrials", -0.2, 0.9, 0.5)],
    macro: [
      // A common effect, kept on the hand-set link.
      { ...row("M:vix>valuation@0:all", -6, 0.7, -5), from: "vix", to: "valuation", lag: 0, sectors: "all", basedOn: "M:vix>valuation@0:all" },
      // A sector-specific effect: one link per sector, reasons inherited.
      { ...row("M:baaSpread>valuation@0:Financials", -12, 0.6, -10), from: "baaSpread", to: "valuation", lag: 0, sectors: ["Financials"], basedOn: "M:baaSpread>valuation@0:Financials" },
      { ...row("M:baaSpread>valuation@0:Tech", -3, 0.6, -5), from: "baaSpread", to: "valuation", lag: 0, sectors: ["Tech"], basedOn: "M:baaSpread>valuation@0:all" },
    ],
  };
  const links = applyEstimates(DEFAULT_LINKS, file);

  it("puts each estimate on its hand-set link, keeping the reason", () => {
    const ipo = links.features.find((l) => linkKey(l) === "C:valuation>ipoCount@1")!;
    const hand = DEFAULT_LINKS.features.find((l) => linkKey(l) === "C:valuation>ipoCount@1")!;
    expect(ipo).toMatchObject({ value: 1.6, range: [1.6 - 0.1, 1.6 + 0.1], n: 150, weight: 0.8, prior: 1, strength: "strong", direction: "+", status: ESTIMATED, why: hand.why });
  });

  it("drops the assumption status only where the data outweighs the prior", () => {
    expect(links.features.find((l) => linkKey(l) === "C:dealCount>dealValue@0")!.status).toBe(ASSUMPTION);
    // Links the file doesn't cover stay hand-set.
    const untouched = links.features.find((l) => linkKey(l) === "C:valuation>dealValue@0")!;
    expect(untouched).toBe(DEFAULT_LINKS.features.find((l) => linkKey(l) === "C:valuation>dealValue@0"));
  });

  it("takes direction and strength from the estimate, so a flipped link says so", () => {
    expect(links.sectors.find((l) => linkKey(l) === "L:Energy>Industrials")).toMatchObject({ direction: "-", strength: "moderate", value: -0.2, prior: 0.5 });
  });

  it("builds macro links from the file: common effects as one link, sector-specific ones per sector", () => {
    expect(links.macro).toHaveLength(3);
    const tech = links.macro.find((l) => l.from === "baaSpread" && l.sectors !== "all" && l.sectors[0] === "Tech")!;
    expect(tech.why).toBe(DEFAULT_LINKS.macro.find((l) => linkKey(l) === "M:baaSpread>valuation@0:all")!.why);
    expect(applyEstimates(DEFAULT_LINKS, { ...file, macro: [] }).macro).toBe(DEFAULT_LINKS.macro);
  });

  it("names strengths by the nearest step of the scale", () => {
    expect([1.2, 0.8, 0.6, 0.35, 0.3, 0.05].map((v) => strengthOf("feature", v))).toEqual(["strong", "strong", "moderate", "moderate", "weak", "weak"]);
    expect(strengthOf("macro", -7.5)).toBe("strong");
  });
});

describe("the committed estimates (lib/ripple/estimated.json)", () => {
  it("cover every hand-set feature and sector link, and every macro effect", () => {
    for (const l of [...DEFAULT_LINKS.features, ...DEFAULT_LINKS.sectors]) expect([...ESTIMATES.features, ...ESTIMATES.sectors].map((r) => r.key)).toContain(linkKey(l));
    const groups = new Set(ESTIMATES.macro.map((r) => `${r.from}>${r.to}@${r.lag}`));
    for (const l of DEFAULT_LINKS.macro) expect(groups).toContain(`${l.from}>${l.to}@${l.lag}`);
  });

  it("carry sensible ranges, sample sizes and data weights", () => {
    for (const r of [...ESTIMATES.features, ...ESTIMATES.sectors, ...ESTIMATES.macro]) {
      expect(r.range[0]).toBeLessThanOrEqual(r.range[1]);
      expect(r.weight).toBeGreaterThanOrEqual(0);
      expect(r.weight).toBeLessThanOrEqual(1);
      if (r.n === 0) expect(r.weight).toBe(0);
    }
  });

  it("give every link in the estimated set a status that matches its data weight, and a reason", () => {
    for (const l of [...ESTIMATED_LINKS.features, ...ESTIMATED_LINKS.sectors, ...ESTIMATED_LINKS.macro]) {
      expect(l.status).toBe((l.weight ?? 0) >= ESTIMATES.meta.enoughData ? ESTIMATED : ASSUMPTION);
      expect(l.why.length).toBeGreaterThan(20);
      expect(l.value).toBeDefined();
    }
  });
});

describe("assumption shares per result", () => {
  const shock = { sectors: { Tech: { valuation: 10 } } };
  const allEstimated: Links = {
    features: DEFAULT_LINKS.features.map((l) => ({ ...l, status: ESTIMATED })),
    sectors: DEFAULT_LINKS.sectors.map((l) => ({ ...l, status: ESTIMATED })),
    macro: DEFAULT_LINKS.macro.map((l) => ({ ...l, status: ESTIMATED })),
  };

  it("is 1 for knock-on effects on hand-set links and 0 once every link is estimated", () => {
    expect(runRipple(shock).quarters[1].assumed.Tech.ipoCount).toBe(1);
    const r = runRipple(shock, { links: allEstimated });
    for (const q of r.quarters) for (const s of SECTORS) for (const f of FEATURES) expect(q.assumed[s][f]).toBe(0);
    expect(explain(shock, "Tech", "ipoCount", 2, { links: allEstimated }).every((c) => !c.assumed)).toBe(true);
  });

  it("splits a result between estimated and assumed links", () => {
    // Only "valuation → IPO count, 1 quarter later" estimated: Tech IPOs in Q2 are mostly, not wholly, on data.
    const mixed: Links = { ...DEFAULT_LINKS, features: DEFAULT_LINKS.features.map((l) => (linkKey(l) === "C:valuation>ipoCount@1" ? { ...l, status: ESTIMATED } : l)) };
    const share = runRipple(shock, { links: mixed }).quarters[1].assumed.Tech.ipoCount;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.5);
    // The shocked cell's own move isn't a knock-on effect.
    expect(runRipple({ sectors: { Tech: { dealValue: 10 } } }, { links: allEstimated }).quarters[0].assumed.Tech.dealValue).toBe(0);
  });

  it("is 0 everywhere for a zero shock", () => {
    for (const s of SECTORS) expect(runRipple({}).quarters[0].assumed[s].valuation).toBe(0);
  });
});
