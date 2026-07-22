---
title: "A /tmp leak at render thirteen: shipping meshcheck's deterministic renderer"
date: 2026-07-14
project: "meshcheck"
phase: 2
tags: [vercel, chromium, swiftshader, determinism, rendering]
draft: false
summary: "Phase 2 ships deterministic server-side rendering; the sustained deploy gates caught a /tmp leak that poisoned instances after twelve renders."
repo_ref: "phase-2"
decisions:
  - what: "The determinism gate is exact-hash on deployed Vercel (rung 0 of the fallback ladder) — no region pinning, per-backend baselines, or external render worker"
    why: "496/496 spike samples across 16 instances and two Xeon steppings produced one sha256 per model, identical to the Windows dev box; at phase close, 36/36 (asset, angle) cells held across 3 runs x 3 deploys and a CPU-tier change moved zero bytes"
    alternatives: ["pin the renderer to one region/instance family", "per-backend baseline hashes", "external GPU/CPU render worker behind the RenderBackend seam"]
  - what: "The renderer emits integer evidence only (pixel counts, bboxes, dimensions); every ratio, threshold, and verdict is computed in Rust against checks.toml"
    why: "Float formatting in TS must never influence the report; integers cross the wasm boundary exactly, and the thresholds-are-data rule stays enforceable in one place"
    alternatives: ["quantized floats computed in TS", "verdicts computed in TS and injected as check results"]
  - what: "Render state on CheckContext is a three-way enum — NotRun ⇒ RND skipped, Failed ⇒ RND engine-error with partial confidence, Evidence ⇒ verdicts"
    why: "checks_only and a crashed renderer are different truths: skipped says we did not look, error says the instrument broke; the Failed path is the SPEC_04 crash-isolation contract"
    alternatives: ["Option<RenderEvidence> (conflates not-run with failed)", "TS-side verdict injection"]
  - what: "Model bytes and raw frames never cross the function boundary: the API stages a payload envelope to private Blob, the renderer uploads finished PNGs/GIFs itself, and only integer evidence plus blob keys travel over HTTP (intra-deployment via VERCEL_URL, renderer behind its own header secret)"
    why: "Vercel function bodies cap at 4.5MB in both directions — a 25MB model, twelve 1024px stills, or 36 raw RGBA frames (~37.7MB) all breach it; VERCEL_URL pins the call to the same deployment (same chromium build), and the production domain is not deployment-protected so the renderer needs its own auth"
    alternatives: ["inline base64 bodies (fails at documented size cliffs)", "streaming responses", "importing the renderer as a module (incompatible function shapes)"]
  - what: "Chromium launches per request into a mkdtemp'd profile removed in the same finally, plus an age-gated stale-dir sweep at handler start; never a module-scope shared browser"
    why: "Shared browsers give shared-fate crashes, and unremoved profiles exhaust /tmp — the exact failure the phase gate later caught in production; warm launch is ~50-70ms against an 8s budget, so per-request isolation costs nothing that matters"
    alternatives: ["module-scope shared browser", "context pool within one invocation", "launch() with a profile arg (playwright rejects --user-data-dir; launchPersistentContext output verified byte-identical)"]
  - what: "Turntables are GIF-only in v1 (mp4 ⇒ BAD_REQUEST), encoded inside the render function with one global palette from frame 0; the Screenshot render_hash is the sha256 of the concatenated per-frame hashes"
    why: "The finished GIF (~470KB for Duck) goes straight to Blob under the body cap; the global palette measured ~266ms vs ~2.7s per-frame for 36x512^2 and removes palette shimmer; hash-of-hashes keeps the contract independent of encoder internals"
    alternatives: ["mp4 encoding", "per-frame palettes", "hashing the GIF bytes"]
  - what: "The /render RenderReport envelope is assembled in Rust via a render_report wasm export, with no native-CLI twin"
    why: "One-serializer discipline — JS never builds report-family JSON; the surface is hosted-only, so parity has no consumer, and byte-stability is covered by a double-call integration test"
    alternatives: ["TS-built envelope", "full native CLI twin plus a parity row"]
  - what: "Hosted functions run on the Performance CPU tier (4GB/2 vCPU) with Fluid in-function concurrency left on"
    why: "Measured on the gate corpus: the tier bump cut single renders ~15% and c4 p95 from 13,498-13,760ms to 8,922ms; disabling packing flattened the extreme tail (p99 12,711 ⇒ 9,702ms) but raised p50 by ~0.9s and left p95 at 9,190ms, so it was reverted"
    alternatives: ["legacy tier via vercel.json memory keys (1.67 vCPU)", "in-function concurrency off (tried on a preview, reverted)"]
  - what: "The full-validate latency gate was revised from a flat p95 < 8s to p95 < 10s at concurrency 4 AND < 8s sequential"
    why: "The flat target predates any renderer: a 3.7MB texture-heavy PBR asset needs ~6.5s of pure SwiftShader render on 2 vCPU, Fluid exposes no per-instance concurrency control, and both available infrastructure levers left c4 p95 at 8.9s; the revision is dated and reasoned in PHASES.md"
    alternatives: ["keep the flat 8s target and hold the phase open", "serialize renders behind an app-level semaphore (queueing disguised as latency)", "an external render worker with dedicated CPU (the RenderBackend seam's later impl, unjustified at current volume)"]
