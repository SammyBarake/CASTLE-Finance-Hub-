"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/components/ui/UiProvider";
import type { WorkbookSpec } from "@/lib/excel/spec";
import { downloadWorkbook } from "./excel";
import { LiveLinkBody, type LiveLinkSpec } from "./LiveLink";

/**
 * The page heading's Export button. With an Excel spec it opens a two-item menu (Excel workbook, CSV); without one it
 * downloads the CSV directly, as before.
 */
export function ExportButton({
  title,
  onCsv,
  excel,
  live,
  label,
}: {
  title: string;
  onCsv?: () => void;
  excel?: () => WorkbookSpec | null;
  /** The page's live data link for Excel / Google Sheets (null: none for what's on screen). */
  live?: () => LiveLinkSpec | null;
  label?: string;
}) {
  const { openMenu, openDialog, toast } = useUi();
  const openLive = () => {
    const spec = live?.();
    if (!spec) return toast("No live link for this view.");
    openDialog({ eyebrow: "Live data link", title: `${title} in Excel or Google Sheets`, body: <LiveLinkBody spec={spec} /> });
  };
  const [busy, setBusy] = useState(false);

  const toExcel = async () => {
    const spec = excel?.();
    if (!spec) return toast("No rows to export.");
    setBusy(true);
    try {
      await downloadWorkbook(spec);
      toast(`Excel workbook downloaded: ${spec.fileName}.xlsx`);
    } catch (err) {
      console.error(err);
      toast("Couldn't build the Excel file. The CSV export still works.");
    } finally {
      setBusy(false);
    }
  };

  if (!excel)
    return (
      <button type="button" className="button" onClick={onCsv} aria-label={label ?? `Export ${title} data as CSV`}>
        <Icon name="download" />
        Export
      </button>
    );
  return (
    <button
      type="button"
      className="button"
      aria-haspopup="menu"
      aria-label={label ?? `Export ${title} data`}
      disabled={busy}
      onClick={(e) =>
        openMenu(
          [
            { kind: "title", label: "Export" },
            { kind: "action", label: "Excel workbook (.xlsx)", icon: "download", onSelect: () => void toExcel() },
            ...(onCsv ? [{ kind: "action" as const, label: "CSV file", onSelect: onCsv }] : []),
            ...(live ? [{ kind: "rule" as const }, { kind: "action" as const, label: "Live link for Excel / Sheets…", icon: "link" as const, onSelect: openLive }] : []),
          ],
          { anchor: e.currentTarget },
        )
      }
    >
      <Icon name="download" />
      {busy ? "Preparing…" : "Export"}
    </button>
  );
}
