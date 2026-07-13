import { test, expect } from "@playwright/test";

test("chips filter in place without navigation", async ({ page }) => {
  await page.goto("/log/");

  const urlBefore = page.url();
  const items = page.locator("main ul > li");
  const totalBefore = await items.count();
  expect(totalBefore).toBeGreaterThan(0);

  // The island hydrates client:lazyidle (post-load, double-rAF, idle slot) —
  // under full-suite load a click can land before hydration attaches. Astro
  // drops the ssr attribute from <astro-island> once hydrated; wait for that.
  await page.locator("astro-island:not([ssr])").first().waitFor();

  // Derive the expected filtered count from the rendered list itself, so the
  // test doesn't break every time a post is published.
  // The project name appears in the entry-meta line ("2026-07-12 · particlr ·
  // phase 06"), separator-bounded so titles containing "particlr" don't match.
  const particlrItems = page.locator("main ul > li", {
    has: page.locator(".entry-meta", { hasText: /· particlr(?: ·|$)/ }),
  });
  const particlrCount = await particlrItems.count();
  expect(particlrCount).toBeGreaterThan(0);
  expect(particlrCount).toBeLessThan(totalBefore);

  // Click the particlr chip.
  await page.getByRole("button", { name: "particlr", exact: true }).click();

  // URL must not change — client-side filtering only.
  expect(page.url()).toBe(urlBefore);

  // Only particlr posts remain — same count as the pre-click meta-line census,
  // and every remaining item is one of the particlr-meta items.
  await expect(items).toHaveCount(particlrCount);
  await expect(particlrItems).toHaveCount(particlrCount);

  // Reset via "all".
  await page.getByRole("button", { name: "all", exact: true }).click();
  expect(page.url()).toBe(urlBefore);
  await expect(items).toHaveCount(totalBefore);
});

test("post list works with JavaScript disabled", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/log/");

  // The island server-renders the full list, so the seed post is visible even
  // without hydration.
  await expect(
    page.getByText("Rebuilding particlr's spatial hash for 2,500 live particles")
  ).toBeVisible();

  await context.close();
});

test("post page smoke: seed post returns 200 with its h1", async ({ page }) => {
  const response = await page.goto("/log/particlr-spatial-hash/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toContainText(
    "Rebuilding particlr's spatial hash"
  );
});

test("post page has no horizontal overflow at 360px", async ({ browser }) => {
  // The record tables and title block must scroll/wrap within the viewport,
  // never push the page wider than the screen on a narrow phone.
  const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await context.newPage();
  await page.goto("/log/particlr-spatial-hash/");
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  );
  expect(scrollWidth).toBeLessThanOrEqual(360);
  await context.close();
});
