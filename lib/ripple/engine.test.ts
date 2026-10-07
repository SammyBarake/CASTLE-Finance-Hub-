import { describe, expect, it } from "vitest";
import { SECTORS } from "../types";
import { adviserOutlook, adviserShares } from "./advisers";
import { buildMatrices, DEFAULT_LAMBDA, DEFAULT_LINKS, explain, index, kron, N, runRipple, type RippleResult } from "./engine";
import { ASSUMPTION, FEATURE_LINKS, FEATURES, MACRO_LINKS, MACROS, SECTOR_LINKS } from "./links";

const all = (r: RippleResult) => r.quarters.flatMap((q) => SECTORS.flatMap((s) => FEATURES.map((f) => q.sectors[s][f])));
const total = (r: RippleResult, k: number) => SECTORS.reduce((t, s) => t + FEATURES.reduce((u, f) => u + Math.abs(r.quarters[k - 1].sectors[s][f].mid), 0), 0);

describe("matrices", () => {
  it("computes a Kronecker product", () => {
    expect(kron([[1, 2], [3, 4]], [[0, 5], [6, 7]])).toEqual([
      [0, 5, 0, 10],
      [6, 7, 12, 14],
      [0, 15, 0, 20],
      [18, 21, 24, 28],
    ]);
  });

  it("uses a link's per-sector value in that target sector's rows only", () => {
    const base = DEFAULT_LINKS;
    const links = {
      ...base,
      features: base.features.map((l) => (l.from === "valuation" && l.to === "dealCount" && l.lag === 1 ? { ...l, value: 0.5, bySector: { Healthcare: -0.4 } } : l)),
    };
    const { A, L } = buildMatrices(links);
    const hc = SECTORS.indexOf("Healthcare");
    // Healthcare deal counts: −0.4 × L[Healthcare][from]; Tech deal counts keep 0.5 × L[Tech][from].
    expect(A[1][index("dealCount", "Healthcare")][index("valuation", "Healthcare")]).toBeCloseTo(-0.4 * L[hc][hc]);
    expect(A[1][index("dealCount", "Healthcare")][index("valuation", "Energy")]).toBeCloseTo(-0.4 * L[hc][SECTORS.indexOf("Energy")]);
    expect(A[1][index("dealCount", "Tech")][index("valuation", "Tech")]).toBeCloseTo(0.5);
  });

  it("builds A = C ⊗ L per lag, without self-links", () => {
    const { C, L, A, M } = buildMatrices();
    expect(C).toHaveLength(3);
    expect(A[0]).toHaveLength(N);
    for (const a of A) for (let i = 0; i < N; i++) expect(a[i][i]).toBe(0);
    // Energy valuation -> Industrials IPOs at lag 1 = C1[ipo][valuation] × L[Industrials][Energy]
    const c = C[1][FEATURES.indexOf("ipoCount")][FEATURES.indexOf("valuation")];
    const l = L[SECTORS.indexOf("Industrials")][SECTORS.indexOf("Energy")];
    expect(A[1][index("ipoCount", "Industrials")][index("valuation", "Energy")]).toBeCloseTo(c * l);
    expect(c).toBeGreaterThan(0);
    expect(l).toBeGreaterThan(0);
    expect(M[0]).toHaveLength(N);
  });
});

