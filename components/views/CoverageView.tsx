"use client";

import { useMemo, type CSSProperties } from "react";
import { useHubData } from "@/components/data/HubDataProvider";
import { AboutData, Kpi, Kpis, PageHeading, PanelHead, Takeaways } from "@/components/ui/primitives";
import { coverageStart } from "@/lib/aggregate";
import { coverage, coverageTakeaways, IPO_FIELDS, PRIVATE_FIELDS, privateDeals, PUBLIC_FIELDS, publicDeals, type Coverage, type Share } from "@/lib/coverage";
import { formatPct } from "@/lib/format";

/** A share as a percentage with a slim bar under it (the design's value bar). */
function Cell({ s, strong }: { s: Share; strong?: boolean }) {
  if (s.pct == null) return <td className="right dim">—</td>;
  return (
    <td className={`right mono cov-cell ${strong ? "cov-all" : ""}`} title={`${s.n.toLocaleString("en-US")} of ${s.of.toLocaleString("en-US")}`}>
      {formatPct(s.pct, 0)}
      <span className="cov-bar" aria-hidden="true">
        <i style={{ "--pct": `${Math.max(0, Math.min(100, s.pct))}%` } as CSSProperties} />
      </span>
    </td>
  );
}

function CoverageTable({ c, caption, first }: { c: Coverage; caption: string; first: string }) {
  return (
    <div className="table-scroll">
      <table className="coverage-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col" className="right">
              ALL
            </th>
            {c.years.map((y) => (
              <th scope="col" className="right" key={y}>
                {y.toUpperCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                {r.label}
                {r.note && <small>{r.note}</small>}
              </th>
              <Cell s={r.all} strong />
              {c.years.map((y) => (
                <Cell key={y} s={r.byYear[y]} />
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Records</th>
            <td className="right mono">{c.total.toLocaleString("en-US")}</td>
            {c.years.map((y) => (
              <td className="right mono" key={y}>
                {c.totalByYear[y].toLocaleString("en-US")}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const STAGES = ["Filed", "Priced", "Trading"];

/** How complete each field is, read from the same data every page uses. */
export function CoverageView() {
  const { data } = useHubData();
  const start = useMemo(() => coverageStart(data.deals) ?? "2021-01-01", [data.deals]);
  const byYear = (d: { announcedDate: string }) => d.announcedDate.slice(0, 4);
  const pub = useMemo(() => coverage(publicDeals(data.deals, start), PUBLIC_FIELDS, byYear), [data.deals, start]);
  const priv = useMemo(() => coverage(privateDeals(data.deals, start), PRIVATE_FIELDS, byYear), [data.deals, start]);
  const ipos = useMemo(() => coverage(data.ipos, IPO_FIELDS, (i) => i.stage, STAGES), [data.ipos]);
  const takeaways = useMemo(() => coverageTakeaways(pub, priv), [pub, priv]);
  const pct = (c: Coverage, key: string) => formatPct(c.rows.find((r) => r.key === key)?.all.pct ?? null, 0);

  return (
    <>
      <PageHeading title="Data Coverage" subtitle="How complete each field is · Read from SEC EDGAR filings" />
      <Kpis label="Coverage summary">
        <Kpi label="Public-target deals" value={pub.total.toLocaleString("en-US")} note={`Since ${start.slice(0, 4)}, not terminated`} />
        <Kpi label="With a deal value" value={pct(pub, "value")} note={`Premium ${pct(pub, "premium")}`} text />
        <Kpi label="With EV / EBITDA" value={pct(pub, "evEbitda")} note={`EV / Revenue ${pct(pub, "evRevenue")}`} text />
        <Kpi label="Private-target deals" value={priv.total.toLocaleString("en-US")} note={`${pct(priv, "value")} disclose a price`} />
      </Kpis>
      <Takeaways items={takeaways} />

      <section className="panel">
        <PanelHead title="Public-target deals" subtitle="Share of deals with each figure, by year announced" />
        <CoverageTable c={pub} caption="Coverage of public-target deals by field and year" first="FIELD" />
      </section>

      <section className="panel">
        <PanelHead title="Private-target deals" subtitle="Private companies bought by US-listed acquirers" />
        <CoverageTable c={priv} caption="Coverage of private-target deals by field and year" first="FIELD" />
      </section>

      <section className="panel">
        <PanelHead title="IPO pipeline" subtitle="Share of registrations with each figure, by stage" />
        <CoverageTable c={ipos} caption="Coverage of the IPO pipeline by field and stage" first="FIELD" />
      </section>

      <AboutData>
        <p>
          Every figure is read from SEC EDGAR filings: deals from announcement press releases, merger 8-Ks (Item 1.01) and the merger proxies and tender
          responses of every company being bought; terms, advisers and fairness opinions from those proxies; multiples from the target&apos;s XBRL financials. New
          filings are read every hour on weekdays and every six hours otherwise.
        </p>
        <p>
          A blank means the filings don&apos;t state the figure clearly: Castle never estimates one. Some blanks are expected. A merger of equals often states only the
          combined company&apos;s size, a premium is shown only over the unaffected or last closing price, loss-making targets have no EV / EBITDA, and banks and
          insurers have no enterprise value at all. Most private-company purchases don&apos;t disclose a price.
        </p>
        <p>Terminated deals are left out of the public-deal table: an abandoned bid rarely reaches a merger proxy, where much of the detail comes from.</p>
      </AboutData>
    </>
  );
}
