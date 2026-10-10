import { defineConfig } from "@playwright/test";

/**
 * Page smoke test (`npm run test:pages`, after `npm run build`): opens every page in Chrome against the production
 * build and fails on errors, blank pages or sideways scrolling. CI runs it on every push (sample data: no database
 * keys there). Uses the installed Chrome (`channel: "chrome"`, preinstalled on GitHub's Ubuntu runners), so no
 * browser download is needed.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", headless: true },
  webServer: { command: `npm run start -- --port ${PORT}`, port: PORT, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
