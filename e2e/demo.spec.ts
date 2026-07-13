import { test, expect, type Page } from "@playwright/test";

const DEMO_POST = "/log/particlr-spatial-hash/";
const FIELD_NOTE = "/log/field-notes-hello-log/";
const PIXI_RE = /pixi|particlr/i;

// Collect every asset request whose URL looks like the pixi/runtime graph (the
// island chunk is named ParticlrDemo.*, and the pixi.js chunk carries the word).
// The navigation document is excluded: the demo post's own URL contains
// "particlr-spatial-hash", which would otherwise self-match.
function trackPixiRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (req) => {
    if (req.resourceType() === "document") return;
    if (PIXI_RE.test(req.url())) hits.push(req.url());
  });
  return hits;
}

test.describe("particlr demo island", () => {
  test("no pixi/particlr bytes on non-demo pages", async ({ page }) => {
    for (const url of [FIELD_NOTE, "/log/"]) {
      const hits = trackPixiRequests(page);
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      expect(hits, `pixi bytes leaked on ${url}: ${hits.join(", ")}`).toHaveLength(0);
      // Remove the listener before the next iteration.
      page.removeAllListeners("request");
    }

    // The field-note post is a plain post: zero <script> tags at all.
    await page.goto(FIELD_NOTE, { waitUntil: "networkidle" });
    expect(await page.locator("script").count()).toBe(0);
  });

  test("loads pixi only after the figure scrolls into view", async ({ page }) => {
    const hits = trackPixiRequests(page);
    await page.goto(DEMO_POST, { waitUntil: "load" });

    // At the top of the post the figure is below the fold — nothing loaded yet.
    expect(hits, `pixi loaded before scroll: ${hits.join(", ")}`).toHaveLength(0);
    await expect(page.locator("figure.demo canvas")).toHaveCount(0);

    await page.locator("figure.demo").scrollIntoViewIfNeeded();
    const canvas = page.locator("figure.demo canvas");
    await canvas.waitFor({ state: "attached", timeout: 20_000 });

    expect(hits.length, "pixi/particlr chunks should have loaded on visibility").toBeGreaterThan(0);
    await expect(canvas).toBeAttached();
  });

  test("runs 30s with no console errors and sustained fps", async ({ page }) => {
    test.slow(); // fps sample alone is 30s

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));

    await page.goto(DEMO_POST, { waitUntil: "load" });
    await page.locator("figure.demo").scrollIntoViewIfNeeded();
    await page.locator("figure.demo canvas").waitFor({ state: "attached", timeout: 20_000 });

    // Sample the browser rAF cadence for 30s — a proxy for delivered frame rate;
    // if pixi rendering blocks the main thread the cadence drops below 60.
    const fps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const start = performance.now();
          const loop = () => {
            frames++;
            const elapsed = performance.now() - start;
            if (elapsed >= 30_000) resolve((frames / elapsed) * 1000);
            else requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        })
    );

    console.log(`[demo] sustained fps over 30s: ${fps.toFixed(1)}`);
    expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
    expect(fps, `sustained fps was ${fps.toFixed(1)}`).toBeGreaterThanOrEqual(50);
  });

  test("reduced motion shows a static poster with zero ongoing rAF", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();

    // Count every rAF the page schedules, wrapping before any page script runs.
    await page.addInitScript(() => {
      (window as unknown as { __raf: number }).__raf = 0;
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb: FrameRequestCallback) =>
        orig((t) => {
          (window as unknown as { __raf: number }).__raf++;
          return cb(t);
        });
    });

    await page.goto(DEMO_POST, { waitUntil: "load" });
    await page.locator("figure.demo").scrollIntoViewIfNeeded();
    await page.locator("figure.demo canvas").waitFor({ state: "attached", timeout: 20_000 });

    // Let init settle (it may schedule a few frames before the ticker stops).
    await page.waitForTimeout(1000);
    const before = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);

    expect(after - before, "reduced-motion poster must not animate").toBe(0);

    const button = page.locator("button.demo-toggle");
    await expect(button).toBeVisible();
    await expect(button).toContainText("▶");
    await expect(button).toHaveAttribute("aria-label", "Play animation");

    await context.close();
  });
});
