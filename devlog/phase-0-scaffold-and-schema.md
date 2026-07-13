---
title: "Scaffolding scribr on Astro 7's Content Layer, not the docs' legacy API"
date: 2026-07-13
project: scribr
phase: 0
tags: [astro, content-layer, zod, tooling]
draft: true
summary: "Phase 0 stands up the Astro site and the typed content schema. The design docs targeted Astro's removed legacy API; we ported to Content Layer."
repo_ref: "phase-0"
decisions:
  - what: "Port the content schema to the Content Layer API instead of following the design docs verbatim"
    why: "The docs were written against Astro's legacy content-collections API, which is removed in Astro 7.0.7 (current stable); the legacy code would not compile"
    alternatives: ["Pin an older Astro that still ships the legacy API", "Follow the docs literally and let the build fail"]
  - what: "Hand-author the project files instead of running npm create astro"
    why: "The directory already held docs/, plans/, and .git; the interactive scaffold expects an empty dir and its prompts stall in a non-interactive Windows shell"
    alternatives: ["npm create astro in a temp dir then copy files over"]
  - what: "Use the Zod 4 { error } message idiom in the refine, re-exported via astro/zod"
    why: "Astro 7 bundles Zod 4; astro/zod is the supported import and { error } is the current idiom. It typechecked cleanly, so no fallback to { message } was needed"
    alternatives: ["import { z } from astro:content", "keep the legacy { message } key"]
benchmarks:
  - metric: "astro build (2 pages, cold)"
    value: "992ms"
    target: "exit 0 with seed post"
  - metric: "astro check"
    value: "0 errors, 0 warnings, 0 hints (10 files)"
    target: "exit 0, 0 errors"
  - metric: "schema-gate corruption cases caught"
    value: "3 of 3 (missing summary, bad enum, empty tags)"
    target: "all corruptions fail the build; clean builds pass"
---

## What shipped

scribr now builds. Phase 0 stands up a minimal Astro 7 site: `package.json`,
`astro.config.mjs` (site `https://brac.dev`, Preact + MDX integrations),
`tsconfig.json` extending `astro/tsconfigs/strict` with Preact JSX settings,
and the typed content collection in `src/content.config.ts`.

The schema is the full Zod contract from the design docs — title 8-90,
summary 20-160, 1-5 lowercase-slug tags, `draft` defaulting to true, a
`project` enum, decisions/benchmarks sub-schemas, and a `refine` requiring
`phase` and `repo_ref` on any non-`field-notes` post. One hand-written seed
post (`particlr-spatial-hash.md`, `draft: false`) exercises every field.

Rendering is a `Post.astro` layout plus `DecisionTable.astro` and
`BenchmarkTable.astro`, which turn the frontmatter arrays into tables. The
dynamic route `src/pages/log/[slug].astro` filters drafts through a shared
`published()` helper and renders each post. A dependency-free Node script,
`test/phase-0-schema-gate.mjs`, proves the schema actually gates the build.

## Decisions

The load-bearing decision was the API port. The design docs specify the
legacy content-collections API (`src/content/config.ts`, `type: "content"`,
`import { z } from "astro:content"`, `entry.slug`, `entry.render()`). That
API is removed in Astro 7. We moved to the Content Layer: config at
`src/content.config.ts`, a `glob` loader from `astro/loaders`, `z` from
`astro/zod`, `entry.id` for the slug, and `render(entry)` imported from
`astro:content`. The alternative — pinning an old Astro to keep the legacy
API — was rejected because it locks the project to a dead API on day one.

Scaffolding was hand-authored rather than generated. `npm create astro`
assumes an empty directory and runs interactive prompts; this repo already
had `docs/`, `plans/`, and git history, and the prompts do not resolve in a
non-interactive shell. Writing the dozen files directly was faster than
scaffolding elsewhere and reconciling.

## What broke

Nothing in the build broke, largely because the API drift was caught before
writing code rather than after. Had the legacy schema been copied verbatim,
`astro:content` would have rejected `type: "content"` and the unresolvable
`entry.slug`/`entry.render()` calls — the failure would have surfaced as a
config error at build, not a typecheck hint.

The one genuine surprise was `npm install`: esbuild's `postinstall` script
was blocked by the sandbox's `allowScripts` policy, printing a warning that
esbuild's platform binary might be missing. That normally means a broken
build, so it warranted a check — but `astro build` ran esbuild fine, so the
prebuilt binary was already present and the warning was cosmetic. No action
taken beyond confirming the build exits 0.

## Numbers

All measured on this machine (Node 24.15, Windows 11). `astro build`
completes in 992ms for the two static routes. `astro check` reports 0
errors, 0 warnings, 0 hints across 10 files. The schema gate catches all
three corruption cases: removing the `summary` line, `project: particlrr`
(bad enum), and `tags: []` each make the build exit nonzero, and both the
baseline and post-restore clean builds exit 0.

## Next

Phase 1 builds the route surface: the `/log` index (newest-first, drafts
excluded via `published()`), the `FilterChips` Preact island, per-project
listing pages generated from the enum, and the global plus per-project RSS
feeds with a sitemap. The draft-exclusion invariant gets its first real test
there — a `draft: true` fixture must be absent from every page, feed, and
sitemap entry.
