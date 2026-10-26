import { expect, test, type Page } from "@playwright/test";
import { INFO_ROUTES, ROUTES } from "../components/shell/routes";
import { companyHref, hasCompanyPage } from "../lib/companies";
import type { Deal } from "../lib/types";
import { expandCore, type WireCore } from "../lib/wire";

/**
 * Every page loads its data and renders without errors, at desktop and phone width. A failure here means a page is
 * broken for visitors, so CI fails before anyone notices on the live site.
 */

/** Collect uncaught exceptions and console errors while a page is used. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`exception: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** The page has its data (skeleton gone, no load error), a heading and real content. */
async function expectLoaded(page: Page) {
  await expect(page.locator(".skeleton")).toHaveCount(0);
  await expect(page.locator(".skeleton-error")).toHaveCount(0);
  await expect(page.locator("main h1").first()).toBeVisible();
  const text = (await page.locator("main").innerText()).trim();
  expect(text.length, "page content").toBeGreaterThan(200);
}

for (const width of [1366, 375]) {
  test.describe(width === 375 ? "phone" : "desktop", () => {
    test.use({ viewport: { width, height: width === 375 ? 812 : 900 } });

    for (const route of [...ROUTES, ...INFO_ROUTES]) {
      test(`${route.title} (${route.href})`, async ({ page }) => {
        const errors = watchErrors(page);
        // Wait for the dataset (and every other request) to finish before judging the page.
        await page.goto(route.href, { waitUntil: "networkidle" });
        await expectLoaded(page);
        // Nothing scrolls sideways (tables scroll inside their own containers).
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      });
    }

    // The landing page at "/" (the Hub is at /hub, in the loop above): figures from the server, never the dataset.
    test("Landing (/)", async ({ page }) => {
      const errors = watchErrors(page);
      const dataset: string[] = [];
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.startsWith("/api/hub")) dataset.push(r.url());
      });
      await page.goto("/", { waitUntil: "networkidle" });
      await expectLoaded(page);
      await expect(page.locator('main a[href="/hub"]').first()).toBeVisible();
      // CI sets no NEXT_PUBLIC_AUTH_PROVIDERS: no account wording, no sign-in button.
      await expect(page.locator('a[href="/hub?signin=1"]')).toHaveCount(0);
      await expect(page.locator(".landing-kpis .kpi")).toHaveCount(4);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
      if (width === 375) {
        // Phone text never below 10px.
        const tiny = await page.evaluate(() =>
          [...document.querySelectorAll(".landing *")]
            .filter(
              (el) =>
                el.getClientRects().length > 0 &&
                [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) &&
                parseFloat(getComputedStyle(el).fontSize) < 10,
            )
            .map((el) => `${el.tagName}.${el.className}: ${getComputedStyle(el).fontSize}`),
        );
        expect(tiny, "phone text under 10px").toEqual([]);
      }
      expect(dataset, "the landing page never downloads the dataset").toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test("the landing page opens the terminal, and ?signin=1 is cleaned up without breaking Back", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/", { waitUntil: "networkidle" });
  // A soft navigation from a page with no providers into the terminal layout.
  await page.locator('main a[href="/hub"]').first().click();
  await expect(page).toHaveURL(/\/hub$/);
  await expectLoaded(page);
  // Opened with a full load (a shared link, a new tab): the parameter goes, and the router's history state stays.
  await page.goto("/hub?signin=1", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/hub$/);
  await page.goto("/about", { waitUntil: "networkidle" });
  // A soft navigation back: waiting for "networkidle" here took ~28 s for nothing.
  await page.goBack();
  await expect(page).toHaveURL(/\/hub$/);
  await expectLoaded(page);
  expect(errors).toEqual([]);
});

test("deal drawer, company page and tear sheet", async ({ page, request }) => {
  const errors = watchErrors(page);
  const hub = expandCore((await (await request.get("/api/hub")).json()) as WireCore);
  // Any deal whose target has a company page (live data has CIKs; CI's sample data has names only).
  const deal = (hub.deals as Deal[]).find((d) => hasCompanyPage(d.target));
  expect(deal, "a deal whose target has a company page").toBeTruthy();
  if (!deal) return;

  await page.goto("/deal-flow", { waitUntil: "networkidle" });
  await expectLoaded(page);
  // Rows open the deal drawer from the keyboard (their company names are links to company pages).
  const row = page.locator("tr.row-link").first();
  await row.focus();
  await row.press("Enter");
  await expect(page.locator(".detail-drawer, dialog[open]").first()).toBeVisible();

  await page.goto(companyHref(deal.target), { waitUntil: "networkidle" });
  await expectLoaded(page);

  await page.goto(`/tearsheet/deal/${encodeURIComponent(deal.id)}`);
  await expect(page.locator("body")).toContainText(deal.target.name.split(" ")[0]);
  expect(errors).toEqual([]);
});

test("Excel export downloads a workbook", async ({ page }) => {
  const errors = watchErrors(page);
  // Precedents builds the richest workbook (summary formulas, the banks' DCFs); ExcelJS loads only on this click. CI's
  // sample deals carry no multiples, so the screen drops that requirement.
  await page.goto("/precedents?withMultiples=0", { waitUntil: "networkidle" });
  await expectLoaded(page);
  await page.getByRole("button", { name: "Export the comps table" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Excel workbook (.xlsx)" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^Castle_Precedents.*\.xlsx$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const file = Buffer.concat(chunks);
  expect(file.subarray(0, 2).toString(), "zip signature").toBe("PK");
  expect(file.length, "workbook bytes").toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
});

test("the sign-in return page explains a sign-in that didn't finish", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/auth/callback?error_description=You%20cancelled%20the%20sign-in.&next=%2F%2Felsewhere.example");
  await expect(page.locator("h1")).toHaveText("Sign-in didn't finish");
  await expect(page.locator("main")).toContainText("You cancelled the sign-in.");
  await expect(page.locator(".status-actions a")).toHaveAttribute("href", "/hub");
  expect(errors).toEqual([]);
});

test("a shared deal book link that doesn't exist is a 404, not an error", async ({ page }) => {
  const res = await page.goto("/book/0123456789abcdef0123");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("Page not found");
});

test("an unknown address gets the Castle 404 page", async ({ page }) => {
  const res = await page.goto("/no-such-page-here");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("Page not found");
  await expect(page.locator(".status-actions a").first()).toHaveAttribute("href", "/hub");
});

test("data feed, freshness, sitemap, robots and preview image", async ({ request }) => {
  const hub = expandCore((await (await request.get("/api/hub")).json()) as WireCore);
  expect(hub.deals.length, "deals in the feed").toBeGreaterThan(0);
  const details = await (await request.get("/api/hub/details")).json();
  expect(details.asOf, "details belong to the same dataset").toBe(hub.asOf);
  expect(Date.parse(hub.asOf), "asOf is a date").not.toBeNaN();
  expect((await request.get("/api/freshness")).ok()).toBe(true);
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<urlset");
  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap:");
  const og = await request.get("/opengraph-image");
  expect(og.headers()["content-type"]).toContain("image/png");
  // Live data links for Excel / Google Sheets: CSV with a header row and the page's filters applied.
  for (const path of ["/api/live/deals.csv?sort=value", "/api/live/precedents.csv?withMultiples=0", "/api/live/league.csv", "/api/live/ipos.csv"]) {
    const res = await request.get(path);
    expect(res.headers()["content-type"], path).toContain("text/csv");
    const lines = (await res.text()).trim().split(/\r?\n/);
    expect(lines.length, `${path} rows`).toBeGreaterThan(1);
  }
  expect((await request.get("/api/live/deals.csv")).headers()["x-robots-tag"]).toBe("noindex");
});
