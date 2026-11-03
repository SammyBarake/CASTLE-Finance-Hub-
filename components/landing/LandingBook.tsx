"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/*
 * The landing page's binding, with no markup of its own: one-shot reveals, the sticky stack's safety rules, and the
 * contents page's exhibit. Everything it does is progressive: without it the page is complete and simply doesn't move.
 *
 * Why the rules: a sticky leaf taller than the screen would lose its bottom under top: 0, so a tall leaf sticks only once
 * its end is on screen (--stick). A link in a leaf that's already covered can't scroll into view by itself, since the
 * browser thinks a stuck element is already visible, so focus there scrolls back to that leaf.
 */

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const MOTION_CLASSES = ["lx", "lx-go", "lx-again"];

export function LandingBook() {
  // Which motion classes this visit has (StrictMode re-runs the effect, and a re-run mustn't count as a second visit).
  const had = useRef<string[] | null>(null);

  // Before paint. A full load has its classes from the root layout's script; a soft navigation here gets them now.
  useIsoLayoutEffect(() => {
    const c = document.documentElement.classList;
    if (had.current) had.current.forEach((x) => c.add(x));
    else {
      const reduced = c.contains("reduce-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (c.contains("lx-boot")) {
        c.remove("lx-boot");
        if (reduced) MOTION_CLASSES.forEach((x) => c.remove(x));
      } else if (!reduced) {
        c.add("lx", "lx-go");
        try {
          if (sessionStorage.getItem("lx-seen")) c.add("lx-again");
          else sessionStorage.setItem("lx-seen", "1");
        } catch {}
      }
      had.current = MOTION_CLASSES.filter((x) => c.contains(x));
    }
    return () => {
      [...MOTION_CLASSES, "lx-ok"].forEach((x) => c.remove(x));
      // Next resets the scroll only when the new page's top is off screen. The short loading page clamps a deep scroll
      // to a small one, its top is then "on screen", and the visitor lands part-way down the page (the page's own Back
      // position was saved by the router before this runs). Runs before Next's check, in the same commit.
      window.scrollTo({ top: 0, behavior: "instant" });
    };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const root = document.querySelector<HTMLElement>(".landing");
    if (!root) return;
    html.classList.add("lx-ok"); // the head script's 6 s safety stands down: this script is running
    const cleanups: (() => void)[] = [];

    // One-shot reveals.
    const settling: number[] = [];
    cleanups.push(() => settling.forEach(clearTimeout));
    if (html.classList.contains("lx")) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            if (e.isIntersecting) {
              const el = e.target;
              el.classList.add("in");
              io.unobserve(el);
              // Reveal timing ends with the reveal, so hovers answer at once afterwards.
              settling.push(window.setTimeout(() => el.classList.add("settled"), 2600));
            }
        },
        // On one column a block can be very tall: a share of it would leave a heading over an empty panel for a long way.
        { threshold: matchMedia("(max-width: 1020px)").matches ? 0.01 : 0.18, rootMargin: "0px 0px -6% 0px" },
      );
      root.querySelectorAll("[data-r]").forEach((el) => io.observe(el));
      cleanups.push(() => io.disconnect());
    }

    const leaves = [...root.querySelectorAll<HTMLElement>(".lx-leaf")];
    const stacked = matchMedia("(min-width: 1021px) and (min-height: 700px)");

    // A leaf taller than the screen sticks only when its end arrives.
    const measure = () => {
      for (const leaf of leaves) {
        const over = stacked.matches ? leaf.offsetHeight - window.innerHeight : 0;
        leaf.style.setProperty("--stick", over > 1 ? `${-over}px` : "0px");
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    leaves.forEach((l) => ro.observe(l));
    window.addEventListener("resize", measure, { passive: true });
    cleanups.push(() => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    });

    // Which leaf is on top: a covered leaf's animations rest, and the fixed button and fore-edge follow along.
    const sentinels = [...root.querySelectorAll<HTMLElement>(".lx-sentinel")];
    const edge = [...root.querySelectorAll<HTMLElement>(".lx-fore a")];
    // Only the reader's own scrolling clears a hash, never the browser's jump to it on load.
    let reading = false;
    const startReading = () => {
      reading = true;
    };
    const READING = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    READING.forEach((n) => window.addEventListener(n, startReading, { passive: true, once: true }));
    cleanups.push(() => READING.forEach((n) => window.removeEventListener(n, startReading)));
    const syncTop = () => {
      const mid = window.innerHeight * 0.5;
      let top = 0;
      sentinels.forEach((s, i) => {
        if (s.getBoundingClientRect().top <= mid) top = i;
      });
      leaves.forEach((l, i) => l.classList.toggle("covered", sentinels[i + 1]?.getBoundingClientRect().top <= 0));
      edge.forEach((a, i) => (i === top ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
      // A hash the reader has scrolled away from would pull Back and Reload to that leaf, not the one they left.
      if (reading && location.hash && sentinels.findIndex((s) => `#${s.id}` === location.hash) !== top) window.history.replaceState(window.history.state, "", location.pathname + location.search);
      root.dataset.top = String(top);
      root.dataset.last = top === leaves.length - 1 ? "1" : "0";
      // The fixed button's colours follow the leaf under the button itself, near the top of the window.
      let under = 0;
      sentinels.forEach((s, i) => {
        if (s.getBoundingClientRect().top <= 48) under = i;
      });
      root.dataset.paper = leaves[under]?.classList.contains("paper") ? "1" : "0";
    };
    let queued = 0;
    const onScroll = () => {
      if (!queued)
        queued = requestAnimationFrame(() => {
          queued = 0;
          syncTop();
        });
    };
    syncTop();
    window.addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => {
      cancelAnimationFrame(queued);
      window.removeEventListener("scroll", onScroll);
    });

    // Keyboard focus: the browser scrolls a stuck element by its place in the flow, which can leave it under the next
    // leaf or under a sheet still sliding in. Settle on the focused link's own leaf (never for a mouse click, which
    // must not move the page under the pointer).
    const onFocus = (e: FocusEvent) => {
      if (!stacked.matches || html.dataset.input !== "keyboard") return;
      const leaf = (e.target as HTMLElement).closest?.<HTMLElement>(".lx-leaf");
      const i = leaf ? leaves.indexOf(leaf) : -1;
      if (i < 0) return;
      requestAnimationFrame(() => {
        const start = sentinels[i].getBoundingClientRect().top + window.scrollY;
        const end = start + Math.max(0, leaf!.offsetHeight - window.innerHeight);
        if (window.scrollY < start || window.scrollY > end) window.scrollTo({ top: window.scrollY < start ? start : end, behavior: "instant" });
      });
    };
    root.addEventListener("focusin", onFocus);
    cleanups.push(() => root.removeEventListener("focusin", onFocus));

    // The contents page: the row under the pointer or focus brings up its exhibit, and the last one stays.
    const contents = root.querySelector<HTMLElement>(".lx-contents");
    if (contents) {
      const rowOf = (e: Event) => {
        const row = (e.target as HTMLElement).closest?.<HTMLElement>(".lx-row[data-s]");
        return row && contents.querySelector(`.lx-exhibit[data-s="${row.dataset.s}"]`) ? row : null;
      };
      // A short wait, so a pointer on its way across the rows to an exhibit's link doesn't flip the exhibit under it.
      let intent = 0;
      const pick = (e: Event) => {
        clearTimeout(intent);
        const row = rowOf(e);
        if (!row) return;
        intent = window.setTimeout(() => {
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused.closest(".lx-exhibit")) focused.blur();
          contents.dataset.active = row.dataset.s;
        }, 120);
      };
      const leaveRows = () => clearTimeout(intent);
      // Tabbing into an exhibit's own link keeps that exhibit up.
      const pickFocus = (e: Event) => {
        clearTimeout(intent);
        const row = rowOf(e);
        if (row) contents.dataset.active = row.dataset.s;
        const exhibit = (e.target as HTMLElement).closest?.<HTMLElement>(".lx-exhibit");
        if (exhibit?.dataset.s) contents.dataset.active = exhibit.dataset.s;
      };
      const rows = contents.querySelector(".lx-rows");
      contents.addEventListener("pointerover", pick);
      rows?.addEventListener("pointerleave", leaveRows);
      contents.addEventListener("focusin", pickFocus);
      cleanups.push(() => {
        clearTimeout(intent);
        contents.removeEventListener("pointerover", pick);
        rows?.removeEventListener("pointerleave", leaveRows);
        contents.removeEventListener("focusin", pickFocus);
      });
    }

    // Opening the terminal: the page dissolves into the terminal's black instead of cutting (never for a new tab).
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest?.<HTMLAnchorElement>("a[href='/hub']");
      if (!link || !html.classList.contains("lx") || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button || e.defaultPrevented) return;
      root.classList.add("lx-leaving");
      // It stays black until the route changes, with a hairline showing it's on the way; only a navigation that plainly
      // failed brings the page back. Back from another site restores it as it was.
      clearTimeout(leaving);
      leaving = window.setTimeout(() => root.classList.remove("lx-leaving"), 12_000);
    };
    let leaving = 0;
    const onPageShow = () => root.classList.remove("lx-leaving");
    root.addEventListener("click", onClick);
    window.addEventListener("pageshow", onPageShow);
    cleanups.push(() => {
      clearTimeout(leaving);
      root.removeEventListener("click", onClick);
      window.removeEventListener("pageshow", onPageShow);
    });

    // The fore-edge: a plain hash link would make a history entry the router doesn't own, and Back from any page reached
    // after it would change the address and leave the other page on screen. So it scrolls and nothing else: the address
    // stays, since Back and Reload would then go to that leaf, not the one the reader had moved on to.
    const fore = root.querySelector<HTMLElement>(".lx-fore");
    const onFore = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
      const link = (e.target as HTMLElement).closest?.<HTMLAnchorElement>("a[href^='#']");
      const to = link && document.getElementById(link.hash.slice(1));
      if (!to) return;
      e.preventDefault();
      // Enter on a hairline (a click with no pointer): the next Tab starts in the leaf it asked for.
      const keyboard = e.detail === 0;
      window.scrollTo({ top: to.getBoundingClientRect().top + window.scrollY, behavior: html.classList.contains("lx") && !keyboard ? "smooth" : "instant" });
      const leaf = to.nextElementSibling;
      if (keyboard && leaf instanceof HTMLElement) {
        leaf.tabIndex = -1;
        leaf.focus({ preventScroll: true });
        leaf.addEventListener("blur", () => leaf.removeAttribute("tabindex"), { once: true });
      }
    };
    fore?.addEventListener("click", onFore);
    cleanups.push(() => fore?.removeEventListener("click", onFore));

    // Long idle: the plate's slow movements rest until someone moves again, so the GPU isn't busy for nobody.
    let idle = 0;
    const wake = () => {
      root.classList.remove("lx-idle");
      clearTimeout(idle);
      idle = window.setTimeout(() => root.classList.add("lx-idle"), 60_000);
    };
    wake();
    const wakeEvents = ["pointermove", "scroll", "keydown"] as const;
    wakeEvents.forEach((n) => window.addEventListener(n, wake, { passive: true }));
    cleanups.push(() => {
      clearTimeout(idle);
      wakeEvents.forEach((n) => window.removeEventListener(n, wake));
    });

    // A weak GPU or a remote desktop: when the first scroll stutters, drop to plain sheets sliding over each other.
    if (html.classList.contains("lx") && stacked.matches) {
      let frames: number[] = [];
      let last = 0;
      let raf = 0;
      let startedAt = 0;
      const sample = (t: number) => {
        if (last) frames.push(t - last);
        last = t;
        if (t - startedAt < 1500) raf = requestAnimationFrame(sample);
        else {
          const slow = frames.filter((f) => f > 50).length;
          if (slow >= 3 && slow / frames.length > 0.15) root.classList.add("lx-lite");
          frames = [];
        }
      };
      const first = () => {
        if (document.visibilityState !== "visible") return;
        window.removeEventListener("scroll", first);
        startedAt = performance.now();
        raf = requestAnimationFrame(sample);
      };
      window.addEventListener("scroll", first, { passive: true });
      cleanups.push(() => {
        cancelAnimationFrame(raf);
        window.removeEventListener("scroll", first);
      });
    }

    return () => cleanups.forEach((c) => c());
  }, []);

  return null;
}
