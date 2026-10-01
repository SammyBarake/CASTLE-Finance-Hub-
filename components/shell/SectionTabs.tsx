"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import type { RouteId, SectionDef } from "./routes";

/**
 * The pages of a section as tabs above the page. The bar stays put while the page below changes, and the
 * underline slides from the old tab to the new one.
 */
export function SectionTabs({ section, activeId }: { section: SectionDef; activeId: string }) {
  const barRef = useRef<HTMLElement>(null);
  const tabRefs = useRef(new Map<RouteId, HTMLAnchorElement>());
  const [mark, setMark] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = tabRefs.current.get(activeId as RouteId);
      if (el) setMark({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    // Keep the active tab in view on narrow screens where the bar scrolls.
    tabRefs.current.get(activeId as RouteId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeId, section.id]);

  return (
    <nav ref={barRef} className="section-tabs" aria-label={`${section.title} pages`}>
      {section.routes.map((r) => (
        <Link
          key={r.id}
          ref={(el) => {
            if (el) tabRefs.current.set(r.id, el);
            else tabRefs.current.delete(r.id);
          }}
          href={r.href}
          className={`section-tab ${r.id === activeId ? "active" : ""}`}
          aria-current={r.id === activeId ? "page" : undefined}
        >
          {r.tab}
        </Link>
      ))}
      {mark && <span className="section-tab-mark" style={{ transform: `translateX(${mark.x}px)`, width: mark.w }} aria-hidden="true" />}
    </nav>
  );
}
