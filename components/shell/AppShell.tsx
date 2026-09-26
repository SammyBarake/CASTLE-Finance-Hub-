"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useDetails } from "@/components/details/details";
import { useHubData } from "@/components/data/HubDataProvider";
import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/components/ui/UiProvider";
import { formatTimestampET } from "@/lib/format";
import { GlobalSearch } from "./GlobalSearch";
import { ROUTES, routeForPath } from "./routes";

/** Sidebar, top bar and footer around every page. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data } = useHubData();
  const { openDefinitions } = useDetails();
  const { toast } = useUi();
  const pathname = usePathname();
  const router = useRouter();
  const route = routeForPath(pathname);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu on navigation; move focus to the page title for screen readers.
  useEffect(() => {
    setMenuOpen(false); // eslint-disable-line react-hooks/set-state-in-effect -- sync with navigation
    document.getElementById("page-title")?.focus({ preventScroll: true });
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
      // Alt+1…6 jumps between sections.
      if (e.altKey && /^[1-6]$/.test(e.key)) {
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
                {r.id === "deal-flow" && <span className="nav-count">{data.totalDeals}</span>}
                {r.soon && <span className="nav-count">SOON</span>}
              </>
            );
            return (
              <div key={r.id} style={{ display: "contents" }}>
                {r.id === "world-economies" && <div className="sidebar-divider" />}
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
          <button type="button" onClick={() => document.getElementById("global-search")?.focus()}>
            <Icon name="search" />
            Search <kbd style={{ marginLeft: "auto" }}>Ctrl K</kbd>
          </button>
          <div className="sidebar-meta">
            <span>United States</span>
            <span>USD</span>
          </div>
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
            <div className="updated">
              Last updated<span>{formatTimestampET(data.asOf)}</span>
            </div>
            {data.isSample && <span className="sample-label sample-tag">Sample data</span>}
          </div>
        </header>
        <main className="main" id="main">
          <div className="page-enter" key={pathname}>
            {children}
          </div>
        </main>
        <footer className="footer">
          <span className="sample-tag">{data.isSample ? "Sample data · Fictional transactions and rankings" : "SEC EDGAR · Refreshed twice daily · Not investment advice"}</span>
          <button type="button" onClick={openDefinitions}>
            Data definitions
          </button>
        </footer>
      </div>
    </>
  );
}
