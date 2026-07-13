---
title: "Wiring scribr's route surface: index, per-project feeds, and one Astro bug"
date: 2026-07-13
project: scribr
phase: 1
tags: [astro, rss, routing, playwright]
draft: true
summary: "Phase 1 builds the /log index, per-project listings, nine RSS feeds, sitemap, and canonicals — and works around an Astro trailing-slash bug that breaks dynamic feed endpoints."
repo_ref: "phase-1"
decisions:
  - what: "trailingSlash: always for the whole site; canonicals and feed links carry the slash"
    why: "One canonical URL shape (https://brac.dev/log/{slug}/) is the docs-recommended pairing with the default directory build format and the least-friction option on Cloudflare Pages"
    alternatives: ["trailingSlash: never", "trailingSlash: ignore (no enforcement)"]
  - what: "FilterChips server-renders the full chip row and post list; hydration only adds filtering"
    why: "JS-disabled visitors still see every post — chips are enhancement, not a gate — with no separate no-JS code path to maintain"
    alternatives: ["Ship an empty list and populate it client-side", "Enhance a server-rendered list by DOM-poking after load"]
  - what: "Validate built feeds with feedparser against dist/ files, not the W3C validator"
    why: "No network, no external API, runs offline in CI; feedparser is maintained and parses on Node 24"
    alternatives: ["W3C Feed Validation Service (HTTP)", "hand-rolled XML assertions"]
  - what: "Per-project feeds are concrete injected routes, not a dynamic src/pages/log/[project]/rss.xml.ts"
    why: "Astro 7.0.7 miscompiles a getStaticPaths endpoint that has a file extension under trailingSlash: always; concrete routes skip the broken dynamic-path generation while still deriving from the PROJECTS enum"
    alternatives: ["Dynamic getStaticPaths endpoint (the plan's original design; does not build)", "Eight hand-written static feed files"]
benchmarks:
  - metric: "astro build (11 pages + 9 feeds + sitemap)"
    value: "697ms (11 pages), ~2.5s wall incl. npm"
    target: "exit 0"
  - metric: "astro check"
    value: "0 errors, 0 warnings, 0 hints (21 files)"
    target: "exit 0, 0 errors"
  - metric: "feed validation (feedparser)"
    value: "9 of 9 feeds parse clean, all item links absolute + trailing slash"
    target: "0 parse errors"
  - metric: "playwright e2e (chromium)"
    value: "3 passed in 3.0s"
    target: "exit 0"
---

## What shipped

Phase 1 turns the Phase 0 stub into the full route surface from SPEC §5. There
is now a `/log` index that lists every published post newest-first, per-project
listing pages at `/log/{project}` (chronological, one for every enum value even
when empty), a global `/rss.xml`, eight per-project feeds at
`/log/{project}/rss.xml`, an `@astrojs/sitemap` output, `robots.txt`, and
canonical URLs on every page.

The project enum moved to `src/lib/projects.ts` as the single source of truth:
the content schema imports it, the listing pages and feeds iterate it, and the
feed-validation script reads it. A new `Base.astro` holds the shared `<head>`
(charset, viewport, title, description, canonical, RSS autodiscovery, sitemap
link); `Post.astro` and the index both wrap it. `FilterChips.tsx` is the only
island — a Preact `useState` component that renders the chip row plus the whole
post list server-side and filters in place on click, with no navigation and no
URL change.

Three gates ship with it. `test/phase-1-draft-exclusion.mjs` builds, then
asserts a permanent `draft: true` fixture is absent from every file under
`dist/`. `test/validate-feeds.mjs` parses all nine feeds with feedparser.
`e2e/log-index.spec.ts` drives chromium through the chip-filter, no-JS, and
post-smoke cases.

## Decisions

The load-bearing decision was the feed route shape, forced by a bug (see below).
The others were straightforward. `trailingSlash: "always"` gives one canonical
shape and matches `@astrojs/rss`'s default `trailingSlash: true`, so feed
`<link>`s and page canonicals agree without extra config. The cost is that
dev/preview 404 non-slashed URLs, so every internal link is written with the
slash.

The index island renders the complete list on the server rather than shipping an
empty shell. That satisfies "chips are enhancement, not a gate" with no second
code path: with JS off, hydration simply never attaches and the chips are inert
buttons over a full list. The alternative — server-render a plain list and then
DOM-poke it after load — needs the island to find and mutate markup it did not
own, which is more fragile than owning the render outright.

Feed validation runs feedparser over the built `dist/` files. The W3C validator
is an HTTP service; using it would put a network dependency in the gate. Parsing
the built artifacts offline is both faster and a truer check — it validates
exactly what deploys.

## What broke

The dynamic per-project feed endpoint the plan specified —
`src/pages/log/[project]/rss.xml.ts` with `getStaticPaths` — does not build under
`trailingSlash: "always"`. The build fails with
`TypeError: Missing parameter: project` while generating
`/log/particlr/rss.xml/`.

The cause is a genuine Astro 7.0.7 inconsistency. For an endpoint route that has
a file extension, Astro compiles the route pattern with a per-route `"never"`
trailing-slash override (`create-manifest.js`), so the pattern is
`/log/([^/]+)/rss.xml` with no trailing slash. But the static-path generator
(`runtime/prerender/static-paths.js`) stringifies the pathname with the global
`manifest.trailingSlash` — `"always"` — producing `/log/particlr/rss.xml/`. That
generated path can never match its own pattern, so `pattern.exec` returns no
params, `stringifyParams` is handed an empty object, and it throws on the missing
`project`. Confirmed by flipping the config to `"ignore"`, which builds all nine
feeds cleanly; `7.0.7` is the latest 7.0.x, so there is no patch to take.

The fix keeps `trailingSlash: "always"` and replaces the dynamic endpoint with a
small `projectFeeds()` integration that `injectRoute`s one concrete route per
`PROJECTS` entry, all pointing at `src/endpoints/project-rss.ts`. Concrete
(non-parameterized) routes take the `route.pathname` shortcut and skip the broken
dynamic-path code entirely — the same path the working global `/rss.xml` uses.
The endpoint reads its project from `context.url.pathname`. Feeds still derive
from the enum, so adding a project still adds its feed with no extra file.

## Numbers

Measured on this machine (Node 24.15, Windows 11). `astro build` emits 11 pages,
9 feeds, and the sitemap; Astro reports 697ms for the pages, ~2.5s wall including
npm overhead. `astro check` is clean across 21 files. feedparser validates all
nine feeds with zero parse errors and confirms every item link is absolute and
trailing-slashed; the global feed carries the one published post and the draft
fixture appears in no feed. The Playwright suite runs three chromium tests in
3.0s. The draft-exclusion walk scanned 28 built files and found `draft-fixture`
in none.

## Next

Phase 2 implements the sync script from SYNC-DESIGN.md: sparse shallow clones of
each configured project repo, skip-if-exists, sync-time frontmatter validation,
and an enum cross-check between `scribr.config.json` and the schema. The first
real draft — particlr's — gets pulled through it.
