"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A slim bar across the top of the window from the moment an internal link is clicked until the new page is
 * shown: instant feedback that the click registered. It eases toward the end while waiting (never reaching it),
 * then completes and fades.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const startedAt = useRef(pathname);

  useEffect(() => {
    const stop = () => clearInterval(timer.current);
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      stop();
      startedAt.current = window.location.pathname;
      setProgress(0.12);
      // Trickle: each step covers a little of what's left, so the bar slows as it nears the end.
      timer.current = setInterval(() => setProgress((p) => (p == null ? p : p + (0.9 - p) * 0.09)), 180);
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

  // Never hang around: a navigation that doesn't happen (blocked, offline) clears after 12 seconds.
  useEffect(() => {
    if (progress == null || progress === 1) return;
    const giveUp = setTimeout(() => (clearInterval(timer.current), setProgress(null)), 12_000);
    return () => clearTimeout(giveUp);
  }, [progress == null, progress === 1]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`nav-progress ${progress == null ? "" : progress === 1 ? "done" : "on"}`} aria-hidden="true">
      <i style={{ transform: `scaleX(${progress ?? 0})` }} />
    </div>
  );
}
