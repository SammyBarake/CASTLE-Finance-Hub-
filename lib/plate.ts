/**
 * The landing page's plate: a radial chart of real monthly M&A value, drawn as engraved hairlines. One spoke per month,
 * clockwise from the top; a spoke's length is the month's announced value (root scale), and its bands are the sectors,
 * from Tech at the core to Industrials at the tip. The Hub's own monthly matrix goes in, so the art can't drift from the
 * figures. Pure; relative imports because Vitest doesn't resolve "@/".
 *
 * It travels as an image (/api/landing/plate.svg), never inline: a server component's markup ships twice (the HTML and
 * the React payload), and an <img> rasterises once into one texture that nothing has to repaint.
 */
import { completeMonths, type VolumeMatrix } from "./metrics";
import { SECTORS } from "./types";

export type PlateDetail = "full" | "phone";

export interface PlateSeries {
  /** "YYYY-MM", oldest first. */
  months: string[];
  /** Per month, per sector (SECTORS order): value in USD. */
  bands: number[][];
  /** The last month is still in progress. */
  partial: boolean;
}

/** The dial's radii in viewBox units (0 0 2000 2000). */
export const PLATE = { size: 2000, centre: 1000, spokeBase: 520, spokeMax: 366, bezel: 906, tick: 918, tickLong: 944 } as const;

const TAU = Math.PI * 2;
const C = PLATE.centre;
const round = Math.round;

export function plateSeries(matrix: VolumeMatrix): PlateSeries {
  return {
    months: matrix.months,
    bands: matrix.months.map((_, i) => SECTORS.map((s) => matrix.bySector[s].value[i])),
    partial: completeMonths(matrix) < matrix.months.length,
  };
}

/** A month's angle from the top, clockwise, in degrees: where its spoke and the needle point. */
export const monthAngle = (index: number, count: number) => ((index + 0.5) / count) * 360;

/** The month under an angle (degrees from the top, clockwise). */
export function monthAt(angle: number, count: number): number {
  const a = ((angle % 360) + 360) % 360;
  return Math.min(count - 1, Math.floor((a / 360) * count));
}

/** The short way round from one angle to another, so a needle crossing 12 o'clock doesn't whip all the way back. */
export function shortestTurn(from: number, to: number): number {
  const delta = (((to - from) % 360) + 540) % 360 - 180;
  return from + delta;
}

/**
 * Whether the largest month's label has room: on the left, around 9 o'clock, it would run into the words beside the dial
 * and the cover's headline. The copy names that month anyway, so there it just isn't drawn.
 */
export const peakLabelFits = (angle: number) => angle < 244 || angle > 300;

/** A spoke's tip radius: how far the month's value reaches on the root scale. */
export function spokeTip(series: PlateSeries, index: number): number {
  const total = (i: number) => series.bands[i].reduce((a, b) => a + b, 0);
  const peak = Math.max(0, ...series.months.map((_, i) => total(i)));
  return peak ? PLATE.spokeBase + PLATE.spokeMax * Math.sqrt(total(index) / peak) : PLATE.spokeBase;
}

/** One closed curve as a compact relative path: integer coordinates are what keep the whole plate near 25 KB gzipped. */
function closedPath(radius: (t: number) => number, steps: number): string {
  let out = "";
  let px = 0;
  let py = 0;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const th = t * TAU - Math.PI / 2;
    const r = radius(t);
    const x = round(C + r * Math.cos(th));
    const y = round(C + r * Math.sin(th));
    if (i === 0) out += `M${x} ${y}l`;
    else {
      const dx = x - px;
      const dy = y - py;
      out += `${out.endsWith("l") || dx < 0 ? "" : " "}${dx}${dy < 0 ? "" : " "}${dy}`;
    }
    px = x;
    py = y;
  }
  return `${out}z`;
}

const circles = (radii: number[], attrs: string) => `<g ${attrs}>${radii.map((r) => `<circle cx="${C}" cy="${C}" r="${r}"/>`).join("")}</g>`;

/** A curve and its rotated copies: symmetric rings cost one path, however many copies they have. */
function repeated(id: string, radius: (t: number) => number, steps: number, copies: number, step: number, attrs: string) {
  let s = `<g ${attrs}><path id="${id}" d="${closedPath(radius, steps)}"/>`;
  for (let k = 1; k < copies; k++) s += `<use href="#${id}" transform="rotate(${+(k * step).toFixed(3)} ${C} ${C})"/>`;
  return `${s}</g>`;
}

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PLATE.size} ${PLATE.size}" fill="none" stroke="#ECEAE4" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

