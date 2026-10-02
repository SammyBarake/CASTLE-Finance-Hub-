"use client";

import { Icon } from "@/components/ui/Icon";
import { PanelHead, SectorDot, Segment } from "@/components/ui/primitives";
import type { RippleResult } from "@/lib/ripple/engine";
import { FEATURES, type Feature } from "@/lib/ripple/links";
import { ASSUMED_ABOVE, fadeSummary, FEATURE_LABELS } from "@/lib/ripple/settings";
import { SECTORS, type Sector } from "@/lib/types";
import { useTween } from "./useTween";

export interface Selection {
  sector: Sector;
  feature: Feature;
}

const SHORT: Record<Feature, string> = { valuation: "Value", dealCount: "Deals", dealValue: "Deal $", ipoCount: "IPOs" };
const pct = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(1)}%`;
};
const UP = "111, 186, 152";
const DOWN = "214, 129, 135";

/** Cell colour: green up, red down, stronger with size (relative to the largest knock-on effect). */
function cellStyle(mid: number, scale: number, wave: number): React.CSSProperties {
  const intensity = Math.min(1, Math.abs(mid) / scale);
  const rgb = mid >= 0 ? UP : DOWN;
  const on = Math.abs(mid) >= 0.05;
  return {
    "--cell-bg": on ? `rgba(${rgb}, ${(0.06 + 0.42 * intensity).toFixed(3)})` : undefined,
    "--cell-line": on ? `rgba(${rgb}, ${(0.1 + 0.42 * intensity).toFixed(3)})` : undefined,
    "--wave-rgb": rgb,
    "--d": wave,
  } as React.CSSProperties;
}

/** Steps from the shocked cells (a macro shock starts at the first column), for the ripple wave's delay. */
function waveDistance(s: Sector, f: Feature, shocked: Set<string>, macro: boolean): number {
  const r = SECTORS.indexOf(s);
  const c = FEATURES.indexOf(f);
  let d = macro ? c : Infinity;
  for (const key of shocked) {
    const [ss, ff] = key.split("|") as [Sector, Feature];
    d = Math.min(d, Math.abs(SECTORS.indexOf(ss) - r) + Math.abs(FEATURES.indexOf(ff) - c));
  }
  return Number.isFinite(d) ? d : r + c;
}

export function RippleGrid({
  result,
  quarter,
  onQuarter,
  playing,
  onPlay,
  stepMs,
  selected,
  onSelect,
  shocked,
  macroShock,
  wave,
  ipoReady,
}: {
  result: RippleResult;
  quarter: number;
  onQuarter: (q: number) => void;
  playing: boolean;
  onPlay: () => void;
  /** How long play holds each quarter (the scrubber fills at that pace). */
  stepMs: number;
  selected: Selection;
  onSelect: (s: Selection) => void;
  /** "Sector|feature" keys the user shocked directly. */
  shocked: Set<string>;
  /** The scenario includes a macro shock (the wave then starts at the first column). */
  macroShock: boolean;
  /** Changes whenever the scenario does: replays the ripple wave. */
  wave: number;
  ipoReady: boolean;
}) {
  const q = result.quarters[quarter - 1];
  const cells = SECTORS.flatMap((s) => FEATURES.map((f) => ({ s, f })));
  // Values glide between quarters and scenarios.
  const tween = useTween(cells.flatMap(({ s, f }) => [q.sectors[s][f].mid, q.sectors[s][f].low, q.sectors[s][f].high]));
  // Colours scale to the largest knock-on effect over all quarters, so smaller ripples stay visible next to a big shock.
  const knockOn = result.quarters.flatMap((r) => cells.filter(({ s, f }) => !shocked.has(`${s}|${f}`) && (ipoReady || f !== "ipoCount")).map(({ s, f }) => Math.abs(r.sectors[s][f].mid)));
  const scale = Math.max(1, ...knockOn);
  const last = result.quarters.length;
  const anyAssumed = cells.some(({ s, f }) => q.assumed[s][f] > ASSUMED_ABOVE && q.sectors[s][f].mid !== 0);

  return (
    <section className="panel ripple-panel">
      <PanelHead title="Ripple by sector" subtitle="% change versus no shock · click a cell for its path and its links">
        <div className="ripple-controls">
          <button
            type="button"
            className="tool-icon ripple-play"
            onClick={onPlay}
            aria-label={playing ? "Pause the ripple" : quarter === last ? "Replay the ripple from Q1" : "Play the ripple quarter by quarter"}
            aria-pressed={playing}
          >
            <Icon name={playing ? "pause" : quarter === last ? "replay" : "play"} />
          </button>
          <Segment label="Quarter" value={quarter} onChange={onQuarter} options={result.quarters.map((r) => ({ value: r.quarter, label: `Q${r.quarter}` }))} />
        </div>
      </PanelHead>
      <div className={`ripple-scrubber ${playing ? "playing" : ""}`} style={{ "--step": `${stepMs}ms` } as React.CSSProperties} aria-hidden="true">
        <i style={{ transform: `scaleX(${quarter / last})` }} />
      </div>
      <div className="ripple-scroll">
        <table className="ripple-table">
          <caption className="sr-only">Effects in Q{quarter}, % change versus no shock</caption>
          <thead>
            <tr>
              <th scope="col" className="ripple-corner">
                <span className="sr-only">Sector</span>
              </th>
              {FEATURES.map((f) => (
                <th key={f} scope="col">
                  <span className="long">{FEATURE_LABELS[f]}</span>
                  <span className="short" aria-hidden="true">
                    {SHORT[f]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SECTORS.map((s, row) => (
              <tr key={s}>
                <th scope="row" className="ripple-sector">
                  <SectorDot sector={s} />
                  {s}
                </th>
                {FEATURES.map((f, col) => {
                  const i = (row * FEATURES.length + col) * 3;
                  const [mid, low, high] = [tween[i], tween[i + 1], tween[i + 2]];
                  const exact = q.sectors[s][f];
                  const isShock = shocked.has(`${s}|${f}`);
                  const loading = f === "ipoCount" && !ipoReady;
                  const isSelected = selected.sector === s && selected.feature === f;
                  const assumed = !isShock && exact.mid !== 0 && q.assumed[s][f] > ASSUMED_ABOVE;
                  // Range bar on a symmetric scale: centre = no change.
                  const span = Math.max(scale, Math.abs(low), Math.abs(high));
                  const at = (v: number) => 50 + (v / span) * 50;
                  return (
                    <td key={f}>
                      <button
                        type="button"
                        className={`ripple-cell ${isSelected ? "selected" : ""} ${loading ? "loading" : ""} ${Math.abs(mid) < 0.05 ? "zero" : ""} ${isShock ? "shock" : ""}`}
                        style={loading ? undefined : cellStyle(mid, isShock ? Math.max(Math.abs(exact.mid), 1) : scale, waveDistance(s, f, shocked, macroShock))}
                        aria-pressed={isSelected}
                        aria-label={`${s} ${FEATURE_LABELS[f]}, Q${quarter}: ${loading ? "IPO history loading" : `${pct(exact.mid)}, range ${pct(exact.low)} to ${pct(exact.high)}`}${isShock ? " (your shock)" : assumed ? " (leans on hand-set assumptions)" : ""}`}
                        onClick={() => onSelect({ sector: s, feature: f })}
                      >
                        {!loading && <span key={wave} className="ripple-wave" aria-hidden="true" />}
                        {loading ? (
                          <span className="ripple-loading">IPO history loading</span>
                        ) : (
                          <>
                            <span className="ripple-value mono">{pct(mid)}</span>
                            <span className="ripple-range" aria-hidden="true">
                              <i style={{ left: `${Math.min(at(low), at(high))}%`, width: `${Math.max(1.5, Math.abs(at(high) - at(low)))}%` }} />
                            </span>
                          </>
                        )}
                        {isShock ? (
                          <span className="ripple-shock-tag">shock</span>
                        ) : (
                          assumed && <span className="ripple-mark" title="Leans mostly on hand-set links (assumption)" aria-hidden="true" />
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ripple-legend">
        <span className="ripple-legend-scale" aria-hidden="true">
          <span>Fall</span>
          <i />
          <span>Rise</span>
        </span>
        <span className="ripple-legend-item" aria-hidden="true">
          <span className="ripple-legend-range" /> range
        </span>
        {anyAssumed && (
          <span className="ripple-legend-item">
            <span className="ripple-mark static" aria-hidden="true" /> assumption: leans on hand-set links
          </span>
        )}
        <small>Once their links fire, {fadeSummary(result.lambda)}.</small>
      </div>
    </section>
  );
}
