"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A slim bar across the top of the window from the moment an internal link is clicked until the new page is
 * shown: instant feedback that the click registered. It eases toward the end while waiting (never reaching it),
 * then completes and fades.
 *
 * While `hold` is set (the first visit's dataset is still loading) clicks are held and replayed once it arrives.
 * Next.js falls back to a full page reload when several navigations happen in that window, which on a slow
 * connection restarts the download and makes pages seem never to open.
 */
export function NavigationProgress({ hold = false }: { hold?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const startedAt = useRef(pathname);
  const holdRef = useRef(hold);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    holdRef.current = hold;
    // The data arrived: go where the user asked to go.
    if (!hold && pending.current) {
      const href = pending.current;
      pending.current = null;
      // Let the freshly loaded data finish rendering first; navigating in the same instant also trips the
      // router's full-reload fallback.
      const t = setTimeout(() => router.push(href), 250);
      return () => clearTimeout(t);
    }
  }, [hold, router]);

  useEffect(() => {
    const stop = () => clearInterval(timer.current);
    const start = () => {
      stop();
      startedAt.current = window.location.pathname;
      setProgress(0.12);
      // Trickle: each step covers a little of what's left, so the bar slows as it nears the end.
      timer.current = setInterval(() => setProgress((p) => (p == null ? p : p + (0.9 - p) * 0.09)), 180);
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (holdRef.current) {
        // Keep the click away from the router until the data is in; replay it then.
        e.preventDefault();
        e.stopPropagation();
        pending.current = url.pathname + url.search + url.hash;
      }
      start();
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      stop();
    };
  }, []);

  // The new page is on screen: finish and fade.
  useEffect(() => {
    if (pathname === startedAt.current) return;
    clearInterval(timer.current);
    setProgress((p) => (p == null ? p : 1));
    const done = setTimeout(() => setProgress(null), 420);
    return () => clearTimeout(done);
  }, [pathname]);

  // Never hang around: a navigation that doesn't happen (blocked, offline) clears after 30 seconds.
  useEffect(() => {
    if (progress == null || progress === 1) return;
    const giveUp = setTimeout(() => (clearInterval(timer.current), setProgress(null)), 30_000);
    return () => clearTimeout(giveUp);
  }, [progress == null, progress === 1]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`nav-progress ${progress == null ? "" : progress === 1 ? "done" : "on"}`} aria-hidden="true">
      <i style={{ transform: `scaleX(${progress ?? 0})` }} />
    </div>
  );
}
