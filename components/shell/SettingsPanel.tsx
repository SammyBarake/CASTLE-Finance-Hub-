"use client";

import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { reportIssueUrl } from "@/lib/site";

/**
 * The settings panel the sidebar's Settings item opens: the display options the top bar's menu also holds, plus the
 * workspace and help screens, each one line with its control on the right. It reads the workspace live, so a change
 * shows at once.
 */
export function SettingsPanel({
  onManageViews,
  onWatchlist,
  onShortcuts,
  onDefinitions,
}: {
  onManageViews: () => void;
  onWatchlist: () => void;
  onShortcuts: () => void;
  onDefinitions: () => void;
}) {
  const ws = useWorkspace();
  const views = ws.prefs.views.length;
  const watched = ws.prefs.watch.length;
  return (
    <div className="settings-panel">
      <section>
        <h3>Display</h3>
        <div className="settings-row">
          <div>
            <strong>Table density</strong>
            <p>Compact fits more rows on a screen.</p>
          </div>
          <div className="segmented" role="group" aria-label="Table density">
            {(["comfortable", "compact"] as const).map((d) => (
              <button key={d} type="button" className={ws.prefs.density === d ? "active" : ""} aria-pressed={ws.prefs.density === d} onClick={() => ws.setDensity(d)}>
                {d === "comfortable" ? "Comfortable" : "Compact"}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Interface animations</strong>
            <p>Figures counting up, charts growing in, sections rising.</p>
          </div>
          <div className="segmented" role="group" aria-label="Interface animations">
            {[true, false].map((on) => (
              <button key={String(on)} type="button" className={ws.prefs.motion === on ? "active" : ""} aria-pressed={ws.prefs.motion === on} onClick={() => ws.setMotion(on)}>
                {on ? "On" : "Off"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3>Workspace</h3>
        <div className="settings-row">
          <div>
            <strong>Saved views</strong>
            <p>{views ? `${views} saved Deal Flow screen${views === 1 ? "" : "s"}.` : "Deal Flow screens you save appear here."}</p>
          </div>
          <button type="button" className="button" onClick={onManageViews}>
            Manage
          </button>
        </div>
        <div className="settings-row">
          <div>
            <strong>Watchlist</strong>
            <p>{watched ? `Following ${watched} deal${watched === 1 ? "" : "s"} or IPO${watched === 1 ? "" : "s"}.` : "Star a deal or IPO to follow it."}</p>
          </div>
          <button type="button" className="button" onClick={onWatchlist}>
            Open
          </button>
        </div>
      </section>

      <section>
        <h3>Help</h3>
        <div className="settings-row">
          <div>
            <strong>Data definitions</strong>
            <p>What every figure means and how it is calculated.</p>
          </div>
          <button type="button" className="button" onClick={onDefinitions}>
            Open
          </button>
        </div>
        <div className="settings-row settings-desktop">
          <div>
            <strong>Keyboard shortcuts</strong>
            <p>Search, sections and records from the keyboard.</p>
          </div>
          <button type="button" className="button" onClick={onShortcuts}>
            View
          </button>
        </div>
        <div className="settings-row">
          <div>
            <strong>Report a data issue</strong>
            <p>A wrong figure or a missing deal.</p>
          </div>
          <a className="button" href={reportIssueUrl()} target="_blank" rel="noreferrer">
            Report
          </a>
        </div>
      </section>
    </div>
  );
}
