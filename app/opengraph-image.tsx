import { OG_SIZE, ogCard } from "@/lib/ogCard";

// The default link preview for every page without its own.
export const alt = "Castle: U.S. M&A, IPOs and advisers from SEC filings";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({ kicker: "Castle", title: "Investment banking intelligence", subtitle: "U.S. M&A, IPOs, advisers and valuations from SEC EDGAR" });
}
