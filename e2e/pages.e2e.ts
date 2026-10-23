import { expect, test, type Page } from "@playwright/test";
import { INFO_ROUTES, ROUTES } from "../components/shell/routes";
import { companyHref, hasCompanyPage } from "../lib/companies";
import type { Deal } from "../lib/types";

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
  });
}

test("deal drawer, company page and tear sheet", async ({ page, request }) => {
  const errors = watchErrors(page);
  const hub = await (await request.get("/api/hub")).json();
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
  await expect(page.locator(".status-actions a")).toHaveAttribute("href", "/");
  expect(errors).toEqual([]);
});

test("an unknown address gets the Castle 404 page", async ({ page }) => {
  const res = await page.goto("/no-such-page-here");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("Page not found");
  await expect(page.locator(".status-actions a").first()).toHaveAttribute("href", "/");
});

test("data feed, freshness, sitemap, robots and preview image", async ({ request }) => {
  const hub = await (await request.get("/api/hub")).json();
  expect(hub.deals.length, "deals in the feed").toBeGreaterThan(0);
  expect(Date.parse(hub.asOf), "asOf is a date").not.toBeNaN();
  expect((await request.get("/api/freshness")).ok()).toBe(true);
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<urlset");
  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap:");
  const og = await request.get("/opengraph-image");
  expect(og.headers()["content-type"]).toContain("image/png");
});
