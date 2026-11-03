"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { LandingPlate as PlateData } from "@/lib/landing";
import { monthAngle, monthAt, peakLabelFits, PLATE, shortestTurn } from "@/lib/plate";

/*
 * The plate: an image of the real monthly data (lib/plate.ts), a lace layer turning a fraction of a degree over it, a
 * sheet of black with one soft hole that slides across (the light), and two black blades that wipe away to reveal it.
 * Everything that moves is a transform on an element that is already rasterised, so nothing repaints and no script
 * runs per frame at rest. The chart itself never moves off its months.
 */

const src = (version: string, d: "full" | "phone") => `/api/landing/plate.svg?v=${encodeURIComponent(version)}&d=${d}`;
const rosette = (d: "rosette" | "rosette-phone") => `/api/landing/plate.svg?d=${d}`;

/** The plate as a responsive image: the choice follows the layout, not the screen's density (a 3x phone needs the light cut). */
function PlateImage({ version, onImg }: { version: string; onImg?: (img: HTMLImageElement | null) => void }) {
  return (
    <picture>
      <source media="(max-width: 1020px)" srcSet={src(version, "phone")} />
      <img
        className="lx-plate-img"
        src={src(version, "full")}
        alt=""
        width={PLATE.size}
        height={PLATE.size}
        decoding="async"
        ref={onImg}
        onError={(e) => e.currentTarget.closest(".lx-plate")?.classList.add("lx-noimg")}
      />
    </picture>
  );
}

/** Layers shared by both plates: the lace that turns, the moving light, and the blades that cut it into view. */
function PlateLayers() {
  return (
    <>
      <picture className="lx-rosette">
        <source media="(max-width: 1020px)" srcSet={rosette("rosette-phone")} />
        <img src={rosette("rosette")} alt="" width={PLATE.size} height={PLATE.size} loading="lazy" decoding="async" />
      </picture>
      <div className="lx-light" aria-hidden="true">
        <div className="lx-light-follow">
          <div className="lx-light-orbit">
            <div className="lx-light-sheet" />
          </div>
        </div>
      </div>
      <div className="lx-wipe" aria-hidden="true">
        <div className="lx-blade right">
          <i />
        </div>
        <div className="lx-blade left">
          <i />
        </div>
        <i className="lx-burin" />
      </div>
    </>
  );
}

/** Reveal once the image is really there: a burin line sweeps over the plate, or a plain fade if it's slow to arrive. */
function useReveal(ready: boolean, onCutStart?: () => void) {
  const root = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const onImg = useCallback((el: HTMLImageElement | null) => {
    img.current = el;
  }, []);
  // onError can't see an image that failed before hydration, and a broken image draws its icon on the page.
  useEffect(() => {
    const image = img.current;
    image?.decode().catch(() => {
      if (image.complete && !image.naturalWidth) root.current?.classList.add("lx-noimg");
    });
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!ready || !el) return;
    const state = el.dataset.cut;
    if (state === "done" || state === "fade") return;
    // Motion off: nothing to wait for. A second visit in the tab: a plain fade rather than the whole cut again.
    const html = document.documentElement.classList;
    if (!html.contains("lx")) {
      el.dataset.cut = "done";
      return;
    }
    if (html.contains("lx-again")) {
      el.dataset.cut = "fade";
      return;
    }
    // This effect can re-run mid-cut (StrictMode, or a refreshed page with a new resting month): resume, don't restart.
    const finish = () => {
      el.dataset.cut = "done";
    };
    const burin = el.querySelector(".lx-burin");
    burin?.addEventListener("animationend", finish);
    // A cut whose end never arrives (an animation stopped from outside) mustn't leave the plate behind its blades.
    const backstop = setTimeout(finish, 7000);
    let stale = false;
    let slow: ReturnType<typeof setTimeout> | undefined;
    if (state !== "run") {
      el.dataset.cut = "pending";
      const fade = () => {
        if (!stale) el.dataset.cut = "fade";
      };
      slow = setTimeout(fade, 1100);
      const start = () => {
        if (stale || el.dataset.cut !== "pending") return;
        clearTimeout(slow);
        el.dataset.cut = "run";
        onCutStart?.();
      };
      const image = img.current;
      if (image?.complete && image.naturalWidth) start();
      else if (image) image.decode().then(start, fade);
      else fade();
    }
    return () => {
      stale = true;
      clearTimeout(slow);
      clearTimeout(backstop);
      burin?.removeEventListener("animationend", finish);
    };
  }, [ready, onCutStart]);
  return { root, onImg };
}

