import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getCollection } from "astro:content";
import { published } from "../../../lib/published";
import { PROJECTS } from "../../../lib/projects";

// Per-project feeds as a plain dynamic endpoint — one route per PROJECTS entry.
// Astro 7.0.8 fixes the trailing-slash/extension-endpoint miscompile that forced
// the Phase 1 injectRoute workaround (build threw "Missing parameter: project"
// on 7.0.7), so the plan-original shape builds cleanly again.
export function getStaticPaths() {
  return PROJECTS.map((project) => ({ params: { project } }));
}

export async function GET(context: APIContext) {
  const project = context.params.project!;

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
