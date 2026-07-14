# Adversarial code review — 2026-07-13

Full-repo adversarial review of scribr (site source, sync pipeline, scripts, tests, e2e, config).
Method: three parallel review passes (scripts/sync, site source, tests/config), each finding
independently verified against the actual code — several against the installed `node_modules`
sources — plus a separate secrets/git-history sweep. Findings that could not be traced to a
concrete failure scenario were dropped.

**Verdict:** the core product invariants hold — no draft leakage on any output surface, no
XSS/injection paths, no secrets in the working tree or git history. The real weaknesses are in
the *meta* layer: the sync script can silently lose posts and validates less than it claims, two
test gates can go green while proving nothing, and the demo island leaks a live WebGL loop on a
mid-init failure.

Severity: **HIGH** = can lose content or let a real regression ship green · **MEDIUM** = concrete
defect with a plausible trigger · **LOW** = real but narrow, or requires an unusual state.

---

## Summary

| #  | Severity | Location | Defect |
|----|----------|----------|--------|
| 1  | HIGH   | `scripts/sync.mjs:240` | Phase-prefix stripping collapses same-slug posts across phases; the second post is silently dropped as a benign "exists" |
| 2  | HIGH   | `test/phase-1-draft-exclusion.mjs:32` | Draft-exclusion gate is vacuous if the draft fixture is deleted — all assertions are negatives |
| 3  | HIGH   | `playwright.config.ts:8` / `package.json` | `test:e2e` never builds; Playwright validates whatever stale `dist/` is on disk |
| 4  | MEDIUM | `scripts/sync.mjs:269` | No catch around per-file I/O — a bad `contentDir` or any FS error aborts the run mid-source with a raw stack trace |
| 5  | MEDIUM | `scripts/sync.mjs:104` | Sync validation is shallower than the Zod schema it claims to mirror; type-invalid drafts enter the backlog and detonate the Astro build later |
| 6  | MEDIUM | `scripts/lighthouse.mjs:68,130` | Static server has directory traversal and binds `0.0.0.0` — LAN-readable arbitrary files for the duration of the gate |
| 7  | MEDIUM | `src/components/ParticlrDemo.tsx:74–165` | Mid-init failure leaks a running Pixi Application: orphaned canvas + permanent rAF/WebGL loop behind the error message |
| 8  | MEDIUM | `src/components/ParticlrDemo.tsx:110–120` | Effect cleanup reads `app.canvas` *after* `app.destroy()` (which nulls the renderer) → guaranteed `TypeError` whenever cleanup runs post-init |
| 9  | MEDIUM | `test/validate-feeds.mjs:65` | Per-project feeds pass all assertions when empty — only the global feed has a minimum-item check |
| 10 | MEDIUM | `test/phase-3-meta.mjs:187` | Hardcoded `correctness-seams` draft check false-fails the day that post is published; redundant with the set-equality check above it |
| 11 | MEDIUM | `playwright.config.ts` | No `forbidOnly: !!process.env.CI` — a committed `test.only` silently guts CI coverage |
| 12 | MEDIUM | `playwright.config.ts:11` | `reuseExistingServer` on port 4321 can silently attach e2e to a running `astro dev` instead of the built dist |
| 13 | MEDIUM | `test/phase-0-schema-gate.mjs:25–84` | Test mutates the real tracked seed post in place; a mid-build kill strands the corruption, and the `.bak` restore file is not gitignored |
| 14 | LOW    | `scripts/sync.mjs:127` | Rejects omitted `draft:` key that the Zod schema legally defaults to `true` |
| 15 | LOW    | `scripts/sync.mjs:224–286` | Clone failures don't increment `failed` → summary prints "0 failed → exit 1" |
| 16 | LOW    | `scripts/sync.mjs:189` | No `--` separator / scheme allowlist on config `repo` → git option / `ext::` transport injection via a PR that only touches `scribr.config.json` |
| 17 | LOW    | `docs/SYNC-DESIGN.md` §2 | Doc says the enum is extracted from `src/content/config.ts`, a file that doesn't exist (code correctly reads `src/lib/projects.ts`) |
| 18 | LOW    | `scripts/lighthouse.mjs:66` | `decodeURIComponent("/%")` throws in the request handler → uncaught exception kills the gate mid-run, orphaning Chromium and the temp profile |
| 19 | LOW    | `scripts/lighthouse.mjs:134` | No `error` handler on the Chromium spawn — missing Playwright browsers crash with a raw ENOENT and leak the profile dir |
| 20 | LOW    | `scripts/lighthouse.mjs:126` | `median()` returns the upper-middle element for even run counts — gate silently becomes more lenient on scores if `numberOfRuns` goes even |
| 21 | LOW    | `src/components/ParticlrDemo.tsx:152` | Reduced-motion path stops the page-global `Ticker.shared`/`Ticker.system` — freezes any future second Pixi island on the page |
| 22 | LOW    | `src/pages/og/[...route].ts:20` | A post named `log.md` silently overwrites the site-default OG card (no collision guard on the `pages` map, unlike page routes) |
| 23 | LOW    | `src/content.config.ts:19` / `[slug].astro` | `**/*` loader glob accepts nested files → slash-containing ids escape the `/log/{slug}/` URL contract |
| 24 | LOW    | `src/layouts/Post.astro:40` | REF link hardcodes `github.com/brac/{project}` — dead link for a field-notes post carrying a (schema-legal) `repo_ref`, and brittle if repo names ever diverge from project names |
| 25 | LOW    | `src/components/ParticlrDemo.tsx:183` | Demo failure message lives inside an `aria-hidden` container — screen-reader users get only an unexplained disabled button |
| 26 | LOW    | `e2e/demo.spec.ts:39` | "Nothing loads before scroll" assertion runs synchronously after `load` — an eager-load regression via `requestIdleCallback` slips through the gap |
| 27 | LOW    | `e2e/log-index.spec.ts:28` | "URL must not change" chip assertion races a would-be navigation |
| 28 | LOW    | `e2e/demo.spec.ts:53` | 30s rAF fps ≥ 50 gate is a CI flake risk on shared runners (fails in the safe direction) |
| 29 | LOW    | `test/phase-2-sync.mjs:80` | `git init -b main` result unchecked (unlike every other git call in the file) |
| 30 | LOW    | `.gitignore` | Three overlapping env patterns; `.env*` also blocks ever committing a `.env.example` template |

