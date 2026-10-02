"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PanelHead } from "@/components/ui/primitives";
import type { Contribution } from "@/lib/ripple/engine";
import { ASSUMPTION, type FeatureLink, type MacroLink, type SectorLink } from "@/lib/ripple/links";
import { FEATURE_LABELS, FEATURE_NOUNS, MACRO_LABELS } from "@/lib/ripple/settings";
import { AssumptionBadge } from "./AssumptionBadge";
import type { Selection } from "./RippleGrid";

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
/** Paths listed; the rest are summed in one line (effects of effects can add many small ones). */
const SHOWN = 5;
const LAG: Record<number, string> = { 0: "same quarter", 1: "1 quarter later", 2: "2 quarters later" };
const LAG_SHORT: Record<number, string> = { 0: "same qtr", 1: "+1 qtr", 2: "+2 qtrs" };

/** "Tech valuation" → "Tech valuation"; macro keys → their labels. */
const sourceLabel = (source: string) => {
  if (source in MACRO_LABELS) return MACRO_LABELS[source as keyof typeof MACRO_LABELS];
  const [sector, feature] = source.split(" ");
  return feature in FEATURE_NOUNS ? `${sector} ${FEATURE_NOUNS[feature as keyof typeof FEATURE_NOUNS]}` : source;
};

