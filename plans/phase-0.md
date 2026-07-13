# Phase 0 Implementation Plan — Scaffold & Schema

**Author:** Fable (planner/reviewer)
**Implementer:** Opus agent
**Source docs:** `docs/BUILD-PLAN.md` (Phase 0), `docs/CONTENT-SCHEMA.md`, `docs/SPEC.md` §3
**Repo:** `C:\Users\Ben Bracamonte\Work\scribr` (git repo, branch `main`, docs already committed)

## Critical context: API drift from design docs

The design docs were written against Astro's **legacy** content-collections API. Current stable is **Astro 7.0.7** and the legacy API is **removed**. You MUST use the Content Layer API. Verified facts (July 2026, official docs):

| Design doc says | Implement instead |
|---|---|
| `src/content/config.ts` | **`src/content.config.ts`** (repo root of `src/`, not inside `content/`) |
| `defineCollection({ type: "content", schema })` | `defineCollection({ loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/log" }), schema })` — `glob` from `astro/loaders` |
| `import { z } from "astro:content"` | **`import { z } from "astro/zod"`** (Zod 4 re-export) |
| `entry.slug` | **`entry.id`** (auto-slugified from filename; no `slug` property exists) |
| `entry.render()` | **`render(entry)`** — `render` imported from `astro:content` |

Zod 4 notes: `z.coerce.date()` works; `.refine()` on the object works; custom messages use `{ message: ... }` still accepted but `{ error: ... }` is the Zod 4 idiom — use `{ message: ... }` only if `{ error }` fails typecheck, prefer `{ error }`.

## Pinned dependencies

Install exactly these (as of research):

- `astro@^7.0.7`
- `@astrojs/preact@^6.0.1` + `preact@^10` (peer)
- `@astrojs/mdx@^7.0.2`
- devDeps: `@astrojs/check@^0.9.9`, `typescript@^5`

Do NOT install `@astrojs/rss` / `@astrojs/sitemap` yet (Phase 1). No CSS frameworks, no other deps.

## Scaffold approach

Do **NOT** run `npm create astro` — the directory already exists with `docs/`, `plans/`, `.git`, `.gitignore` and the interactive scaffold is a trap on Windows. Hand-author the minimal project:

1. `package.json` — name `scribr`, private, `"type": "module"`, scripts: `dev`, `build` (`astro build`), `preview`, `check` (`astro check`), `test:phase0` (`node test/phase-0-schema-gate.mjs`).
2. `astro.config.mjs`:
   ```js
   import { defineConfig } from "astro/config";
   import preact from "@astrojs/preact";
   import mdx from "@astrojs/mdx";
   export default defineConfig({
     site: "https://brac.dev",
     integrations: [preact(), mdx()],
   });
   ```
3. `tsconfig.json` extending `astro/tsconfigs/strict`, include `.astro` types per current Astro 7 defaults (`"include": [".astro/types.d.ts", "**/*"], "exclude": ["dist"]`), plus Preact JSX settings (`"jsx": "react-jsx", "jsxImportSource": "preact"`).
4. `src/env.d.ts` if Astro 7 still wants it (check `astro check` output; Astro ≥5 generates `.astro/types.d.ts` on `astro sync` — run `astro sync` once and follow what typecheck demands).

## Files to create

### 1. `src/content.config.ts`

The full schema from `docs/CONTENT-SCHEMA.md` §1, ported to Content Layer + `astro/zod`. Keep every constraint identical: title 8–90, summary 20–160, tags 1–5 lowercase `/^[a-z0-9-]+$/`, `draft` default **true**, project enum exactly `["particlr","haulr","swarmr","herdr","burnrat","crawlers","scribr","field-notes"]`, decisions/benchmarks sub-schemas, `z.coerce.date()`, and the `.refine()` enforcing `phase` + `repo_ref` on non-field-notes posts. Collection name: `log`.

### 2. `src/lib/published.ts`

```ts
import type { CollectionEntry } from "astro:content";
export const published = (e: CollectionEntry<"log">) => !e.data.draft;
```
(Phase 1 will use this everywhere; introduce it now so the post route already filters drafts.)

### 3. `src/content/log/particlr-spatial-hash.md`

