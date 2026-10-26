"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, type CSSProperties } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

/*
 * The sidebar logo. `public/castle-logo.png` (1094 × 838, trimmed to the artwork) is drawn as seven pieces, the crest
 * and each letter of the wordmark, clipped from the same image, so they can move on their own:
 * - on load the crest rises in and the letters follow one by one (CSS);
 * - a click presses the logo, sends a sheen across it and an echo of the crest outwards;
 * - quick repeated clicks build a combo: every third click flips the letters like a departure board, and from the
 *   sixth the crest lifts and sends a wave of echoes.
 * Everything is off under the animations setting and prefers-reduced-motion.
 */
const W = 1094;
const H = 838;
type Box = [x0: number, y0: number, x1: number, y1: number];
const CREST: Box = [262, 0, 832, 600];
const LETTERS: Box[] = [
  [0, 660, 152, 838],
  [185, 660, 369, 838],
  [404, 660, 533, 838],
  [573, 660, 731, 838],
  [759, 660, 919, 838],
  [946, 660, 1094, 838],
];
/** Clicks closer together than this continue a combo. */
const COMBO_GAP_MS = 520;
const MAX_ECHOES = 6;

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
const pieceStyle = ([x0, y0, x1, y1]: Box, i?: number) =>
  ({
    clipPath: `inset(${pct(y0, H)} ${pct(W - x1, W)} ${pct(H - y1, H)} ${pct(x0, W)})`,
    transformOrigin: `${pct((x0 + x1) / 2, W)} ${pct((y0 + y1) / 2, H)}`,
    ...(i != null ? { "--i": i } : {}),
  }) as CSSProperties;

const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function BrandLogo() {
  const { prefs } = useWorkspace();
  const pressRef = useRef<HTMLSpanElement>(null);
  const artRef = useRef<HTMLSpanElement>(null);
  const crestRef = useRef<HTMLImageElement>(null);
  const letterRefs = useRef<(HTMLImageElement | null)[]>([]);
  const bandRef = useRef<HTMLSpanElement>(null);
  const echoRef = useRef<HTMLSpanElement>(null);
  const combo = useRef({ count: 0, last: 0 });

  const echo = (delay = 0, strength = 1) => {
    const layer = echoRef.current;
    if (!layer || layer.childElementCount >= MAX_ECHOES) return;
    const el = document.createElement("span");
    el.className = "brand-echo";
    Object.assign(el.style, pieceStyle(CREST));
    layer.appendChild(el);
    el.animate(
      [
        { transform: "scale(1)", opacity: 0.42 * strength },
        { transform: `scale(${1.5 + 0.25 * strength})`, opacity: 0 },
      ],
      { duration: 900, delay, easing: EASE_OUT, fill: "both" },
    );
    // A timer, not `onfinish`: finish events wait for a painted frame, which never comes in a background tab.
    window.setTimeout(() => el.remove(), delay + 950);
  };

  const flipLetters = () =>
    letterRefs.current.forEach((el, i) =>
      el?.animate(
        [
          { transform: "perspective(220px) rotateX(0deg)", opacity: 1, easing: "cubic-bezier(0.55, 0, 0.9, 0.45)" },
          { transform: "perspective(220px) rotateX(-90deg)", opacity: 0.25, offset: 0.5 },
          { transform: "perspective(220px) rotateX(90deg)", opacity: 0.25, offset: 0.5, easing: "cubic-bezier(0.1, 0.55, 0.35, 1)" },
          { transform: "perspective(220px) rotateX(0deg)", opacity: 1 },
        ],
        { duration: 440, delay: i * 55 },
      ),
    );

  const onClick = () => {
    if (!prefs.motion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const now = performance.now();
    const c = combo.current;
    c.count = now - c.last < COMBO_GAP_MS ? c.count + 1 : 1;
    c.last = now;

    pressRef.current?.animate(
      [
        { transform: "scale(1)", filter: "drop-shadow(0 0 0 rgba(255,255,255,0))" },
        { transform: "scale(0.955)", filter: "drop-shadow(0 0 10px rgba(255,255,255,0.28))", offset: 0.3 },
        { transform: "scale(1.012)", offset: 0.65 },
        { transform: "scale(1)", filter: "drop-shadow(0 0 0 rgba(255,255,255,0))" },
      ],
      { duration: 420, easing: "ease-out" },
    );
    // Light passing over metal: the artwork dims a touch while a bright band crosses it.
    artRef.current?.animate([{ opacity: 1 }, { opacity: 0.74, offset: 0.3 }, { opacity: 0.74, offset: 0.7 }, { opacity: 1 }], { duration: 760 });
    bandRef.current?.animate([{ transform: "translateX(-130%) skewX(-18deg)" }, { transform: "translateX(330%) skewX(-18deg)" }], {
      duration: 760,
      easing: "cubic-bezier(0.45, 0, 0.2, 1)",
    });
    echo();

    if (c.count >= 3 && c.count % 3 === 0) flipLetters();
    if (c.count >= 6 && c.count % 3 === 0) {
      crestRef.current?.animate(
        [
          { transform: "translateY(0) scale(1)" },
          { transform: "translateY(-6%) scale(1.04)", offset: 0.35 },
          { transform: "translateY(1%) scale(0.995)", offset: 0.7 },
          { transform: "translateY(0) scale(1)" },
        ],
        { duration: 700, easing: EASE_OUT },
      );
      echo(120, 1.4);
      echo(260, 1.8);
    }
  };

  return (
    // The Hub, not the landing page at "/": leaving the terminal would unmount the logo before a click combo could build.
    <Link className="brand" href="/hub" aria-label="Castle Hub" onClick={onClick}>
      <span className="brand-logo">
        <span className="brand-press" ref={pressRef}>
          <span className="brand-art" ref={artRef}>
            <Image ref={crestRef} className="brand-piece brand-crest" src="/castle-logo.png" alt="" fill sizes="120px" priority draggable={false} style={pieceStyle(CREST)} />
            {LETTERS.map((box, i) => (
              <Image
                key={i}
                ref={(el) => {
                  letterRefs.current[i] = el;
                }}
                className="brand-piece brand-letter"
                src="/castle-logo.png"
                alt=""
                fill
                sizes="120px"
                draggable={false}
                style={pieceStyle(box, i)}
              />
            ))}
          </span>
          <span className="brand-sheen" aria-hidden="true">
            <span className="brand-sheen-band" ref={bandRef} />
          </span>
        </span>
        <span className="brand-echoes" ref={echoRef} aria-hidden="true" />
      </span>
    </Link>
  );
}
