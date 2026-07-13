# Phase 1 Implementation Plan — Routes, Index, Feeds

**Author:** Fable (planner/reviewer)
**Implementer:** Opus agent
**Source docs:** `docs/BUILD-PLAN.md` (Phase 1), `docs/SPEC.md` §5–6
**Baseline:** `phase-0` tag — scaffold, schema, seed post, `[slug]` route all exist and pass gates.

## Research-verified decisions (do not relitigate)

1. **URL shape: trailing slashes everywhere.** Set `trailingSlash: "always"` in `astro.config.mjs` (keep default `build.format: "directory"`). Canonical URLs are `https://brac.dev/log/{slug}/`. This is the docs-recommended pairing and the path of least resistance on Cloudflare Pages. Keep `@astrojs/rss` at its default `trailingSlash: true` so feed links match canonicals. Note: with `"always"`, dev/preview 404 non-slashed URLs — write all internal links and test URLs with trailing slashes.
2. **`prerenderConflictBehavior: "error"`** in `astro.config.mjs` — a post id colliding with a project name must fail the build, not silently shadow a page.
3. **Feed validation:** parse built files from `dist/` directly with `feedparser@2.6.0` (maintained, Node 24 OK). No HTTP, no W3C API.
4. **Playwright:** `@playwright/test@^1.61` + `npx playwright install chromium`. webServer per official Astro testing guide: `command: "npm run preview"`, `url: "http://localhost:4321/"`, `timeout: 120_000`, `reuseExistingServer: !process.env.CI`. Build must run before e2e (preview hangs without `dist/`).
5. **Autodiscovery is hand-written** `<link rel="alternate" type="application/rss+xml" title=... href={new URL(..., Astro.site)}>` — no helper exists.
6. **Per-project RSS endpoints** (`src/pages/log/[project]/rss.xml.ts`) support `getStaticPaths`; params arrive via `context.params`. Endpoint files with extensions serve at `/log/{project}/rss.xml` (no trailing slash) regardless of config — correct and expected.

## New dependencies (exact)

- deps: `@astrojs/rss@^4.0.19`, `@astrojs/sitemap@^3.7.3`
- devDeps: `feedparser@^2.6.0`, `@playwright/test@^1.61`

Nothing else.

## Files to create / modify

### 1. `src/lib/projects.ts` (new) + `src/content.config.ts` (modify)

Single source of truth for the project enum:

```ts
// src/lib/projects.ts
export const PROJECTS = ["particlr","haulr","swarmr","herdr","burnrat","crawlers","scribr","field-notes"] as const;
export type Project = (typeof PROJECTS)[number];
```

`content.config.ts` imports `PROJECTS` and uses `z.enum(PROJECTS)` (keep the explanatory comment about typo protection). Phase 2's sync script will regex-extract from `projects.ts`, so keep the array literal on one line per value or as-is — just keep it a plain `as const` array literal.

### 2. `astro.config.mjs` (modify)

Add `trailingSlash: "always"`, `prerenderConflictBehavior: "error"`, and the sitemap integration:

```js
import sitemap from "@astrojs/sitemap";
// integrations: [preact(), mdx(), sitemap()]
```

`site: "https://brac.dev"` already present.

### 3. `src/layouts/Base.astro` (new)

Extract the `<head>` boilerplate from `Post.astro` into a shared base layout used by every page. Head must include:

- charset, viewport, `<title>`, `<meta name="description">` (props: `title`, `description`)
- Canonical: `<link rel="canonical" href={new URL(Astro.url.pathname, Astro.site)} />`
- Global feed autodiscovery: `<link rel="alternate" type="application/rss+xml" title="brac.dev devlog" href={new URL("rss.xml", Astro.site)} />`
- Optional prop `projectFeed?: string` — when set, a second autodiscovery link: title `` `brac.dev devlog — ${project}` ``, href `new URL(`log/${project}/rss.xml`, Astro.site)`
- `<link rel="sitemap" href="/sitemap-index.xml" />`

`Post.astro` becomes a wrapper around `Base.astro` (passing `projectFeed={project}`), keeping its article markup unchanged.

### 4. `src/pages/log/index.astro` (new) — the unified index

- `getCollection("log")` → filter `published` → sort **newest first** by `data.date`.
- Render `<FilterChips posts={...} client:idle />` where posts is an array of plain serializable objects: `{ id, title, dateISO, dateDisplay, project, summary }`. Do NOT pass CollectionEntry objects or Date instances into the island — pre-stringify.
- The island server-renders the full chip row + post list, so **JS-disabled still shows every post** (hydration simply never attaches; chips are inert). This satisfies "chips are enhancement, not gate".
- Each post entry links to `/log/{id}/` (trailing slash), shows title, date, project label, summary.
- Uses `Base.astro`; title "devlog — brac.dev" or similar plain text.

### 5. `src/components/FilterChips.tsx` (new) — Preact island

- Props: `posts: { id; title; dateISO; dateDisplay; project; summary }[]`.
- Local state: `active: string | null` (null = all).
- Renders: a chip row — "all" plus one chip per project **present in the posts** (derived from props, not the full enum — empty projects get no dead chip), then the post list `<ul>`, filtered by `active`.
- Clicking a chip filters in place. **No navigation, no URL change, no history API.** Clicking the active chip or "all" resets.
- Mark the active chip with `aria-pressed`. Chips are `<button>` elements.
- Keep it dependency-free (Preact `useState` only). No CSS beyond nothing/inline-minimal — styling is Phase 3.

### 6. `src/pages/log/[project]/index.astro` (new) — per-project listings