The seed post: the **exact example post from `docs/CONTENT-SCHEMA.md` §4, verbatim** — frontmatter and body — with one change: `draft: false` (BUILD-PLAN requires the fixture publishable). Filename must be `particlr-spatial-hash.md` so the route is `/log/particlr-spatial-hash`.

### 4. `src/layouts/Post.astro`

Minimal, semantic, unstyled-is-fine:
- `<html lang="en">`, `<head>` with `<title>`, `<meta charset>`, `<meta name="viewport">`, `<meta name="description" content={summary}>`
- `<article>`: `<h1>{title}</h1>`, `<time datetime>` formatted date, project badge (a `<a href={`/log/${project}`}>` label is fine even though the listing page comes in Phase 1), phase number if present
- Slot for body content
- If `repo_ref` present: "code as of this post" link → `https://github.com/brac/{project}/tree/{repo_ref}`
- Renders `<DecisionTable decisions={...} />` and `<BenchmarkTable benchmarks={...} />` when arrays are non-empty. Per the rendering contract (CONTENT-SCHEMA §3) these belong with the "Decisions" / "Numbers" prose sections, but for Phase 0 render them after the body — placement polish is Phase 3. Note this in a code comment.

### 5. `src/components/DecisionTable.astro`

Props: `decisions: { what; why; alternatives[] }[]`. Render `<table>` with three columns (Decision / Why / Alternatives rejected), alternatives joined with `, `. Return nothing if empty.

### 6. `src/components/BenchmarkTable.astro`

Props: `benchmarks: { metric; value; target }[]`. Three columns (Metric / Value / Target). Return nothing if empty.

### 7. `src/pages/log/[slug].astro`

- `getStaticPaths`: `(await getCollection("log")).filter(published).map(p => ({ params: { slug: p.id }, props: { post: p } }))`
- Render via `const { Content } = await render(post)` inside `Post.astro` layout.

### 8. `src/pages/index.astro`

Bare placeholder ("brac.dev — under construction" + link to `/log/particlr-spatial-hash`). `/log` index itself is Phase 1 — do NOT build it now.

### 9. `test/phase-0-schema-gate.mjs`

Node script (no test framework) proving the schema gate — BUILD-PLAN stop condition 3:

1. Baseline: run `npm run build` (spawn with `shell: true` for Windows) — must exit 0.
2. For each corruption case, copy the pristine seed post to a backup, mutate the file on disk, run `astro build`, **assert nonzero exit**, restore the pristine copy:
   - a. remove the `summary` line entirely
   - b. `project: particlrr` (bad enum value)
   - c. `tags: []`
3. Final: build again clean — exit 0 (proves restore worked).
4. Print a PASS/FAIL line per case; exit 1 if any assertion failed.

Mutations should be done by string manipulation on the raw file (the frontmatter block), not a YAML library — keep it dependency-free.

### 10. `devlog/phase-0-scaffold-and-schema.md`

scribr dogfoods its own devlog contract (`docs/CLAUDE-DEVLOG-SECTION.md`, project slug `scribr`). Write the Phase 0 devlog draft: honest What shipped / Decisions (e.g. the Astro 7 API migration decision, hand-scaffold vs create-astro) / What broke (record real failures you hit) / Numbers (build time, `astro check` results — real measured values) / Next. Frontmatter per contract: `project: scribr`, `phase: 0`, `draft: true`, `repo_ref: "phase-0"` (the reviewer will tag the completion commit `phase-0`). This file lives in `devlog/`, NOT `src/content/log/`, so it does not affect the build.

## Stop conditions (all must pass before you report done)

- [ ] `npm run build` exits 0 with the seed post
- [ ] `npm run check` (`astro check`) exits 0 with 0 errors
- [ ] `npm run test:phase0` exits 0 — all three corruption cases fail the build, clean builds pass
- [ ] `dist/log/particlr-spatial-hash/index.html` exists and contains: the title, both `<table>`s (decision + benchmark content), and all five `##` body sections rendered as `<h2>`

## Out of scope (do not touch)

- `/log` index, filter chips, per-project pages, RSS, sitemap (Phase 1)
- sync script (Phase 2) — do not create `scripts/` or `scribr.config.json`
- styling beyond browser defaults (Phase 3)
- demo islands (Phase 4)
- Do not commit — the reviewer commits after approval.

## Report format

When done, report: files created, exact commands run with exit codes, stop-condition checklist with pass/fail, and anything you deviated from in this plan with justification.
