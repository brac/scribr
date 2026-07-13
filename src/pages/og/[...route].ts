import { getCollection } from "astro:content";
import { OGImageRoute } from "astro-og-canvas";
import { published } from "../../lib/published";

// One OG card per PUBLISHED post (key = post id → /og/{id}.png) plus a single
// synthetic "log" card reused by the index, project listings, home, and 404.
// Drafts are excluded here exactly as everywhere else — a draft OG image would
// be a draft leak (asserted in test/phase-3-meta.mjs).
const posts = (await getCollection("log")).filter(published);

interface Card {
  title: string;
  description: string;
}

// SPEC #13: every card carries title + project + brac.dev branding. The
// branding rides on the description as a trailing line — CanvasKit's
// ParagraphBuilder renders "\n" as a hard break, so "\n\n" yields a blank
// line before the branding (the "·" separator is in the Source Serif subset).
const pages: Record<string, Card> = {
  log: {
    title: "devlog",
    description: "decisions, failures, numbers\n\nbrac.dev/log",
  },
};
for (const post of posts) {
  pages[post.id] = {
    title: post.data.title,
    description: `${post.data.summary}\n\n${post.data.project} · brac.dev/log`,
  };
}

// Cards are always rendered in the dark scheme for contrast in social feeds.
// Colors mirror the dark tokens: bg = dark --paper (21,24,21), accent bottom
// rule = dark --pass (67,179,127), title ink = dark --ink, description = dark
// --graphite. Fonts are the same committed TTFs the site self-hosts; the
// SemiBold face registers under its own family name via FontMgr.FromData, so
// the title stack names it explicitly.
export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page: Card) => ({
    title: page.title,
    description: page.description,
    bgGradient: [[21, 24, 21]],
    border: { color: [67, 179, 127], width: 12, side: "block-end" },
    padding: 72,
    fonts: [
      "./src/assets/fonts/IBMPlexMono-SemiBold.ttf",
      "./src/assets/fonts/SourceSerif4-Regular.ttf",
    ],
    font: {
      title: {
        families: ["IBM Plex Mono SemiBold", "IBM Plex Mono"],
        weight: "SemiBold",
        color: [228, 232, 228],
        size: 58,
        lineHeight: 1.1,
      },
      description: {
        families: ["Source Serif 4"],
        weight: "Normal",
        color: [154, 164, 158],
        size: 30,
        lineHeight: 1.4,
      },
    },
  }),
});