benchmarks:
  - metric: "render_hash stability, deployed (6 assets x 6 angles)"
    value: "36/36 cells identical across 3 runs x 3 deploys and byte-equal to the local table; tier-invariant (12/12 + 6/6 spot-checks plus a 36/36 confirming run after the CPU-tier change)"
    target: "100% identical (Phase 2 gate)"
  - metric: "RND-002 catches invisible, deployed full validate"
    value: "Duck__invisible ⇒ RND-002 fail (0% visible on 6/6 angles), verdict fail; clean Duck ⇒ pass (14.16% min angle)"
    target: "yes (Phase 2 gate)"
  - metric: "renderer crash ⇒ partial report + self-heal, deployed"
    value: "corrupt GLB ⇒ 200 with partial confidence, RND error, screenshots []; immediate next validate healthy with 6 shots; 32/32 sequential soak, 0x5xx, 1 distinct hash"
    target: "verified (Phase 2 gate)"
  - metric: "full validate p95, deployed (60 @ c4 / 10 sequential, 5 GLBs ≤10.6MB, screenshots on)"
    value: "c4 8,922ms; sequential 6,612ms (Performance tier, packing on)"
    target: "< 10s at c4 AND < 8s sequential (revised 2026-07-14)"
  - metric: "full validate c4 p95 across configs (60 requests each)"
    value: "legacy tier 13,760/13,498ms; Performance + packing 8,922ms; Performance packing-off 9,190ms (p99 9,702ms)"
    target: "informational — the lever measurements behind the standing config"
  - metric: "checks_only load regression during the concurrency experiment"
    value: "1200/1200 ⇒ 200 at 20 rps x 60s, p50 159ms, p95 245ms, 0x5xx"
    target: "Phase 1 row stays green (p95 < 4s)"
  - metric: "wasm-vs-native parity (standing gate)"
    value: "28/28 corpus assets + 4/4 render-evidence fixtures byte-identical"
    target: "byte-identical"
---

## What shipped

Rendering went from spec to product surface. The `renderer/` package carries the deterministic harness built in P2M2 — the `studio` rig, one whole-scene camera fit shared across all angles, Draco/meshopt/KTX2 decoders, and a `RenderBackend` seam — and now also the deployed form: `api/render-internal`, a Vercel Large Function running `@sparticuz/chromium` under playwright-core, gated by its own header secret and invoked intra-deployment by the API.

`meshcheck-core` owns the judgment. RND-001/002/003 are registry checks fed by injected integer evidence; `validate_with_render` and `render_report` are new wasm exports; screenshots ride `Report::assemble`'s existing slot. On top of that: `/v1/validate` full mode (Blob staging, six angles, signed `/s/` screenshot URLs bound to report expiry, 2 credits), `/v1/render` returning the Rust-assembled RenderReport, async turntable GIFs, a `RENDER_FAILED` error that is reachable only where the render is the product, and an `invisible` corpus mutation only RND-002 can catch.

## Decisions

The frontmatter carries all nine. The chain that matters most runs through the phase: the P2M1 spike earned the exact-hash gate with 496/496 deployed samples, P2M2 froze the integer-evidence contract that makes TS incapable of influencing verdicts, and P2M5 stress-tested the whole stack — including a CPU-tier migration mid-gate that moved zero hash bytes. The one revised number of the phase is the latency target, and the revision is a decision with named rejected alternatives, not a quiet edit.

## What broke

The centerpiece: **the deployed renderer poisoned its instance after ~12 renders.** The P2M4 plan said "clean the per-launch /tmp profile dir"; the implementation closed the browser but never removed profiles. Hermetic tests and short smokes could not see it. The phase gate's sustained runs hit it in minutes — renders 1-12 byte-correct, render 13 onward failing in ~1.2s with `render function 500`, instance-local, no self-heal, sometimes preceded by blank frames hashing `30e14955…`. Diagnosis was initially blinded because the API discarded renderer 5xx bodies. The fix (9c5dbab) is a per-request mkdtemp profile via `launchPersistentContext` removed in the same `finally`, an age-gated stale sweep, surfaced 5xx bodies, and — same commit — async render jobs learned to unzip bundles, which the gate also exposed.

The latency gate then failed honestly three times: 13.8s, 8.9s after the Performance-tier flip, 9.2s with packing disabled (reverted — worse p50, no p95 gain). We revised the threshold rather than disguise queueing as latency.

Smaller breaks: the `/s/` routes 404'd on first deploy (vercel.json rewrite missing — app mounting and platform routing are separate truths); KTX2Loader's multiline `ktx-parse` import slipped past the vendor sweep; sparticuz v149 required dynamic-import over `require` (`ERR_REQUIRE_ESM`); gifenc has no ESM named exports; review upgraded the internal-key check to a constant-time compare.

## Numbers

Gate evidence lives in `bench_results/phase2-determinism.json`: 36 (asset, angle) cells, one hash each, across three runs on three separate deployments, equal to the local table — FlightHelmet traveling as a 47MB zip through the async path. Latency was measured as the `/v1/validate` POST span (staging PUTs excluded, disclosed), 60 requests at concurrency 4 plus a 10-request sequential sample; the config comparison in the frontmatter is what justified the standing tier. The checks_only load row was re-run mid-experiment and came back better than its Phase 1 value (p95 245ms vs 297ms).

## Next

Phase 3 is distribution: the `meshcheck-mcp` npm package, the Astro site with the drag-and-drop demo on a browser key, and cookbook drafts. Its gate wants a recorded agent transcript naming a real defect, a sub-10s browser demo, and Lighthouse ≥ 90 on the landing page.
