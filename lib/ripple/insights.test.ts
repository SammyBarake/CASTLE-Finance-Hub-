import { describe, expect, it } from "vitest";
import { explain, type Contribution } from "./engine";
import { driverSentence } from "./insights";

describe("driverSentence", () => {
  it("names the input behind a result in plain English", () => {
    const shock = { macro: { baaSpread: 2 } };
    const why = explain(shock, "Financials", "dealValue", 4, { rounds: 1 });
    const s = driverSentence("Financials deal value", 4, why, shock)!;
    expect(s).toMatch(/^Financials deal value [+−]\d+\.\d% by Q4, mainly because the Baa spread widened 200bp/);
  });

  it("describes a shocked variable, cancelling paths and sector shocks", () => {
    const own: Contribution[] = [{ kind: "shock", source: "Tech valuation", lag: null, round: 0, via: [], value: 20, assumed: false, steps: [] }];
    expect(driverSentence("Tech valuation", 1, own, { sectors: { Tech: { valuation: 20 } } })).toBe("Tech valuation +20.0% by Q1: the move you set, plus its knock-on effects.");
    const knock = (source: string, value: number): Contribution => ({ kind: "feature", source, lag: 1, round: 1, via: [], value, assumed: false, steps: [] });
    expect(driverSentence("Tech deal count", 2, [knock("Tech valuation", 1), knock("Energy valuation", -1)], { sectors: { Tech: { valuation: 20 } } })).toBe("Tech deal count barely moves by Q2: its paths cancel out.");
    expect(driverSentence("Tech deal count", 2, [knock("Tech valuation", 3)], { sectors: { Tech: { valuation: 20 } } })).toBe("Tech deal count +3.0% by Q2, mainly because Tech valuation rose 20%.");
  });
});
