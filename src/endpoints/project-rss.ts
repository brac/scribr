import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getCollection } from "astro:content";
import { published } from "../lib/published";

// Shared entrypoint for every per-project feed. One concrete route per project
// is injected in astro.config.mjs (see the projectFeeds integration), so this
// is a NON-parameterized static endpoint — it does NOT use getStaticPaths.
//
// Why not the dynamic src/pages/log/[project]/rss.xml.ts the plan specified:
// Astro 7.0.7 miscompiles a dynamic (getStaticPaths) endpoint that has a file
// extension under trailingSlash: "always". Path generation appends a trailing
// slash ("/log/particlr/rss.xml/") while the route pattern is compiled with the
// per-route "never" override, so the generated path never matches its own
// pattern and the build throws "Missing parameter: project". Concrete injected
// routes take the route.pathname shortcut and skip that broken code path.
//
// The project is read from the request path: /log/{project}/rss.xml.
export async function GET(context: APIContext) {
  const project = context.url.pathname.split("/").filter(Boolean)[1];

  const posts = (await getCollection("log"))
    .filter(published)
    .filter((p) => p.data.project === project)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: `brac.dev devlog — ${project}`,
    description: `Devlog posts for ${project}, newest first.`,
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.summary,
      link: `/log/${post.id}/`,
    })),
    customData: "<language>en-us</language>",
  });
}
