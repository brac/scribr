# Phase 3 Implementation Plan — Design Pass & OG Images

**Author:** Fable (planner/reviewer)
**Implementer:** Opus agent
**Source docs:** `docs/BUILD-PLAN.md` (Phase 3), `docs/SPEC.md` §5–6
**Baseline:** `phase-2` tag. All gates green: build/check/phase0/phase1/phase2/e2e.

## Research-verified facts (July 13, 2026)

1. **`astro@7.0.8` published today fixes the extension-endpoint bug** (verified by repro: `[slug].png.ts` fails on 7.0.7, builds clean on 7.0.8). Upgrade to `^7.0.8` first.
2. **OG images: `astro-og-canvas@0.13.0`** (peer `astro ^5||^6||^7`, pure CanvasKit WASM — identical on Windows dev and Cloudflare Pages linux CI). Its documented route shape `src/pages/og/[...route].ts` with `OGImageRoute({ param: "route", ... })` puts `.png` inside the rest-param value and is immune to the bug on either version. Accepts local `.ttf` font paths.
3. **Fonts API is stable in Astro 7** (no experimental flag): `fonts: [{ provider, name, cssVariable }]` in config + `<Font cssVariable=... preload />` from `astro:assets` in the head. Self-hosts at build (`_astro/fonts`, no runtime Google requests), auto-generates fallback fonts. `fontProviders.local()` takes `variants: [{ src, weight, style }]`.
4. **@fontsource ships no TTFs** — satori/og-canvas need TTF/OTF/WOFF (no WOFF2). Therefore: commit TTFs under `src/assets/fonts/` and feed the same files to both the Fonts API (local provider) and og-canvas.
5. **Lighthouse gate: `@lhci/cli@0.15.1` autorun with `staticDistDir`** (serves `dist/` itself, median of `numberOfRuns: 3`, declarative `minScore` assertions). Point at Playwright's chromium via `CHROME_PATH` env. This beats lighthouse-vs-preview on flakiness.
6. **Zero-JS is literal**: a no-island Astro 7 static page emits **zero `<script>` tags of any kind** (empirically verified). Audit can assert `<script` count == 0 on post pages.
7. **404**: `src/pages/404.astro` emits flat `dist/404.html` even with `trailingSlash: "always"`; Cloudflare Pages serves it automatically.

## Part A — Platform updates (do first, in order)

1. `npm install astro@^7.0.8` (and let `@astrojs/*` ranges float within installed majors). Full regression suite must pass before proceeding.
2. **Attempt to retire the feeds workaround**: restore the plan-original dynamic endpoint `src/pages/log/[project]/rss.xml.ts` (`getStaticPaths` over `PROJECTS`, `GET` via `context.params.project`, same rss() options as `src/endpoints/project-rss.ts`), delete `src/endpoints/project-rss.ts` and the `projectFeeds()` integration from `astro.config.mjs`. If the build emits all 8 feeds at the same URLs and `test:phase1` passes → keep the simplification. If the bug still bites this exact shape → revert to the workaround, note it in the report, and move on. Either way the feed URLs and contents must be byte-stable (validate-feeds passes unchanged).

## Part B — Design brief (the deliverable; follow it, don't improvise a different aesthetic)

**Concept: the phase artifact as an engineering record.** scribr posts are phase artifacts — decisions, failures, measured numbers. The design renders each post as a **lab/engineering record**, and the signature element is a **title block**: the bordered metadata grid from engineering drawings, carrying project / phase / date / repo_ref at the top of every post. Structure encodes real metadata; nothing is decorative.

### Tokens (CSS custom properties in `src/styles/global.css`, `:root` + `@media (prefers-color-scheme: dark)`)

Light ("bond paper", cool — deliberately NOT warm cream):
- `--paper: #F6F7F5` (page), `--panel: #FDFDFC` (table/title-block fill)
- `--ink: #1A1D1B` (text), `--graphite: #57605B` (secondary text, labels)
- `--rule: #D5DAD6` (borders/hairlines)
- `--pass: #1D7A4F`, `--broke: #B3402E` — **semantic only**: pass/fail affordances in benchmark contexts, the "What broke" heading marker, link underlines on hover. Never used as decoration, backgrounds-at-large, or brand gradient.

Dark (auto via `prefers-color-scheme`): `--paper: #151815`, `--panel: #1C201D`, `--ink: #E4E8E4`, `--graphite: #9AA49E`, `--rule: #2D332F`, `--pass: #43B37F`, `--broke: #E0654F`.

### Type

