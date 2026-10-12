"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { PanelHead } from "@/components/ui/primitives";
import { RowLink, ShowMore, TABLE_PAGE } from "@/components/ui/table";
import { formatPct, formatPrice, formatSignedPct } from "@/lib/format";
import { dcfRows, summarizeDcf } from "@/lib/precedents";
import type { Deal } from "@/lib/types";

/** Each DCF range is drawn against its own offer (1.0x), on one scale: 0.4x–1.8x of the offer. */
const LO = 0.4;
const HI = 1.8;
const x = (ratio: number) => ((Math.min(HI, Math.max(LO, ratio)) - LO) / (HI - LO)) * 100;
const span = (r: [number, number] | null) => (r ? (r[0] === r[1] ? formatPct(r[0]) : `${formatPct(r[0])} – ${formatPct(r[1])}`) : "—");

/**
 * What the target banks' discounted cash flow analyses said about the ticked precedents: where each offer sat against
 * the bank's DCF value per share, and the discount rate and terminal growth behind it.
 */
export function PrecedentsDcf({ deals, onOpen }: { deals: Deal[]; onOpen: (d: Deal) => void }) {
  const rows = useMemo(() => dcfRows(deals), [deals]);
  const stats = useMemo(() => summarizeDcf(rows), [rows]);
  const [shown, setShown] = useState(TABLE_PAGE);
  if (!rows.length) return null;
  const vs = stats.vsMid.median;

  return (
    <section className="panel">
      <PanelHead title="What the banks' DCFs said" subtitle="Target-side fairness opinions for the ticked precedents · each range against its offer" />
      <div className="dcf-stats">
        <div>
          <span>Offer vs. DCF midpoint</span>
          <strong>{vs == null ? "—" : formatSignedPct(vs)}</strong>
          <small>Median of {stats.vsMid.n}</small>
        </div>
        <div>
          <span>Discount rate</span>
          <strong>{formatPct(stats.discount.median)}</strong>
          <small>Midpoint, median of {stats.discount.n}</small>
        </div>
        <div>
          <span>Terminal growth</span>
          <strong>{formatPct(stats.growth.median)}</strong>
          <small>Midpoint, median of {stats.growth.n}</small>
        </div>
      </div>
      <div className="table-scroll">
        <table className="comps-table dcf-table">
          <caption className="sr-only">Target banks&apos; DCF ranges against the offer</caption>
          <thead>
            <tr>
              <th scope="col">TARGET</th>
              <th scope="col">ADVISOR</th>
              <th scope="col" className="right">DCF VALUE / SHARE</th>
              <th scope="col" className="right">OFFER</th>
              <th scope="col" className="right">VS. MIDPOINT</th>
              <th scope="col" className="dcf-bar-col">
                <span className="sr-only">DCF range against the offer</span>
              </th>
              <th scope="col" className="right">DISCOUNT RATE</th>
              <th scope="col" className="right">TERMINAL GROWTH</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map(({ deal, dcf, vsMid }) => {
              const offer = deal.pricePerShare;
              const style = offer ? ({ "--lo": `${x(dcf.low / offer)}%`, "--hi": `${x(dcf.high / offer)}%`, "--offer": `${x(1)}%` } as CSSProperties) : undefined;
              const where = offer == null ? "" : offer > dcf.high ? "above" : offer < dcf.low ? "below" : "within";
              return (
                <RowLink key={deal.id} label={`${deal.acquirer.name} to acquire ${deal.target.name}`} onOpen={() => onOpen(deal)}>
                  <td className="company">
                    <CompanyLink company={deal.target} />
                  </td>
                  <td className="dim">{dcf.bank ?? "—"}</td>
                  <td className="right mono">
                    {formatPrice(dcf.low)} – {formatPrice(dcf.high)}
                  </td>
                  <td className="right mono">{formatPrice(offer)}</td>
                  <td className="right mono">{vsMid == null ? "—" : formatSignedPct(vsMid)}</td>
                  <td className="dcf-bar-col">
                    {style && (
                      <span className={`dcf-bar ${where}`} style={style} role="img" aria-label={`Offer ${where} the DCF range`}>
                        <span className="dcf-range" />
                        <span className="dcf-offer" />
                      </span>
                    )}
                  </td>
                  <td className="right mono">{span(dcf.discountRatePct)}</td>
                  <td className="right mono">{span(dcf.perpetuityGrowthPct)}</td>
                </RowLink>
              );
            })}
            {rows.length > shown && (
              <tr className="show-more-row">
                <td colSpan={8}>
                  <ShowMore shown={shown} total={rows.length} onMore={() => setShown((n) => n + TABLE_PAGE)} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        <span>Bar: the DCF value range per share, scaled to the offer (dashed line) · 0.4x – 1.8x</span>
        <span>From the merger proxy&apos;s fairness-opinion summary</span>
      </div>
    </section>
  );
}
