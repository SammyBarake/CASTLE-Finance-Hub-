"use client";

import { useState } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { Icon } from "@/components/ui/Icon";
import { useUi, type MenuPosition } from "@/components/ui/UiProvider";
import { dealsToCsv, downloadCsv } from "@/lib/csv";
import { considerationLabel, formatDateLong, formatPct, formatPrice, formatRaise, formatUsd } from "@/lib/format";
import type { DealScreen } from "@/lib/screen";
import type { Deal, Ipo } from "@/lib/types";
import { useWorkspace, type RecordKind } from "./WorkspaceProvider";

type RecordFor<K extends RecordKind> = K extends "deal" ? Deal : Ipo;

export function summaryText(kind: RecordKind, r: Deal | Ipo, isSample: boolean): string {
  const source = isSample ? "Sample data." : "Source: SEC EDGAR via Castle.";
  if (kind === "deal") {
    const d = r as Deal;
    return [
      `${d.acquirer.name} → ${d.target.name}${d.target.ticker ? ` (${d.target.ticker})` : ""}`,
      `Value: ${formatUsd(d.valueUsd)} · Offer: ${formatPrice(d.pricePerShare)} · Premium: ${formatPct(d.premiumPct)} · ${considerationLabel(d.consideration)}`,
      `${d.sector} · ${d.status} · Announced ${formatDateLong(d.announcedDate)}`,
      `Advisors: ${d.acquirerAdvisors.join(", ") || "n/a"} / ${d.targetAdvisors.join(", ") || "n/a"}`,
      source,
    ].join("\n");
  }
  const i = r as Ipo;
  return [
    `${i.company.name}${i.company.ticker ? ` (${i.company.ticker})` : ""}`,
    `${i.sector} · ${i.stage} · Filed ${formatDateLong(i.filedDate)}`,
    `Expected raise: ${formatRaise(i.expectedRaiseUsd)}${i.offerPrice != null ? ` · Priced at ${formatPrice(i.offerPrice)}` : ""}`,
    `Underwriters: ${i.underwriters.join(", ") || "n/a"}`,
    source,
  ].join("\n");
}

/** Star toggle used in tables and the drawer. */
export function WatchButton({ kind, id, label }: { kind: RecordKind; id: string; label: string }) {
  const { isWatched } = useWorkspace();
  const { toggleWatch } = useRecordActions();
  const on = isWatched(kind, id);
  return (
    <button
      type="button"
      className={`row-icon ${on ? "active" : ""}`}
      aria-pressed={on}
      aria-label={`${on ? "Remove" : "Add"} ${label} ${on ? "from" : "to"} watchlist`}
      onClick={(e) => {
        e.stopPropagation();
        toggleWatch(kind, id);
      }}
    >
      <Icon name="star" className={on ? "star-fill" : ""} />
    </button>
  );
}

