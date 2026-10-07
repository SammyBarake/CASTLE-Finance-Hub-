"use client";

import { useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { Icon } from "@/components/ui/Icon";
import { AboutData, Kpi, Kpis, PageHeading, PanelHead, Segment, Takeaways } from "@/components/ui/primitives";
import { accuracyInsights, FEATURE_NAMES, forecastSeries, tuningChanges } from "@/lib/ripple/accuracy";
import type { BacktestFile } from "@/lib/ripple/backtest";
import backtestFile from "@/lib/ripple/backtest.json";
import { FEATURES, type Feature } from "@/lib/ripple/links";

const B = backtestFile as unknown as BacktestFile;
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const SHORT: Record<Feature, string> = { valuation: "Valuations", dealCount: "Deal counts", dealValue: "Deal values", ipoCount: "IPOs" };
const AHEAD = ["Same quarter", "1 quarter on", "2 quarters on", "3 quarters on"];
const INSIGHTS = accuracyInsights(B);
const CHANGES = tuningChanges(B);
const TOP_SETUPS = B.candidates.slice(0, 6);

/** Cell shade for a direction rate: grey at a coin flip, greener the better. */
function shade(hit: number | null): React.CSSProperties {
  if (hit == null) return {};
  const t = Math.max(0, Math.min(1, (hit - 0.5) / 0.25));
  return { "--cell-bg": `rgba(111, 186, 152, ${(0.04 + 0.34 * t).toFixed(3)})`, "--cell-line": `rgba(111, 186, 152, ${(0.08 + 0.4 * t).toFixed(3)})` } as React.CSSProperties;
}

export function WhatIfAccuracyView() {
  const [feature, setFeature] = useState<Feature>("ipoCount");
  const [ahead, setAhead] = useState(2);
  // The same quarter's valuation is the engine's input, so it isn't scored.
  const k = feature === "valuation" && ahead === 1 ? 2 : ahead;
  const series = forecastSeries(B, feature, k);
  const s = B.summary;
  const gain = s.previous.score > 0 ? Math.round(((s.chosen.score - s.previous.score) / s.previous.score) * 100) : 0;

  return (
    <>
      <PageHeading title="Accuracy" subtitle="How the what-if engine's predictions held up against what actually happened, quarter by quarter, out of sample" />

      <Kpis label="Backtest summary">
        <Kpi label="Direction right" value={pct(s.chosen.all.hitRate)} note={`Valuations ${pct(s.chosen.valuation.hitRate)} · deals and IPOs ${pct(s.chosen.flows.hitRate)}`} />
        <Kpi label="Error vs no change" value={`−${Math.round(s.chosen.score * 100)}%`} note="Average over the four features" />
        <Kpi label="Quarters tested" value={String(B.origins.count)} note={`${B.origins.from}–${B.origins.to}, links re-estimated each time`} />
        <Kpi label="Gain from tuning" value={`+${gain}%`} note={`Skill ${s.previous.score.toFixed(3)} → ${s.chosen.score.toFixed(3)}`} />
      </Kpis>

      <Takeaways items={INSIGHTS} label="What the backtest shows" />

      <section className="panel">
        <PanelHead title="Predicted vs what happened" subtitle={`${FEATURE_NAMES[feature]}, ${AHEAD[k - 1].toLowerCase()} · average over the five sectors · % versus trend`}>
          <div className="acc-controls">
            <Segment label="Feature" value={feature} onChange={setFeature} options={FEATURES.map((f) => ({ value: f, label: SHORT[f] }))} />
            <Segment label="Quarters ahead" value={k} onChange={setAhead} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `Q${n}` }))} />
          </div>
        </PanelHead>
        <div className="acc-chart-legend" aria-hidden="true">
          <span>
            <i style={{ background: "#e6e6e6" }} /> What happened
          </span>
          <span>
            <i style={{ background: "#6fba98" }} /> Engine predicted
          </span>
        </div>
        <LineChart
          key={`${feature}|${k}`}
          className="quarter-chart"
          labels={series.labels}
          points
          series={[
            { label: "What happened", color: "#e6e6e6", data: series.realized, hidden: false },
            { label: "Engine predicted", color: "#6fba98", data: series.predicted, hidden: false },
          ]}
          format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
          formatTick={(v) => `${v}%`}
          ariaLabel={`${FEATURE_NAMES[feature]}: predicted versus realised change, ${AHEAD[k - 1].toLowerCase()}, ${series.labels[0] ?? ""} to ${series.labels.at(-1) ?? ""}`}
        />
      </section>

      <div className="acc-two">
        <section className="panel">
          <PanelHead title="Direction right, by quarter ahead" subtitle="Share of predicted moves with the right sign · bar: skill against no change" />
          <table className="acc-grid">
            <caption className="sr-only">Direction rate and skill by feature and quarter ahead</caption>
            <thead>
              <tr>
                <th scope="col" className="acc-corner">
                  <span className="sr-only">Feature</span>
                </th>
                {[1, 2, 3, 4].map((q) => (
                  <th key={q} scope="col">
                    Q{q}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f, row) => (
                <tr key={f}>
                  <th scope="row">{SHORT[f]}</th>
                  {B.features[f].map((c, col) => {
                    const empty = !c.n || c.hitRate == null;
                    return (
                      <td key={c.k}>
                        <div
                          className={`acc-cell ${empty ? "empty" : ""}`}
                          style={{ ...shade(c.hitRate), "--i": row * 4 + col } as React.CSSProperties}
                          title={empty ? "Not scored: the same quarter's valuation is the input" : `${c.n} forecasts · skill ${c.skill?.toFixed(2) ?? "—"} · slope ${c.slope ?? "—"}`}
                        >
                          <b>{empty ? "—" : pct(c.hitRate)}</b>
                          {empty ? (
                            <small>input</small>
                          ) : (
                            <span className="acc-meter" aria-hidden="true">
                              <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, (c.skill ?? 0) / 0.4))})` }} />
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="acc-legend">50% is a coin flip. Skill bars: 0 = no better than predicting no change, full width = 0.4 (a 40% smaller squared error).</p>
        </section>

        <section className="panel">
          <PanelHead title="What tuning changed" subtitle={`${B.candidates.length} setups compared on the same ${B.origins.count} quarters`} />
          <div className="acc-change">
            <div className="acc-change-row head">
              <span>Setting</span>
              <span>Before</span>
              <span />
              <span>Now</span>
            </div>
            {CHANGES.map((c, i) => (
              <div key={c.setting} className="acc-change-row" style={{ "--i": i } as React.CSSProperties}>
                <span>{c.setting}</span>
                <span>{c.before}</span>
                <Icon name="right" />
                <span>{c.after}</span>
              </div>
            ))}
          </div>
          <ol className="acc-setups" aria-label="Best setups by average skill">
            {TOP_SETUPS.map((c, i) => (
              <li key={c.label} className={`acc-setup ${i === 0 ? "chosen" : ""}`} style={{ "--i": i } as React.CSSProperties}>
                <span>{c.label}</span>
                <b>{c.score.toFixed(3)}</b>
                <span className="acc-meter" aria-hidden="true">
                  <i style={{ transform: `scaleX(${Math.max(0, c.score / (TOP_SETUPS[0].score || 1))})` }} />
                </span>
              </li>
            ))}
          </ol>
          <div className="acc-halves">
            {B.halves.map((h) => (
              <span key={h.from}>
                {h.from}–{h.to}: <b>{h.chosen.toFixed(3)}</b> vs <b>{h.previous.toFixed(3)}</b> before
              </span>
            ))}
          </div>
        </section>
      </div>

      <AboutData title="How the backtest works">
        <p>
          <strong>Out of sample.</strong> At each of {B.origins.count} quarters from {B.origins.from} to {B.origins.to}, the links are re-estimated using only the
          data available before that quarter. The engine then gets that quarter&apos;s real inputs, the changes in Fed funds, the 10-year yield, the Baa spread
          and the VIX plus each sector&apos;s ETF move (less the part it already puts down to those macro changes), and predicts the next four quarters.
          {B.chosen.history ? (
            <>
              {" "}It also gets the same inputs for the {B.chosen.history === 1 ? "quarter" : `${B.chosen.history} quarters`} before: their effects are still
              travelling through the lagged links at the forecast date, so the part still to come counts. That lifted direction from{" "}
              {pct(B.summary.thisQuarterOnly?.all.hitRate ?? null)} to {pct(s.chosen.all.hitRate)}. Deal and IPO numbers are never inputs.
            </>
          ) : null}
        </p>
        <p>
          <strong>Scoring.</strong> Deal and IPO counts are compared with the average of the four quarters before (plus trend), because a single quarter is
          noisy, and the calendar pattern is taken out (deals dip in Q1, IPOs bunch in Q2), measured only from earlier quarters. Valuations are compared with
          the quarter before. Direction is the share of predicted moves of at least 0.5 points that had the right sign. Skill is 1 minus
          the squared error divided by that of predicting no change from trend: above 0 beats it.
        </p>
        <p>
          <strong>Tuning.</strong> {B.candidates.length} setups were compared: hand-set or estimated links (with the priors at a quarter to double width),
          one to three rounds of effects, and a fade per feature. The best, {B.chosen.label}, now runs the Scenarios tab. Choosing settings on the same
          quarters they are scored on flatters them a little, so the two halves of the period are shown separately.
        </p>
        <p>
          <strong>Tried and rejected.</strong> Magnitude calibration (it fitted the 2020 quarters and failed cross-validation), quarter-of-year controls,
          megadeal-capped deal values, stronger clipping, six extra sector spillovers the data suggested, end-of-quarter macro changes, leaving out the
          pandemic quarters, feeding past deal and IPO surprises, more than two quarters of history, sector-specific deal links, weighting recent years,
          capping big market moves and averaging several link sets. None beat the settings above out of sample; the log is in{" "}
          <code>research/experiments.md</code>.
        </p>
        <p>
          <strong>Limits.</strong> Deal figures in weak coverage years (2019–2020 and a few earlier sector-years) can&apos;t be scored, so deal results lean on 2021
          onward. Quarterly deal values hinge on single megadeals and stay close to a coin flip. Re-run with <code>npm run backtest</code>; the full report is
          in <code>research/backtest.md</code>.
        </p>
      </AboutData>
    </>
  );
}
