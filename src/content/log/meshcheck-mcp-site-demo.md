---
title: "meshcheck goes public: an MCP server, a demo you can't scrape clean, a 9.7-second gate"
date: 2026-07-14
project: "meshcheck"
phase: 3
tags: [mcp, astro, vercel, demo, watermark]
draft: false
summary: "Phase 3 shipped meshcheck-mcp, the public demo path with plan-forced watermarks, and the Astro site — all four gates green on deployed production."
repo_ref: "phase-3"
decisions:
  - what: "npm publish deferred; the e2e gate runs from a packed tarball via npm i -g"
    why: "Ben holds the npm names but wasn't logged in; npx-from-tarball re-extracts every run (~960 ms measured)"
    alternatives: ["publish 0.x immediately", "npx -y ./tgz per run", "node <abs path> (rejected: skips bin wiring)"]
  - what: "No outputSchema on any MCP tool; reports ride as verbatim text blocks"
    why: "Declared structured output forces structuredContent and fights the mixed text+image result render_model needs"
    alternatives: ["outputSchema + structuredContent on validate_model"]
  - what: "Watermark invariant rides the PLAN, not the demo route"
    why: "Any demo-plan account gets stamped output on every render path — a leaked server-held key can never yield clean shots"
    alternatives: ["watermark flag set only by the demo route"]
  - what: "Watermark stamped AFTER render_hash + evidence, onto copies"
    why: "Corpus hashes and RND evidence stay byte-identical to Phase 2; only stored pixels carry the mark"
    alternatives: ["stamp before hash (rejected: breaks determinism gates)", "post-process blobs in the API (rejected: renderer stores PNGs directly)"]
  - what: "Static Astro site inside the same Vercel project via outputDirectory site/dist; a build guard fails the build if the site emits /llms.txt, /openapi.json, /v1, /s, or /api"
    why: "Vercel serves filesystem before rewrites — one stray static llms.txt would silently shadow the API's"
    alternatives: ["separate site project (rejected: cross-origin demo, second deploy pipeline)", "@astrojs/vercel adapter (rejected: fights the prebuilt pipeline)"]
  - what: "Demo route is multipart-only, no url/blob_id input"
    why: "Keeps the SSRF surface entirely off the unauthenticated path"
    alternatives: ["mirroring all three /v1/validate input modes"]
benchmarks:
  - metric: "e2e agent transcript (validate → defect named)"
    value: "recorded — agent named GEO-003, 422/4,212 faces (10.02%) vs 5% threshold on Duck__flip_faces"
    target: "recorded (PHASES.md Phase 3)"
  - metric: "browser demo, corpus file → report + shots, deployed"
    value: "9,675 ms (DamagedHelmet.glb 3.77MB, cold render, 6 watermarked shots loaded)"
    target: "< 10 s"
  - metric: "Lighthouse landing, deployed, desktop preset"
    value: "100 / 100 / 100 / 100 (perf / a11y / best-practices / seo)"
    target: "≥ 90"
  - metric: "llms.txt + openapi.json reachable post-site"
    value: "200 both; full live-smoke pass"
    target: "yes"
---

## What shipped

Phase 3 made meshcheck usable by someone who isn't us. `meshcheck-mcp` is a real npm package (unpublished, by decision): four tools over the official SDK — validate_model, render_model with up to three inline base64 stills, inspect_model (passes through the Phase-4-pending API error verbatim), get_report — with `~`/CWD path resolution, plan-cap size routing into the presigned Blob flow, and transparent 2-second job polling so agents never see a 202 envelope.

The API grew its one public unauthenticated route: `POST /v1/demo/validate`, multipart-only, 5/hour/IP token bucket spent before body parsing, authenticating internally as a demo-plan account via a server-held key. Every rendering path watermarks demo-plan output with a procedural "MESHCHECK DEMO" stamp — a hardcoded 5×7 bitmap font, zero dependencies, applied only after render_hash and RND evidence are computed from the pristine buffer.

The Astro site (landing, five docs pages, two cookbook drafts, the drag-and-drop demo island at 12.99 KB gzipped) deploys inside the same Vercel project as static output. Production was promoted at phase start and redeployed at phase close with everything above; meshcheck.dev and api.meshcheck.dev are attached pending registrar DNS.

## Decisions

The frontmatter list is the record; two deserve context. The watermark placement question — route flag vs plan property — looks small but decides whether a leaked demo key matters. We put the invariant on the plan so routes/validate, routes/render, and both async runners all force it from `plan.name === 'demo'`; the demo route is just another caller. And the site/API cohabitation hinged on one Vercel routing fact: the filesystem wins over rewrites. Rather than trusting ourselves to never add a static `llms.txt`, the site build fails if any API-owned path appears in its output — the reviewer proved the guard fires by planting one.

## What broke

Piping the demo key into `vercel env add` from PowerShell stored an **empty value** while reporting success. Diagnosis was doubly masked: `vercel env ls` lists the variable normally, and `vercel env pull` writes empty for sensitive-typed vars by design. The deployed route returned "demo not configured" against a provably correct database — the split test that cracked it was using the same key as a normal `X-Api-Key` header against the same deployment (200) while the env-dependent path 500'd. Re-adding via bash `printf` fixed it. Two preview deploys were burned bisecting this.

Smaller: `astro dev`'s on-demand TSX transform intermittently failed to hydrate the demo island, so click-through testing moved to the built bundle behind a same-origin mock; Astro's default image service wanted sharp (we pass through pre-sized images instead); the first Lighthouse pass scored a11y 0.94 for heading order and an unlabeled file input, fixed to 1.0; and the reviewer's first demo-gate Playwright run set the file before the `client:visible` island had hydrated — scroll first, then drop.

## Numbers

All four Phase 3 BENCHMARKS rows measured on deployed production. The demo gate is the honest squeaker: 9,675 ms from file-drop to six loaded screenshots for a 3.77 MB texture-heavy PBR asset on a cold render — inside the 10-second target with 3% to spare, and consistent with Phase 2's sequential full-validate p95 of 6.6 s plus upload and image delivery. Lighthouse came back 100 across all four categories on both the implementer's preview run and the reviewer's independent deployed run. The MCP integration suite (21 tests) runs against production in ~9 s and burns ~23 credits per cycle. The e2e transcript gate recorded a four-turn session in which the agent, given only the MCP server, named the planted defect and its exact measurements.

## Next

Phase 4 is billing and launch: Paddle sandbox lifecycle against the credit ledger, the /inspect vision endpoint, registry submissions (npm publish unblocks the `npx meshcheck-mcp` story), and the 48-hour staging soak. The smoke/loadtest accounts and the phase smoke key get revoked before launch.