---

## High severity

### 1. Sync silently loses posts when slugs collide across phases — `scripts/sync.mjs:239–249`

```js
const slug = base.replace(/^phase-\d+-/, "");
const stem = `${project}-${slug}`;
...
if (existsSync(targetMd) || existsSync(targetMdx)) {
  skipped++;
  console.log(`  ${pad(project)} exists: ${stem}.md`);
```

Two devlog files with the same post-phase slug — e.g. `phase-3-retro.md` and `phase-7-retro.md`
in one repo — both map to `{project}-retro.md`. The lexically-first syncs; the second hits the
existence check and is logged as `exists`, counted in `skipped`, exit 0. SYNC-DESIGN §5 calls
"exists" the normal steady state, so nothing ever flags it: a distinct post silently never enters
the editing backlog. Plausible in practice — this repo's own history has repeated "retro" posts.
SYNC-DESIGN only considers cross-*project* duplicates ("impossible by construction"); within-project
cross-phase duplicates are unhandled.

**Fix:** detect when a target stem was already produced *by this run or a differently-named source
file* — e.g. record the source filename in a manifest, or fail when two files in one source dir
map to the same stem.

### 2. Draft-exclusion gate proves nothing if the fixture disappears — `test/phase-1-draft-exclusion.mjs:32–57`

Every draft assertion is a negative ("`draft-fixture` absent from dist"):

```js
report(
  "dist/log/field-notes-draft-fixture/ does not exist",
  !existsSync(join(dist, "log", "field-notes-draft-fixture"))
);
```

Delete or rename `src/content/log/field-notes-draft-fixture.md`, then break the draft filter
entirely — the gate stays green forever. The fixture's own prose admits "deleting it would remove
the only proof," but the test doesn't enforce its presence. The same gap infects the
`draft fixture absent` check in `test/validate-feeds.mjs:82–84`.

**Fix:** before checking dist, assert the fixture source file exists and contains `draft: true`.

### 3. e2e suite validates stale builds — `playwright.config.ts:7–12`

