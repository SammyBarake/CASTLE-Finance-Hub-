"use client";

import { useMemo, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { AboutData, CompanyMark, Kpi, Kpis, PageHeading, PanelHead, SectorLabel, Segment, Takeaways } from "@/components/ui/primitives";
import { EmptyRow, RowLink, ShowMore, TABLE_PAGE } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { bankShortName } from "@/lib/banks";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate, formatPct, formatUsd } from "@/lib/format";
import { feeLabel, feeUsd, financingLabel, financingShort, goShopLabel, termsInsights, termsRows, termsStats, type TermsRow } from "@/lib/terms";

type Filter = "all" | "goshop" | "reverse" | "financed";
const pct = (v: number | null) => formatPct(v);

export function DealTermsView() {
  const { data } = useHubData();
  const { openDeal } = useDetails();
  const { toast } = useUi();
  const rows = useMemo(() => termsRows(data.deals), [data.deals]);
  const s = useMemo(() => termsStats(rows), [rows]);
  const notes = useMemo(() => termsInsights(s), [s]);
  const [filter, setFilter] = useState<Filter>("all");
  const [lender, setLender] = useState<string | null>(null);
  const [shown, setShown] = useState(TABLE_PAGE);

  const visible = rows.filter(
    (r) =>
      (filter === "all" ||
        (filter === "goshop" && r.deal.terms!.goShop) ||
        (filter === "reverse" && r.reverseFeePct != null) ||
        (filter === "financed" && r.deal.terms!.financingBanks.length > 0)) &&
      (!lender || r.deal.terms!.financingBanks.includes(lender)),
  );
  const maxFee = Math.max(1, ...s.bySize.flatMap((b) => [b.targetFee ?? 0, b.reverseFee ?? 0]));
  const maxLender = Math.max(1, ...s.lenders.map((l) => l.deals));

  const exportRows = () => {
    const csv = toCsv(
      ["Announced", "Target", "Acquirer", "Deal value (USD)", "Target break fee (USD)", "Break fee (% of value)", "Reverse fee (USD)", "Reverse fee (% of value)", "Go-shop", "Go-shop days", "Financing condition", "Financing banks"],
      visible.map(({ deal: d, targetFeePct, reverseFeePct }) => [
        d.announcedDate,
        d.target.name,
        d.acquirer.name,
        d.valueUsd,
        d.terms!.targetFeeUsd,
        targetFeePct,
        d.terms!.reverseFeeUsd,
        reverseFeePct,
        d.terms!.goShop == null ? "" : d.terms!.goShop ? "Yes" : "No",
        d.terms!.goShopDays,
        d.terms!.financingCondition == null ? "" : d.terms!.financingCondition ? "Yes" : "No",
        d.terms!.financingBanks.join("; "),
      ]),
      data.isSample,
    );
    downloadCsv(csv, `Castle_Deal_Terms${data.isSample ? "_Sample" : ""}.csv`);
    toast(`${visible.length} deals exported.`);
  };

  if (!rows.length) {
    return (
      <>
        <PageHeading title="Deal Terms" subtitle="Break fees, go-shops and financing in U.S. public-target M&A" />
        <section className="panel">
          <div className="empty-small">
            {data.isSample ? "Deal terms are read from real merger agreements, so they appear once the site is showing live data." : "Deal terms appear after the next data refresh reads the merger agreements."}
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeading title="Deal Terms" subtitle="Break fees, go-shops and financing in U.S. public-target M&A" onExport={exportRows} />

      <Kpis label="Deal terms summary">
        <Kpi label="Median break fee" value={pct(s.medianTargetFee)} note={`Paid by the target · ${rows.filter((r) => r.targetFeePct != null).length} deals`} />
        <Kpi label="Median reverse fee" value={pct(s.medianReverseFee)} note={`Paid by the buyer · in ${s.reverseSharePct ?? 0}% of deals`} />
        <Kpi label="Go-shops" value={String(s.goShopCount)} note={s.medianGoShopDays ? `Typically ${s.medianGoShopDays} days to seek better offers` : "Deals letting the target shop after signing"} />
        <Kpi label="Debt-financed deals" value={String(s.financedCount)} note={s.lenders[0] ? `Committed lenders named · most active ${s.lenders[0].bank}` : "Committed lenders named"} />
      </Kpis>

      <Takeaways items={notes} />

      <div className="two-col timeline-grid">
        <section className="panel">
          <PanelHead title="Fees by deal size" subtitle="Median fee as a share of deal value" />
          <div className="terms-legend">
            <span>
              <i className="terms-key target" />
              Break fee (target pays)
            </span>
            <span>
              <i className="terms-key reverse" />
              Reverse fee (buyer pays)
            </span>
          </div>
          <div className="terms-bands">
            {s.bySize.map((b, i) => (
              <div key={b.label} className="terms-band" style={{ "--i": i } as React.CSSProperties}>
                <span className="terms-band-label">
                  {b.label}
                  <small>{b.n} deals</small>
                </span>
                <span className="terms-band-bars">
                  <span className="terms-bar target">
                    <i style={{ width: `${((b.targetFee ?? 0) / maxFee) * 100}%` }} />
                    <b>{pct(b.targetFee)}</b>
                  </span>
                  <span className="terms-bar reverse">
                    <i style={{ width: `${((b.reverseFee ?? 0) / maxFee) * 100}%` }} />
                    <b>{pct(b.reverseFee)}</b>
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="terms-sectors">
            <div className="terms-sectors-head">
              <span>By sector</span>
              <span>Deals</span>
              <span>Break</span>
              <span>Reverse</span>
            </div>
            {s.bySector.map((x) => (
              <div key={x.sector} className="terms-sector-row">
                <SectorLabel sector={x.sector} />
                <span className="mono">{x.n}</span>
                <span className="mono">{pct(x.targetFee)}</span>
                <span className="mono reverse">{pct(x.reverseFee)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <PanelHead title="Lenders" subtitle="Banks committing the buyer's debt · click to filter the deals" />
          {s.lenders.length ? (
            s.lenders.slice(0, 8).map((l, i) => (
              <button
                key={l.bank}
                type="button"
                className={`preview-row lender-row ${lender === l.bank ? "active-row" : ""}`}
                aria-pressed={lender === l.bank}
                onClick={() => (setLender(lender === l.bank ? null : l.bank), setShown(TABLE_PAGE))}
              >
                <span className="preview-company">
                  <span className="preview-rank">{String(i + 1).padStart(2, "0")}</span>
                  <CompanyMark name={l.bank} letters={bankShortName(l.bank)} />
                  <span>
                    <strong>{l.bank}</strong>
                    <small>Largest: {l.largest.target.name}</small>
                  </span>
                </span>
                <span className="lender-meter">
                  <span className="lender-bar">
                    <i style={{ width: `${(l.deals / maxLender) * 100}%` }} />
                  </span>
                  <span className="preview-value">
                    {l.deals} deal{l.deals === 1 ? "" : "s"}
                    <small>{formatUsd(l.valueUsd)}</small>
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="empty-small">No committed financing named yet.</div>
          )}
        </section>
      </div>

      <section className="panel">
        <PanelHead title={lender ? `Deals financed by ${lender}` : "Deals"} subtitle={`${visible.length} public-target deals · newest first · click a row for the full deal`}>
          {lender && (
            <button type="button" className="explorer-clear" onClick={() => setLender(null)}>
              Show all lenders
            </button>
          )}
          <Segment
            label="Filter deals"
            value={filter}
            onChange={(v) => (setFilter(v), setShown(TABLE_PAGE))}
            options={[
              { value: "all", label: "All" },
              { value: "reverse", label: "Reverse fee" },
              { value: "goshop", label: "Go-shop" },
              { value: "financed", label: "Committed debt" },
            ]}
          />
        </PanelHead>
        <div className="table-scroll">
          <table className="terms-table">
            <caption className="sr-only">Deal protection terms</caption>
            <thead>
              <tr>
                <th scope="col">ANNOUNCED</th>
                <th scope="col">TARGET</th>
                <th scope="col">ACQUIRER</th>
                <th scope="col" className="right">DEAL VALUE</th>
                <th scope="col" className="right">BREAK FEE</th>
                <th scope="col" className="right">REVERSE FEE</th>
                <th scope="col">GO-SHOP</th>
                <th scope="col">FINANCING</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, shown).map((r: TermsRow) => (
                <RowLink key={r.deal.id} label={`${r.deal.acquirer.name} to acquire ${r.deal.target.name}`} onOpen={() => openDeal(r.deal)}>
                  <td className="table-date">{formatDate(r.deal.announcedDate)}</td>
                  <td className="company">
                    <CompanyLink company={r.deal.target} />
                  </td>
                  <td className="company">
                    <CompanyLink company={r.deal.acquirer} />
                  </td>
                  <td className="right table-value">{formatUsd(r.deal.valueUsd)}</td>
                  <td className="right mono">{feeLabel(r.deal.terms!.targetFeeUsd, r.targetFeePct, feeUsd)}</td>
                  <td className="right mono">{feeLabel(r.deal.terms!.reverseFeeUsd, r.reverseFeePct, feeUsd)}</td>
                  <td className={r.deal.terms!.goShop ? "" : "dim"}>{goShopLabel(r.deal.terms!)}</td>
                  <td className={`terms-financing ${r.deal.terms!.financingBanks.length ? "" : "dim"}`} title={financingLabel(r.deal.terms!, 8)}>
                    {financingShort(r.deal.terms!, bankShortName)}
                  </td>
                </RowLink>
              ))}
              {!visible.length && <EmptyRow colSpan={8}>No deals match.</EmptyRow>}
            </tbody>
          </table>
        </div>
        <ShowMore shown={shown} total={visible.length} onMore={() => setShown((n) => n + TABLE_PAGE)} />
      </section>

      <AboutData>
        <p>
          <strong>Break fee.</strong> What the target pays the buyer if the deal falls apart for reasons on the target&apos;s side, most often because its board
          accepts a better offer. <strong>Reverse fee.</strong> What the buyer pays the target if the buyer can&apos;t close, typically when financing or regulatory
          approval fails. Both are shown in dollars and as a share of the headline deal value.
        </p>
        <p>
          <strong>Go-shop vs. no-shop.</strong> A go-shop lets the target actively seek better offers for a set period after signing, usually with a lower break
          fee during that window; a no-shop forbids soliciting other bids. <strong>Financing.</strong> &quot;No financing condition&quot; means the buyer must close
          even if its loans fall through; committed lenders are the banks named in the debt commitment letters.
        </p>
        <p>
          <strong>Sources.</strong> The summary of the merger agreement in the target&apos;s 8-K (Item 1.01), with gaps filled from its merger proxy. A fee is
          kept only when the filing makes clear who pays it; fees outside 0.3%–15% of the deal value are left out as likely misreads.
        </p>
      </AboutData>
    </>
  );
}
