"use client";

import "./globals.css";
import { StatusPage } from "@/components/shell/StatusPage";

/** The last resort: the root layout itself failed, so this page brings its own document and styles. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · Castle</title>
        <StatusPage
          code="ERROR"
          title="Castle is having trouble"
          actions={
            <>
              <button type="button" className="button primary" onClick={() => retry()}>
                Try again
              </button>
              {/* A full page load, not a client navigation: the app around this page failed. */}
              <button type="button" className="button" onClick={() => window.location.assign(window.location.origin)}>
                Reload Castle
              </button>
            </>
          }
        >
          <p>Something went wrong before the page could load. Please try again in a moment.</p>
          {error.digest && (
            <p>
              <code>Reference {error.digest}</code>
            </p>
          )}
        </StatusPage>
      </body>
    </html>
  );
}
