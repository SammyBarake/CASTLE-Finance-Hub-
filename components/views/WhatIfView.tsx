"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useHubData } from "@/components/data/HubDataProvider";
import { Icon } from "@/components/ui/Icon";
import { AboutData, PageHeading, PanelHead, Takeaways } from "@/components/ui/primitives";
import { AdviserPanel } from "@/components/whatif/AdviserPanel";
import { RangeChart } from "@/components/whatif/RangeChart";
import { RippleGrid, type Selection } from "@/components/whatif/RippleGrid";
import { ScenarioPanel } from "@/components/whatif/ScenarioPanel";
import { WhyPanel } from "@/components/whatif/WhyPanel";
import { formatDate } from "@/lib/format";
import { adviserOutlook, adviserShares } from "@/lib/ripple/advisers";
import type { SectorBaseline } from "@/lib/ripple/baseline";
import { explain, runRipple } from "@/lib/ripple/engine";
import { rippleInsights } from "@/lib/ripple/insights";
import { MACRO_UNITS, STRENGTH_SCALE } from "@/lib/ripple/links";
import { ESTIMATES } from "@/lib/ripple/estimated";
import { ASSUMED_ABOVE, fadeSummary, FEATURE_NOUNS, linkCounts, PRESETS, RIPPLE_SETTINGS as S, targetLabel, toRippleShock, TUNED, type ShockInput } from "@/lib/ripple/settings";
import { SECTORS, type Sector } from "@/lib/types";

const COUNTS = linkCounts(S.links);

interface WhatIfData {
  baselines: Record<Sector, SectorBaseline> | null;
  ipoHistoryReady: boolean;
  throughMonth: string | null;
}

// Fetched once per visit: the history changes monthly.
let cached: WhatIfData | null = null;
function useWhatIfData(): WhatIfData | null {
  const [data, setData] = useState<WhatIfData | null>(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    fetch("/api/what-if")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WhatIfData | null) => {
        cached = d ?? { baselines: null, ipoHistoryReady: false, throughMonth: null };
        if (alive) setData(cached);
      })
      .catch(() => alive && setData({ baselines: null, ipoHistoryReady: false, throughMonth: null }));
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

const STEP_MS = 1100;

/** "≈ +1.1 deals a quarter (baseline 21.5)", from sector_monthly's last four quarters. */
function levelNote(sel: Selection, mid: number, b: SectorBaseline | undefined, ipoReady: boolean): string | null {
  if (!b) return null;
  const signed = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
  if (sel.feature === "valuation") return b.etfClose ? `≈ ${signed((b.etfClose * mid) / 100, 2)} on the sector ETF (last close $${b.etfClose.toFixed(2)})` : null;
  if (sel.feature === "dealCount") return b.dealCount ? `≈ ${signed((b.dealCount * mid) / 100)} deals a quarter (baseline ${b.dealCount.toFixed(1)})` : null;
  if (sel.feature === "dealValue") return b.dealValueUsd ? `≈ ${signed((b.dealValueUsd * mid) / 100 / 1e9, 2)}B a quarter (baseline $${(b.dealValueUsd / 1e9).toFixed(1)}B, today's dollars)` : null;
  return ipoReady && b.ipoCount ? `≈ ${signed((b.ipoCount * mid) / 100)} IPOs a quarter (baseline ${b.ipoCount.toFixed(1)})` : null;
}

