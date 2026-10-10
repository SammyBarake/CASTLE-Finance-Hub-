import { describe, expect, it } from "vitest";
import { decodeState, encodeState, type Spec } from "./urlState";

interface S {
  query: string;
  sector: "all" | "Tech" | "Energy";
  min: string;
  watchOnly: boolean;
  multiples: boolean;
}
const DEFAULTS: S = { query: "", sector: "all", min: "", watchOnly: false, multiples: true };
// watchOnly is personal (the viewer's own watchlist), so it is not in the spec and never shared.
const SPEC: Spec<S> = { query: { kind: "text" }, sector: { kind: "enum", values: ["all", "Tech", "Energy"] }, min: { kind: "number" }, multiples: { kind: "bool" } };

describe("URL state", () => {
  it("writes only what differs from the defaults, and reads it back", () => {
    const state: S = { query: "Thoma Bravo", sector: "Tech", min: "1.5", watchOnly: true, multiples: false };
    const q = encodeState(state, DEFAULTS, SPEC);
    expect(q).toBe("query=Thoma+Bravo&sector=Tech&min=1.5&multiples=0");
    expect(decodeState(new URLSearchParams(q), DEFAULTS, SPEC)).toEqual({ ...state, watchOnly: false });
    expect(encodeState(DEFAULTS, DEFAULTS, SPEC)).toBe("");
  });

  it("ignores values the screen doesn't accept", () => {
    const s = decodeState(new URLSearchParams("sector=Crypto&min=abc&multiples=yes&watchOnly=1"), DEFAULTS, SPEC);
    expect(s).toEqual(DEFAULTS);
  });
});
