"use client";

import { useState } from "react";

/** Placeholder shaped like a page while the dataset loads (first visit only); a retry if it fails. */
export function PageSkeleton({ error, onRetry }: { error: string | null; onRetry: () => Promise<unknown> }) {
  const [retrying, setRetrying] = useState(false);
  if (error) {
    return (
      <div className="skeleton-error" role="alert">
        <strong>The data didn&apos;t load.</strong>
        <span>Check your connection and try again. ({error})</span>
        <button
          type="button"
          className="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            await onRetry();
            setRetrying(false);
          }}
        >
          {retrying ? "Loading…" : "Try again"}
        </button>
      </div>
    );
  }
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading data">
      <div className="skeleton-head">
        <i className="sk sk-title" />
        <i className="sk sk-sub" />
      </div>
      <div className="skeleton-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <i className="sk sk-label" />
            <i className="sk sk-value" />
            <i className="sk sk-note" />
          </div>
        ))}
      </div>
      <div className="skeleton-panel">
        <i className="sk sk-label" />
        <div className="skeleton-bars">
          {[42, 58, 35, 70, 48, 82, 55, 64, 38, 74, 50, 60].map((h, i) => (
            <i key={i} className="sk" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      <div className="skeleton-rows">
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className="sk sk-row" />
        ))}
      </div>
    </div>
  );
}
