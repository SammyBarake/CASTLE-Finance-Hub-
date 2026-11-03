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
      // The plate is a real image of the data, and the page's own figures are in the HTML.
      const plate = page.locator(".lx-crop .lx-plate-img");
      await expect(plate).toHaveJSProperty("complete", true);
      expect(await plate.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await expect(page.locator(".lx-tomb").first()).toBeAttached();
      // Every tombstone is whole: its value inside its frame, and all of them above the note under them.
      const tombs = await page.evaluate(() => {
        const note = document.querySelector(".lx-tomb-note")!.getBoundingClientRect();
        return [...document.querySelectorAll(".lx-tomb")].map((t) => {
          const frame = t.querySelector(".lx-tomb-frame")!.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(t.querySelector(".lx-tomb-value")!);
          const value = range.getBoundingClientRect();
          return { fits: value.left >= frame.left && value.right <= frame.right, abovenote: t.getBoundingClientRect().bottom <= note.top + 1 };
        });
      });
      expect(tombs.length).toBeGreaterThan(0);
      for (const t of tombs) expect(t).toEqual({ fits: true, abovenote: true });
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
                // SVG text is drawn at its size times the drawing's scale, which the computed size doesn't show.
                parseFloat(getComputedStyle(el).fontSize) * (el instanceof SVGGraphicsElement ? (el.getScreenCTM()?.a ?? 1) : 1) < 10,
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

test("the landing page's plate is an image of the data, and it reads a month by keyboard", async ({ page, request }) => {
  const errors = watchErrors(page);
  for (const d of ["full", "phone", "rosette", "rosette-phone"]) {
    const res = await request.get(`/api/landing/plate.svg?d=${d}`);
    expect(res.status(), d).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  }
  await page.goto("/", { waitUntil: "networkidle" });
  const dial = page.getByRole("slider", { name: "Announced M&A value by month" });
  await dial.focus();
  await page.keyboard.press("Home");
  const first = await dial.getAttribute("aria-valuetext");
  await page.keyboard.press("ArrowRight");
  expect(await dial.getAttribute("aria-valuetext")).not.toBe(first);
  expect(await dial.getAttribute("aria-valuenow")).toBe("1");
  expect(errors).toEqual([]);
});

test("Back works after the landing page's fore-edge, and a link from a low leaf lands at the top of the page", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.classList.add("lx-test"));
  await page.locator('.lx-fore a[href="#notes"]').click();
  await expect.poll(() => page.evaluate(() => Math.abs(document.getElementById("notes")!.getBoundingClientRect().top))).toBeLessThan(2);
  // The address stays as it was: a hash would pull Back and Reload to that leaf once the reader has moved on.
  expect(new URL(page.url()).hash).toBe("");
  await page.evaluate(() => window.scrollTo({ top: document.getElementById("terminal")!.getBoundingClientRect().top + window.scrollY, behavior: "instant" }));
  const leaf = await page.evaluate(() => window.scrollY);
  await page.locator('.lx-row[data-s="deal-flow"]').click();
  await expect(page).toHaveURL(/\/deal-flow$/);
  await expectLoaded(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page.locator(".landing")).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(leaf);
  expect(errors).toEqual([]);
});

test("Enter on a fore-edge hairline carries keyboard focus into that leaf", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.locator('.lx-fore a[href="#terminal"]').focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("lx-terminal"))).toBe(true);
  await expect.poll(() => page.evaluate(() => Math.abs(document.getElementById("terminal")!.getBoundingClientRect().top))).toBeLessThan(2);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest(".lx-terminal"))).toBe(true);
});

test("the landing page is complete with motion off: nothing waits for an animation", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto("/", { waitUntil: "networkidle" });
  expect(await page.evaluate(() => document.documentElement.classList.contains("lx"))).toBe(false);
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll(".landing *")].filter((el) => getComputedStyle(el).opacity === "0" && !el.closest(".lx-exhibit") && !el.closest(".lx-fore") && !el.matches(".lx-float")).map((el) => el.className),
  );
  expect(hidden, "nothing hidden with motion off").toEqual([]);
  await expect(page.locator(".lx-title")).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

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