/** The engine-turned band around the centre: interlaced lobes, the fine lathe work on a banknote or a watch dial. */
function lace(detail: PlateDetail, id: string) {
  const copies = detail === "full" ? 15 : 8;
  const step = 15 / copies;
  const width = detail === "full" ? 0.9 : 1.5;
  return repeated(id, (t) => 400 + 96 * (0.5 + 0.5 * Math.sin(TAU * 24 * t)), 24 * 14, copies, step, `stroke-opacity=".44" stroke-width="${width}"`);
}

/** How strongly each sector's band is inked, core to tip: told apart by weight of line, never by colour. */
const BAND_INK = [1, 0.52, 0.84, 0.44, 0.72];

/**
 * The chart. Each month is a fan of radial hairlines, tallest in the middle of its slice; a month's bands are cut with a
 * hair's gap, so the sectors read as engraved steps. The month in progress is drawn lighter, as the site's charts do.
 */
export function plateSvg(series: PlateSeries, detail: PlateDetail): string {
  const count = series.months.length;
  const lines = detail === "full" ? 11 : 6;
  const width = detail === "full" ? 1.5 : 2.8;
  const peak = Math.max(0, ...series.bands.map((b) => b.reduce((x, y) => x + y, 0)));
  const segments: string[][] = SECTORS.map(() => []);
  const partialSegments: string[] = [];
  if (peak > 0)
    series.bands.forEach((bands, i) => {
      const total = bands.reduce((a, b) => a + b, 0);
      if (!total) return;
      const height = PLATE.spokeMax * Math.sqrt(total / peak);
      const inProgress = series.partial && i === count - 1;
      for (let k = 0; k < lines; k++) {
        const f = (k + 0.5) / lines;
        const th = ((i + 0.08 + f * 0.84) / count) * TAU - Math.PI / 2;
        const shape = Math.pow(Math.sin(Math.PI * f), 0.55);
        const cos = Math.cos(th);
        const sin = Math.sin(th);
        let done = 0;
        bands.forEach((value, b) => {
          const from = PLATE.spokeBase + done * height * shape + 1.5;
          done += value / total;
          const to = PLATE.spokeBase + done * height * shape - 1.5;
          if (to - from < 2) return;
          const x = round(C + from * cos);
          const y = round(C + from * sin);
          const dx = round(C + to * cos) - x;
          const dy = round(C + to * sin) - y;
          (inProgress ? partialSegments : segments[b]).push(`M${x} ${y}l${dx}${dy < 0 ? "" : " "}${dy}`);
        });
      }
    });

  const ticks = series.months
    .map((m, i) => {
      const th = ((i + 0.5) / count) * TAU - Math.PI / 2;
      const end = m.endsWith("-01") ? PLATE.tickLong : PLATE.tick + 10;
      return `M${round(C + PLATE.tick * Math.cos(th))} ${round(C + PLATE.tick * Math.sin(th))}L${round(C + end * Math.cos(th))} ${round(C + end * Math.sin(th))}`;
    })
    .join("");

  return svg(
    [
      ...segments.map((s, b) => (s.length ? `<path stroke-opacity="${BAND_INK[b]}" stroke-width="${width}" d="${s.join("")}"/>` : "")),
      partialSegments.length ? `<path stroke-opacity=".3" stroke-width="${width}" d="${partialSegments.join("")}"/>` : "",
      lace(detail, "l"),
      circles([392, 504, 510, PLATE.bezel, PLATE.tick], `stroke-opacity=".5" stroke-width="${detail === "full" ? 1 : 1.5}"`),
      ticks ? `<path d="${ticks}" stroke-opacity=".8" stroke-width="${detail === "full" ? 1.2 : 1.8}"/>` : "",
    ].join(""),
  );
}

/**
 * The same lace alone. It lies over the plate's own and turns by a fraction of a degree, so moiré fringes swim through
 * the band like light on engraved metal; moving it needs no repaint, and no chart line ever moves off its month.
 */
export const rosetteSvg = (detail: PlateDetail) => svg(lace(detail, "r"));

/** A plate with no chart, for when the data is unavailable: the page still looks finished. */
export const emptyPlateSvg = () => plateSvg({ months: [], bands: [], partial: false }, "full");