/** The light follows the pointer (coalesced to one transform a frame, and stopped when it settles). */
function useLight(root: React.RefObject<HTMLElement | null>, area: () => HTMLElement | null) {
  useEffect(() => {
    const host = area();
    const el = root.current;
    const sheet = el?.querySelector<HTMLElement>(".lx-light-follow");
    if (!host || !el || !sheet || !matchMedia("(hover: hover)").matches) return;
    // The crop's light rests a quarter of a plate to the left, over the part of the dial that's on the page.
    const rest = el.classList.contains("lx-crop") ? 0.25 : 0;
    let x = 0;
    let y = 0;
    let tx = 0;
    let ty = 0;
    let raf = 0;
    const tick = () => {
      x += (tx - x) * 0.09;
      y += (ty - y) * 0.09;
      sheet.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      tx = e.clientX - (r.left + r.width / 2 - r.width * rest);
      ty = e.clientY - (r.top + r.height / 2);
      el.classList.add("pointing");
      kick();
    };
    const leave = () => {
      tx = 0;
      ty = 0;
      el.classList.remove("pointing");
      kick();
    };
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, [root, area]);
}

/** Marks on the dial are real pixels whatever its size: viewBox units per pixel, for the CSS (--lx-u). */
function useDialScale(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const set = () => el.offsetWidth && el.style.setProperty("--lx-u", (PLATE.size / el.offsetWidth).toFixed(3));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [root]);
}

/** The cover's crop of the plate, bleeding off the page. Decorative: the dial leaf says what it shows. */
export function PlateCrop({ plate }: { plate: PlateData }) {
  const { root, onImg } = useReveal(true);
  const area = useCallback(() => root.current?.closest<HTMLElement>(".lx-sheet") ?? null, [root]);
  useLight(root, area);
  useDialScale(root);
  return (
    <div className="lx-plate lx-crop" ref={root} aria-hidden="true">
      <PlateImage version={plate.version} onImg={onImg} />
      <PlateLayers />
      <svg className="lx-crop-peak" viewBox={`0 0 ${PLATE.size} ${PLATE.size}`} aria-hidden="true">
        {peakLabelFits(plate.peak.angle) && <PeakLabel plate={plate} reach={PLATE.tickLong + 8} />}
      </svg>
    </div>
  );
}

const polar = (angle: number, r: number) => {
  const th = ((angle - 90) * Math.PI) / 180;
  return { x: PLATE.centre + r * Math.cos(th), y: PLATE.centre + r * Math.sin(th) };
};

/**
 * A leader from the largest month's tip out past the rings, to its figure: the first thing that says this is real data.
 * With the league ring there, it breaks at the ring so it doesn't run through its letters.
 */
function PeakLabel({ plate, reach, breakAt }: { plate: PlateData; reach: number; breakAt?: number }) {
  const { angle, radius, label } = plate.peak;
  const a = polar(angle, radius + 6);
  const b = polar(angle, reach);
  const end = angle > 180;
  const gapIn = breakAt == null ? null : polar(angle, breakAt - 34);
  const gapOut = breakAt == null ? null : polar(angle, breakAt + 32);
  // On the right, the label heads for the window's edge: where the dial fills the leaf, the CSS leaves it out.
  return (
    <g className={`lx-peak${angle > 50 && angle < 130 ? " right" : ""}`}>
      {gapIn && gapOut ? (
        <>
          <line x1={a.x} y1={a.y} x2={gapIn.x} y2={gapIn.y} />
          <line x1={gapOut.x} y1={gapOut.y} x2={b.x} y2={b.y} />
        </>
      ) : (
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      )}
      <text x={b.x + (end ? -10 : 10)} y={b.y + 8} textAnchor={end ? "end" : "start"}>
        {label}
      </text>
    </g>
  );
}

