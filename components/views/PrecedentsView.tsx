"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { CopyLinkButton } from "@/components/ui/CopyLinkButton";
import { Icon } from "@/components/ui/Icon";
import { AboutData, FilterSearch, Kpi, Kpis, PageHeading, PanelHead, Select } from "@/components/ui/primitives";
import { EmptyRow, RowLink, ShowMore, TABLE_PAGE } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { PrecedentsDcf } from "@/components/views/PrecedentsDcf";
import { exportContext } from "@/components/export/excel";
import { downloadCsv, toCsv } from "@/lib/csv";
import { precedentsWorkbook } from "@/lib/excel/workbooks";
import { considerationLabel, formatDate, formatMultiple, formatPct, formatUsd } from "@/lib/format";
import {
  dcfRows,
  dealSize,
  DEFAULT_PRECEDENTS,
  describeScreen,
  PRECEDENT_SPEC,
  screenForDeal,
  screenPrecedents,
  SUMMARY_ROWS,
  summarizeComps,
  WINDOW_OPTIONS,
  type PrecedentScreen,
  type Summary,
} from "@/lib/precedents";
import { CONSIDERATION_OPTIONS } from "@/lib/screen";
import { SECTORS } from "@/lib/types";
import { decodeState, encodeState, replaceQuery } from "@/lib/urlState";

const range = (s: Summary, fmt: (v: number | null) => string) => (s.n >= 4 ? `25th–75th: ${fmt(s.p25)} – ${fmt(s.p75)}` : `${s.n} data point${s.n === 1 ? "" : "s"}`);

export function PrecedentsView() {
  const dealId = useSearchParams().get("deal");
  // A new ?deal= starts a fresh screen.
  return <Precedents key={dealId ?? ""} dealId={dealId} />;
}

