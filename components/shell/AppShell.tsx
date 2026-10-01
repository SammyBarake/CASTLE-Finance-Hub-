"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/components/ui/UiProvider";
import { useWorkspaceDialogs } from "@/components/workspace/actions";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { formatTimestampET } from "@/lib/format";
import { GlobalSearch } from "./GlobalSearch";
import { ROUTES, routeForPath } from "./routes";

/** Sidebar, top bar and footer around every page. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data } = useHubData();
  const { openDefinitions } = useDetails();
  const { toast, openMenu } = useUi();
  const ws = useWorkspace();
  const { openWatchlist, openShortcuts, openManageViews } = useWorkspaceDialogs();

  const applyViewFromAnywhere = (index: number) => {
    document.querySelector<HTMLDialogElement>("dialog[open]")?.close();
    ws.setPendingView(index);
    if (pathname !== "/deal-flow") router.push("/deal-flow");
  };

  const openSettings = (anchor: HTMLElement) =>
    openMenu(
      [
        { kind: "title", label: "Table density" },
        { kind: "action", label: `${ws.prefs.density === "comfortable" ? "✓" : "○"} Comfortable`, onSelect: () => ws.setDensity("comfortable") },
        { kind: "action", label: `${ws.prefs.density === "compact" ? "✓" : "○"} Compact`, onSelect: () => ws.setDensity("compact") },
        { kind: "rule" },
        { kind: "check", label: "Interface animations", checked: ws.prefs.motion, onToggle: (on) => ws.setMotion(on) },
        { kind: "rule" },
        { kind: "action", label: "Keyboard shortcuts", shortcut: "?", onSelect: openShortcuts },
        { kind: "action", label: "Manage saved views", onSelect: () => openManageViews(applyViewFromAnywhere) },
      ],
      { anchor },
    );
  const pathname = usePathname();
  const router = useRouter();
  const route = routeForPath(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const shortcutsRef = useRef(openShortcuts);
  useEffect(() => {
    shortcutsRef.current = openShortcuts;
  });

  // Close the mobile menu on navigation; move focus to the page title for screen readers.
  useEffect(() => {
    setMenuOpen(false); // eslint-disable-line react-hooks/set-state-in-effect -- sync with navigation
    document.getElementById("page-title")?.focus({ preventScroll: true });
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
      const typing = (e.target as HTMLElement)?.matches?.("input, textarea, select, [contenteditable]");
      if (e.key === "?" && !typing) {
        e.preventDefault();
        shortcutsRef.current();
      }
      // Alt+1…9 jumps between sections.
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        document.querySelector<HTMLDialogElement>("dialog[open]")?.close();
        router.push(ROUTES[Number(e.key) - 1].href);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <>
      <div className={`menu-backdrop ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar ${menuOpen ? "open" : ""}`} id="sidebar" aria-label="Primary navigation">
        <Link className="brand" href="/" aria-label="Castle home">
          <Image src="/castle-logo.webp" alt="Castle" width={400} height={400} priority />
        </Link>
        <nav className="nav">
          {ROUTES.map((r, i) => {
            const active = r.id === route.id;
            const content = (
              <>
                <Icon name={r.icon} />
                {r.title}
                {r.id === "deal-flow" && <span className="nav-count">{data.totalDeals.toLocaleString("en-US")}</span>}
                {r.soon && <span className="nav-count">SOON</span>}
              </>
            );
            return (
              <div key={r.id} style={{ display: "contents" }}>
                {r.group !== ROUTES[i - 1]?.group && <div className="nav-group">{r.group}</div>}
                {r.soon ? (
                  <button type="button" className="nav-link" style={{ opacity: 0.6 }} onClick={() => toast(`${r.title} is coming soon.`)}>
                    {content}
                  </button>
                ) : (
                  <Link className={`nav-link ${active ? "active" : ""}`} href={r.href} aria-current={active ? "page" : undefined} title={`${r.title} · Alt ${i + 1}`}>
                    {content}
                  </Link>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <button type="button" onClick={openDefinitions}>
            <Icon name="file" />
            Data definitions
          </button>
          <button type="button" onClick={openShortcuts}>
            <Icon name="info" />
            Shortcuts <kbd style={{ marginLeft: "auto" }}>?</kbd>
          </button>
        </div>
      </aside>

      <div className="shell">
        <header className="topbar">
          <button type="button" className="menu-toggle" aria-label="Open navigation" aria-controls="sidebar" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <Icon name="menu" />
          </button>
          <div className="top-location">
            <span>Castle</span>
            <Icon name="chevron" />
            <strong>{route.title}</strong>
          </div>
          <div className="top-tools">
            <GlobalSearch />
            {!data.dataError && !data.isSample && (
              <div className="live-status" title={`SEC EDGAR data, last refreshed ${formatTimestampET(data.asOf)}. Open pages update on their own.`}>
                <i aria-hidden="true" />
                Live<span>{formatTimestampET(data.asOf)}</span>
              </div>
            )}
            {data.isSample && <span className="sample-label sample-tag">Sample data</span>}
            <button type="button" className="tool-icon wide" aria-label={`Open watchlist (${ws.prefs.watch.length})`} title="Watchlist" onClick={openWatchlist}>
              <Icon name="star" className={ws.prefs.watch.length ? "star-fill" : ""} />
              <span className="watch-count">{ws.prefs.watch.length}</span>
            </button>
            <button type="button" className="tool-icon" aria-label="Display options" title="Display options" onClick={(e) => openSettings(e.currentTarget)}>
              <Icon name="settings" />
            </button>
          </div>
        </header>
        <main className="main" id="main">
          {data.dataError && (
            <div className="data-error" role="alert">
              <strong>Live data is unavailable right now.</strong> The site could not reach its database: {data.dataError}. No numbers are shown until it
              reconnects.
            </div>
          )}
          <div className="page-enter" key={pathname}>
            {children}
          </div>
        </main>
        <footer className="footer">
          <span className="sample-tag">
            {data.isSample
              ? "Sample data (local development) · Fictional transactions and rankings"
              : "SEC EDGAR · Refreshed every few hours · Not investment advice"}
          </span>
          <button type="button" onClick={openDefinitions}>
            Data definitions
          </button>
        </footer>
      </div>
    </>
  );
}
