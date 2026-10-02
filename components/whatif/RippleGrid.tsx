"use client";

import { Icon } from "@/components/ui/Icon";
import { PanelHead, SectorDot, Segment } from "@/components/ui/primitives";
import type { Band, RippleResult } from "@/lib/ripple/engine";
import { FEATURES, type Feature } from "@/lib/ripple/links";
import { ASSUMED_ABOVE, FEATURE_LABELS } from "@/lib/ripple/settings";
import { SECTORS, type Sector } from "@/lib/types";
import { AssumptionBadge } from "./AssumptionBadge";

export interface Selection {
  sector: Sector;
  feature: Feature;
}

const SHORT: Record<Feature, string> = { valuation: "Value", dealCount: "Deals", dealValue: "Deal $", ipoCount: "IPOs" };
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;

/** Cell colour: green up, red down, stronger with size (relative to the largest knock-on effect in the scenario). */
function cellStyle(b: Band, scale: number): React.CSSProperties {
  if (!b.mid) return {};
  const intensity = Math.min(1, Math.abs(b.mid) / scale);
  const alpha = (0.07 + 0.43 * intensity).toFixed(3);
  return { "--cell-bg": b.mid > 0 ? `rgba(111, 186, 152, ${alpha})` : `rgba(214, 129, 135, ${alpha})`, "--cell-line": b.mid > 0 ? `rgba(111, 186, 152, ${(0.12 + 0.4 * intensity).toFixed(3)})` : `rgba(214, 129, 135, ${(0.12 + 0.4 * intensity).toFixed(3)})` } as React.CSSProperties;
}

export function RippleGrid({
  result,
  quarter,
  onQuarter,
  playing,
  onPlay,
  selected,
  onSelect,
  shocked,
  ipoReady,
}: {
  result: RippleResult;
  quarter: number;
  onQuarter: (q: number) => void;
  playing: boolean;
  onPlay: () => void;
  selected: Selection;
  onSelect: (s: Selection) => void;
  /** "Sector|feature" keys the user shocked directly. */
  shocked: Set<string>;
  ipoReady: boolean;
}) {
  const q = result.quarters[quarter - 1];
  // Scale colours to the largest knock-on effect over all quarters, so smaller ripples stay visible next to a big shock.
  const knockOn = result.quarters.flatMap((r) => SECTORS.flatMap((s) => FEATURES.filter((f) => !shocked.has(`${s}|${f}`) && (ipoReady || f !== "ipoCount")).map((f) => Math.abs(r.sectors[s][f].mid))));
  const scale = Math.max(1, ...knockOn);
  const last = result.quarters.length;

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
            {SECTORS.map((s) => (
              <tr key={s}>
                <th scope="row" className="ripple-sector">
                  <SectorDot sector={s} />
                  {s}
                </th>
                {FEATURES.map((f) => {
                  const b = q.sectors[s][f];
                  const isShock = shocked.has(`${s}|${f}`);
                  const loading = f === "ipoCount" && !ipoReady;
                  const isSelected = selected.sector === s && selected.feature === f;
                  return (
                    <td key={f}>
                      <button
                        type="button"
                        className={`ripple-cell ${isSelected ? "selected" : ""} ${loading ? "loading" : ""} ${b.mid ? "" : "zero"}`}
                        style={loading ? undefined : cellStyle(b, isShock ? Math.abs(b.mid) || 1 : scale)}
                        aria-pressed={isSelected}
                        aria-label={`${s} ${FEATURE_LABELS[f]}, Q${quarter}: ${loading ? "IPO history loading" : `${pct(b.mid)}, range ${pct(b.low)} to ${pct(b.high)}`}${isShock ? " (your shock)" : ""}`}
                        onClick={() => onSelect({ sector: s, feature: f })}
                      >
                        {loading ? (
                          <span className="ripple-loading">IPO history loading</span>
                        ) : (
                          <>
                            <span className="ripple-value mono">{pct(b.mid)}</span>
                            <span className="ripple-range mono">{b.low === b.high ? " " : `${pct(b.low)} to ${pct(b.high)}`}</span>
                          </>
                        )}
                        {isShock ? <span className="ripple-shock-tag">shock</span> : !loading && b.mid !== 0 && <AssumptionBadge show={q.assumed[s][f] > ASSUMED_ABOVE} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ripple-legend" aria-hidden="true">
        <span>Fall</span>
        <i />
        <span>Rise</span>
        <small>Colour strength is relative to the largest knock-on effect in this scenario. Effects fade {Math.round((1 - result.lambda) * 100)}% a quarter once their links have fired.</small>
      </div>
    </section>
  );
}