function Precedents({ dealId }: { dealId: string | null }) {
  const { data } = useHubData();
  const { openDeal } = useDetails();
  const { toast } = useUi();
  const subject = useMemo(() => data.deals.find((d) => d.id === dealId) ?? null, [data.deals, dealId]);

  // Seeded once from the link (?deal= and any screen fields, ?x= the unticked outliers); edits take over after that
  // and are written back, so the screen is always a link someone else can open.
  const params = useSearchParams();
  const [screen, setScreen] = useState<PrecedentScreen>(() => decodeState(params, subject ? screenForDeal(subject) : DEFAULT_PRECEDENTS, PRECEDENT_SPEC));
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set((params.get("x") ?? "").split(",").filter((id) => /^[\w.-]{3,80}$/.test(id)).slice(0, 200)));
  useEffect(() => {
    const query = new URLSearchParams(encodeState(screen, DEFAULT_PRECEDENTS, PRECEDENT_SPEC));
    if (dealId) query.set("deal", dealId);
    if (excluded.size) query.set("x", [...excluded].join(","));
    replaceQuery(query.toString());
  }, [screen, excluded, dealId]);
  const [shown, setShown] = useState(TABLE_PAGE);
  const edit = (patch: Partial<PrecedentScreen>) => (setScreen((s) => ({ ...s, ...patch })), setShown(TABLE_PAGE));

  const rows = useMemo(() => screenPrecedents(data.deals, screen, data.asOf).filter((d) => d.id !== subject?.id), [data.deals, data.asOf, screen, subject]);
  const included = rows.filter((d) => !excluded.has(d.id));
  const stats = useMemo(() => summarizeComps(included), [included]);
  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const vsMedian = (value: number | null, median: number | null) =>
    value != null && median != null ? `Subject ${formatMultiple(value)} vs. median ${formatMultiple(median)}` : null;

  const exportRows = () => {
    const fmt = (v: number | null, digits = 1) => (v == null ? null : Number(v.toFixed(digits)));
    const csv = toCsv(
      ["Announced", "Target", "Acquirer", "Deal size (USD)", "EV / EBITDA", "EV / Revenue", "Premium (%)", "Consideration", "Status"],
      [
        ...included.map((d) => [d.announcedDate, d.target.name, d.acquirer.name, dealSize(d), d.evEbitda, d.evRevenue, d.premiumPct, d.consideration, d.status]),
        [],
        ...SUMMARY_ROWS.map(({ key, label }) => [label, "", "", fmt(stats.size[key], 0), fmt(stats.evEbitda[key]), fmt(stats.evRevenue[key]), fmt(stats.premium[key]), "", ""]),
      ],
      data.isSample,
    );
    downloadCsv(csv, `Castle_Precedents${screen.sector === "all" ? "" : `_${screen.sector}`}${data.isSample ? "_Sample" : ""}.csv`);
    toast(`${included.length} precedents exported with summary rows.`);
  };

  return (
    <>
      <PageHeading
        title="Precedent Transactions"
        subtitle={subject ? `Comparables for ${subject.acquirer.name} → ${subject.target.name}` : "Comparable U.S. M&A · Transaction multiples"}
        onExport={included.length ? exportRows : undefined}
        excel={() =>
          included.length
            ? precedentsWorkbook(included, dcfRows(included), exportContext(data), {
                subtitle: subject ? `Comparables for ${subject.acquirer.name} → ${subject.target.name}` : "Comparable U.S. M&A · transaction multiples",
                selection: [
                  ...(subject ? [`Subject deal: ${subject.acquirer.name} → ${subject.target.name}`] : []),
                  ...describeScreen(screen),
                  ...(excluded.size ? [`Excluded by you: ${rows.length - included.length}`] : []),
                ],
                sector: screen.sector,
              })
            : null
        }
        exportLabel="Export the comps table"
        extra={<CopyLinkButton label="Copy a link to this precedent set" />}
      />

      <Kpis label="Precedent summary">
        <Kpi label="Precedents" value={included.length} note={excluded.size ? `${rows.length - included.length} excluded by you` : `${rows.length} match the screen`} />
        <Kpi
          label="Median EV / EBITDA"
          value={formatMultiple(stats.evEbitda.median)}
          note={(subject && vsMedian(subject.evEbitda, stats.evEbitda.median)) ?? range(stats.evEbitda, formatMultiple)}
        />
        <Kpi
          label="Median EV / Revenue"
          value={formatMultiple(stats.evRevenue.median)}
          note={(subject && vsMedian(subject.evRevenue, stats.evRevenue.median)) ?? range(stats.evRevenue, formatMultiple)}
        />
        <Kpi label="Median premium" value={formatPct(stats.premium.median)} note={range(stats.premium, (v) => formatPct(v))} />
      </Kpis>

      <section className="panel">
        <PanelHead title="Screen" subtitle="Pick comparable deals, then untick outliers">
          <button type="button" className="small-link" onClick={() => (setScreen(subject ? screenForDeal(subject) : DEFAULT_PRECEDENTS), setExcluded(new Set()), setShown(TABLE_PAGE))}>
            Reset
          </button>
        </PanelHead>
        <div className="filters-drawer precedents-filters">
          <div className="field">
            <label htmlFor="p-sector">Sector</label>
            <Select id="p-sector" label="Sector" value={screen.sector} onChange={(sector) => edit({ sector })} options={[{ value: "all", label: "All sectors" }, ...SECTORS.map((s) => ({ value: s, label: s }))]} />
          </div>
          <div className="field">
            <label htmlFor="p-industry">Industry contains</label>
            <FilterSearch id="p-industry" label="Industry contains" placeholder="e.g. software, bank, pharma" value={screen.industry} onChange={(industry) => edit({ industry })} />
          </div>
          <div className="field">
            <label htmlFor="p-min">Deal size · USD billions (EV first)</label>
            <div className="filter-pair">
              <input id="p-min" aria-label="Minimum deal size in billions" type="number" min="0" step=".1" placeholder="Min" value={screen.min} onChange={(e) => edit({ min: e.target.value })} />
              <input aria-label="Maximum deal size in billions" type="number" min="0" step=".1" placeholder="Max" value={screen.max} onChange={(e) => edit({ max: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="p-window">Announced</label>
            <Select id="p-window" label="Announced" value={screen.window} onChange={(window) => edit({ window })} options={WINDOW_OPTIONS} />
          </div>
          <div className="field">
            <label htmlFor="p-consideration">Consideration</label>
            <Select id="p-consideration" label="Consideration" value={screen.consideration} onChange={(consideration) => edit({ consideration })} options={[{ value: "all", label: "Any consideration" }, ...CONSIDERATION_OPTIONS]} />
          </div>
          <label className="check-label precedents-check">
            <input type="checkbox" checked={screen.withMultiples} onChange={(e) => edit({ withMultiples: e.target.checked })} />
            Only deals with multiples
          </label>
          <label className="check-label precedents-check">
            <input type="checkbox" checked={screen.includeTerminated} onChange={(e) => edit({ includeTerminated: e.target.checked })} />
            Include terminated deals
          </label>
        </div>

        <div className="table-scroll">
          <table className="comps-table">
            <caption className="sr-only">Precedent transactions</caption>
            <thead>
              <tr>
                <th scope="col" className="cell-controls">
                  <span className="sr-only">Include</span>
                </th>
                <th scope="col">ANNOUNCED</th>
                <th scope="col">TARGET</th>
                <th scope="col">ACQUIRER</th>
                <th scope="col" className="right">DEAL VALUE</th>
                <th scope="col" className="right">EV / EBITDA</th>
                <th scope="col" className="right">EV / REVENUE</th>
                <th scope="col" className="right">PREMIUM</th>
                <th scope="col">CONSIDERATION</th>
              </tr>
            </thead>
            <tbody>
              {subject && (
                <RowLink label={`Subject deal: ${subject.target.name}`} onOpen={() => openDeal(subject)} className="comps-subject">
                  <td className="cell-controls">
                    <Icon name="right" />
                  </td>
                  <td className="table-date">{formatDate(subject.announcedDate)}</td>
                  <td className="company">
                    <CompanyLink company={subject.target} />
                  </td>
                  <td className="company">
                    <CompanyLink company={subject.acquirer} />
                  </td>
                  <td className="right table-value">{formatUsd(dealSize(subject))}</td>
                  <td className="right mono">{formatMultiple(subject.evEbitda)}</td>
                  <td className="right mono">{formatMultiple(subject.evRevenue)}</td>
                  <td className="right mono">{formatPct(subject.premiumPct)}</td>
                  <td className="dim">Subject deal</td>
                </RowLink>
              )}
              {rows.slice(0, shown).map((d) => {
                const out = excluded.has(d.id);
                return (
                  <RowLink key={d.id} label={`${d.acquirer.name} to acquire ${d.target.name}`} onOpen={() => openDeal(d)} className={out ? "comps-excluded" : ""}>
                    <td className="cell-controls" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Include ${d.target.name}`} checked={!out} onChange={() => toggle(d.id)} />
                    </td>
                    <td className="table-date">{formatDate(d.announcedDate)}</td>
                    <td className="company">
                      <CompanyLink company={d.target} />
                    </td>
                    <td className="company">
                      <CompanyLink company={d.acquirer} />
                    </td>
                    <td className="right table-value">{formatUsd(dealSize(d))}</td>
                    <td className="right mono">{formatMultiple(d.evEbitda)}</td>
                    <td className="right mono">{formatMultiple(d.evRevenue)}</td>
                    <td className="right mono">{formatPct(d.premiumPct)}</td>
                    <td className="dim">{considerationLabel(d.consideration)}</td>
                  </RowLink>
                );
              })}
              {!rows.length && <EmptyRow colSpan={9}>No deals match this screen. Widen the size range or the date window.</EmptyRow>}
              {rows.length > shown && (
                <tr className="show-more-row">
                  <td colSpan={9}>
                    <ShowMore shown={shown} total={rows.length} onMore={() => setShown((n) => n + TABLE_PAGE)} />
                  </td>
                </tr>
              )}
            </tbody>
            {!!included.length && (
              <tfoot className="comps-summary">
                {SUMMARY_ROWS.map(({ key, label }) => (
                  <tr key={key} className={key === "median" ? "comps-median" : ""}>
                    <td />
                    <th scope="row" colSpan={3}>
                      {label}
                    </th>
                    <td className="right table-value">{formatUsd(stats.size[key])}</td>
                    <td className="right mono">{formatMultiple(stats.evEbitda[key])}</td>
                    <td className="right mono">{formatMultiple(stats.evRevenue[key])}</td>
                    <td className="right mono">{formatPct(stats.premium[key])}</td>
                    <td />
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
        <div className="panel-foot">
          <span>
            Statistics use ticked rows only · n = {stats.evEbitda.n} (EV / EBITDA), {stats.evRevenue.n} (EV / Revenue), {stats.premium.n} (premium)
          </span>
          <span>Deal size = enterprise value, else headline value</span>
        </div>
      </section>
      <PrecedentsDcf deals={included} onOpen={openDeal} />
      <AboutData>
        <p>
          Multiples use the target&apos;s last-twelve-month revenue and EBITDA from its XBRL filings. EV is the stated enterprise value, or equity value plus debt
          minus cash. A dash means not disclosed; blanks are left out of the statistics, never counted as zero.
        </p>
        <p>
          The DCF panel reads the target board&apos;s bank: the discounted cash flow range of value per share in its fairness opinion, as the merger proxy
          summarises it, with the discount rate and terminal growth it used. An offer above the range means the bank&apos;s own cash-flow view valued the company
          below the price paid.
        </p>
      </AboutData>
    </>
  );
}