/** The whole dial, read with a needle: pointer, touch or arrow keys. It rests on the last complete month. */
export function PlateDial({ plate }: { plate: PlateData }) {
  const { months, rest } = plate;
  const count = months.length;
  // The needle's angle runs on past 360, so crossing 12 o'clock takes the short way round.
  const [dial, setDial] = useState({ index: rest, angle: monthAngle(rest, count) });
  const go = useCallback((next: number) => setDial((d) => (d.index === next ? d : { index: next, angle: shortestTurn(d.angle, monthAngle(next, count)) })), [count]);
  const { index, angle } = dial;
  const [inView, setInView] = useState(false);
  const ticking = useRef(0);

  // The readout runs through every month while the blades open, and lands where it rests.
  const onCutStart = useCallback(() => {
    const started = performance.now();
    const CUT_MS = 2400;
    ticking.current = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / CUT_MS);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      go(Math.min(rest, Math.floor(eased * (rest + 1))));
      if (p >= 1) {
        clearInterval(ticking.current);
        ticking.current = 0;
      }
    }, 40);
  }, [rest, go]);
  useEffect(() => () => clearInterval(ticking.current), []);

  const { root, onImg } = useReveal(inView, onCutStart);
  const area = useCallback(() => root.current, [root]);
  useLight(root, area);
  useDialScale(root);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  const stopTicking = () => {
    if (ticking.current) {
      clearInterval(ticking.current);
      ticking.current = 0;
    }
  };

  const read = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // Not inside the centre, where the readout's link lives.
    if (Math.hypot(dx, dy) < r.width * 0.2) return;
    stopTicking();
    go(monthAt((Math.atan2(dy, dx) * 180) / Math.PI + 90, count));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? index + 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? index - 1 : e.key === "Home" ? 0 : e.key === "End" ? count - 1 : null;
    if (next == null) return;
    e.preventDefault();
    stopTicking();
    go(Math.max(0, Math.min(count - 1, next)));
  };

  const month = months[index];
  const inProgress = plate.partial && index === count - 1;
  const ring = PLATE.tickLong + 26;
  const circle = `M ${PLATE.centre} ${PLATE.centre - ring} A ${ring} ${ring} 0 1 1 ${PLATE.centre - 0.01} ${PLATE.centre - ring}`;

  return (
    <div className="lx-plate lx-dial" ref={root}>
      <PlateImage version={plate.version} onImg={onImg} />
      <PlateLayers />
      <svg className="lx-dial-marks" viewBox={`0 0 ${PLATE.size} ${PLATE.size}`} aria-hidden="true">
        <defs>
          <path id="lx-league-ring" d={circle} />
        </defs>
        {plate.years.map((y) => {
          const p = polar(y.angle, PLATE.bezel - 26);
          return (
            <text key={y.label} className="lx-year" x={p.x} y={p.y + 7} textAnchor="middle">
              {y.label}
            </text>
          );
        })}
        {peakLabelFits(plate.peak.angle) && <PeakLabel plate={plate} reach={ring + 48} breakAt={plate.league.length ? ring : undefined} />}
        {plate.league.length > 0 && (
          // Both places: Firefox reads textLength only on the <text>, the others on the <textPath>.
          <text className="lx-league" textLength={(2 * Math.PI * ring * 0.985).toFixed(0)} lengthAdjust="spacing">
            <textPath href="#lx-league-ring" textLength={(2 * Math.PI * ring * 0.985).toFixed(0)} lengthAdjust="spacing">
              {plate.league.map((b) => `${b.toUpperCase()}  ·  `).join("")}
            </textPath>
          </text>
        )}
      </svg>
      <div className="lx-needle" style={{ transform: `rotate(${angle}deg)` }} aria-hidden="true">
        <i />
      </div>
      {/* The slider is a layer of its own, so the readout's link is a link and not a child of a slider. */}
      <div
        className="lx-dial-hit"
        role="slider"
        tabIndex={0}
        aria-label="Announced M&A value by month"
        aria-valuemin={0}
        aria-valuemax={count - 1}
        aria-valuenow={index}
        aria-valuetext={`${month.label}${inProgress ? " to date" : ""}, ${month.value}, ${month.deals} deals`}
        onPointerMove={(e) => e.pointerType !== "touch" && read(e)}
        // A finger reads on a tap (a click never follows a scroll): a swipe past the dial mustn't move the needle.
        onPointerDown={(e) => e.pointerType !== "touch" && read(e)}
        onClick={read}
        onKeyDown={onKey}
      />
      <div className="lx-readout">
        <span className="lx-readout-month">
          {month.label}
          {inProgress ? " to date" : ""}
        </span>
        <span className="lx-readout-value">{month.value}</span>
        <span className="lx-readout-deals">{month.deals.toLocaleString("en-US")} deals</span>
        {month.largest && (
          <Link className="lx-readout-largest" href={`/tearsheet/deal/${encodeURIComponent(month.largest.id)}`} prefetch={false} title={`${month.largest.label}: open the tear sheet`}>
            <span>Largest: {month.largest.label}</span>
            <span className="lx-readout-largest-value">{month.largest.value}</span>
          </Link>
        )}
      </div>
    </div>
  );
}
