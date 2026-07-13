# scribr — Phased Build Plan

**Version:** 1.0
Each phase ends with machine-verifiable stop conditions (BENCHMARKS-style) plus a reviewer gate. Phase 1 onward, scribr eats its own dogfood: every phase produces its own devlog draft per `CLAUDE-DEVLOG-SECTION.md`.

---

## Phase 0 — Scaffold & schema

**Goal:** Astro site builds with the typed content collection and one hand-written seed post.

Work:
- `npm create astro` + `@astrojs/preact` + `@astrojs/mdx` integrations
- `src/content/config.ts` with the full Zod schema from CONTENT-SCHEMA.md
- Seed post: the example post from CONTENT-SCHEMA.md, committed as a fixture with `draft: false`
- Minimal `Post.astro` layout: title, date, project badge, body — unstyled is fine
- `DecisionTable.astro` + `BenchmarkTable.astro` rendering the frontmatter arrays

Stop conditions:
- [ ] `astro build` exits 0 with the seed post
- [ ] `astro check` exits 0
- [ ] Corrupting any required frontmatter field in the seed post fails `astro build` (verified for: missing `summary`, bad `project` enum value, `tags: []`)
- [ ] `/log/particlr-spatial-hash` renders title, both tables, and body sections

---

## Phase 1 — Routes, index, feeds

**Goal:** Full route surface from SPEC §5.

Work:
- `/log` index, newest-first, drafts excluded via shared `published()` filter
- `FilterChips.tsx` Preact island: client-side project filtering, no reload
- `/log/{project}` listing pages generated from the project enum
- Global `rss.xml` + per-project feeds; autodiscovery `<link>` tags
- Sitemap; canonical URLs on posts; drafts absent from all of the above

Stop conditions:
- [ ] With one `draft: true` fixture present: draft URL 404s in built output, and `grep` finds its slug in zero files under `dist/` (pages, feeds, sitemap)
- [ ] Both feeds validate against the W3C feed validator (or `feedparser` in a script) with 0 errors
- [ ] `/log` with JS disabled still lists all posts (chips are enhancement, not gate)
- [ ] Chips filter without navigation (Playwright: click chip, assert URL unchanged, assert list filtered)

---

## Phase 2 — Sync script

**Goal:** `SYNC-DESIGN.md` implemented and proven against a real repo.

Work:
- `scripts/sync.mjs` per design: sparse shallow clone, skip-if-exists (`.md`/`.mdx`), sync-time frontmatter validation, summary table, exit codes
- `scribr.config.json` with particlr as the first real source
- Enum cross-check between config and content schema at startup
- Fixture-based tests: a `test/fixtures/fake-repo` exercised for each failure mode in SYNC-DESIGN §5

Stop conditions:
- [ ] Sync against fixture repo: fresh file synced, existing `.md` skipped, existing `.mdx` skipped, invalid frontmatter fails with field-level error, wrong `project` field fails — all asserted in a test script exiting 0
- [ ] Sync against the real particlr repo pulls its first genuine devlog draft
- [ ] Running sync twice in a row: second run syncs 0 files, exits 0
- [ ] `time npm run sync` < 15s with two configured repos

---

## Phase 3 — Design pass & OG images

**Goal:** The blog looks like brac.dev built it, and links unfurl properly.

Work:
- Typography/layout pass on Post layout, index, listing pages (this is a design phase — treat fonts, measure, spacing as the deliverable, not an afterthought)
- Per-post OG image generation at build (satori + resvg or `astro-og-canvas`): title, project, brac.dev branding
- Project badges/chips share one visual system across index, post header, OG images
- 404 page; `field-notes` styling for non-phase posts

Stop conditions:
- [ ] Every post page in `dist/` has `og:image`, `og:title`, `og:description`, `twitter:card` meta (asserted by script over built HTML)
- [ ] OG images render correct title/project for 3 spot-checked posts (manual gate)
- [ ] Lighthouse ≥ 95 all categories on `/log` and one post page (CI run, throttled)
- [ ] Zero client JS shipped on a post page without islands (`dist` audit: no `<script type="module">` beyond Astro's optional tiny inline)

---

## Phase 4 — Demo islands

**Goal:** The hard-yes feature: live particlr demo inside a post.

Work:
- `ParticlrDemo.tsx`: Preact island wrapping the particlr runtime + PixiJS, `preset` prop, `client:visible`
- Canvas lifecycle: instantiate on visibility, destroy on unmount, `prefers-reduced-motion` honored (static poster frame instead)
- Convert the relevant particlr devlog post to `.mdx` with an embedded demo — first real MDX post
- Island bundle isolated: PixiJS chunk loads only on pages that embed a demo

Stop conditions:
- [ ] Post without demos: no PixiJS bytes in its page's loaded assets (Playwright network assertion)
- [ ] Post with demo: island loads only after scrolled into view; LCP of the text content < 1.5s throttled (demo below fold must not gate it)
- [ ] Demo runs at 60fps for 30s in Playwright trace without console errors
- [ ] `prefers-reduced-motion: reduce` renders poster frame, zero rAF ticks

---

## Phase 5 — Deploy & analytics

**Goal:** Live at brac.dev/log on Cloudflare Pages, measured by Umami.

Work:
- Pages project wired to repo, build-on-push, preview deployments on PRs
- Apex routing per SPEC decision #12: brac.dev → Pages; project subdomains unchanged → droplet. If apex move is deferred: Caddy `handle /log/*` reverse-proxy fallback configured and documented
- Umami on the droplet (Docker, behind Caddy at an existing subdomain), script tag in scribr layout, localhost/preview traffic excluded
- Redirect map for any existing brac.dev URLs affected by the apex move

Stop conditions:
- [ ] `https://brac.dev/log` serves the built site over the chosen routing; all Phase 1 routes reachable in production
- [ ] Push to main → live deploy with no manual step (verified by content change round-trip)
- [ ] Umami records a pageview from a real visit; preview/localhost visits do not appear
- [ ] Existing production URLs (crawlers.brac.dev, particlr.brac.dev, prior brac.dev pages) all still 200

---

## Phase 6 — First real cycle (process gate, not code)

**Goal:** Prove the loop end-to-end on a live project before calling scribr shipped.

Work:
- Paste `CLAUDE-DEVLOG-SECTION.md` into particlr's and haulr's CLAUDE.md
- Complete one real phase in particlr with the devlog gate active; reviewer enforces the checklist
- Sync → edit (timed) → publish → distribute one post manually (HN/Reddit/social as judged fit)

Stop conditions:
- [ ] A worker-drafted, reviewer-gated, human-edited post is live at brac.dev/log with a demo embed
- [ ] Editing pass took ≤ 20 minutes (if not: the worker contract gets revised before scribr is called done — the 10-minute pass is the product)
- [ ] Post appears in global + particlr RSS feeds
- [ ] Umami shows referrer data from at least one external distribution channel
- [ ] scribr's own six devlog drafts exist in its `devlog/`, ready to be its launch content

---

## Sequencing notes

- Phases 0-2 are pure agent work with fully mechanical gates — good candidates for the standard orchestrator/worker split.
- Phase 3 is taste-heavy; expect a human-in-the-loop iteration cycle rather than one-shot completion.
- Phase 4 depends on particlr's runtime being importable as a package/module; if it isn't yet, a thin extraction task belongs in particlr's roadmap, not scribr's.
- Phase 6 intentionally gates on process economics (the 20-minute ceiling), not code. scribr fails as a product if editing is expensive, regardless of how clean the build is.
