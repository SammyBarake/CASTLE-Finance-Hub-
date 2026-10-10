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
// Mirrors components/workspace/store.ts (key and fields).
const prefsScript = `try{var p=JSON.parse(localStorage.getItem("castle-workspace-v1")||"{}");var c=document.documentElement.classList;if(p.density==="compact")c.add("density-compact");if(p.motion===false)c.add("reduce-motion")}catch(e){}`;

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