```ts
// `npm run build` must run before the e2e suite (preview hangs without dist/).
webServer: { command: "npm run preview", ... }
```

The comment documents the dependency; nothing enforces it. Break the island in source, run
`npm run test:e2e`, and preview serves last week's `dist/` — suite passes. With no `dist/` at all
you get an opaque 120s webServer timeout instead of "you forgot to build."

**Fix:** `command: "npm run build && npm run preview"` (or chain it in the package script).

---

## Medium severity

### 4. One FS error aborts the whole sync run — `scripts/sync.mjs:218–282`

The per-source `try` has only a `finally`. `contentDir` is validated as a non-empty string but
never checked to exist: a typo like `"src/content/logs"` makes every existence check false, then
the first valid file throws `ENOENT` from `writeFileSync` — run dies mid-source with a raw stack
trace, no summary, remaining sources unprocessed. This contradicts SYNC-DESIGN §5's
log-and-continue contract. Worse, a wrong-but-existing `contentDir` would re-pull every
already-synced post as an "unedited original" — exactly the resurrection §3 exists to prevent.

**Fix:** verify `contentDir` exists at startup; wrap the per-file body in a catch that counts a
failure and continues.

### 5. Sync validation is shallower than the schema it claims to mirror — `scripts/sync.mjs:104–110`

Only *presence* of `phase`/`repo_ref` is checked; the Zod schema requires
`phase: z.number().int().nonnegative()` and validates `decisions`/`benchmarks` item shapes.
A draft with `phase: two`, or a `decisions:` entry missing `why`, syncs cleanly (exit 0) and then
fails `npm run build` pointing at the *scribr* copy — the exact failure mode SYNC-DESIGN §3 says
sync-time validation exists to prevent. Once written, the file passes the exists-check forever, so
re-running sync never re-flags it.

### 6. Lighthouse static server: directory traversal + all-interfaces bind — `scripts/lighthouse.mjs:65–69,130`

```js
const full = join(dist, p);            // no containment check
...
await new Promise((r) => server.listen(serverPort, r));   // binds 0.0.0.0
```

`GET /..%2f..%2f..%2f<path>` resolves outside `dist/` and gets served (unknown extensions fall
back to `application/octet-stream`). Because the server binds all interfaces, any machine on the
LAN can read user-readable files for the several minutes the gate runs.

**Fix (two lines):** `server.listen(serverPort, "127.0.0.1", r)` and reject when
`!full.startsWith(dist + sep)` after the join.

### 7. Demo island leaks a live WebGL loop on mid-init failure — `src/components/ParticlrDemo.tsx:74–165`

`cleanup` is assigned only after the entire happy path succeeds (line 121). The canvas is appended
at line 74. If `new Effect(...)` throws or `await view.ready` rejects (e.g. a corrupt embedded
texture in a vendored `.prt`), the catch sets `failed` but never destroys the already-initialized
`Application`: orphaned canvas in `.demo-stage`, autostarted ticker running a permanent
rAF + WebGL loop behind the "could not be loaded" message, for every reader who scrolls the demo
into view.

**Fix:** initialize `cleanup` incrementally (assign a partial destroy as soon as `app.init`
resolves), or destroy `app`/`view` in the catch.

### 8. Effect cleanup crashes after `app.destroy()` — `src/components/ParticlrDemo.tsx:110–120`

```ts
app.destroy(true, { children: true });
if (app.canvas && app.canvas.parentNode) {   // TypeError: renderer is null
```

Pixi v8's `Application.destroy()` nulls `this.renderer` (`node_modules/pixi.js/lib/app/Application.js:203`),
and `get canvas()` is `return this.renderer.canvas`. Any cleanup after successful init —
dev HMR of the island module, a future move to View Transitions, a `presetText` dep change —
throws inside Preact's commit phase. Only the current pure-MPA flow (full page unloads) keeps this
latent. The canvas-removal block is also dead code: `app.destroy(true, …)` already detaches the
canvas.

**Fix:** capture `const canvas = app.canvas` *before* destroy, or just delete the removal block.

### 9. Empty per-project feeds pass validation — `test/validate-feeds.mjs:65–101`

