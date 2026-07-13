import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getCollection } from "astro:content";
import { published } from "../lib/published";

export async function GET(context: APIContext) {
  const posts = (await getCollection("log"))
    .filter(published)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return rss({
    title: "brac.dev devlog",
    description:
      "Decisions, failures, and numbers from each build phase across brac.dev projects.",
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.summary,
      // @astrojs/rss defaults to trailingSlash: true, matching our canonicals.
      link: `/log/${post.id}/`,
    })),
    customData: "<language>en-us</language>",
  });
}
