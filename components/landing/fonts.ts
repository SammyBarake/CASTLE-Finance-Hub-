import { Newsreader } from "next/font/google";

/**
 * The landing page's voice, imported only from this page so the terminal never loads it. High contrast at display sizes
 * (the optical-size axis follows the font size on its own) and a true italic. Self-hosted by next/font: no request to Google.
 */
export const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-news",
  display: "swap",
});
