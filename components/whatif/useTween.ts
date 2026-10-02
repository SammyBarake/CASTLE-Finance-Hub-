"use client";

import { useEffect, useRef, useState } from "react";

const reduced = () =>
  typeof window === "undefined" || document.documentElement.classList.contains("reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Numbers that glide to new values instead of jumping (through zero too, unlike AnimatedNumber, which counts within one
 * sign and unit). The first render shows the values as they are; every later change eases over `duration` ms from
 * whatever is on screen, so an interrupted move carries on smoothly. Reduced motion shows new values at once.
 */
export function useTween(target: number[], duration = 560): number[] {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const key = target.join("|");

  useEffect(() => {
    const from = current.current;
    const to = key ? key.split("|").map(Number) : [];
    if (reduced() || from.length !== to.length) {
      current.current = to;
      const frame = requestAnimationFrame(() => setShown(to));
      return () => cancelAnimationFrame(frame);
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const k = easeOut(t);
      const next = to.map((v, i) => from[i] + (v - from[i]) * k);
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, duration]);

  return shown;
}
