import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

const DESCRIPTION = "A free terminal tracking M&A, IPOs, advisors and valuations from public SEC EDGAR filings.";

// Link previews (LinkedIn, iMessage, Slack, X): absolute URLs from SITE_URL, a large card image (app/opengraph-image.tsx,
// overridden by deal tear sheets and company pages).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Castle: Investment Banking Intelligence",
  description: DESCRIPTION,
  openGraph: { siteName: "Castle", type: "website", description: DESCRIPTION },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

// Apply saved display preferences before first paint so compact rows don't "snap" after loading.
// Mirrors components/workspace/store.ts (key and fields). On the landing page, .lx turns its motion on (landing.css: with
// no script or with motion off the page is simply still) and goes again if the page's script hasn't arrived after 6 s, so
// nothing can stay hidden. .lx-go releases the headline once its font is here or after 700 ms, whichever is first: fonts
// are only requested at first layout, so asking any earlier gets an answer that means nothing. .lx-again shortens the
// entrance for a second visit in the same tab, and .lx-boot tells LandingBook this script has done the work.
const prefsScript = `try{var p={};try{p=JSON.parse(localStorage.getItem("castle-workspace-v1")||"{}")||{}}catch(e){}var c=document.documentElement.classList;if(p.density==="compact")c.add("density-compact");if(p.motion===false)c.add("reduce-motion");else if(location.pathname==="/"&&!matchMedia("(prefers-reduced-motion: reduce)").matches){c.add("lx","lx-boot");var g=function(){c.add("lx-go")};setTimeout(g,700);setTimeout(function(){if(!c.contains("lx-ok"))c.remove("lx")},6000);if(document.fonts)addEventListener("DOMContentLoaded",function(){requestAnimationFrame(function(){document.fonts.ready.then(g)})});try{if(sessionStorage.getItem("lx-seen"))c.add("lx-again");else sessionStorage.setItem("lx-seen","1")}catch(e){}}}catch(e){}`;

// Focus rings are for keyboard users. Browsers also draw them after mouse clicks on selects and when
// a menu or drawer hands focus back to its button, so track the last input method and hide rings for mouse use.
const inputModeScript = `(function(){var d=document.documentElement;d.dataset.input="mouse";document.addEventListener("pointerdown",function(){d.dataset.input="mouse"},true);document.addEventListener("keydown",function(e){if(/^(Tab|Arrow|Home|End|Page)/.test(e.key))d.dataset.input="keyboard"},true)})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: prefsScript }} />
        <script dangerouslySetInnerHTML={{ __html: inputModeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
