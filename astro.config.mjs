import { defineConfig, fontProviders } from "astro/config";
import preact from "@astrojs/preact";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://brac.dev",
  // Canonical URLs are https://brac.dev/log/{slug}/ — trailing slashes
  // everywhere. Docs-recommended pairing with the default directory build
  // format and least friction on Cloudflare Pages. Note: with "always",
  // dev/preview 404 non-slashed URLs, so all internal links carry the slash.
  trailingSlash: "always",
  // A post id colliding with a project name must fail the build, not silently
  // shadow a page.
  prerenderConflictBehavior: "error",
  integrations: [preact(), mdx(), sitemap()],
  // Self-hosted fonts via the stable Astro 7 Fonts API + local provider. The
  // same committed TTFs feed og-canvas (satori/CanvasKit need TTF, not WOFF2).
  // Astro subsets + self-hosts these at build time under _astro/fonts — no
  // runtime Google requests — and auto-generates metric-matched fallbacks.
  fonts: [
    {
      provider: fontProviders.local(),
      name: "IBM Plex Mono",
      cssVariable: "--font-mono",
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/IBMPlexMono-Regular.ttf"],
            weight: 400,
            style: "normal",
          },
          {
            src: ["./src/assets/fonts/IBMPlexMono-SemiBold.ttf"],
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
      options: {
        variants: [
          {
            src: ["./src/assets/fonts/SourceSerif4-Regular.ttf"],
            weight: 400,
            style: "normal",
          },
          {
            src: ["./src/assets/fonts/SourceSerif4-It.ttf"],
            weight: 400,
            style: "italic",
          },
          {
            src: ["./src/assets/fonts/SourceSerif4-Semibold.ttf"],
            weight: 600,
            style: "normal",
          },
        ],
      },
    },
  ],
});
