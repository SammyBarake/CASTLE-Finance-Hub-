/**
 * The link-preview card (LinkedIn, iMessage, Slack, X): black, the logo, a kicker, a title, up to four figures. Server
 * only (reads the logo from disk); used by the opengraph-image routes.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

let logo: Promise<string> | null = null;
const logoDataUrl = () => (logo ??= readFile(join(process.cwd(), "public/castle-logo.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`));

export interface OgCard {
  kicker: string;
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string }[];
}

export async function ogCard({ kicker, title, subtitle, stats = [] }: OgCard): Promise<ImageResponse> {
  const src = await logoDataUrl();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#050505", color: "#f2f2f2", padding: "64px 72px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: "#8d8d8d" }}>{kicker}</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
          <img src={src} width={131} height={100} alt="" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: title.length > 48 ? 54 : 66, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1 }}>{title}</div>
          {subtitle && <div style={{ display: "flex", fontSize: 30, color: "#a5a5a5" }}>{subtitle}</div>}
        </div>
        <div style={{ display: "flex", gap: 32, borderTop: "1px solid #2a2a2a", paddingTop: 28 }}>
          {stats.slice(0, 4).map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", flex: 1, gap: 6 }}>
              <div style={{ display: "flex", fontSize: 22, color: "#8d8d8d" }}>{s.label}</div>
              <div style={{ display: "flex", fontSize: s.value.length > 15 ? 32 : 40, fontWeight: 700 }}>{s.value}</div>
            </div>
          ))}
          {!stats.length && <div style={{ display: "flex", fontSize: 24, color: "#8d8d8d" }}>Free terminal for U.S. M&A, IPOs and advisers, built from SEC EDGAR filings</div>}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
