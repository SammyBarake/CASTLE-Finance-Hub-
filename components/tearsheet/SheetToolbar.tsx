"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

/** On-screen controls above a tear sheet; hidden when printing. */
export function SheetToolbar({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: nothing to do.
    }
  };
  return (
    <div className="sheet-toolbar">
      <Link className="sheet-back" href={backHref}>
        <Icon name="chevron" />
        {backLabel}
      </Link>
      <div className="sheet-toolbar-actions">
        <span className="sheet-hint">Letter · prints on one page</span>
        <button type="button" className="button" onClick={copy}>
          <Icon name="copy" />
          {copied ? "Link copied" : "Copy link"}
        </button>
        <button type="button" className="button sheet-print" onClick={() => window.print()}>
          <Icon name="print" />
          Print / Save PDF
        </button>
      </div>
    </div>
  );
}