export function useRecordActions() {
  const ws = useWorkspace();
  const { data } = useHubData();
  const { toast, openDialog, openMenu } = useUi();
  const { openDeal, openIpo } = useDetails();

  const toggleWatch = (kind: RecordKind, id: string) => {
    const now = ws.toggleWatch(kind, id);
    toast(now ? "Added to watchlist." : "Removed from watchlist.");
  };

  const copySummary = async (kind: RecordKind, r: Deal | Ipo) => {
    const text = summaryText(kind, r, data.isSample);
    try {
      await navigator.clipboard.writeText(text);
      toast("Summary copied.");
    } catch {
      openDialog({
        eyebrow: "Summary",
        title: "Copy summary",
        body: (
          <>
            <textarea className="notes-area" readOnly defaultValue={text} onFocus={(e) => e.currentTarget.select()} autoFocus />
            <p className="notes-help">Select and copy with Ctrl+C or ⌘C.</p>
          </>
        ),
      });
    }
  };

  const toggleCompare = (id: string) => {
    const has = ws.selected.has(id);
    ws.toggleSelected(id);
    toast(`${ws.selected.size + (has ? -1 : 1)} transactions selected.`);
  };

  function openRowMenu<K extends RecordKind>(kind: K, r: RecordFor<K>, at: MenuPosition) {
    const id = r.id;
    const watched = ws.isWatched(kind, id);
    openMenu(
      [
        { kind: "title", label: kind === "deal" ? (r as Deal).target.name : (r as Ipo).company.name },
        { kind: "action", label: "Open details", icon: "file", onSelect: () => (kind === "deal" ? openDeal(r as Deal) : openIpo(r as Ipo)) },
        { kind: "action", label: watched ? "Remove from watchlist" : "Add to watchlist", icon: "star", onSelect: () => toggleWatch(kind, id) },
        { kind: "action", label: "Copy summary", icon: "copy", onSelect: () => copySummary(kind, r) },
        ...(kind === "deal"
          ? ([
              { kind: "rule" },
              { kind: "action", label: ws.selected.has(id) ? "Remove from comparison" : "Select for comparison", icon: "compare", onSelect: () => toggleCompare(id) },
            ] as const)
          : []),
        ...(r.filings[0]
          ? ([{ kind: "action", label: "Open source filing", icon: "external", onSelect: () => window.open(r.filings[0].url, "_blank", "noopener") }] as const)
          : []),
      ],
      at,
    );
  }

  return { toggleWatch, copySummary, toggleCompare, openRowMenu };
}

// ---------------------------------------------------------------------------
// Workspace dialogs
// ---------------------------------------------------------------------------

