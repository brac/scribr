import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { PROJECTS } from "./src/lib/projects";

// Per-project RSS feeds. Injected as one CONCRETE route per project (no route
// params) rather than a single dynamic src/pages/log/[project]/rss.xml.ts.
// Reason: Astro 7.0.7 miscompiles a getStaticPaths endpoint that has a file
// extension when trailingSlash is "always" — the generated path gets a trailing
// slash the route pattern (compiled "never" for extension endpoints) rejects,
// so the build throws "Missing parameter: project". Concrete routes avoid the
// buggy dynamic-path generation entirely. Feeds still auto-derive from the
// PROJECTS enum, so every project — even empty ones — gets a feed URL.
function projectFeeds() {
  return {
    name: "project-feeds",
    hooks: {
      "astro:config:setup": ({ injectRoute }) => {
        for (const project of PROJECTS) {
          injectRoute({
            pattern: `/log/${project}/rss.xml`,
            entrypoint: "./src/endpoints/project-rss.ts",
            prerender: true,
          });
        }
      },
    },
  };
}

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
  integrations: [preact(), mdx(), sitemap(), projectFeeds()],
});
