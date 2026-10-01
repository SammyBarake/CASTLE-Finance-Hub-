"use client";

import { useEffect, useRef, useState } from "react";
import { isLiveUpdate } from "@/components/data/HubDataProvider";

/** "$2.92T" -> { prefix "$", number 2.92, decimals 2, suffix "T" }; null when the text holds no single number. */
function split(text: string) {
  const m = /^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(\D*)$/.exec(text.trim());
  if (!m) return null;
  const digits = m[2].replace(/,/g, "");
  return { prefix: m[1], value: Number(digits), decimals: digits.split(".")[1]?.length ?? 0, commas: m[2].includes(","), suffix: m[3] };
}

const render = (p: NonNullable<ReturnType<typeof split>>, v: number) =>
  p.prefix + (p.commas ? v.toLocaleString("en-US", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals }) : v.toFixed(p.decimals)) + p.suffix;

const reduced = () =>
  document.documentElement.classList.contains("reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Figures count up from zero when a page opens inside the running app. On the very first load the server-rendered
// value is shown as is: counting would first flash the real number, then zero.
let hydrated = false;

/**
 * Shows a formatted figure; when it changes (a page opening, a filter, new data arriving in the background) it
 * counts from the old value to the new one instead of jumping. When the change came from a live data update the
 * figure also tints green (up) or red (down) while it moves. Unit changes ("$950B" -> "$1.02T") and reduced
 * motion show the new text directly.
 */
export function AnimatedNumber({ text }: { text: string }) {
  const [initial] = useState(() => {
    const p = typeof window !== "undefined" && hydrated && !reduced() ? split(text) : null;
    return p ? render(p, 0) : text;
  });
  const [shown, setShown] = useState(initial);
  const [tick, setTick] = useState<"up" | "down" | null>(null);
  // What is on screen right now, so an interrupted count continues from there.
  const onScreen = useRef(initial);

  useEffect(() => {
    hydrated = true;
  }, []);

  useEffect(() => {
    const show = (s: string) => {
      onScreen.current = s;
      setShown(s);
    };
    const a = split(onScreen.current);
    const b = split(text);
    if (!a || !b || a.prefix !== b.prefix || a.suffix !== b.suffix || a.value === b.value || reduced()) {
      show(text);
      return;
    }
    const live = a.value !== 0 && isLiveUpdate();
    if (live) setTick(b.value > a.value ? "up" : "down");
    const start = performance.now();
    const duration = live ? 1200 : a.value === 0 ? 800 : 900;
    let frame = 0;
    const step = (now: number) => {
      // A frame's timestamp can precede `start`: clamp, or the first frame would move the wrong way.
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      show(t < 1 ? render(b, a.value + (b.value - a.value) * eased) : text);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // Background tabs get no animation frames: land on the true value regardless.
    const settle = setTimeout(() => {
      cancelAnimationFrame(frame);
      show(text);
    }, duration + 150);
    const untint = live ? setTimeout(() => setTick(null), duration + 900) : undefined;
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      clearTimeout(untint);
    };
  }, [text]);

  return tick ? <span className={`num-tick ${tick}`}>{shown}</span> : <>{shown}</>;
}