Only the global `rss.xml` gets `requireSeed`; the nine project feeds have no minimum-item check,
so the per-item loop and the draft check are vacuous over an empty channel. A regression that
emits zero items for particlr (4 published posts) passes everything.

**Fix:** `requireSeed` the particlr feed too (the seed post is `project: particlr`), or assert
item counts derived from frontmatter.

### 10. Hardcoded draft slug is a time bomb — `test/phase-3-meta.mjs:187–190`

```js
report(
  "no draft OG image leaked",
  ![...actualOg].some((n) => n.includes("draft") || n.includes("correctness-seams"))
);
```

`particlr-correctness-seams.md` is currently `draft: true`; the day it's published its OG image is
legitimate and this assertion fails a correct build. Any future published slug containing the
substring "draft" also false-fails. The set-equality check directly above it
(`OG inventory == {published ids} ∪ {log}`) already covers draft leaks completely.

**Fix:** delete the assertion, or derive draft names from frontmatter.

### 11–13. Playwright / phase-0 hygiene

- **No `forbidOnly`** (`playwright.config.ts`): a committed `test.only` reduces CI to one test,
  green. Add `forbidOnly: !!process.env.CI`.
- **`reuseExistingServer: !process.env.CI`** on port 4321 — `astro dev`'s default port. A
  forgotten dev server means local e2e runs against dev-mode output; some tests fail loudly, but
  the filtering/smoke tests "pass" against the wrong artifact.
- **phase-0 mutates the tracked seed post in place** (`test/phase-0-schema-gate.mjs`): Ctrl+C
  during any of the five multi-second `astro build` child runs skips the `finally` restore,
  leaving corrupted frontmatter in `src/content/log/particlr-spatial-hash.mdx` plus an unignored
  `test/particlr-spatial-hash.mdx.bak`. Add `*.bak` to `.gitignore` and a SIGINT restore handler
  (or copy the seed to a temp content dir instead of mutating the real one).

---

## Low severity

- **14.** `sync.mjs:127` rejects a draft with no `draft:` key, which the schema legally defaults
  to `true` — a false-failure trap that contradicts the "mirrors the Zod schema" comment.
  (Arguably intended strictness; if so, document it in SYNC-DESIGN.)
- **15.** `sync.mjs:224–286` — clone failures set `dirty` but don't increment `failed`; a red run
  can end `N synced, M skipped, 0 failed → exit 1`.
- **16.** `sync.mjs:180–192` — no `--` before the `repo` positional and no scheme allowlist:
  a config value of `--upload-pack=...` is parsed as a git option and `ext::` is a
  command-executing transport. Attack path is a PR that only touches `scribr.config.json`
  followed by your next `npm run sync`. Cheap fix: prepend `--` and require `https://`/`git@`.
- **17.** SYNC-DESIGN §2 points enum extraction at `src/content/config.ts`, which doesn't exist;
  code correctly reads `src/lib/projects.ts`. Doc is the contract other tooling is described
  against — fix the doc.
