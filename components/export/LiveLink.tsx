"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/components/ui/UiProvider";

/** A page's live data link: the CSV path with the page's filters, and anything the link leaves out. */
export interface LiveLinkSpec {
  path: string;
  note?: string;
}

function CopyField({ value, label, copyLabel }: { value: string; label: string; copyLabel: string }) {
  const { toast } = useUi();
  const [copied, setCopied] = useState(false);
  return (
    <div className="share-link-row">
      <input className="share-input" readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            toast("Couldn't copy: select the text and copy it.");
          }
        }}
      >
        <Icon name={copied ? "check" : "copy"} />
        {copied ? "Copied" : copyLabel}
      </button>
    </div>
  );
}

/**
 * How to keep a spreadsheet in step with a Castle table: the link itself, the Excel steps (Power Query's From Web),
 * and the Google Sheets formula.
 */
export function LiveLinkBody({ spec }: { spec: LiveLinkSpec }) {
  const url = `${window.location.origin}${spec.path}`;
  return (
    <div className="account-panel live-panel">
      <p className="account-lead">A link to this table that always returns Castle&apos;s latest data. Set it up once, then refresh whenever you like.</p>
      <CopyField value={url} label="Live data link" copyLabel="Copy link" />
      <div className="live-apps">
        <section>
          <h3>Excel</h3>
          <ol>
            <li>
              <b>Data</b> → <b>From Web</b> (or Get Data → From Other Sources → From Web).
            </li>
            <li>Paste the link, choose OK, then Load.</li>
            <li>
              To update: <b>Data</b> → <b>Refresh All</b>. In the query&apos;s properties it can also refresh every hour, or each time the file opens.
            </li>
          </ol>
        </section>
        <section>
          <h3>Google Sheets</h3>
          <p>Paste this formula into a cell (Sheets may ask you to allow access once):</p>
          <CopyField value={`=IMPORTDATA("${url}")`} label="Google Sheets formula" copyLabel="Copy formula" />
          <p className="account-fine">Sheets refreshes it about every hour.</p>
        </section>
      </div>
      {spec.note && <p className="account-fine">{spec.note}</p>}
      <p className="account-fine">Money in $M, premiums in %, multiples as x, dates as dates. Castle updates several times a day from SEC filings.</p>
    </div>
  );
}
