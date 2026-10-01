import type { ReactNode } from "react";

// Line icons from the design reference (24x24, stroked).
const PATHS = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  flow: <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />,
  chart: <path d="M4 3v17h17M8 14l4-5 4 3 5-7" />,
  ipo: <path d="M5 21V9h5v12M10 21V3h6v18M16 12h4v9M3 21h19M12.5 7h1M12.5 11h1M12.5 15h1" />,
  bank: <path d="m3 8 9-5 9 5H3Zm2 3v7m5-7v7m4-7v7m5-7v7M3 21h18" />,
  values: (
    <>
      <path d="M5 5v14m7-17v20m7-15v12" />
      <rect x="3" y="8" width="4" height="7" rx=".7" />
      <rect x="10" y="5" width="4" height="10" rx=".7" />
      <rect x="17" y="10" width="4" height="5" rx=".7" />
    </>
  ),
  megaphone: <path d="M4 10v4h3l7 4V6l-7 4H4Zm13-1.5a4 4 0 0 1 0 7M7 14l1.5 5h2L9 14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  comps:<path d="M4 5h16M4 10h16M4 15h16M4 20h10M9 5v15" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  right: <path d="M5 12h14m-5-5 5 5-5 5" />,
  "up-right": <path d="M6 18 18 6M7 6h11v11" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />,
  dots: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  filter: (
    <>
      <path d="M3 5h18M6 12h12M9 19h6" />
      <circle cx="8" cy="5" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
    </>
  ),
  columns: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M10 4v16m7-16v16" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M15 8V3H3v12h5" />
    </>
  ),
  compare: <path d="M3 4h7v16H3zM14 4h7v16h-7z" />,
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" fill="currentColor" />
      <circle cx="16" cy="12" r="2" fill="currentColor" />
      <circle cx="10" cy="18" r="2" fill="currentColor" />
    </>
  ),
  trash: <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  "trend-up": <path d="m3 17 7-7 4 4 7-9m-7 0h7v7" />,
  "trend-down": <path d="m3 7 7 7 4-4 7 9m-7 0h7v-7" />,
  "arrow-up": <path d="M12 20V4m-6 6 6-6 6 6" />,
  "arrow-down": <path d="M12 4v16m-6-6 6 6 6-6" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 11h18" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.2" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  expand: <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  pulse: <path d="M2 12h5l3-7 4 14 3-7h5" />,
  file: <path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h5" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