- **18.** `lighthouse.mjs:66` — `decodeURIComponent` throws `URIError` on malformed
  percent-encoding (e.g. `GET /%`); uncaught in the request handler, it kills the process
  mid-gate, orphaning Chromium and the temp profile. Combined with the `0.0.0.0` bind (#6), a
  stray LAN port scan can fail the gate.
- **19.** `lighthouse.mjs:134` — no `error` listener on the Chromium spawn; missing Playwright
  browsers → raw `spawn ENOENT` crash, `finally` never runs, profile dir leaks.
- **20.** `lighthouse.mjs:124–127` — `median()` picks the upper-middle for even N. Harmless at
  `numberOfRuns: 3`, but flipping the config to 4 silently loosens the score gates.
- **21.** `ParticlrDemo.tsx:152–153` — reduced-motion path stops the *global* `Ticker.shared` /
  `Ticker.system`. With two Pixi islands on one page, pressing play on demo A leaves anything on
  the shared ticker (e.g. a future `AnimatedSprite`) frozen.
- **22.** `og/[...route].ts:20–31` — publishing `src/content/log/log.md` (schema-valid; "log" is
  not a project, so `prerenderConflictBehavior` never fires) silently replaces the site-default
  OG card used by home, `/log/`, all project pages, and 404. Guard the key or reserve the name.
- **23.** `content.config.ts:19` — the `**/*.{md,mdx}` loader glob accepts nested files, producing
  slash-containing ids that `[slug]` emits as multi-segment URLs off the `/log/{slug}/` contract.
  Content is flat today; restrict to `*.{md,mdx}` to make nesting a loud failure.
- **24.** `Post.astro:36–42` — REF href hardcodes `https://github.com/brac/{project}`. A
  field-notes post with a (schema-legal) `repo_ref` links to a nonexistent `brac/field-notes`;
  the pattern also breaks if any repo name diverges from its project name. Worth confirming the
  `brac` org itself is correct for all four projects.
- **25.** `ParticlrDemo.tsx:183–189` — the failure message renders inside the
  `aria-hidden="true"` stage; assistive-tech users get only a disabled play button with no
  explanation. Move the error text outside the hidden container or into the figcaption.
- **26.** `e2e/demo.spec.ts:39–43` — the pre-scroll "no pixi requests" assertion runs in the gap
  before a `requestIdleCallback`-scheduled import would fire; a regression to `client:idle` can
  pass. The sibling test at lines 24–27 settles first (`networkidle` + 500ms) — do the same here.
- **27.** `e2e/log-index.spec.ts:28–31` — `expect(page.url()).toBe(urlBefore)` immediately after
  `click()` can run before a would-be navigation commits.
- **28.** `e2e/demo.spec.ts:53–86` — fps ≥ 50 over 30s of rAF sampling will intermittently dip on
  shared CI runners from host contention alone. Fails in the safe direction; expect flaky reds.
- **29.** `test/phase-2-sync.mjs:80` — `git init -b main` status unchecked; on git < 2.28 the
  failure surfaces later as a confusing `git config ... failed`.
- **30.** `.gitignore` — `.env`, `.env.*`, and `.env*` overlap; `.env*` also prevents committing a
  future `.env.example` without `git add -f`.

---

## Verified clean

- **Draft leakage:** all six output surfaces (log index, project pages, `[slug]` static paths,
  global RSS, per-project RSS, OG route) filter through the single `published` predicate; drafts
  get no route, so the sitemap can't contain them. Schema defaults `draft` to `true` — the
  fail-safe direction.
- **XSS / injection:** zero uses of `set:html` / `innerHTML` / `dangerouslySetInnerHTML`; all
  frontmatter flows through Astro/Preact auto-escaping; RSS titles/descriptions are
  entity-escaped by `@astrojs/rss`; `customData` is a fixed literal.
- **Secrets:** `.env.local` is untracked, no `.env*` or `.vercel` file was ever committed
  (checked `git log --all --diff-filter=A`), and `git ls-files` shows nothing sensitive tracked.
- **Feeds/sitemap/dates:** GUIDs are permalink URLs, trailing slashes match canonicals, pubDates
  are RFC-822; `@astrojs/sitemap` auto-excludes 404/500 and non-page routes; date handling is
  UTC-consistent end to end.
- **Routing:** all nine project pages + feeds emit (including empty ones, per spec);
  `prerenderConflictBehavior: "error"` guards page-route collisions.
- **`client:lazyidle`:** the `readyState === "complete"` guard closes the missed-`load` race,
  `{ once: true }` prevents double hydration, `requestIdleCallback` has a fallback.
- **`FilterChips`:** SSR and initial client render are identical, no listeners to leak, full
  no-JS fallback.
- **`scripts/fonts-woff2.mjs`**, **`scribr.config.json`** (as data), **`tsconfig.json`**,
  **`lighthouserc.cjs` wiring** (the gate genuinely builds first and consumes every threshold),
  **frontmatter parsing in sync** (CRLF, BOM, `---` in body all handled), and **temp-dir
  cleanup** (`finally` + `maxRetries`, correct for Windows) — no findings.

## Suggested triage order

1. #1 (sync data loss) — small guard, protects content.
2. #2 + #3 (vacuous gates) — the tests exist to catch regressions; right now two of them can't.
3. #7 + #8 (demo island teardown) — one small refactor of `destroy`/`cleanup` fixes both.
4. #6 (lighthouse server) — two-line fix, removes a LAN exposure.
5. #10 (phase-3 landmine) — delete one redundant assertion before it fires.
6. Everything else opportunistically.
