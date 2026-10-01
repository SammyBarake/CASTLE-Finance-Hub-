"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { Icon } from "@/components/ui/Icon";
import { CompanyMark, FilterSearch, Kpi, Kpis, PageHeading, SectorLabel, Select, StatusTag } from "@/components/ui/primitives";
import { EmptyRow } from "@/components/ui/table";
import { useUi } from "@/components/ui/UiProvider";
import { useRecordActions, useWorkspaceDialogs, WatchButton } from "@/components/workspace/actions";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { dealsToCsv, downloadCsv } from "@/lib/csv";
import { considerationLabel, formatDate, formatMultiple, formatPct, formatUsd } from "@/lib/format";
import { median, sum } from "@/lib/metrics";
import {
  activeFilters,
  CONSIDERATION_OPTIONS,
  DATE_OPTIONS,
  DEAL_COLUMNS,
  DEFAULT_COLUMNS,
  DEFAULT_SCREEN,
  screenDeals,
  type DealColumn,
  type DealScreen,
  type DealSort,
} from "@/lib/screen";
import { DEAL_STATUSES, SECTORS, type Deal } from "@/lib/types";

const PAGE_SIZE = 25;
type ViewKey = "all" | "large" | "tech" | "watch" | "custom" | `saved:${number}`;

const PRESETS: { key: ViewKey; label: string; screen: Partial<DealScreen> }[] = [
  { key: "all", label: "All deals", screen: {} },
  { key: "large", label: "$3B+", screen: { min: "3" } },
  { key: "tech", label: "Technology", screen: { sector: "Tech" } },
  { key: "watch", label: "Watchlist", screen: { watchOnly: true } },
];

function Cell({ d, col }: { d: Deal; col: DealColumn }) {
  switch (col) {
    case "date":
      return <td className="table-date">{formatDate(d.announcedDate)}</td>;
    case "acquirer":
      return (
        <td className="company">
          <CompanyLink company={d.acquirer} />
        </td>
      );
    case "target":
      return (
        <td className="company">
          <span className="company-line">
            <CompanyMark name={d.target.name} />
            <CompanyLink company={d.target} />
            {d.privateTarget && <span className="aim-chip private-chip">Private</span>}
          </span>
        </td>
      );
    case "value":
      return <td className="right table-value">{formatUsd(d.valueUsd)}</td>;
    case "premium":
      return <td className="right mono">{formatPct(d.premiumPct)}</td>;
    case "sector":
      return (
        <td>
          <SectorLabel sector={d.sector} />
        </td>
      );
    case "status":
      return (
        <td>
          <StatusTag status={d.status} />
        </td>
      );
    case "advisor":
      return <td>{d.acquirerAdvisors.join(", ") || <span className="dim">—</span>}</td>;
    case "consideration":
      return <td>{considerationLabel(d.consideration)}</td>;
    case "evEbitda":
      return <td className="right mono">{formatMultiple(d.evEbitda)}</td>;
  }
}

