import { defineConfig, devices } from "@playwright/test";

// Per the official Astro testing guide. Preview serves the built dist/, so
// `npm run build` must run before the e2e suite (preview hangs without dist/).
export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4321/",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
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