- `getStaticPaths` from `PROJECTS` (all enum values, even currently-empty ones — stable URLs per SPEC).
- Lists that project's published posts **oldest first** (chronological — SPEC calls this "the linkable project narrative", contrasted with the index's "newest first").
- Empty state: a single line ("No posts yet.") — do not omit the page.
- Uses `Base.astro` with `projectFeed={project}`. Link each post `/log/{id}/`; link back to `/log/`.

### 7. `src/pages/rss.xml.ts` (new) — global feed

Per the researched idiom: `rss({ title: "brac.dev devlog", description: <one-liner>, site: context.site, items, customData: "<language>en-us</language>" })`. Items = published posts, newest first: `{ title, pubDate: data.date, description: data.summary, link: `/log/${id}/` }`. Do NOT set `trailingSlash: false` (default `true` matches our canonicals).

### 8. `src/pages/log/[project]/rss.xml.ts` (new) — per-project feeds

- `getStaticPaths` from `PROJECTS` (all values → every project page has a feed URL that exists).
- `GET({ params, site })`: same item shape, filtered to `data.project === params.project`, newest first. Title `` `brac.dev devlog — ${params.project}` ``.

### 9. `public/robots.txt` (new)

```
User-agent: *
Allow: /

Sitemap: https://brac.dev/sitemap-index.xml
```

### 10. `src/content/log/field-notes-draft-fixture.md` (new) — permanent draft fixture

A minimal valid post: `project: field-notes` (so no `phase`/`repo_ref` needed), `draft: true`, distinctive slug `field-notes-draft-fixture`, plausible title/summary/tags/body (2 short paragraphs). This is a permanent regression fixture — the string `draft-fixture` must never appear anywhere in `dist/`.

### 11. `src/pages/index.astro` (modify)

Placeholder now links to `/log/` instead of directly to the seed post.

### 12. `test/phase-1-draft-exclusion.mjs` (new)

Node script, dependency-free, run after a build (script runs `npm run build` itself first, like phase-0 gate):

1. Assert `dist/log/field-notes-draft-fixture/` does **not** exist.
2. Recursively walk every file under `dist/`, assert **zero** files contain the string `draft-fixture` (covers pages, feeds, sitemap).
3. Assert the seed post IS present (`dist/log/particlr-spatial-hash/index.html` exists) — guards against a filter bug that excludes everything.
4. PASS/FAIL lines per assertion; exit 1 on any failure.

### 13. `test/validate-feeds.mjs` (new)

Uses `feedparser`. For `dist/rss.xml` plus `dist/log/{project}/rss.xml` for every entry in `PROJECTS` (import the list — read `src/lib/projects.ts` values by regex or duplicate deliberately with a comment):

- Stream-parse each file; any `error` event = FAIL for that feed.
- Assert channel `title` + `description` present.
- Assert every item has `title`, `link`, `pubdate`; assert item links are absolute URLs starting `https://brac.dev/log/` and ending with `/`.
- Assert the global feed has ≥1 item and contains the seed post; assert the fixture draft appears in **no** feed.
- Exit 1 on any failure.

### 14. `playwright.config.ts` + `e2e/log-index.spec.ts` (new)

Config per research (webServer → `npm run preview`, url `http://localhost:4321/`, chromium project only). Tests:

1. **Chips filter without navigation:** goto `/log/`, record `page.url()`, count post list items, click the `particlr` chip, assert URL unchanged, assert visible list items are exactly the particlr posts (1 with current fixtures), click "all"/toggle off, assert full count restored.
2. **No-JS still lists posts:** a second browser context with `javaScriptEnabled: false`, goto `/log/`, assert the seed post's title is visible.
3. Basic smoke: `/log/particlr-spatial-hash/` returns 200 and shows the h1.

### 15. `package.json` scripts (modify)

- `test:phase1`: `node test/phase-1-draft-exclusion.mjs && node test/validate-feeds.mjs` (draft-exclusion script performs the build; validate-feeds reuses the dist it produced — do NOT rebuild in validate-feeds)
- `test:e2e`: `playwright test`
- Keep `test:phase0` working.

Windows note: npm scripts run under cmd where `&&` works; fine.

### 16. `devlog/phase-1-routes-index-feeds.md` (new)

Phase 1 devlog draft per `docs/CLAUDE-DEVLOG-SECTION.md`: `project: scribr`, `phase: 1`, `draft: true`, `repo_ref: "phase-1"`. Real decisions (trailing-slash canonicals, island-wraps-list vs DOM-poking enhancement, feedparser over W3C), real failures, real numbers (build time, feed item counts, e2e runtime).

## Stop conditions (all must pass before you report done)

- [ ] `npm run build` exits 0; `npm run check` exits 0 with 0 errors
- [ ] `npm run test:phase0` still exits 0 (schema gate unbroken)
- [ ] `npm run test:phase1` exits 0: draft URL absent, `draft-fixture` in zero `dist/` files, seed post present, all 9 feeds (1 global + 8 project) parse clean with valid channel/item fields
- [ ] `npm run test:e2e` exits 0: chips filter with URL unchanged, no-JS lists posts, post page smoke
- [ ] `dist/sitemap-index.xml` exists and no sitemap file contains `draft-fixture` (covered by test:phase1 walk, but eyeball it)
- [ ] Every built HTML page contains exactly one `<link rel="canonical">` whose href starts `https://brac.dev/` and ends with `/`

## Out of scope (do not touch)

- Styling/typography/OG images (Phase 3) — browser-default HTML is correct here
- Sync script, `scribr.config.json` (Phase 2)
- Demo islands / PixiJS (Phase 4)
- Pagination, search, tag pages — not in the spec at all
- Do not commit — the reviewer commits after approval.

## Report format

Files created/modified; commands run with exit codes; stop-condition checklist pass/fail; deviations with justification.
