"use client";

import type { CSSProperties } from "react";
import { useFullDeal } from "@/components/data/useFullDeal";
import { DetailGrid, DetailItem, Note } from "@/components/ui/UiProvider";
import { formatPrice, formatUsd } from "@/lib/format";
import type { Deal, FairnessOpinion, ValuationRange } from "@/lib/types";

/** Display order, the way banks lay out a football field. */
const ORDER = [
  "Discounted cash flow",
  "Trading comparables",
  "Precedent transactions",
  "Premiums paid",
  "Leveraged buyout",
  "Future share price",
  "Sum of the parts",
  "Liquidation",
  "Analyst price targets",
  "52-week trading range",
  "Other analysis",
];

const pctRange = (r: [number, number] | null, unit: "%" | "x") => (r ? (r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}${unit} – ${r[1]}${unit}`) : null);

type Row = ValuationRange & { bank: string | null };

/** Football field: each analysis's implied value per share against the offer price. */
function FootballField({ rows, offer }: { rows: Row[]; offer: number | null }) {
  const values = rows.flatMap((r) => [r.low, r.high]).concat(offer != null ? [offer] : []);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Room on both sides for the price labels printed outside each bar.
  const pad = (hi - lo) * 0.22 || hi * 0.2;
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const x = (v: number) => ((v - min) / (max - min)) * 100;
  const offerStyle = offer != null ? ({ "--offer": `${x(offer)}%` } as CSSProperties) : undefined;

  return (
    <div className="football" style={offerStyle} role="img" aria-label={`Implied value per share by analysis${offer != null ? `, offer ${formatPrice(offer)}` : ""}`}>
      {rows.map((r, i) => {
        const inRange = offer != null && offer >= r.low && offer <= r.high;
        return (
          <div className="ff-row" key={`${r.method}-${r.bank}-${i}`}>
            <div className="ff-label">
              {r.method}
              {r.bank && <small>{r.bank}</small>}
            </div>
            <div className="ff-track">
              <span className={`ff-bar ${inRange ? "contains" : offer != null && r.high < offer ? "below" : ""}`} style={{ left: `${x(r.low)}%`, width: `${Math.max(x(r.high) - x(r.low), 0.8)}%` }}>
                <span className="ff-lo">{formatPrice(r.low)}</span>
                <span className="ff-hi">{formatPrice(r.high)}</span>
              </span>
              {offer != null && <span className="ff-offer" aria-hidden="true" />}
            </div>
          </div>
        );
      })}
      {offer != null && (
        <div className="ff-row ff-axis">
          <div />
          <div className="ff-track">
            <span className="ff-offer-label">Offer {formatPrice(offer)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function OpinionFacts({ o }: { o: FairnessOpinion }) {
  return (
    <div className="ff-bank">
      <div className="related-title">
        {o.bank ?? "Financial advisor"} · advised the {o.side === "target" ? "target's board" : "buyer"}
      </div>
      <DetailGrid>
        <DetailItem label="Advisory fee">{o.feeUsd != null ? formatUsd(o.feeUsd) : "Not stated"}</DetailItem>
        <DetailItem label="DCF discount rate">{pctRange(o.discountRatePct, "%") ?? "—"}</DetailItem>
        {o.perpetuityGrowthPct && <DetailItem label="Perpetuity growth">{pctRange(o.perpetuityGrowthPct, "%")}</DetailItem>}
        {o.terminalMultiple && <DetailItem label="Terminal multiple">{pctRange(o.terminalMultiple, "x")}</DetailItem>}
      </DetailGrid>
    </div>
  );
}

/** The page feed leaves fairness opinions out; the full record is fetched when the tab opens. */
function useFairness(deal: Deal): { opinions: FairnessOpinion[] | null; failed: boolean } {
  const { full, failed } = useFullDeal(deal);
  return { opinions: full ? (full.fairness ?? []) : null, failed };
}

export function ValuationTab({ deal }: { deal: Deal }) {
  const { opinions: loaded, failed } = useFairness(deal);
  if (!loaded) return <p className="dim ff-intro">{failed ? "Couldn't load the valuation detail. Try again in a moment." : "Loading valuation detail…"}</p>;
  return <ValuationBody deal={deal} opinions={loaded} />;
}

function ValuationBody({ deal, opinions }: { deal: Deal; opinions: FairnessOpinion[] }) {
  const targetSide = opinions.filter((o) => o.side === "target");
  const rows: Row[] = targetSide
    .flatMap((o) => o.ranges.map((r) => ({ ...r, bank: targetSide.length > 1 ? o.bank : null })))
    .sort((a, b) => ORDER.indexOf(a.method) - ORDER.indexOf(b.method));
  const buyerSide = opinions.filter((o) => o.side === "acquirer");

  return (
    <>
      <p className="ff-intro">
        Implied value per {deal.target.name} share from the {targetSide.length > 1 ? "banks'" : "bank's"} fairness {targetSide.length > 1 ? "opinions" : "opinion"}, as summarised in the
        merger proxy.
      </p>
      {rows.length ? <FootballField rows={rows} offer={deal.pricePerShare} /> : <p className="dim">No target-side valuation ranges were found in the proxy.</p>}
      {opinions.map((o) => (
        <OpinionFacts key={`${o.bank}-${o.side}`} o={o} />
      ))}
      {!!buyerSide.length && <Note>The buyer&apos;s advisor valued the buyer&apos;s own shares, so its ranges aren&apos;t plotted against the offer.</Note>}
      <Note>Read automatically from the proxy&apos;s fairness-opinion summary. Bankers run several versions of some analyses (different projections or multiples); each appears as its own bar. Check the filing before relying on any figure.</Note>
    </>
  );
}
