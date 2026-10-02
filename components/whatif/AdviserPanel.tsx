"use client";

import { CompanyMark, PanelHead, SectorLabel } from "@/components/ui/primitives";
import { bankShortName } from "@/lib/banks";
import type { AdviserOutlook } from "@/lib/ripple/advisers";
import type { Sector } from "@/lib/types";

const usd = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : `$${Math.round(a / 1e6)}M`;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}`;
};

function Row({ o, rank, largest, onOpen, assumed }: { o: AdviserOutlook; rank: number; largest: number; onOpen: (s: Sector) => void; assumed: boolean }) {
  const up = o.changeUsd.mid >= 0;
  return (
    <button
      type="button"
      className="preview-row adviser-outlook-row"
      style={{ "--i": rank } as React.CSSProperties}
      onClick={() => o.driver && onOpen(o.driver)}
      aria-label={`${o.bank}: ${usd(o.changeUsd.mid)} predicted deal value${o.driver ? `, mostly ${o.driver}` : ""}${assumed ? " (leans on hand-set assumptions)" : ""}. Show why.`}
    >
      <span className="preview-company">
        <span className="preview-rank">{String(rank).padStart(2, "0")}</span>
        <CompanyMark name={o.bank} letters={bankShortName(o.bank)} />
        <span>
          <strong>
            {o.bank}
            {assumed && <span className="ripple-mark inline" title="Leans mostly on hand-set links (assumption)" aria-hidden="true" />}
          </strong>
          <small>{o.driver ? <SectorLabel sector={o.driver} /> : "No sector exposure"}</small>
        </span>
      </span>
      <span className="adviser-change">
        <span className={`adviser-figure mono ${up ? "up" : "down"}`}>{usd(o.changeUsd.mid)}</span>
        <small>
          {usd(o.changeUsd.low)} to {usd(o.changeUsd.high)} · {o.changePct.mid > 0 ? "+" : o.changePct.mid < 0 ? "−" : ""}
          {Math.abs(o.changePct.mid)}%
        </small>
        <span className="adviser-bar" aria-hidden="true">
          <i className={up ? "up" : "down"} style={{ transform: `scaleX(${largest ? Math.abs(o.changeUsd.mid) / largest : 0})` }} />
        </span>
      </span>
    </button>
  );
}

export function AdviserPanel({ outlook, window, quarters, onOpen, assumed }: { outlook: AdviserOutlook[]; window: string; quarters: number; onOpen: (s: Sector) => void; assumed: (o: AdviserOutlook) => boolean }) {
  const rise = outlook.filter((o) => o.changeUsd.mid > 0).slice(0, 5);
  const fall = outlook.filter((o) => o.changeUsd.mid < 0).reverse().slice(0, 5);
  // One scale for both columns, so a bar's length compares across them.
  const largest = Math.max(0, ...[...rise, ...fall].map((o) => Math.abs(o.changeUsd.mid)));
  const anyAssumed = [...rise, ...fall].some(assumed);
  return (
    <section className="panel">
      <PanelHead title="Advisers" subtitle={`Each bank's share of sector deal value (${window}) × the predicted change in deal value over ${quarters} quarters · click for why`}>
        {anyAssumed && (
          <span className="panel-legend">
            <span className="ripple-mark static" aria-hidden="true" /> assumption
          </span>
        )}
      </PanelHead>
      <div className="adviser-split">
        <div>
          <h3 className="adviser-split-head">Positioned to rise</h3>
          {rise.length ? rise.map((o, i) => <Row key={o.bank} o={o} rank={i + 1} largest={largest} onOpen={onOpen} assumed={assumed(o)} />) : <div className="empty-small">No bank gains deal value in this scenario.</div>}
        </div>
        <div>
          <h3 className="adviser-split-head">Positioned to fall</h3>
          {fall.length ? fall.map((o, i) => <Row key={o.bank} o={o} rank={i + 1} largest={largest} onOpen={onOpen} assumed={assumed(o)} />) : <div className="empty-small">No bank loses deal value in this scenario.</div>}
        </div>
      </div>
    </section>
  );
}
