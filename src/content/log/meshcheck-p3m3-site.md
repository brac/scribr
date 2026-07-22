---
title: "A static Astro site with one island: landing, docs, and the drag-and-drop demo"
date: 2026-07-14
project: "meshcheck"
phase: 3
milestone: 3
tags: [astro, preact, lighthouse, vercel]
draft: true
summary: "The meshcheck site ships as static Astro with a single Preact demo island, a build guard against API-shadowing paths, and Lighthouse 1.0 across the board."
repo_ref: "p3m3"
---

# P3M3 — Astro site (raw material for phase-3 devlog)

Milestone draft, not the gated artifact.

## What shipped

`site/`: static Astro 7 site (`astro@7.0.9` + `@astrojs/preact@6.0.1`, no adapter) — landing (hero + curl, seven check families, live demo, MCP quickstart, pricing verbatim from SPEC_03, privacy commitments verbatim), five docs pages authored from the SPECs, two cookbook drafts (Meshy/Tripo loops). One hydrated island: the drag-and-drop demo (Preact, 12.99 KB gzipped, `client:visible`), calling `POST /v1/demo/validate` relative-URL with no key in the client; handles 429 with humanized Retry-After, 4.4 MB client-side cap, sample-file one-click (bundled Duck.glb served same-origin). Deploy integration: `vercel.json` `outputDirectory: "site/dist"` + site build appended to buildCommand; `api/` functions untouched.

The llms.txt shadowing hazard (filesystem beats rewrites on Vercel) is enforced by a build guard that fails the build if `site/dist` ever contains `/llms.txt`, `/openapi.json`, `/v1`, `/s`, or `/api`. Reviewer negative-proved it: planting a test `site/public/llms.txt` fails the build with the exact hazard message; removal restores green.

## Decisions

- Docs authored fresh in `site/src/content/` from the SPECs rather than importing repo SPEC files raw (they contain internal build notes). Machine-readable sources (/llms.txt, /v1/openapi.json, schemas) linked instead of duplicated.
- `passthroughImageService` instead of sharp: the default optimizer needs a native binary that complicates the prebuilt Vercel pipeline; the one hero image is pre-sized 512×512 (108 KB). Perf still 1.0.
- Demo click-through verified against a same-origin mock serving the BUILT site + canned SPEC_02 report (the plan's sanctioned option — production demo route 500s until the P3M4 redeploy). `astro dev`'s on-demand TSX transform was flaky for hydration; the compiled-bundle mock is more faithful anyway.
- No external resources at all (fonts system-stack, zero third-party scripts); landing ships zero JS beyond the island bootstrap.

## What broke

- `astro dev` intermittently failed to hydrate the island ("Failed to fetch dynamically imported module: Demo.tsx") — dev-transform flake, not a product bug; testing moved to the built output.
- Astro's default image service errored `MissingSharp` on this machine — switched to passthrough (decision above).
- First Lighthouse pass: a11y 0.94 (heading order, unlabeled file input, dropzone accessible-name mismatch) — fixed to 1.0.

## Numbers

- Lighthouse (desktop preset, all four categories, astro preview): implementer 1.0/1.0/1.0/1.0; reviewer re-measured independently: 1.0/1.0/1.0/1.0. Hard gate re-runs on the deployed site at P3M4.
- Island JS 12.99 KB gzipped (budget < 30 KB); landing weight 136.9 KB excl. demo results (budget < 300 KB).
- 9 pages built in ~0.9 s; vercel build output verified: static root + both functions, zero shadowed API paths.
- Full regression: server 154, renderer 27, mcp 21 (live vs production), typecheck clean workspace-wide.

## Next

P3M4: attach meshcheck.dev (consent stop), production deploy, run the four Phase 3 gates deployed (demo < 10 s, Lighthouse ≥ 90, llms.txt/openapi reachable, e2e transcript already recorded), BENCHMARKS green, phase devlog, tag phase-3.
