import { preload } from "react-dom";

/**
 * Starts downloading the dataset with the page, in parallel with the JavaScript, instead of after it has run
 * (HubDataProvider's fetch("/api/hub") then picks up the preloaded response; keep the two matching). Called by the
 * pages that need the full dataset before they can show anything. The BOOT_READY pages (components/shell/routes.ts)
 * render from the boot copy and fetch it after hydration instead: a preload there competes with the page's own
 * first paint on a slow phone, and Lighthouse counts it against the largest paint.
 */
export function preloadHubData() {
  preload("/api/hub", { as: "fetch", crossOrigin: "anonymous" });
}
