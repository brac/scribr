import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://brac.dev",
  integrations: [preact(), mdx()],
});