export function DealFlowView() {
  const { data } = useHubData();
  const { openDeal } = useDetails();
  const { toast, openMenu } = useUi();
  const ws = useWorkspace();
  const { openRowMenu } = useRecordActions();
  const { openCompare, openSaveView, openManageViews } = useWorkspaceDialogs();

  const [screen, setScreen] = useState<DealScreen>(DEFAULT_SCREEN);
  const [view, setView] = useState<ViewKey>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => screenDeals(data.deals, screen, { asOf: data.asOf, isWatched: (id) => ws.isWatched("deal", id) }), [data, screen, ws]);
  const chips = activeFilters(screen);
  const columns = DEAL_COLUMNS.filter((c) => ws.prefs.columns.includes(c.key));
  const advisors = useMemo(() => [...new Set(data.deals.flatMap((d) => [...d.acquirerAdvisors, ...d.targetAdvisors]))].sort(), [data.deals]);
  const watchedDeals = ws.prefs.watch.filter((k) => k.startsWith("deal:")).length;

  // Filter edits make the view "custom"; presets and saved views replace the whole screen.
  const edit = (patch: Partial<DealScreen>) => {
    setScreen((s) => ({ ...s, ...patch }));
    setView("custom");
    setLimit(PAGE_SIZE);
  };
  const applyScreen = (next: DealScreen, key: ViewKey) => {
    setScreen(next);
    setView(key);
    setLimit(PAGE_SIZE);
  };
  const applySaved = (index: number) => {
    const v = ws.prefs.views[index];
    if (v) applyScreen({ ...DEFAULT_SCREEN, ...v.screen }, `saved:${index}`);
  };

  // A saved view picked from the settings menu on another page.
  useEffect(() => {
    if (ws.pendingView == null) return;
    applySaved(ws.pendingView); // eslint-disable-line react-hooks/set-state-in-effect -- consume a one-off request from the settings menu
    ws.setPendingView(null);
  });

  // Header checkbox reflects the visible rows.
  const visibleIds = rows.map((d) => d.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => ws.selected.has(id));
  const someSelected = visibleIds.some((id) => ws.selected.has(id));
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const toggleAll = (checked: boolean) => {
    const next = new Set(ws.selected);
    visibleIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
    ws.setSelected(next);
  };

  const exportRows = (list: Deal[], label = "rows") => {
    if (!list.length) return toast("No rows to export. Clear the filters first.");
    downloadCsv(dealsToCsv(list, data.isSample), data.isSample ? "Castle_Deals_Sample.csv" : "Castle_Deals.csv");
    toast(`${list.length} ${label} exported.`);
  };

  const openColumns = (anchor: HTMLElement, current: DealColumn[] = ws.prefs.columns) =>
    openMenu(
      [
        { kind: "title", label: "Visible columns" },
        ...DEAL_COLUMNS.map((c) => ({
          kind: "check" as const,
          label: c.label,
          checked: current.includes(c.key),
          disabled: c.locked,
          onToggle: (on: boolean) => {
            // Keep the canonical column order.
            const next = on ? DEAL_COLUMNS.map((x) => x.key).filter((k) => k === c.key || current.includes(k)) : current.filter((k) => k !== c.key);
            ws.setColumns(next);
            openColumns(anchor, next); // reopen with fresh checkmarks
          },
        })),
        { kind: "rule" },
        { kind: "action", label: "Reset columns", onSelect: () => ws.setColumns(DEFAULT_COLUMNS) },
      ],
      { anchor },
    );

  const medianPrem = median(rows.map((d) => d.premiumPct).filter((p): p is number => p != null));
  const selectedDeals = data.deals.filter((d) => ws.selected.has(d.id));

  return (
    <>
      <PageHeading title="Deal Flow" subtitle={`Announced U.S. M&A · ${data.isSample ? "Transaction details" : "From SEC filings"}`} onExport={() => exportRows(rows)} />

      <Kpis label="Filtered transaction summary">
        <Kpi label="Transactions" value={rows.length} note="Current selection" />
        <Kpi label="Total deal value" value={formatUsd(sum(rows.map((d) => d.valueUsd ?? 0)))} note="Disclosed transaction value" />
        <Kpi label="Median premium" value={medianPrem == null ? "—" : formatPct(medianPrem)} note="Offer vs. unaffected share price" />
        <Kpi label="Pending" value={rows.filter((d) => d.status === "Pending").length} note="Current selection" />
      </Kpis>

      <section className="panel" aria-label="Deal screener">
        <div className="views-row" role="group" aria-label="Views">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`view-button ${view === p.key ? "active" : ""}`}
              aria-pressed={view === p.key}
              onClick={() => applyScreen({ ...DEFAULT_SCREEN, ...p.screen }, p.key)}
            >
              {p.label}
              {p.key === "all" && <span className="view-count">{data.deals.length}</span>}
              {p.key === "watch" && <span className="view-count">{watchedDeals}</span>}
            </button>
          ))}
          {ws.prefs.views.map((v, i) => (
            <button key={`${v.name}-${i}`} type="button" className={`view-button ${view === `saved:${i}` ? "active" : ""}`} aria-pressed={view === `saved:${i}`} onClick={() => applySaved(i)}>
              {v.name}
            </button>
          ))}
          <button type="button" className="view-button save-view" onClick={() => openSaveView(screen, (i) => setView(`saved:${i}`))}>
            + Save view
          </button>
          <button type="button" className="row-icon" aria-label="Manage saved views" title="Manage saved views" onClick={() => openManageViews(applySaved)}>
            <Icon name="dots" />
          </button>
        </div>

        <div className="table-tools">
          <FilterSearch id="deal-search" label="Filter transactions" placeholder="Company, ticker or advisor" value={screen.query} onChange={(query) => edit({ query })} />
          <div className="table-filters">
            <Select
              id="deal-sort"
              label="Sort transactions"
              value={screen.sort}
              onChange={(sort: DealSort) => setScreen((s) => ({ ...s, sort }))}
              options={[
                { value: "date", label: "Newest first" },
                { value: "value", label: "Largest first" },
                { value: "premium", label: "Highest premium" },
              ]}
            />
            <button type="button" className="button" aria-expanded={filtersOpen} aria-controls="advanced-filters" onClick={() => setFiltersOpen((o) => !o)}>
              <Icon name="filter" />
              Filters <span className="inline-count">{chips.length}</span>
            </button>
            <button type="button" className="button" onClick={(e) => openColumns(e.currentTarget)}>
              <Icon name="columns" />
              Columns
            </button>
          </div>
        </div>

        {filtersOpen && (
          <div id="advanced-filters" className="filters-drawer">
            <div className="field">
              <label htmlFor="f-date">Announced date</label>
              <Select id="f-date" label="Announced date" value={screen.date} onChange={(date) => edit({ date })} options={DATE_OPTIONS} />
            </div>
            <div className="field">
              <label htmlFor="f-min">Deal value · USD billions</label>
              <div className="filter-pair">
                <input id="f-min" aria-label="Minimum deal value in billions" type="number" min="0" step=".1" placeholder="Min" value={screen.min} onChange={(e) => edit({ min: e.target.value })} />
                <input aria-label="Maximum deal value in billions" type="number" min="0" step=".1" placeholder="Max" value={screen.max} onChange={(e) => edit({ max: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="f-premium">Minimum premium · %</label>
              <input id="f-premium" type="number" min="0" max="500" step="1" placeholder="Any premium" value={screen.premium} onChange={(e) => edit({ premium: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="f-advisor">Advisor · either side</label>
              <Select id="f-advisor" label="Advisor" value={screen.advisor} onChange={(advisor) => edit({ advisor })} options={[{ value: "all", label: "Any advisor" }, ...advisors.map((a) => ({ value: a, label: a }))]} />
            </div>
            <div className="field">
              <label htmlFor="f-consideration">Consideration</label>
              <Select
                id="f-consideration"
                label="Consideration"
                value={screen.consideration}
                onChange={(consideration) => edit({ consideration })}
                options={[{ value: "all" as const, label: "Any consideration" }, ...CONSIDERATION_OPTIONS]}
              />
            </div>
            <div className="field">
              <label htmlFor="f-target-type">Target</label>
              <Select
                id="f-target-type"
                label="Target type"
                value={screen.targetType ?? "all"}
                onChange={(targetType) => edit({ targetType })}
                options={[
                  { value: "all" as const, label: "Public and private" },
                  { value: "public" as const, label: "U.S.-listed targets" },
                  { value: "private" as const, label: "Private companies" },
                ]}
              />
            </div>
            <div className="field">
              <label htmlFor="f-sector">Sector</label>
              <Select id="f-sector" label="Sector" value={screen.sector} onChange={(sector) => edit({ sector })} options={[{ value: "all" as const, label: "All sectors" }, ...SECTORS.map((s) => ({ value: s, label: s }))]} />
            </div>
            <div className="field">
              <label htmlFor="f-status">Status</label>
              <Select id="f-status" label="Status" value={screen.status} onChange={(status) => edit({ status })} options={[{ value: "all" as const, label: "All statuses" }, ...DEAL_STATUSES.map((s) => ({ value: s, label: s }))]} />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button type="button" className="button" style={{ width: "100%" }} onClick={() => applyScreen({ ...DEFAULT_SCREEN, sort: screen.sort }, "all")}>
                Reset filters
              </button>
            </div>
          </div>
        )}

        <div className="filter-chips" aria-label="Active filters">
          {chips.map((c) => (
            <button key={c.key} type="button" className="filter-chip" aria-label={`Remove filter ${c.label}`} onClick={() => edit({ [c.key]: DEFAULT_SCREEN[c.key] } as Partial<DealScreen>)}>
              {c.label}
              <Icon name="close" />
            </button>
          ))}
        </div>

        {ws.selected.size > 0 && (
          <div className="bulk-bar" role="region" aria-label="Selection">
            <span>{ws.selected.size} selected</span>
            <button type="button" className="button" onClick={() => openCompare()}>
              <Icon name="compare" />
              Compare
            </button>
            <button type="button" className="button" onClick={() => exportRows(selectedDeals, "selected transactions")}>
              <Icon name="download" />
              Export selected
            </button>
            <span className="bulk-spacer" />
            <button type="button" className="small-link" onClick={() => ws.setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}

        <div className="table-scroll">
          <table>
            <caption className="sr-only">M&amp;A deal screener. Select a row for details; right-click for actions.</caption>
            <thead>
              <tr>
                <th className="cell-controls">
                  <input ref={selectAllRef} type="checkbox" aria-label="Select all visible transactions" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} />
                </th>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={c.right ? "right" : ""} aria-sort={c.sortable && screen.sort === c.sortable ? "descending" : undefined}>
                    {c.sortable ? (
                      <button type="button" className="sort-button" onClick={() => setScreen((s) => ({ ...s, sort: c.sortable! }))}>
                        {c.label.toUpperCase()}
                        {screen.sort === c.sortable && <Icon name="arrow-down" />}
                      </button>
                    ) : (
                      c.label.toUpperCase()
                    )}
                  </th>
                ))}
                <th className="cell-end">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((d) => {
                const isSel = ws.selected.has(d.id);
                return (
                  <tr
                    key={d.id}
                    className={`row-link ${isSel ? "selected-row" : ""}`}
                    tabIndex={0}
                    aria-label={`${d.acquirer.name} acquires ${d.target.name}`}
                    onClick={() => openDeal(d)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDeal(d);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openRowMenu("deal", d, { x: e.clientX, y: e.clientY });
                    }}
                  >
                    <td className="cell-controls" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${d.target.name}`} checked={isSel} onChange={() => ws.toggleSelected(d.id)} />
                      <WatchButton kind="deal" id={d.id} label={d.target.name} />
                    </td>
                    {columns.map((c) => (
                      <Cell key={c.key} d={d} col={c.key} />
                    ))}
                    <td className="cell-end">
                      <button
                        type="button"
                        className="row-icon"
                        aria-label={`Actions for ${d.target.name}`}
                        aria-haspopup="menu"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRowMenu("deal", d, { anchor: e.currentTarget });
                        }}
                      >
                        <Icon name="dots" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <EmptyRow colSpan={columns.length + 2}>
                  No transactions match these filters.
                  <button type="button" onClick={() => applyScreen({ ...DEFAULT_SCREEN, sort: screen.sort }, "all")}>
                    Reset filters
                  </button>
                </EmptyRow>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <button type="button" className="show-more" onClick={() => setLimit((l) => l + 50)}>
            Show more ({rows.length - limit} remaining)
          </button>
        )}
        <div className="panel-foot">
          <span>
            {rows.length} of {data.deals.length} transactions
          </span>
          <span>USD · As of {formatDate(data.asOf.slice(0, 10))}</span>
        </div>
      </section>
    </>
  );
}