describe("runRipple", () => {
  it("returns zero everywhere for a zero shock", () => {
    const r = runRipple({});
    expect(r.quarters).toHaveLength(4);
    for (const b of all(r)) expect(b).toEqual({ mid: 0, low: 0, high: 0 });
    expect(runRipple({ sectors: { Tech: { valuation: 0 } }, macro: { vix: 0 } }).quarters.every((q) => SECTORS.every((s) => FEATURES.every((f) => q.sectors[s][f].mid === 0)))).toBe(true);
  });

  it("fades over time: after the last lag every response shrinks by λ a quarter", () => {
    const r = runRipple({ sectors: { Tech: { valuation: 10 } }, macro: { baaSpread: 1 } }, { quarters: 8 });
    for (let k = 3; k < 8; k++) {
      expect(total(r, k + 1)).toBeLessThan(total(r, k));
      expect(total(r, k + 1) / total(r, k)).toBeCloseTo(DEFAULT_LAMBDA, 1);
    }
    expect(total(r, 8)).toBeLessThan(total(r, 1) * 0.3);
  });

  it("a positive Tech valuation shock raises Tech IPOs, most strongly a quarter later", () => {
    const r = runRipple({ sectors: { Tech: { valuation: 10 } } });
    const ipo = r.quarters.map((q) => q.sectors.Tech.ipoCount);
    expect(ipo[0].mid).toBeGreaterThan(0);
    expect(ipo[1].mid).toBeGreaterThan(ipo[0].mid);
    // Even the low end of the range is positive.
    expect(ipo[1].low).toBeGreaterThan(0);
    // The shocked variable itself fades by λ.
    expect(r.quarters.map((q) => q.sectors.Tech.valuation.mid)).toEqual([10, 7, 4.9, 3.43]);
  });

  it("gives every result a range of ±50% on the links, around the middle", () => {
    const r = runRipple({ sectors: { Energy: { valuation: -15 } }, macro: { fedFunds: 1, vix: 10 } });
    for (const b of all(r)) {
      expect(b.low).toBeLessThanOrEqual(b.mid);
      expect(b.mid).toBeLessThanOrEqual(b.high);
    }
    const ipo = r.quarters[0].sectors.Tech.ipoCount; // VIX only, at lag 0: -10% ± 50%
    expect(ipo).toEqual({ mid: -10, low: -15, high: -5 });
  });

  it("spills an Energy shock into Industrials more than into Tech", () => {
    const r = runRipple({ sectors: { Energy: { valuation: 10 } } });
    const q2 = r.quarters[1].sectors;
    expect(q2.Industrials.ipoCount.mid).toBeGreaterThan(0);
    expect(q2.Industrials.ipoCount.mid).toBeGreaterThan(q2.Tech.ipoCount.mid);
  });

  it("applies macro shocks to the features without feeding back into the macro inputs", () => {
    const r = runRipple({ macro: { baaSpread: 1 } });
    for (const s of SECTORS) expect(r.quarters[0].sectors[s].dealValue.mid).toBeLessThan(0);
    expect(r.quarters.map((q) => q.macro.baaSpread)).toEqual([1, 0.7, 0.49, 0.34]);
    expect(r.status).toBe(ASSUMPTION);
  });

  it("explains a result by its contributions", () => {
    const parts = explain({ sectors: { Tech: { valuation: 10 } } }, "Tech", "ipoCount", 2);
    expect(parts[0]).toMatchObject({ kind: "feature", source: "Tech valuation", lag: 1 });
  });
});

describe("links config", () => {
  const entries = [...FEATURE_LINKS, ...SECTOR_LINKS, ...MACRO_LINKS];
  it("marks every value as an assumption, with a strength, direction and a one-sentence reason", () => {
    for (const e of entries) {
      expect(e.status).toBe(ASSUMPTION);
      expect(["strong", "moderate", "weak"]).toContain(e.strength);
      expect(["+", "-"]).toContain(e.direction);
      expect(e.why).toMatch(/^[A-Z].{20,220}\.$/);
      expect(e.why.split(/\.\s/).length).toBe(1);
    }
  });

  it("uses known features, sectors, macro inputs and lags 0–2", () => {
    for (const l of FEATURE_LINKS) {
      expect(FEATURES).toContain(l.from);
      expect(FEATURES).toContain(l.to);
      expect([0, 1, 2]).toContain(l.lag);
    }
    for (const l of SECTOR_LINKS) {
      expect(SECTORS).toContain(l.from);
      expect(l.from).not.toBe(l.to);
    }
    for (const l of MACRO_LINKS) {
      expect(MACROS).toContain(l.from);
      expect([0, 1, 2]).toContain(l.lag);
    }
    const keys = FEATURE_LINKS.map((l) => `${l.from}>${l.to}@${l.lag}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("adviserOutlook", () => {
  const deal = (sector: (typeof SECTORS)[number], valueUsd: number, banks: string[]) => ({ announcedDate: "2025-06-01", sector, status: "Closed" as const, valueUsd, acquirerAdvisors: banks, targetAdvisors: [] });
  const shares = adviserShares(
    [deal("Tech", 8e9, ["Tech Boutique"]), deal("Tech", 2e9, ["Generalist"]), deal("Energy", 6e9, ["Generalist", "Energy Shop"])],
    "2024-01-01",
    "2026-06-30",
  );

  it("measures each bank's share of a sector's deal value", () => {
    expect(shares.sectorValueUsd.Tech).toBe(10e9);
    expect(shares.banks.find((b) => b.bank === "Tech Boutique")!.share.Tech).toBeCloseTo(0.8);
    expect(shares.banks.find((b) => b.bank === "Generalist")!.share.Energy).toBeCloseTo(1);
  });

  it("ranks the bank concentrated where deal value rises first, and the exposed one last", () => {
    const out = adviserOutlook(runRipple({ sectors: { Tech: { valuation: 10 }, Energy: { valuation: -10 } } }), shares);
    expect(out[0]).toMatchObject({ bank: "Tech Boutique", driver: "Tech" });
    expect(out[0].changeUsd.mid).toBeGreaterThan(0);
    expect(out.at(-1)!.bank).toBe("Energy Shop");
    expect(out.at(-1)!.changeUsd.mid).toBeLessThan(0);
    for (const o of out) {
      expect(o.changeUsd.low).toBeLessThanOrEqual(o.changeUsd.mid);
      expect(o.changeUsd.mid).toBeLessThanOrEqual(o.changeUsd.high);
    }
  });
});
