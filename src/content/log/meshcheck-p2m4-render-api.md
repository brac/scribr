---
title: "Rendering becomes product: /render, full-mode validate, and a turntable GIF pipeline"
date: 2026-07-14
project: "meshcheck"
phase: 2
milestone: 4
tags: [vercel, hono, gifenc, rendering, api]
draft: true
summary: "The renderer deploys as a production function; /validate full renders and judges; /v1/render ships RenderReports; turntable GIFs encode inside the renderer."
repo_ref: "p2m4"
decisions:
  - what: "Model bytes and raw frames never cross the function boundary: the API stages a payload envelope to private Blob for the renderer to fetch, the renderer uploads finished PNGs/GIFs to Blob itself, and only integer evidence + blob keys travel over HTTP"
    why: "Vercel function bodies cap at 4.5MB both directions. A 25MB model can't be POSTed to the render function; 12 stills at 1024px can breach the response cap; 36 raw RGBA turntable frames are ~37.7MB. Blob is the only sanctioned bulk channel, so gifenc runs inside the renderer function and the finished GIF (~470KB for Duck) goes straight to storage."
    alternatives: ["inline base64 bodies (breaks at documented size cliffs)", "streaming responses (exempt from the cap but complex for JSON+binary multiplexing)"]
  - what: "API→renderer calls go to https://$VERCEL_URL/api/render-internal with x-vercel-protection-bypass, and the renderer enforces its own x-internal-render-key"
    why: "VERCEL_URL is the immutable per-deployment host — the API always hits the same deployment, hence the same chromium build (determinism). Deployment protection challenges that host, so the bypass system env var rides along. The production domain is NOT deployment-protected, so without its own secret the render function would be publicly invocable after promote."
    alternatives: ["VERCEL_BRANCH_URL / production URL (mutable, can cross deployments mid-rollout)", "importing the renderer as a module (impossible: Large-Function chromium config vs small API bundle)", "OIDC (documented for external backends, not intra-project)"]
  - what: "Chromium launches per request and closes in finally; no module-scope browser reuse across Fluid invocations"
    why: "Field-reported Fluid failures are /tmp exhaustion from accumulated profile dirs and shared-fate crashes where one bad browser poisons concurrent invocations on the instance — the exact failure the crash-isolation gate exists to prevent. Warm launch is ~50–70ms against an 8s budget."
    alternatives: ["module-scope shared browser (faster, but shared-fate + /tmp leak)", "context pool within one invocation (deferred until latency demands it)"]
  - what: "The /render envelope (RenderReport) is assembled and serialized in Rust via a new render_report wasm export, with no native-CLI twin"
    why: "One-serializer discipline: JS never builds report-family JSON. The surface is hosted-only, so wasm-vs-native parity doesn't apply; byte-stability is covered by a double-call integration test (identical modulo meta/URLs)."
    alternatives: ["TS-built envelope (second serializer, drift by construction)", "full native CLI twin + parity row (cost without a consumer)"]
  - what: "Turntable screenshot render_hash = sha256 of the concatenated per-frame hashes; GIF encoding uses one global palette from frame 0"
    why: "SPEC_02's Screenshot has a single render_hash field; hash-of-hashes keeps it deterministic and frame-auditable from the source render. The global palette is 10× faster than per-frame quantization (verified ~266ms vs ~2.7s for 36×512²) and removes palette shimmer."
    alternatives: ["hash of the GIF bytes (couples the contract to encoder internals)", "per-frame palettes (slower, shimmers)"]
benchmarks:
  - metric: "deployed preview smoke (reviewer-run, full path)"
    value: "401 own-auth · full validate 200 in 8.6s with RND pass + 6 shots · signed PNG streams (44,093B) · tampered sig 403 · RenderReport 5.9s · turntable 202→done ~9s, GIF89a 471,036B"
    target: "every new surface exercised on real Vercel before commit"
  - metric: "deployed render_hash vs local P2M2 table"
    value: "Duck front 8b0536c6… — byte-identical deployed vs local"
    target: "same-backend bytes hold through the full production path"
  - metric: "integration suite"
    value: "server 142/142 (15 new render-surface tests + real-chromium e2e incl. invisible-detection through the API), renderer 20/20, cargo 228, parity 28/28 + 4/4"
    target: "all prior gates green + the P2M4 floor covered"
  - metric: "gifenc turntable encode (36×512², global palette)"
    value: "~266ms (10× vs per-frame ~2.7s), byte-deterministic cross-process"
    target: "encode cost negligible on the async path"
---

## What shipped

The renderer is a production Vercel function (`api/render-internal.js`, Large Function, sparticuz chromium, launch-per-request) with its own header auth. `/v1/validate` `mode:"full"` now stages the model to Blob, renders the six rig angles, stores screenshots under signed `/s/` URLs bound to report expiry, and feeds integer evidence into `validate_with_render` — charging SPEC_03's 2 credits (the Phase-1 carve-out is gone, async included via a persisted `charged_cost` for exact refunds). `/v1/render` ships: stills up to 12 angles at 128–1024px with custom background (including `transparent`), returning a Rust-assembled `RenderReport` (new schema file + OpenAPI path), persisted and re-fetchable like reports; turntables always run async and come back as a `kind:"turntable"` GIF screenshot. `RENDER_FAILED` is reachable on `/v1/render` only — a full-validate render failure yields a partial-confidence report, never an error. The retention sweep now expires shot blobs with their report. The P2M1 spike function is deleted from the deploy (source remains, tagged).

## Decisions

See frontmatter — all five came out of the research round's assumption breakers (the 4.5MB caps and the unprotected production domain being the ones that reshaped the design).

## What broke

- **`/s/` routes 404'd on the first preview deploy** — the app mounted the route but `vercel.json` had no rewrite for `/s/(.*)`. Caught by the deployed smoke, not the hermetic suite (which drives `app.fetch` directly and never sees Vercel routing). Fixed with a rewrite entry; a reminder that route mounting and platform routing are separate truths.
- **gifenc's missing ESM exports** cost the first import attempt (`Named export 'GIFEncoder' not found`) — the research round had flagged it; default-import destructure resolved it.
- **Review round:** the internal-key check compared secrets with plain `!==`; upgraded to a constant-time compare since that header is the only auth on the production domain.

## Numbers

The reviewer re-ran every local gate and then probed the deployed preview end-to-end with fresh credentials, including the one path the implementer's smoke had not covered (turntable: submit 202, background job to `done` in ~9s, valid 36-frame GIF) and a negative proof the smoke also lacked (tampered signature → 403). The strongest number is the cross-check: the deployed full-validate Duck front screenshot carries render_hash `8b0536c6…` — byte-identical to the P2M2 local determinism table, meaning the entire production path (Blob staging → sparticuz chromium → readPixels → hash) reproduces the local backend exactly. Full-validate latency on the preview was 8.6s cold-ish for Duck (the P2M5 gate measures p95 properly).

## Next

P2M5 closes the phase: deployed determinism (3 × full clean corpus across cold starts through the production render path), the crash/self-heal test on the deployed function, full-validate p95 < 8s for ≤25MB, the Phase 2 BENCHMARKS rows, and the phase devlog.
