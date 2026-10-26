"use client";

import Link from "next/link";
import { useEffect } from "react";
import { StatusPage } from "@/components/shell/StatusPage";
import { reportIssueUrl } from "@/lib/site";

/** A crash outside a terminal page (tear sheets, or the terminal layout itself). */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    // A client component can't export metadata, and a <title> here would come after the layout's.
    document.title = "Something went wrong · Castle";
  }, [error]);
  return (
    <StatusPage
      code="ERROR"
      title="Something went wrong"
      actions={
        <>
          <button type="button" className="button primary" onClick={() => retry()}>
            Try again
          </button>
          <Link className="button" href="/hub">
            Go to the Hub
          </Link>
          <a className="button" href={reportIssueUrl("Page error on Castle", error.digest ? `Reference: ${error.digest}` : "")} target="_blank" rel="noopener noreferrer">
            Report it
          </a>
        </>
      }
    >
      <p>Castle couldn&apos;t show this page. Trying again usually fixes it; if it keeps happening, let us know.</p>
      {error.digest && (
        <p>
          <code>Reference {error.digest}</code>
        </p>
      )}
    </StatusPage>
  );
}