- **Display/headings + all data/labels: `IBM Plex Mono`** — h1 in mono 600 is the aesthetic risk, and it is deliberate: the record is machine-scribed. h1 clamp(1.5rem, 4vw, 2.25rem), tight leading (1.15), letter-spacing -0.01em. Section `h2`s: mono, small (0.95rem), uppercase, letter-spacing 0.08em, `--graphite`, preceded by a short rule — they read as record section stamps (`WHAT SHIPPED`, `WHAT BROKE`...).
- **Body: `Source Serif 4`** — long-form text face, 1.0625rem/1.65, `--ink`, measure `max-width: 68ch`.
- No third face. Bold sparing; italics for emphasis only.
- Fonts via the stable **Fonts API with `fontProviders.local()`**: commit `src/assets/fonts/IBMPlexMono-Regular.ttf`, `IBMPlexMono-SemiBold.ttf`, `SourceSerif4-Regular.ttf`, `SourceSerif4-It.ttf`, `SourceSerif4-Semibold.ttf` (TTFs from the google/fonts GitHub repo — OFL licensed; include the OFL.txt files beside them). `<Font ... preload />` for the two primary faces only. Same TTFs feed og-canvas (fact #4).

### Layout & components

- **Title block (signature — post pages)**: directly under the h1, a bordered 1px `--rule` grid on `--panel`, mono 0.8rem, single row on desktop / 2×2 on mobile: `PROJECT ▸ particlr` (links to `/log/particlr/`) · `PHASE 07` (zero-padded; cell absent for field-notes) · `DATE 2026-07-12` · `REF 745e6a9` (links to the GitHub tree; cell absent when no repo_ref). Labels in `--graphite` uppercase, values in `--ink`. This grid IS the post header metadata — remove the current loose `<p>` of date/badge/phase and the separate "code as of this post" line (the REF cell replaces it).
- **Page frame**: centered column, `max-width: 44rem` for prose; `padding-inline: 1.25rem` mobile. A thin site header on every page: `brac.dev` (link home, mono) · `/ log` (link to index) · right-aligned `rss` link. No nav bar beyond this. Footer: single mono line, `--graphite`: `© Ben Bracamonte · feeds: global / per-project` (linked).
- **Tables (Decision/Benchmark)**: full-bleed-ish within measure, `--panel` background, 1px `--rule` borders, mono 0.85rem, th uppercase `--graphite`, generous cell padding. Benchmark table: value column in `--ink` 600; a met target gets a `✓` prefix in `--pass` — determine "met" ONLY by rendering the check when target starts with `<`/`≤`/`>=` comparison AND the value/target are not comparable? No — too clever. Simpler rule: every benchmark row gets a `--pass`-colored `✓` in a leading column; this is a *record of gates passed* (benchmarks in these posts are by contract the numbers that satisfied stop conditions). Note this reasoning in a comment.
- **Both tables get an `overflow-x: auto` wrapper** — no horizontal page scroll on mobile.
- **Index (`/log/`)**: h1 `devlog`, one-line description in serif `--graphite`, then FilterChips. Each post entry: mono metadata line (`2026-07-12 · particlr · phase 07`) above a serif title link (1.25rem, 600) and a serif summary line in `--graphite`. Entries separated by 1px `--rule` hairlines, roomy (`padding-block: 1.25rem`). Chips: mono 0.8rem `<button>`s, 1px `--rule` border, 2px radius, transparent bg; `[aria-pressed="true"]`: `--ink` bg / `--paper` text. Focus-visible: 2px outline `--ink`, offset 2px.
- **Project listing pages**: same entry treatment, plus a small title-block-style header strip: `PROJECT ▸ {name}` / post count / `rss` link. Empty state: "No posts yet." in serif `--graphite`.
- **field-notes styling**: posts and entries with `project === "field-notes"` render their title block without PHASE/REF cells and the project cell reads `FIELD NOTES` (no link to a project page… it still has one — link it, it's in the enum). Visually identical otherwise — the absence of cells IS the differentiation.
- **404 (`src/pages/404.astro`)**: title block pastiche: `STATUS ▸ 404` / `REF not-found`, one serif line ("This page doesn't exist. The log index does."), link to `/log/`. Uses Base (canonical fine), noindex meta.
- **Links**: serif body links underlined with `text-underline-offset: 3px`, `--ink`; hover shifts underline color to `--pass`. Mono/metadata links: no underline, hover underline.
- **Motion**: none beyond color/underline transitions ≤150ms. Nothing to gate behind reduced-motion, but include the `prefers-reduced-motion` kill-switch block anyway (future-proof, zero cost).
- **Quality floor**: visible keyboard focus everywhere; contrast — verify `--graphite` on `--paper` ≥ 4.5:1 in both schemes (adjust the value if not, keep the hue); tables scroll not squish; print stylesheet NOT in scope.

### CSS mechanics

- One global stylesheet `src/styles/global.css` imported in `Base.astro`, plus Astro scoped `<style>` in components where local. **No CSS framework, no resets beyond a ~10-line modern normalize written inline.** Keep total CSS lean (< ~8 KB raw). No JS added anywhere by this phase.

## Part C — OG images

1. `npm i astro-og-canvas` (0.13.x).
2. `src/pages/og/[...route].ts` using `OGImageRoute`:
   - `pages`: every **published** post (import the collection via `getCollection` — og-canvas accepts a plain record; key = post id) **plus** two synthetic entries: `log` (the index card: title "devlog", description "decisions, failures, numbers — brac.dev") and one per project? **No** — v1 scope is per-post + index only. Project listing pages reuse the `log` card.
   - `getImageOptions`: title = post title, description = summary, `bgGradient: [[21,24,21]]` (the dark `--paper` — OG cards are always the dark scheme for feed contrast), `border: { color: [67,179,127], width: 12, side: "block-end" }` (the `--pass` accent as a bottom rule), `padding: 72`, `font`: title mono semibold / description serif regular from the committed TTFs, `fonts: [paths]`, logo: none (text branding instead — og-canvas `title`/`description` only; put `brac.dev/log` in the description line if the API has no third slot — check its options; if it supports a `logo` image only, skip branding text beyond what fits).
3. `Base.astro` gains props `ogImage?: string` (path like `/og/{id}.png`) and emits: `og:title`, `og:description`, `og:type` (`article` on posts via a new `article` boolean prop, else `website`), `og:url` (canonical), `og:image` (ABSOLUTE `new URL(ogImage ?? "/og/log.png", Astro.site)`), `og:site_name` (`brac.dev`), `twitter:card` = `summary_large_image`. Post.astro passes `ogImage={`/og/${post.id}.png`}` + `article`. Index/listing/404 default to `/og/log.png`.

## Part D — Gates

### `test/phase-3-meta.mjs` (node, dependency-free, runs `npm run build` first like the other gates)

For every `dist/**/*.html`:
- exactly one `og:title`, `og:description`, `og:image`, `twitter:card` meta; `og:image` is absolute `https://brac.dev/og/...png` and **the referenced file exists in `dist/`**;
- canonical still present exactly once.
For every **post** page (`dist/log/*/index.html` excluding the 8 project listing dirs — derive the exclusion from `PROJECTS`):
- `og:type` == `article`;
- **zero `<script` occurrences** (fact #6);
- title block present: the four (or two, for field-notes) mono labels rendered.
For `/log/` index: at least one `<script type="module">` (the island — sanity that hydration still ships there and only there: also assert zero `<script` on `/` and project pages).
PASS/FAIL lines; exit 1 on failure.

### Lighthouse (`lighthouserc.cjs` + `scripts/lighthouse.mjs` + `npm run test:lighthouse`)

- `scripts/lighthouse.mjs`: sets `process.env.CHROME_PATH = chromium.executablePath()` (from `@playwright/test`), then spawns `npx lhci autorun` inheriting stdio; exits with its code.
- `lighthouserc.cjs`: `collect: { staticDistDir: "./dist", url: ["http://localhost/log/", "http://localhost/log/particlr-spatial-hash/"], numberOfRuns: 3 }`, `assert` all four categories `minScore: 0.95` (error level). devDep: `@lhci/cli@^0.15`.
- BUILD-PLAN's gate is "Lighthouse ≥ 95 all categories on `/log` and one post page" — these two URLs are exactly that.

### Devlog

`devlog/phase-3-design-og.md` — `project: scribr`, `phase: 3`, `draft: true`, `repo_ref: "phase-3"`. Real decisions (title block, mono display risk, semantic-only color, og-canvas over satori, lhci over raw lighthouse, workaround retirement outcome), real failures, real numbers (Lighthouse scores ×4 for both URLs, CSS bytes, OG render count + build-time delta, font bytes).

## Stop conditions (all must pass)

- [ ] Full regression: `build`, `check`, `test:phase0`, `test:phase1`, `test:phase2` (fixture suite), `test:e2e` all exit 0 (e2e may need selector updates for new markup — update assertions, not intent)
- [ ] `npm run test:phase3` (the meta audit) exits 0
- [ ] `npm run test:lighthouse` exits 0 — ≥95 all four categories on both URLs (report the actual scores)
- [ ] OG spot-check (report, reviewer will eyeball): `dist/og/particlr-spatial-hash.png`, `dist/og/particlr-correctness-seams.png`… exist wait — correctness-seams is a DRAFT, it must NOT get an OG page. Only published posts + `log.png`. Assert in test:phase3: `dist/og/` contains exactly {published post ids} ∪ {log}.png — a draft OG image is a draft leak.
- [ ] `dist/404.html` exists, styled, zero scripts
- [ ] No horizontal overflow at 360px viewport on a post page (add a Playwright assertion: `document.documentElement.scrollWidth <= 360`)
- [ ] Feed workaround retirement resolved one way or the other with evidence

## Out of scope

- Demo islands/PixiJS (Phase 4); deploy/analytics (Phase 5)
- Editing/publishing any draft; no new posts
- View transitions, search, comments, pagination, theme toggle (auto scheme only)
- Do not commit — reviewer commits.

## Report format

Files created/modified; commands + exit codes; the four Lighthouse scores per URL; OG inventory; workaround-retirement outcome with evidence; stop-condition checklist; deviations with justification.
