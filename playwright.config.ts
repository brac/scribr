import { defineConfig, devices } from "@playwright/test";

// Per the official Astro testing guide. Preview serves the built dist/, so the
// webServer builds first and then previews — the suite always validates a fresh
// dist/ it produced itself, never a stale one left on disk.
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4321/",
    // Build takes tens of seconds; the old 120s was preview-only.
    timeout: 240_000,
    // Never attach to a running astro dev on 4321 — always serve our own build.
    reuseExistingServer: false,
  },
  use: {
    baseURL: "http://localhost:4321/",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
