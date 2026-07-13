---
title: "Building scribr's sync script, and watching it reject scribr's own drafts"
date: 2026-07-13
project: scribr
phase: 2
tags: [sync, git, dogfooding, validation]
draft: true
summary: "Phase 2 implements the one-way devlog sync from project repos; dogfooding it against scribr's own drafts caught two schema violations the build never saw."
repo_ref: "phase-2"
decisions:
  - what: "Use HTTPS remotes in scribr.config.json, not the SSH URLs SYNC-DESIGN's example showed"
    why: "This machine's git and gh auth are HTTPS; SSH clones would prompt or fail in the non-interactive shell"
    alternatives: ["git@github.com: SSH remotes, per the design doc's example"]
  - what: "Run the target existence check before frontmatter validation"
    why: "An already-synced file is the editable truth; re-validating it would let a since-fixed origin defect or a human edit re-trigger a failure, and existence-first is what lets the steady-state run exit 0"
    alternatives: ["Validate every source file first, then check existence (re-fails already-synced drafts whose origin copy is invalid)"]
  - what: "Configure two sources — particlr and scribr itself — to dogfood the script"
    why: "Gives the timing gate two configured repos and runs scribr's own devlog content through the same schema the build enforces"
    alternatives: ["Configure only particlr as the single real source"]
  - what: "Relax the schema's phase constraint from positive() to nonnegative()"
    why: "scribr's Phase 0 is a real first-class phase; positive() rejected phase: 0 and failed the build on scribr's own scaffold devlog"
    alternatives: ["Keep positive() and renumber the phase-0 devlog, which would misstate which phase it documents"]
  - what: "Ship yaml as a devDependency and regex-extract the project enum from src/lib/projects.ts"
    why: "Sync is tooling — nothing ships at runtime — and reusing the single source of truth hard-fails a config typo before any clone"
    alternatives: ["Add yaml to runtime dependencies", "Duplicate the enum in the config schema"]
benchmarks:
  - metric: "sync first run (two real repos, HTTPS clones)"
    value: "5.59 s wall"
    target: "< 15 s"
  - metric: "sync steady-state run (all targets present)"
    value: "5.46 s wall"
    target: "< 15 s; 0 synced; exit 0"
  - metric: "fixture suite (test:phase2)"
    value: "23 assertions across 8 failure modes, exit 0"
    target: "all green, no network"
  - metric: "full regression with synced drafts present"
    value: "build/check/phase0/phase1/e2e/phase2 all exit 0"
    target: "all gates exit 0"
  - metric: "synced draft slugs leaked into dist/"
    value: "0 of 3"
    target: "0 (drafts build-excluded)"
---

## What shipped

scribr can now pull devlog drafts out of any configured project repo.
`scripts/sync.mjs` (Node ESM, one dependency: `yaml`) sparse-shallow-clones each
source's `devlog/` directory, renames `phase-N-{slug}.md` to
`{project}-{slug}.md`, validates the frontmatter, and writes it verbatim into
`src/content/log/` — but only if no file of that name already exists, in either
`.md` or `.mdx`. The invariant is one-way and non-destructive: once a draft is
synced, the scribr copy is the editable truth and sync never touches it again.

`scribr.config.json` declares two sources, `particlr` and `scribr` itself.
`test/phase-2-sync.mjs` builds a throwaway git repo at runtime and drives the
real script through eight SYNC-DESIGN failure modes — fresh sync, phase-prefix
stripping, `.md` and `.mdx` skip, invalid frontmatter, a wrong `project` field,
an unreachable repo alongside a good one, and idempotent re-runs — with 23
assertions on exit codes and file effects. `npm run sync` and
`npm run test:phase2` are wired into package.json.

The first genuine content also landed: particlr's phase-7 correctness devlog,
authored in the particlr repo from its real audit and commit history, pushed to
`brac/particlr` main, then pulled through sync byte-identically.

## Decisions

The config uses HTTPS remotes (`https://github.com/brac/{repo}.git`), not the
`git@github.com:` SSH URLs SYNC-DESIGN's example showed, because this machine's
git and gh auth are HTTPS — SSH clones would prompt or fail in the
non-interactive shell.

The most consequential ordering decision is that the existence check runs
before frontmatter validation. An already-synced file that would now fail
validation is not sync's problem: the scribr copy is truth, and re-parsing it
every run would let a since-fixed origin defect, or a human edit, re-trigger a
failure. So sync checks for the target first and reports `exists` without ever
opening it. That is what makes the steady-state second run report zero work and
exit 0 even when a source's origin copy is invalid.

Syncing scribr's own drafts, rather than only particlr, was a deliberate
dogfooding choice: it gives the timing gate its two configured repos and, more
usefully, runs scribr's own devlog content through the same schema the build
enforces. That turned out to matter. The `yaml` package is a devDependency
because sync is tooling and nothing ships at runtime, and the project enum is
regex-extracted from `src/lib/projects.ts` — the same single source of truth the
feed validator reads — so a config typo like `particlrr` hard-fails at startup
before any clone runs.

## What broke

Dogfooding immediately caught two schema violations in scribr's own devlog
drafts — content that had never been validated, because `devlog/` files are not
part of the Astro collection until they are synced in.

First, the phase-1 devlog's `summary` was 175 characters against the schema's
160 maximum. Sync refused it with
`FAILED: phase-1-routes-index-feeds.md — summary: length must be 20–160 (got 175)`
and exited 1 — the field-level gate working as designed. Because sync pulls from
origin, which is not mine to re-push here, the fix went into the editable scribr
copy: the summary was trimmed to 155 characters and the source draft corrected
to match.

Second, and more interesting, the phase-0 devlog carries `phase: 0`, but the
content schema declared `phase` as `z.number().int().positive()` — and
`positive()` rejects zero. The synced file passed sync's presence check, then
crashed the build with `phase: Too small: expected number to be >0`. Phase 0 is
a real, first-class phase (the scaffold phase), so the constraint was wrong, not
the data; I relaxed it to `nonnegative()`. Both defects had sat in committed
content since Phase 0 and Phase 1, invisible because nothing had ever run those
drafts through Zod. Surfacing them is exactly what syncing scribr's own drafts
was for.

A smaller one: on Windows, git's `autocrlf` would rewrite line endings on clone
and break the byte-identity assertion, so the fixture repos commit a
`.gitattributes` with `* -text` and set `core.autocrlf false`. The real particlr
repo already pins `eol=lf` globally, so its draft round-trips byte-for-byte.

## Numbers

Against the two real repos, sync's first run — two files pulled, one already
present — took 5.59 s wall; the steady-state second run, with all three targets
present, took 5.46 s. Both are under the 15 s gate and both are dominated by the
two network clones, not the local work. The fixture suite runs its 23 assertions
across eight failure modes in under a second with no network. With all three
synced drafts present the full regression suite stays green: `astro build`
emits 11 pages in 813 ms (the three drafts validated but excluded from output —
zero of their slugs appear anywhere in `dist/`), `astro check` is clean across
23 files, and the Phase 0, Phase 1, e2e, and Phase 2 gates all exit 0.

## Next

Phase 3 is the design pass and per-post OG images — the first phase where taste,
not a mechanical gate, is the deliverable. The synced drafts now sitting in
`src/content/log/` become the editing backlog that phase and the eventual launch
will draw from.
