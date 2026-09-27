"use client";

import { useMemo } from "react";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { buyerGroups, buyerInsights, type BuyerGroup } from "@/lib/buyers";
import { formatMultiple, formatPct, formatUsd } from "@/lib/format";

function GroupCard({ g, blurb }: { g: BuyerGroup; blurb: string }) {
  return (
    <div className="buyer-card">
      <div className="buyer-card-head">
        <h3>{g.type}</h3>
        <span className="mono">
          {g.count} deals · {g.sharePct}%
        </span>
      </div>
      <p className="buyer-blurb">{blurb}</p>
      <dl className="buyer-stats">
        <div>
          <dt>Median premium</dt>
          <dd>{formatPct(g.medianPremium, 0)}</dd>
        </div>
        <div>
          <dt>Median EV / EBITDA</dt>
          <dd>{formatMultiple(g.medianEvEbitda)}</dd>
        </div>
        <div>
          <dt>Median deal size</dt>
          <dd>{formatUsd(g.medianValueUsd)}</dd>
        </div>
        <div>
          <dt>Paid all in cash</dt>
          <dd>{g.cashPct != null ? `${g.cashPct}%` : "n/a"}</dd>
        </div>
      </dl>
      {!!g.topBuyers.length && (
        <div className="buyer-top">
          <div className="buyer-top-label">Most active</div>
          {g.topBuyers.map((b) => (
            <div key={b.name} className="explorer-buyer">
              <CompanyLink company={b.deal.acquirer} />
              <span className="dim">
                {b.count} deal{b.count === 1 ? "" : "s"}
                {b.valueUsd ? ` · ${formatUsd(b.valueUsd)}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Strategic vs. private-equity buyers: who buys, what they pay, how they pay. */
export function BuyerTypes() {
  const { data } = useHubData();
  const groups = useMemo(() => buyerGroups(data.deals), [data.deals]);
  const notes = useMemo(() => buyerInsights(groups), [groups]);
  if (!groups[0].count || !groups[1].count) return null;
  return (
    <section className="panel buyer-panel" aria-label="Strategic vs private-equity buyers">
      <div className="panel-head">
        <div className="panel-heading">
          <h2>Who pays more: companies or private equity?</h2>
          <small>Every deal by buyer type · terminated deals excluded</small>
        </div>
      </div>
      <div className="buyer-grid">
        <GroupCard g={groups[0]} blurb="An operating company buying a competitor, supplier or a way into a new market." />
        <GroupCard g={groups[1]} blurb="A fund (KKR, Blackstone, Thoma Bravo…) buying with investors' money and debt, planning to sell again in a few years." />
      </div>
      {!!notes.length && (
        <ul className="buyer-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