function CompareBody({ deals, isSample }: { deals: Deal[]; isSample: boolean }) {
  const { toast } = useUi();
  const fields: [string, (d: Deal) => string][] = [
    ["Acquirer", (d) => d.acquirer.name],
    ["Deal value", (d) => formatUsd(d.valueUsd)],
    ["Offer price", (d) => formatPrice(d.pricePerShare)],
    ["Premium", (d) => formatPct(d.premiumPct)],
    ["EV / EBITDA", (d) => (d.evEbitda == null ? "n/a" : `${d.evEbitda.toFixed(1)}x`)],
    ["EV / Revenue", (d) => (d.evRevenue == null ? "n/a" : `${d.evRevenue.toFixed(1)}x`)],
    ["Sector", (d) => d.sector],
    ["Status", (d) => d.status],
    ["Announced", (d) => formatDateLong(d.announcedDate)],
    ["Consideration", (d) => considerationLabel(d.consideration)],
    ["Acquirer advisor", (d) => d.acquirerAdvisors.join(", ") || "n/a"],
    ["Target advisor", (d) => d.targetAdvisors.join(", ") || "n/a"],
  ];
  return (
    <>
      <div className="table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th>TERMS</th>
              {deals.map((d) => (
                <th key={d.id}>{d.target.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map(([label, fn]) => (
              <tr key={label}>
                <td>{label}</td>
                {deals.map((d) => (
                  <td key={d.id}>{fn(d)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            downloadCsv(dealsToCsv(deals, isSample), `Castle_Comparison${isSample ? "_Sample" : ""}.csv`);
            toast(`${deals.length} rows exported.`);
          }}
        >
          <Icon name="download" />
          Export comparison data
        </button>
      </div>
    </>
  );
}

function WatchlistBody() {
  const { data } = useHubData();
  const { prefs } = useWorkspace();
  const { openDeal, openIpo } = useDetails();
  const entries = prefs.watch
    .map((key) => {
      const [kind, ...rest] = key.split(":");
      const id = rest.join(":");
      const r = kind === "deal" ? data.deals.find((d) => d.id === id) : data.ipos.find((i) => i.id === id);
      return r ? { kind: kind as RecordKind, r } : null;
    })
    .filter((e): e is { kind: RecordKind; r: Deal | Ipo } => !!e);
  if (!entries.length) return <p>No saved companies yet. Use the star beside a transaction or IPO, or in its details.</p>;
  return (
    <>
      {entries.map(({ kind, r }) => (
        <div key={`${kind}:${r.id}`} className="saved-entry">
          <button type="button" onClick={() => (kind === "deal" ? openDeal(r as Deal) : openIpo(r as Ipo))}>
            {kind === "deal" ? (r as Deal).target.name : (r as Ipo).company.name}
            <small>
              {kind === "deal" ? "M&A" : "IPO"} · {r.sector} · {kind === "deal" ? formatUsd((r as Deal).valueUsd) : formatRaise((r as Ipo).expectedRaiseUsd)}
            </small>
          </button>
          <WatchButton kind={kind} id={r.id} label={kind === "deal" ? (r as Deal).target.name : (r as Ipo).company.name} />
        </div>
      ))}
    </>
  );
}

function SaveViewBody({ screen, onSaved }: { screen: DealScreen; onSaved: (index: number) => void }) {
  const { saveView, storageOk } = useWorkspace();
  const { closeDialog, toast } = useUi();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    if (!name.trim()) return setError("Enter a view name.");
    const index = saveView(name.trim(), screen);
    closeDialog();
    onSaved(index);
    toast(storageOk ? "View saved." : "View saved for this session.");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p>Keep the current deal filters and sort order.</p>
      <label className="sr-only" htmlFor="saved-view-name">
        View name
      </label>
      <input className="plain-field" id="saved-view-name" maxLength={35} placeholder="e.g. Healthcare · $1B+" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="field-error" role="alert">
        {error}
      </div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={closeDialog}>
          Cancel
        </button>
        <button type="submit" className="button">
          Save view
        </button>
      </div>
    </form>
  );
}

function ManageViewsBody({ onApply }: { onApply: (index: number) => void }) {
  const { prefs, deleteView } = useWorkspace();
  if (!prefs.views.length) return <p>No saved views yet. Set your deal filters, then choose Save view.</p>;
  return (
    <>
      {prefs.views.map((v, i) => (
        <div key={`${v.name}-${i}`} className="saved-entry">
          <button type="button" onClick={() => onApply(i)}>
            {v.name}
            <small>Deal Flow</small>
          </button>
          <button type="button" className="row-icon" aria-label={`Delete ${v.name}`} onClick={() => deleteView(i)}>
            <Icon name="trash" />
          </button>
        </div>
      ))}
    </>
  );
}

function Shortcuts() {
  const rows: [string, string][] = [
    ["Ctrl K / ⌘ K", "Search companies, transactions and banks."],
    ["Alt 1–8", "Open a sidebar section."],
    ["Enter", "Open a focused table row or search result."],
    ["Escape", "Close details, menus or search."],
    ["Right-click a deal or IPO", "Open its actions menu."],
    ["?", "Show this list."],
  ];
  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k} className="definition">
          <strong>{k}</strong>
          <p>{v}</p>
        </div>
      ))}
    </>
  );
}

export function useWorkspaceDialogs() {
  const { openDialog, toast } = useUi();
  const { data } = useHubData();
  const { selected } = useWorkspace();

  return {
    openCompare: (onDone?: () => void) => {
      const deals = data.deals.filter((d) => selected.has(d.id));
      if (deals.length < 2 || deals.length > 4) {
        toast("Select 2–4 transactions to compare.");
        return;
      }
      openDialog({ variant: "wide", eyebrow: "Deal comparison", title: `${deals.length} transactions`, body: <CompareBody deals={deals} isSample={data.isSample} /> });
      onDone?.();
    },
    openWatchlist: () => openDialog({ eyebrow: "Watchlist", title: "Following", body: <WatchlistBody /> }),
    openSaveView: (screen: DealScreen, onSaved: (index: number) => void) =>
      openDialog({ eyebrow: "Saved view", title: "Save this screen", body: <SaveViewBody screen={screen} onSaved={onSaved} /> }),
    openManageViews: (onApply: (index: number) => void) => openDialog({ eyebrow: "Saved views", title: "Your screens", body: <ManageViewsBody onApply={onApply} /> }),
    openShortcuts: () => openDialog({ eyebrow: "Keyboard", title: "Shortcuts", body: <Shortcuts /> }),
  };
}
