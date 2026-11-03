import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { emptyPlateSvg, monthAngle, monthAt, peakLabelFits, PLATE, plateSeries, plateSvg, rosetteSvg, shortestTurn, spokeTip, type PlateSeries } from "./plate";
import { buildVolumeMatrix } from "./metrics";
import { SECTORS, type MonthlySectorVolume } from "./types";

/** 72 months with a seeded spread of values, as the real data has: sparse sectors and one large month. */
function series(months = 72, partial = true): PlateSeries {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return {
    months: Array.from({ length: months }, (_, i) => `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`),
    bands: Array.from({ length: months }, (_, i) => SECTORS.map(() => (i === 40 ? 40e9 : random() * 12e9))),
    partial,
  };
}

const coordinates = (svg: string) => [...svg.matchAll(/ d="M(\d+) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe("plateSeries", () => {
  it("takes the Hub's matrix as it is, month in progress included", () => {
    const rows: MonthlySectorVolume[] = ["2026-09", "2026-10"].flatMap((month) => SECTORS.map((sector, i) => ({ month, sector, dealValueUsd: (i + 1) * 1e9, dealCount: 1 })));
    const s = plateSeries(buildVolumeMatrix(rows, "2026-10"));
    expect(s.months).toEqual(["2026-09", "2026-10"]);
    expect(s.bands[0]).toEqual([1e9, 2e9, 3e9, 4e9, 5e9]);
    expect(s.partial).toBe(true);
    expect(plateSeries(buildVolumeMatrix(rows, "2026-11")).partial).toBe(false);
  });
});

describe("plateSvg", () => {
  it("is the same picture for the same data", () => {
    expect(plateSvg(series(), "full")).toBe(plateSvg(series(), "full"));
  });

  it("has no broken numbers and stays on the dial", () => {
    for (const detail of ["full", "phone"] as const) {
      const svg = plateSvg(series(), detail);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      for (const [x, y] of coordinates(svg)) {
        expect(Math.hypot(x - PLATE.centre, y - PLATE.centre)).toBeLessThanOrEqual(PLATE.tickLong + 1);
      }
    }
  });

  it("stays small enough to send: the real page needs it on first paint", () => {
    const size = (s: string) => gzipSync(s, { level: 6 }).length / 1024;
    expect(size(plateSvg(series(), "full"))).toBeLessThan(45);
    expect(size(plateSvg(series(), "phone"))).toBeLessThan(25);
    expect(size(rosetteSvg("full"))).toBeLessThan(3);
  });

  it("draws one tick per month and the month in progress lighter", () => {
    const s = series(24);
    const svg = plateSvg(s, "full");
    const ticks = /<path d="(M[^"]+)" stroke-opacity="\.8"/.exec(svg)![1];
    expect(ticks.match(/M/g)).toHaveLength(24);
    expect(svg).toContain('stroke-opacity=".3"');
    expect(plateSvg({ ...s, partial: false }, "full")).not.toContain('stroke-opacity=".3"');
  });

  it("draws a dial with no chart when there's no data", () => {
    const svg = emptyPlateSvg();
    expect(svg).toContain("<circle");
    expect(svg).not.toMatch(/NaN/);
    expect(plateSvg({ months: ["2026-01"], bands: [[0, 0, 0, 0, 0]], partial: false }, "full")).not.toMatch(/NaN/);
  });
});

describe("the dial's geometry", () => {
  it("runs clockwise from the top, and an angle reads back as its month", () => {
    expect(monthAngle(0, 72)).toBeCloseTo(2.5);
    for (const i of [0, 1, 35, 71]) expect(monthAt(monthAngle(i, 72), 72)).toBe(i);
    expect(monthAt(-1, 72)).toBe(71);
    expect(monthAt(360, 72)).toBe(0);
  });

  it("keeps the peak label out of the words beside the dial", () => {
    expect(peakLabelFits(306)).toBe(true);
    expect(peakLabelFits(285)).toBe(false);
    expect(peakLabelFits(100)).toBe(true);
  });

  it("turns the short way round at the seam", () => {
    expect(shortestTurn(357.5, 2.5)).toBeCloseTo(362.5);
    expect(shortestTurn(2.5, 357.5)).toBeCloseTo(-2.5);
    expect(shortestTurn(722.5, 10)).toBeCloseTo(730);
    expect(shortestTurn(10, 100)).toBeCloseTo(100);
  });

  it("puts the largest month furthest out, on a root scale", () => {
    const s = series();
    expect(spokeTip(s, 40)).toBeCloseTo(PLATE.spokeBase + PLATE.spokeMax);
    const quarter: PlateSeries = { months: ["a", "b"], bands: [[4, 0, 0, 0, 0], [1, 0, 0, 0, 0]], partial: false };
    expect(spokeTip(quarter, 1)).toBeCloseTo(PLATE.spokeBase + PLATE.spokeMax / 2);
  });
});
