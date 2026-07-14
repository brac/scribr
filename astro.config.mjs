import { defineConfig, fontProviders } from "astro/config";
import preact from "@astrojs/preact";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import lazyIdle from "./src/integrations/lazyidle.mjs";

export default defineConfig({
  site: "https://brac.dev",
  // Canonical URLs are https://brac.dev/log/{slug}/ — trailing slashes
  // everywhere. Docs-recommended pairing with the default directory build
  // format and least friction on Vercel. Note: with "always",
  // dev/preview 404 non-slashed URLs, so all internal links carry the slash.
  trailingSlash: "always",
  // A post id colliding with a project name must fail the build, not silently
  // shadow a page.
  prerenderConflictBehavior: "error",
  // The whole design system is one ~7.5 KB stylesheet; inlining it removes the
  // only render-blocking request (one full RTT off FCP/LCP on every page under
  // Lighthouse's simulated mobile RTT), which the LCP <= 1500ms gate needs.
  build: { inlineStylesheets: "always" },
  integrations: [preact(), mdx(), sitemap(), lazyIdle()],
  // Self-hosted fonts via the stable Astro 7 Fonts API + local provider.
  // Browsers get WOFF2 (listed first in each variant's src — ~113 KB total vs
  // 311 KB TTF; regenerate with scripts/fonts-woff2.mjs if the TTFs change);
  // og-canvas keeps consuming the committed TTFs directly by path
  // (satori/CanvasKit need TTF, not WOFF2). display: swap is the API default
  // but spelled out because the LCP gate depends on it: text paints in the
  // metric-matched fallback immediately instead of waiting on the webfont.
  // Astro self-hosts these at build time under _astro/fonts — no runtime
  // Google requests — and auto-generates the size-adjusted fallbacks.
  fonts: [
    {
      provider: fontProviders.local(),
      name: "IBM Plex Mono",
      cssVariable: "--font-mono",
      display: "swap",
      options: {
        variants: [
          {
            src: [
              "./src/assets/fonts/IBMPlexMono-Regular.woff2",
              "./src/assets/fonts/IBMPlexMono-Regular.ttf",
            ],
            weight: 400,
            style: "normal",
          },
          {
            src: [
              "./src/assets/fonts/IBMPlexMono-SemiBold.woff2",
              "./src/assets/fonts/IBMPlexMono-SemiBold.ttf",
            ],
            weight: 600,
            style: "normal",
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: "Source Serif 4",
      cssVariable: "--font-serif",
      display: "swap",
      options: {
        variants: [
          {
            src: [
              "./src/assets/fonts/SourceSerif4-Regular.woff2",
              "./src/assets/fonts/SourceSerif4-Regular.ttf",
            ],
            weight: 400,
            style: "normal",
          },
          {
            src: [
              "./src/assets/fonts/SourceSerif4-It.woff2",
              "./src/assets/fonts/SourceSerif4-It.ttf",
            ],
            weight: 400,
            style: "italic",
          },
          {
            src: [
              "./src/assets/fonts/SourceSerif4-Semibold.woff2",
              "./src/assets/fonts/SourceSerif4-Semibold.ttf",
            ],
            weight: 600,
            style: "normal",
          },
        ],
      },
    },
  ],
});
