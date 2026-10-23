"use client";

import { useEffect, useRef, useState } from "react";
import { useDetails } from "@/components/details/details";
import { Icon } from "@/components/ui/Icon";
import { CompanyLink } from "@/components/ui/CompanyLink";
import { Kpi, Kpis, StatusTag, Takeaways } from "@/components/ui/primitives";
import { bookStats, bookTakeaways, type BookRow } from "@/lib/books";
import { formatDate, formatMultiple, formatPct, formatUsd } from "@/lib/format";
import { dealSize } from "@/lib/precedents";
import type { Deal } from "@/lib/types";

/**
 * A text field that keeps its own draft while you type and saves it a moment after you stop (and on leaving the
 * field), so typing doesn't re-render the whole terminal on every key. Outside edits (a sync from another device)
 * show up when the field isn't being edited.
 */
export function useDraft(value: string, save: (v: string) => void, delay = 400) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!editing.current) setDraft(value); // an outside change (another device) while not typing
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (v: string) => {
    clearTimeout(timer.current);
    if (v !== value) saveRef.current(v);
  };
  return {
    value: draft,
    onChange: (e: { target: { value: string } }) => {
      editing.current = true;
      const v = e.target.value;
      setDraft(v);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => saveRef.current(v), delay);
    },
    onBlur: () => {
      editing.current = false;
      commit(draft);
    },
  };
}

/** The book's figures: KPIs over its live deals, and takeaways against the market. */
export function BookFigures({ rows, all }: { rows: BookRow[]; all: Deal[] }) {
  const s = bookStats(rows);
  const takeaways = bookTakeaways(rows, all);
  const n = (sum: { n: number }) => `${sum.n} of ${s.count} with a figure`;
  return (
    <>
      <Kpis label="Book summary">
        <Kpi label="Deals" value={s.count} note={s.missing ? `${s.missing} no longer in Castle's data` : s.totalValueUsd != null ? `${formatUsd(s.totalValueUsd)} total value` : "No values disclosed"} />
        <Kpi label="Median EV / EBITDA" value={formatMultiple(s.evEbitda.median)} note={s.evEbitda.n ? `${formatMultiple(s.evEbitda.p25)} – ${formatMultiple(s.evEbitda.p75)} middle half · ${n(s.evEbitda)}` : "No multiples disclosed"} />
        <Kpi label="Median EV / Revenue" value={formatMultiple(s.evRevenue.median)} note={s.evRevenue.n ? n(s.evRevenue) : "No multiples disclosed"} />
        <Kpi label="Median premium" value={formatPct(s.premium.median)} note={s.premium.n ? n(s.premium) : "Public targets only"} />
      </Kpis>
      <Takeaways items={takeaways} label="What this book shows" />
    </>
  );
}

function NoteField({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  const draft = useDraft(value, onSave);
  return <input className="book-note-input" aria-label={label} placeholder="Add a comment" maxLength={500} {...draft} />;
}

/** The deals, in the book's order. With `onNote` / `onRemove` the comments are editable and deals removable. */
export function BookTable({ rows, onNote, onRemove }: { rows: BookRow[]; onNote?: (dealId: string, note: string) => void; onRemove?: (dealId: string) => void }) {
  const { openDeal } = useDetails();
  const editable = !!onNote;
  return (
    <div className="table-scroll">
      <table className="book-table">
        <caption className="sr-only">Deals in this book</caption>
        <thead>
          <tr>
            <th scope="col">ANNOUNCED</th>
            <th scope="col">TARGET</th>
            <th scope="col">ACQUIRER</th>
            <th scope="col" className="right">DEAL VALUE</th>
            <th scope="col" className="right">EV / EBITDA</th>
            <th scope="col" className="right">PREMIUM</th>
            <th scope="col">STATUS</th>
            <th scope="col">COMMENT</th>
            {onRemove && (
              <th className="cell-end">
                <span className="sr-only">Remove</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, deal: d }) => (
            <tr key={item.dealId} className={d ? "" : "book-missing"}>
              <td className="table-date">{d ? formatDate(d.announcedDate) : item.date ? formatDate(item.date) : "—"}</td>
              {d ? (
                <>
                  <td className="company book-party" title={d.target.name}>
                    <button type="button" className="book-open" onClick={() => openDeal(d)} aria-label={`Open ${d.acquirer.name} to acquire ${d.target.name}`}>
                      <Icon name="file" />
                    </button>
                    <CompanyLink company={d.target} />
                  </td>
                  <td className="book-party" title={d.acquirer.name}>
                    <CompanyLink company={d.acquirer} />
                  </td>
                  <td className="right table-value">{formatUsd(dealSize(d))}</td>
                  <td className="right mono">{formatMultiple(d.evEbitda)}</td>
                  <td className="right mono">{formatPct(d.premiumPct)}</td>
                  <td>
                    <StatusTag status={d.status} />
                  </td>
                </>
              ) : (
                <>
                  <td colSpan={2}>
                    {item.label || item.dealId}
                    <small className="dim"> · no longer in Castle&apos;s data</small>
                  </td>
                  <td className="right dim">—</td>
                  <td className="right dim">—</td>
                  <td className="right dim">—</td>
                  <td className="dim">—</td>
                </>
              )}
              <td className="book-note">
                {editable ? (
                  <NoteField value={item.note} onSave={(v) => onNote!(item.dealId, v)} label={`Comment on ${item.label || item.dealId}`} />
                ) : item.note ? (
                  item.note
                ) : (
                  <span className="dim">—</span>
                )}
              </td>
              {onRemove && (
                <td className="cell-end">
                  <button type="button" className="row-icon" aria-label={`Remove ${item.label || item.dealId} from the book`} title="Remove from book" onClick={() => onRemove(item.dealId)}>
                    <Icon name="close" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
