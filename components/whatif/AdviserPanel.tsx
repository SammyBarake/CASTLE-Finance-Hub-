"use client";

import { CompanyMark, PanelHead, SectorLabel } from "@/components/ui/primitives";
import { bankShortName } from "@/lib/banks";
import type { AdviserOutlook } from "@/lib/ripple/advisers";
import type { Sector } from "@/lib/types";
import { AssumptionBadge } from "./AssumptionBadge";

const usd = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : `$${Math.round(a / 1e6)}M`;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}`;
};

function Row({ o, rank, onOpen, handSet }: { o: AdviserOutlook; rank: number; onOpen: (s: Sector) => void; handSet: boolean }) {
  return (
    <button type="button" className="preview-row adviser-outlook-row" onClick={() => o.driver && onOpen(o.driver)} aria-label={`${o.bank}: ${usd(o.changeUsd.mid)} predicted deal value${o.driver ? `, mostly ${o.driver}` : ""}. Show why.`}>
      <span className="preview-company">
        <span className="preview-rank">{String(rank).padStart(2, "0")}</span>
        <CompanyMark name={o.bank} letters={bankShortName(o.bank)} />
        <span>
          <strong>{o.bank}</strong>
          <small>{o.driver ? <SectorLabel sector={o.driver} /> : "No sector exposure"}</small>
        </span>
      </span>
      <span className="preview-value">
        <span className={o.changeUsd.mid >= 0 ? "up" : "down"}>{usd(o.changeUsd.mid)}</span>
        <small>
          {usd(o.changeUsd.low)} to {usd(o.changeUsd.high)} · {o.changePct.mid > 0 ? "+" : o.changePct.mid < 0 ? "−" : ""}
          {Math.abs(o.changePct.mid)}%
        </small>
        <AssumptionBadge show={handSet} />
      </span>
    </button>
  );
}

export function AdviserPanel({ outlook, window, quarters, onOpen, handSet }: { outlook: AdviserOutlook[]; window: string; quarters: number; onOpen: (s: Sector) => void; handSet: boolean }) {
  const rise = outlook.filter((o) => o.changeUsd.mid > 0).slice(0, 5);
  const fall = outlook.filter((o) => o.changeUsd.mid < 0).reverse().slice(0, 5);
  return (
    <section className="panel">
      <PanelHead title="Advisers" subtitle={`Each bank's share of sector deal value (${window}) × the predicted change in deal value over ${quarters} quarters · click for why`}>
        <AssumptionBadge show={handSet} />
      </PanelHead>
      <div className="adviser-split">
        <div>
          <h3 className="adviser-split-head">Positioned to rise</h3>
          {rise.length ? rise.map((o, i) => <Row key={o.bank} o={o} rank={i + 1} onOpen={onOpen} handSet={handSet} />) : <div className="empty-small">No bank gains deal value in this scenario.</div>}
        </div>
        <div>
          <h3 className="adviser-split-head">Positioned to fall</h3>
          {fall.length ? fall.map((o, i) => <Row key={o.bank} o={o} rank={i + 1} onOpen={onOpen} handSet={handSet} />) : <div className="empty-small">No bank loses deal value in this scenario.</div>}
        </div>
      </div>
    </section>
  );
}
