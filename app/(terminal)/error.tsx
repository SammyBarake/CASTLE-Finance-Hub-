"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportIssueUrl } from "@/lib/site";

/** A page that crashed inside the terminal: the sidebar and top bar stay, the page area explains and offers a retry. */
export default function TerminalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="panel page-error" role="alert">
      <p className="status-code">ERROR</p>
      <h1 id="page-title" tabIndex={-1}>
        This page hit a problem
      </h1>
      <p>Something went wrong while showing this page. The rest of Castle still works, and trying again usually fixes it.</p>
      {error.digest && (
        <p className="page-error-ref">
          Reference <code>{error.digest}</code>
        </p>
      )}
      <div className="status-actions">
        <button type="button" className="button primary" onClick={() => retry()}>
          Try again
        </button>
        <Link className="button" href="/hub">
          Go to the Hub
        </Link>
        <a className="button" href={reportIssueUrl("Page error on Castle", error.digest ? `Reference: ${error.digest}` : "")} target="_blank" rel="noopener noreferrer">
          Report it
        </a>
      </div>
    </section>
  );
}
