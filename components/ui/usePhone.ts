"use client";

import { useSyncExternalStore } from "react";

/** The phone layout's breakpoint, the same as the ≤760px block in globals.css. */
export const PHONE_QUERY = "(max-width: 760px)";

const subscribe = (onChange: () => void) => {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

/**
 * True at phone width, kept current as the window resizes. The server and the first (hydrating) render always say
 * false, so the HTML matches; React then re-renders with the real value. For what CSS can't do (chart options drawn
 * on a canvas, a menu's items); everything else stays in the ≤760px CSS block.
 */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