type AnyLink = FeatureLink | SectorLink | MacroLink;
const num = (v: number, d: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;

/** "Valuation → Deal count +1 qtr · Tech → Financials": the links of a path in one line. */
function chain(c: Contribution): string {
  return c.steps
    .flatMap((s) =>
      s.links.map((l) =>
        "sectors" in l
          ? `${MACRO_LABELS[l.from]} → ${FEATURE_LABELS[l.to]} ${LAG_SHORT[l.lag]}`
          : typeof l.lag === "string"
            ? `${l.from} → ${l.to}`
            : `${FEATURE_LABELS[l.from as keyof typeof FEATURE_LABELS]} → ${FEATURE_LABELS[l.to as keyof typeof FEATURE_LABELS]} ${LAG_SHORT[l.lag]}`,
      ),
    )
    .join(" · ");
}

/** "Estimated +0.42 (90% range +0.18 to +0.66) from 153 sector-quarters; 71% data, the rest the hand-set +1.00." */
function Evidence({ link }: { link: AnyLink }) {
  if (link.value == null || link.prior == null || !link.range) return null;
  const kind = "sectors" in link ? "macro" : typeof link.lag === "string" ? "sector" : "feature";
  const d = kind === "macro" ? 1 : 2;
  const u = kind === "macro" ? "%" : "";
  const flipped = link.prior !== 0 && Math.sign(link.value) !== Math.sign(link.prior);
  if (!link.n) return <p className="why-evidence">No data behind this link yet: it is the hand-set {num(link.prior, d)}{u}.</p>;
  const basis = kind === "sector" ? `${link.n} months of sector ETF returns and BEA input-output tables` : `${link.n} sector-quarters`;
  return (
    <p className="why-evidence">
      Estimated <span className="mono">{num(link.value, d)}{u}</span> (90% range <span className="mono">{num(link.range[0], d)}</span> to <span className="mono">{num(link.range[1], d)}{u}</span>) from {basis};{" "}
      {Math.round((link.weight ?? 0) * 100)}% data, the rest the hand-set {num(link.prior, d)}{u}.{flipped && <strong> The data points the other way from this reasoning.</strong>}
    </p>
  );
}

function LinkCard({ link }: { link: AnyLink }) {
  const isSector = typeof link.lag === "string";
  const from = "sectors" in link ? MACRO_LABELS[link.from] : isSector ? link.from : FEATURE_LABELS[link.from as keyof typeof FEATURE_LABELS];
  const to = "sectors" in link ? `${FEATURE_LABELS[link.to]}${link.sectors === "all" ? "" : ` (${link.sectors.join(", ")})`}` : isSector ? link.to : FEATURE_LABELS[link.to as keyof typeof FEATURE_LABELS];
  return (
    <li className="why-link">
      <div className="why-tags">
        <span className="why-route">
          {from} → {to}
        </span>
        <span className={`why-tag ${link.direction === "+" ? "up" : "down"}`}>{link.direction === "+" ? "↑ raises" : "↓ lowers"}</span>
        <span className="why-tag">{link.strength}</span>
        <span className="why-tag">{isSector ? "sector spillover" : LAG[link.lag as number]}</span>
        <AssumptionBadge show={link.status === ASSUMPTION} />
      </div>
      <p className="why-reason">{link.why}</p>
      <Evidence link={link} />
    </li>
  );
}

export function WhyPanel({ selection, quarter, contributions, ipoLoading, assumed, lambda }: { selection: Selection; quarter: number; contributions: Contribution[]; ipoLoading: boolean; assumed: boolean; lambda: number }) {
  const title = `${selection.sector} ${FEATURE_NOUNS[selection.feature]}`;
  const shown = contributions.slice(0, SHOWN);
  const largest = Math.max(0, ...shown.map((c) => Math.abs(c.value)));
  // Paths start folded to one line each; the biggest one starts open. Choices are remembered per path.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const keyOf = (c: Contribution) => `${title}|${c.kind}|${c.source}|${c.via.join(">")}|${c.lag}|${c.round}`;
  const firstPath = shown.find((c) => c.kind !== "shock");

  return (
    <section className="panel why-panel" id="whatif-why" aria-live="polite">
      <PanelHead title="Why it moves" subtitle={`${title} in Q${quarter} · the paths behind it, largest first`}>
        {assumed && (
          <span className="panel-legend" title="Most of this result runs through links that lean on hand-set reasoning">
            <span className="ripple-mark static" aria-hidden="true" /> assumption
          </span>
        )}
      </PanelHead>
      {ipoLoading && <p className="why-note">IPO history loading: the values appear once the IPO backfill fills the history. The links below are what will drive them.</p>}
      {shown.length ? (
        <ol className="why-list">
          {shown.map((c) => {
            const key = keyOf(c);
            const open = opened[key] ?? c === firstPath;
            return (
              // Keyed by selection and path: picking another cell replays the entrance, changing the quarter just moves the bars.
              <li key={key} className="why-item">
                <div className="why-head">
                  <span className="why-source">
                    {c.kind === "shock" ? "Your shock" : `From ${sourceLabel(c.source)}`}
                    {c.via.length > 0 && <small> via {c.via.map(sourceLabel).join(" → ")}</small>}
                  </span>
                  {!ipoLoading && <span className={`why-value mono ${c.value >= 0 ? "up" : "down"}`}>{pct(c.value)}</span>}
                </div>
                {!ipoLoading && (
                  <span className="why-bar" aria-hidden="true">
                    <i className={c.value >= 0 ? "up" : "down"} style={{ transform: `scaleX(${largest ? Math.abs(c.value) / largest : 0})` }} />
                  </span>
                )}
                {c.kind === "shock" ? (
                  <p className="why-reason">The variable you shocked. Its move is given, not estimated, and {lambda >= 0.995 ? "persists" : `fades ${Math.round((1 - lambda) * 100)}% a quarter`}.</p>
                ) : (
                  <>
                    <button type="button" className="why-toggle" aria-expanded={open} onClick={() => setOpened((o) => ({ ...o, [key]: !open }))}>
                      <span className="why-chain">{chain(c)}</span>
                      <span className="why-toggle-label">
                        {open ? "Hide" : "Why"}
                        <Icon name="chevron" />
                      </span>
                    </button>
                    {open && (
                      <ul className="why-links">
                        {c.steps.flatMap((s) => s.links).map((l, j) => (
                          <LinkCard key={j} link={l} />
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="why-empty">No link reaches {title} from this scenario{quarter === 1 ? " in Q1 (some links take a quarter or two)" : ""}.</p>
      )}
      {contributions.length > SHOWN && (
        <p className="why-more">
          + {contributions.length - SHOWN} smaller {contributions.length - SHOWN === 1 ? "path" : "paths"} adding up to {pct(contributions.slice(SHOWN).reduce((t, c) => t + c.value, 0))}
        </p>
      )}
    </section>
  );
}
