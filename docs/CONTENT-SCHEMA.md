# scribr — Content Schema

**Version:** 1.0
**Applies to:** `src/content/log/` in the scribr repo, and `devlog/*.md` in every project repo (same schema; sync copies files verbatim).

---

## 1. Zod schema (`src/content/config.ts`)

```ts
import { defineCollection, z } from "astro:content";

const decision = z.object({
  what: z.string().min(1),
  why: z.string().min(1),
  alternatives: z.array(z.string()).default([]),
});

const benchmark = z.object({
  metric: z.string().min(1),
  value: z.string().min(1),
  target: z.string().min(1),
});

const log = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string().min(8).max(90),
    date: z.coerce.date(),
    project: z.enum([
      // extend as projects are added; enum (not free string) so a typo
      // ("particlrr") fails the build instead of silently forking a feed
      "particlr",
      "haulr",
      "swarmr",
      "herdr",
      "burnrat",
      "crawlers",
      "scribr",
      "field-notes", // ad-hoc manual posts not tied to a project phase
    ]),
    phase: z.number().int().nonnegative().optional(), // absent for field-notes; 0 is valid (phase-gated projects start at Phase 0)
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1).max(5),
    draft: z.boolean().default(true),
    summary: z.string().min(20).max(160),
    repo_ref: z.string().optional(), // required for phase posts, see refine
    decisions: z.array(decision).default([]),
    benchmarks: z.array(benchmark).default([]),
  }).refine(
    (p) => p.project === "field-notes" || (p.phase !== undefined && !!p.repo_ref),
    { message: "phase and repo_ref are required for project posts" }
  ),
});

export const collections = { log };
```

### Schema notes

- **`project` is an enum.** Adding a new project to scribr = one line here + one entry in `scribr.config.json`. A worker typo fails the Pages build rather than creating a phantom project feed.
- **`date` uses `z.coerce.date()`** so `2026-07-13` in YAML parses cleanly.
- **`summary` is length-bounded** because it feeds OG descriptions and RSS `<description>`; 160 chars is the SEO snippet ceiling.
- **`draft` defaults to `true`** — a post missing the flag entirely cannot accidentally publish.
- **`refine`** enforces that phase posts carry `phase` + `repo_ref`, while `field-notes` posts need neither.

## 2. Slug derivation

Filename is the slug. Sync writes files as `{project}-{original-slug-minus-phase-prefix}.md`:

`particlr/devlog/phase-3-collision-rework.md` → `src/content/log/particlr-collision-rework.md` → `brac.dev/log/particlr-collision-rework`

Phase numbers stay out of URLs (they're in frontmatter) so a renumbered roadmap never breaks links.

## 3. Rendering contract

- `decisions[]` renders as a `<DecisionTable />` under the "Decisions" prose section — structured data and narrative coexist rather than duplicating.
- `benchmarks[]` renders as a `<BenchmarkTable />` with value-vs-target, under "Numbers".
- `repo_ref` renders as a "code as of this post" link: `https://github.com/brac/{project}/tree/{repo_ref}`.
- Draft posts are excluded from `getCollection("log")` results at every callsite via a shared `published()` filter — routes, feeds, sitemap, index counts.

## 4. Example post (as a worker would produce it)

```markdown
---
title: "Rebuilding particlr's spatial hash for 2,500 live particles"
date: 2026-07-10
project: particlr
phase: 5
tags: [pixijs, performance, spatial-hash]
draft: true
summary: "The naive O(n²) neighbor pass died at 800 particles. A 64px-cell spatial hash got us to 2,500 at 3.1ms."
repo_ref: "a41f9c2"
decisions:
  - what: "Fixed 64px cell size instead of adaptive cells"
    why: "Presets cluster particle sizes tightly; adaptive sizing added a rebuild cost with no measured win"
    alternatives: ["Adaptive cell sizing per preset", "Quadtree"]
  - what: "Hash rebuilt every tick rather than incrementally updated"
    why: "Full rebuild is 0.4ms at 2,500 particles; incremental bookkeeping was slower to write and easier to get wrong"
    alternatives: ["Incremental insert/remove on movement"]
benchmarks:
  - metric: "neighbor pass @ 2500 particles"
    value: "3.1ms"
    target: "<4.16ms (240Hz budget)"
  - metric: "hash rebuild @ 2500 particles"
    value: "0.4ms"
    target: "<1ms"
---

## What shipped

Phase 5 replaces the naive all-pairs neighbor query with a uniform spatial
hash. Collision-reactive presets (the `ember-*` family and everything using
`repelNeighbors`) now hold frame budget at 2,500 particles, up from ~800.

The hash lives in `src/sim/spatialHash.ts` and is rebuilt at the top of each
fixed tick before behaviors run. Behaviors query it through a single
`neighborsOf(p, radius)` call; no behavior touches particle arrays directly
anymore.

## Decisions

Cell size was the main argument. Adaptive sizing (cells scaled to the
preset's max interaction radius) looked right on paper, but measuring it
showed the rebuild cost eating the win: presets keep particle interaction
radii within a narrow band, so a fixed 64px cell was never more than one
extra cell lookup away from optimal. A quadtree was rejected without
prototyping — rebuild-per-tick favors flat structures, and the sim's
fixed-timestep loop makes per-tick rebuild the simplest correctness story.

Rebuild-vs-incremental went the same way. Incremental updates only pay off
when a minority of particles move per tick; in particlr everything moves
every tick.

## What broke

First implementation hashed on render position, not sim position, which
worked until interpolation was on — then neighbors flickered at cell
boundaries at high time scales. Cost an evening. The fix was hashing on the
fixed-step sim position only, and it exposed that two behaviors were reading
render position for logic, which is now lint-blocked.

## Numbers

Measured on the usual bench rig (M-series laptop throttled profile, 2,500
particles, `ember-drift` preset, 10s capture, p95). Neighbor pass went from
11.8ms all-pairs at 800 particles to 3.1ms hashed at 2,500. Rebuild is
0.4ms and flat with respect to particle motion, as expected.

## Next

Phase 6 targets the renderer: sprite batching audit and moving per-particle
tint math into the shader. Goal is 5,000 particles inside the same budget.
```

## 5. Editing pass (human contract)

What Ben does to a synced draft, for the record:

1. Read once. Cut anything that reads like a changelog.
2. Add the opinion the worker isn't allowed to have.
3. Optionally rename `.md → .mdx` and add embeds (`<ParticlrDemo preset="ember-drift" client:visible />`). MDX only ever enters at this step.
4. Flip `draft: false`. Commit. Push. Pages builds and validates.
