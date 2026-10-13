"use client";

import { Fragment, useMemo } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { PanelHead } from "@/components/ui/primitives";
import { formatSignedPct, formatUsd } from "@/lib/format";
import { MIN_GROUP, reactionInsights, reactionSummary, type ReactionGroup } from "@/lib/reactions";
import type { Deal } from "@/lib/types";

const Move = ({ value }: { value: number | null }) =>
  value == null ? <span className="dim">—</span> : <span className={value >= 0 ? "text-up" : "text-down"}>{formatSignedPct(value)}</span>;

function Row({ g, strong = false }: { g: ReactionGroup; strong?: boolean }) {
  return (
    <tr className={strong ? "reaction-all" : undefined}>
      <td>{g.label}</td>
      <td className="right mono">{g.count}</td>
      <td className="right mono">
        <Move value={g.announcement} />
      </td>
      <td className="right mono">{g.beatPct == null ? <span className="dim">—</span> : `${g.beatPct}%`}</td>
      <td className="right mono">
        <Move value={g.sixMonths} />
      </td>
    </tr>
  );
}

function DealList({ title, deals, onOpen }: { title: string; deals: Deal[]; onOpen: (d: Deal) => void }) {
  if (!deals.length) return null;
  return (
    <div>
      <div className="fp-head">{title}</div>
      {deals.map((d) => (
        <button key={d.id} type="button" className="related-deal" onClick={() => onOpen(d)}>
          <span>
            {d.acquirer.name}
            <small>
              buying {d.target.name} · {formatUsd(d.enterpriseValueUsd ?? d.valueUsd)}
            </small>
          </span>
          <span className="mono">
            <Move value={d.reaction!.announcementVsMarketPct} />
          </span>
        </button>
      ))}
    </div>
  );
}

/** "Did buyers win?": listed acquirers' shares against the S&P 500 after they announced, by how they paid and what they bought. */
export function BuyerReactions() {
  const { data } = useHubData();
  const { openDeal } = useDetails();
  const s = useMemo(() => reactionSummary(data.deals), [data.deals]);
  const notes = useMemo(() => reactionInsights(s), [s]);
  if (s.all.count < MIN_GROUP) return null;
  return (
    <section className="panel buyer-panel" aria-label="Did buyers win?">
      <PanelHead title="Did buyers win?" subtitle="Listed buyers' shares against the S&P 500 · two trading days after announcing, and six months on · medians" />
      <div className="reaction-grid">
        <div className="table-scroll">
          <table className="reaction-table">
            <caption className="sr-only">Buyers&apos; share-price moves against the S&amp;P 500</caption>
            <thead>
              <tr>
                <th scope="col">BUYERS</th>
                <th scope="col" className="right">DEALS</th>
                <th scope="col" className="right">2 DAYS</th>
                <th scope="col" className="right">BEAT S&amp;P</th>
                <th scope="col" className="right">6 MONTHS</th>
              </tr>
            </thead>
            <tbody>
              <Row g={s.all} strong />
              {s.groups.map((grp) => (
                <Fragment key={grp.title}>
                  <tr className="reaction-group">
                    <td colSpan={5}>{grp.title}</td>
                  </tr>
                  {grp.rows.filter((g) => g.count).map((g) => (
                    <Row key={g.label} g={g} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="reaction-lists">
          <DealList title="Best received · $1B and up" deals={s.best} onOpen={openDeal} />
          <DealList title="Worst received · $1B and up" deals={s.worst} onOpen={openDeal} />
        </div>
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
