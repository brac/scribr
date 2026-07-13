import { test, expect } from "@playwright/test";

test("chips filter in place without navigation", async ({ page }) => {
  await page.goto("/log/");

  const urlBefore = page.url();
  const items = page.locator("main ul > li");
  const totalBefore = await items.count();
  expect(totalBefore).toBeGreaterThan(0);

  // Click the particlr chip.
  await page.getByRole("button", { name: "particlr", exact: true }).click();

  // URL must not change — client-side filtering only.
  expect(page.url()).toBe(urlBefore);

  // Only particlr posts remain (1 with current fixtures).
  const filteredCount = await items.count();
  expect(filteredCount).toBe(1);
  await expect(page.locator("main ul > li")).toContainText("particlr");

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