export function WhatIfView() {
  const { data } = useHubData();
  const history = useWhatIfData();
  const ipoReady = history?.ipoHistoryReady ?? false;
  const [shocks, setShocks] = useState<ShockInput[]>(PRESETS.find((p) => p.id === "tech")!.shocks);
  const [editing, setEditing] = useState(0);
  const [quarter, setQuarter] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<Selection>({ sector: "Tech", feature: "dealValue" });
  // Bumped when the scenario changes shape (a preset, a new variable): replays the ripple wave across the grid.
  // Dragging a slider only resizes the shock, so the numbers glide without the wave.
  const [wave, setWave] = useState(0);
  const changeShocks = (next: ShockInput[], kind: "preset" | "edit") => {
    const shape = (xs: ShockInput[]) => xs.map((s) => targetLabel(s.target)).join("|");
    if (kind === "preset" || shape(next) !== shape(shocks)) setWave((w) => w + 1);
    setShocks(next);
    setPlaying(false);
  };

  const shock = useMemo(() => toRippleShock(shocks), [shocks]);
  const result = useMemo(() => runRipple(shock, S), [shock]);
  const shocked = useMemo(() => new Set(shocks.filter((s) => s.target.kind === "feature" && s.size).map((s) => (s.target.kind === "feature" ? `${s.target.sector}|${s.target.feature}` : ""))), [shocks]);
  const insights = useMemo(() => rippleInsights(result, shock, ipoReady), [result, shock, ipoReady]);
  const span = useMemo(() => {
    const to = data.asOf.slice(0, 10);
    const from = new Date(Date.parse(to) - S.adviserWindowYears * 365.25 * 86_400_000).toISOString().slice(0, 10);
    return { from, to };
  }, [data.asOf]);
  const shares = useMemo(() => adviserShares(data.deals, span.from, span.to), [data.deals, span]);
  const outlook = useMemo(() => adviserOutlook(result, shares), [result, shares]);
  const why = useMemo(() => explain(shock, selected.sector, selected.feature, quarter, S), [shock, selected, quarter]);
  // An adviser's figure leans on assumptions when its driving sector's deal value does (weighted over the quarters).
  const dealValueAssumed = useMemo(() => {
    const out = {} as Record<Sector, boolean>;
    for (const s of SECTORS) {
      const size = result.quarters.reduce((t, q) => t + Math.abs(q.sectors[s].dealValue.mid), 0);
      const assumed = result.quarters.reduce((t, q) => t + Math.abs(q.sectors[s].dealValue.mid) * q.assumed[s].dealValue, 0);
      out[s] = size > 0 && assumed / size > ASSUMED_ABOVE;
    }
    return out;
  }, [result]);

  // Play: hold each quarter for a beat, step to the next, and stop after the last one.
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => (quarter >= S.quarters ? setPlaying(false) : setQuarter(quarter + 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, quarter]);
  const play = () => {
    if (playing) return setPlaying(false);
    if (quarter >= S.quarters) setQuarter(1);
    setPlaying(true);
  };

  const openSector = (sector: Sector) => {
    setSelected({ sector, feature: "dealValue" });
    // On a phone the explanation sits below the fold.
    if (globalThis.matchMedia?.("(max-width: 1020px)").matches) document.getElementById("whatif-why")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const points = result.quarters.map((q) => q.sectors[selected.sector][selected.feature]);
  const selectedAssumed = result.quarters[quarter - 1].assumed[selected.sector][selected.feature] > ASSUMED_ABOVE;
  const ipoLoading = selected.feature === "ipoCount" && !ipoReady;
  const cellTitle = `${selected.sector} ${FEATURE_NOUNS[selected.feature]}`;
  const note = levelNote(selected, points[quarter - 1].mid, history?.baselines?.[selected.sector], ipoReady);
  const windowLabel = `${formatDate(span.from)} – ${formatDate(span.to)}`;

  return (
    <>
      <PageHeading title="What-if" subtitle="Shock a sector or the economy and watch it ripple through valuations, deals, IPOs and advisers over four quarters" />

      <div className="whatif-meta">
        {TUNED.linkSet === S.linkSet && TUNED.hitRate != null && (
          <Link href="/what-if/accuracy" className="whatif-meta-link">
            <span className="whatif-meta-dot" aria-hidden="true" />
            Backtested on {TUNED.quarters} quarters: right direction {Math.round(TUNED.hitRate * 100)}% of the time
            <Icon name="right" />
          </Link>
        )}
        <span>
          {S.linkSet === "hand-set"
            ? "Links hand-set from economic reasoning"
            : `${COUNTS.estimated} of ${COUNTS.total} links estimated from ${ESTIMATES.meta.window.from}–${ESTIMATES.meta.window.to} history`}
        </span>
        <span>Shows direction and strength of likely effects, not price predictions.</span>
      </div>

      <ScenarioPanel shocks={shocks} onChange={changeShocks} editing={editing} onEdit={setEditing} />

      <Takeaways items={insights} label="What this scenario does" />

      <div className="whatif-layout">
        <RippleGrid
          result={result}
          quarter={quarter}
          onQuarter={(q) => (setPlaying(false), setQuarter(q))}
          playing={playing}
          onPlay={play}
          stepMs={STEP_MS}
          selected={selected}
          onSelect={setSelected}
          shocked={shocked}
          macroShock={shocks.some((s) => s.target.kind === "macro" && s.size !== 0)}
          wave={wave}
          ipoReady={ipoReady}
        />
        <div className="whatif-side">
          <section className="panel">
            <PanelHead title={cellTitle} subtitle={`% change versus no shock, Q1–Q${S.quarters} · shaded: ${S.linkSet === "estimated" ? "90% range" : "range"}`}>
              {selectedAssumed && (
                <span className="panel-legend" title="Most of this result runs through links that lean on hand-set reasoning">
                  <span className="ripple-mark static" aria-hidden="true" /> assumption
                </span>
              )}
            </PanelHead>
            {ipoLoading ? (
              <div className="empty-small">IPO history loading. IPO results appear once the IPO backfill fills the history.</div>
            ) : (
              <div className="range-chart-wrap">
                <RangeChart points={points} quarter={quarter} label={cellTitle} />
                {note && (
                  <p key={`${cellTitle}|${quarter}`} className="range-chart-note">
                    Q{quarter}: {note}
                  </p>
                )}
              </div>
            )}
          </section>
          <WhyPanel selection={selected} quarter={quarter} contributions={why} ipoLoading={ipoLoading} assumed={selectedAssumed} lambda={S.lambda[selected.feature]} />
        </div>
      </div>

      <AdviserPanel outlook={outlook} window={windowLabel} quarters={S.quarters} onOpen={openSector} assumed={(o) => (o.driver ? dealValueAssumed[o.driver] : false)} />

      <AboutData title="How the what-if engine works">
        <p>
          <strong>What it shows.</strong> Twenty variables: valuation (the sector ETF), deal count, deal value and IPO count in each of the five sectors, as the
          % change versus a world without the shock. You can also shock four macro inputs (Fed funds, the 10-year yield, the Baa credit spread and the VIX); they
          drive the sectors but get no feedback. Every number shows a direction and a rough strength, not a forecast of prices or volumes.
        </p>
        <p>
          <strong>How effects travel.</strong> Feature links say how one feature moves another (valuations lift IPOs a quarter later, for example), each with a lag of
          0, 1 or 2 quarters. Sector links say how much of a move reaches another sector (half of an Energy move reaches Industrials). Together they form the link
          matrix A = C ⊗ L; macro links say how each macro input hits each feature in each sector. A shock lands in Q1; each link fires after its lag, and from then on{" "}
          {fadeSummary(S.lambda)} (the fades that predicted best in the backtest). {S.rounds > 1 ? `Effects of effects are included (${S.rounds} rounds).` : "Only direct effects are counted (one round): with hand-set links, effects of effects would stack one guess on another."}
        </p>
        {S.linkSet === "estimated" ? (
          <p>
            <strong>Where the numbers come from.</strong> Each link is estimated from {ESTIMATES.meta.window.quarters} quarters of history ({ESTIMATES.meta.window.from}–
            {ESTIMATES.meta.window.to}) and pulled toward its hand-set value, harder where the data is noisy. Feature and macro links come from panel regressions of
            each sector&apos;s quarterly changes on the others, with sector fixed effects and lags of 0–2 quarters. Sector links blend BEA input-output tables (how
            much of one sector&apos;s output another sector&apos;s demand drives) with how sector ETFs move together beyond the market. Ranges are 90% intervals
            from {ESTIMATES.meta.bootstrapRuns.toLocaleString("en-US")} bootstrap runs. A link counts as estimated when the data outweighs its hand-set value;
            the rest, and every result leaning mostly on them, keep the &quot;assumption&quot; badge.
            {!ESTIMATES.meta.ipoHistory && " IPO links stay hand-set until the IPO history is in."} Units: feature links are % per 1% move, sector links the share
            of a move that reaches the other sector, macro links % per {MACRO_UNITS.fedFunds.label} (per {MACRO_UNITS.vix.label} for the VIX).
          </p>
        ) : (
          <p>
            <strong>Strengths.</strong> Feature links: strong {STRENGTH_SCALE.feature.strong}, moderate {STRENGTH_SCALE.feature.moderate}, weak {STRENGTH_SCALE.feature.weak}{" "}
            (% change per 1% move). Sector links: strong {STRENGTH_SCALE.sector.strong}, moderate {STRENGTH_SCALE.sector.moderate}, weak {STRENGTH_SCALE.sector.weak} (share of a
            move that reaches the other sector). Macro links: strong {STRENGTH_SCALE.macro.strong}%, moderate {STRENGTH_SCALE.macro.moderate}%, weak {STRENGTH_SCALE.macro.weak}%
            per {MACRO_UNITS.fedFunds.label} (per {MACRO_UNITS.vix.label} for the VIX). The range on every result takes each link at ±{S.band * 100}%.
          </p>
        )}
        <p>
          <strong>Advisers.</strong> Each bank&apos;s share of every sector&apos;s deal value over the last {S.adviserWindowYears} years (league-table credit: every adviser on a
          deal counts its full value), times the sector&apos;s average quarterly deal value and its predicted % change, added up over {S.quarters} quarters. Levels
          (&quot;≈ +1.1 deals a quarter&quot;) use the last four complete quarters of the monthly history{history?.throughMonth ? ` (through ${history.throughMonth})` : ""}.
        </p>
        <p>
          <strong>Engine.</strong> {S.version}. Hand-set links and their reasons live in <code>lib/ripple/links.ts</code>, the estimates in{" "}
          <code>lib/ripple/estimated.json</code> (compared link by link in <code>research/link-estimates.md</code>); the link set, fade, range, rounds and
          horizon in <code>lib/ripple/settings.ts</code>.
        </p>
      </AboutData>
    </>
  );
}
