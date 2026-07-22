---
title: "One hash, sixteen instances: proving SwiftShader render determinism on deployed Vercel"
date: 2026-07-14
project: "meshcheck"
phase: 2
milestone: 1
tags: [swiftshader, threejs, playwright, vercel, determinism]
draft: true
summary: "A throwaway render function proved render_hash is byte-stable across Vercel cold starts: 496 samples, 16 instances, 2 CPU models, 1 hash per model."
repo_ref: "p2m1"
decisions:
  - what: "The Phase 2 determinism gate stays exact-hash on deployed Vercel (rung 0 of the fallback ladder); no region pinning, per-backend baselines, or external render worker"
    why: "496/496 deployed samples across 16 distinct function instances and two Xeon microarchitectures (2.50GHz and 2.90GHz steppings, iad1) produced one sha256 per model — and those hashes are byte-identical to renders on the Windows dev box. The feared SwiftShader Subzero JIT float-path divergence across x86-64 microarchitectures did not materialize."
    alternatives: ["pin the renderer function to one region/instance family", "per-backend baseline hashes instead of one universal hash", "external GPU/CPU render worker behind the RenderBackend seam"]
  - what: "Ship full @sparticuz/chromium@149.0.0 inside a Vercel Large Function rather than chromium-min + a pack tarball in Blob"
    why: "With VERCEL_SUPPORT_LARGE_FUNCTIONS=1 the assembled function (129MB packed, over 250MB extracted) deploys fine, and the brotli chromium extracts to /tmp in ~2.8s on cold start. The -min + remote-pack path adds a download + a Blob artifact to version for no measured benefit."
    alternatives: ["@sparticuz/chromium-min with the chromium pack hosted in Vercel Blob, fetched on cold start"]
  - what: "The renderer function is not esbuild-bundled: @sparticuz/chromium and playwright-core ship as real npm-installed files (renderer/spike/fn/node_modules via includeFiles) and are required at runtime via createRequire; sparticuz is dynamic-import()ed because v149 is ESM"
    why: "Bundling @sparticuz/chromium breaks its internal binary path resolution, and pnpm's symlinked node_modules is untraceable by Vercel's file tracer — so a self-contained npm install inside renderer/spike/fn is the shippable form. require() on sparticuz throws ERR_REQUIRE_ESM; resolving the path with the CJS resolver then dynamic-importing it works."
    alternatives: ["esbuild-bundle everything like api/index.js (breaks chromium path resolution)", "ship the pnpm store symlinks (NFT cannot trace them)"]
  - what: "Harness assets (HTML + three.js modules + the GLB) are served to the page via Playwright route() interception from an in-memory map, not file:// + import map to on-disk files"
    why: "Identical behavior on the Windows dev box and the Linux function without file://-vs-import-map relative-path fragility; the GLB transfers as a raw Buffer through route().fulfill, never base64."
    alternatives: ["file:// harness with an import map into shipped module files (the plan's original wording)"]
benchmarks:
  - metric: "render_hash stability, deployed (4 models, cold starts forced)"
    value: "496/496 ok samples, exactly 1 hash per model, 16 distinct instances, 2 CPU models, 0 launch failures"
    target: "byte-stable across cold starts on deployed Vercel (Phase 2 gate risk probe)"
  - metric: "local ↔ deployed hash agreement"
    value: "4/4 models identical (Windows SwiftShader = Vercel SwiftShader)"
    target: "same backend contract ⇒ same bytes"
  - metric: "chromium cold launch (extract + boot), deployed"
    value: "median 2795ms (2277–3957ms, 15 cold starts); warm 69ms"
    target: "fits the full-validate p95 < 8s budget with room for render"
  - metric: "warm render per model, deployed (2 vCPU)"
    value: "cube 520ms · Duck 1255ms · Avocado 3142ms · BoomBox 3969ms (median)"
    target: "informational baseline for P2M4/P2M5 latency budgeting"
---

## What shipped

A committed, throwaway-quality spike that answers Phase 2's two gating unknowns with deployed evidence: `api/render-spike.js` (a second Vercel function beside the API) launches `@sparticuz/chromium@149.0.0` through `playwright-core@1.61.1`, renders a procedural cube or one of three corpus GLBs (Duck, Avocado, BoomBox) with `three@0.185.1` under the settled determinism constants (512×512, antialias off, `preserveDrawingBuffer`, `NoToneMapping`, sRGB output, single synchronous render, no rAF), and returns the sha256 of the raw RGBA `readPixels` buffer plus diagnostics (`cpuModel`, module-scope `instanceId`, renderer string, timings). A driver (`scripts/spike-coldstarts.mjs`) forces instance spread via concurrent bursts across four preview deploys and rolls up hash variance by instance and CPU; raw samples live in `bench_results/p2m1-spike-samples.json`.

## Decisions

See frontmatter. The load-bearing one is the first: the exact-hash gate stays on Vercel. The evidence covers two Intel Xeon steppings in one region — real but limited hardware diversity — so the P2M5 full-corpus deployed run re-confirms before the BENCHMARKS row goes green, and the `RenderBackend` seam remains the escape hatch if AMD or another region ever disagrees. The report contract does not move either way.

## What broke

- **First deploy 500'd at boot: `ERR_REQUIRE_ESM`.** `@sparticuz/chromium@149` is ESM-only; the fix is resolving its path with a CJS `createRequire` and then dynamic-`import()`ing the file URL. One redeploy; after it, 496/496 launches succeeded.
- **Predicted Fluid failure modes did not appear.** No `libnss3.so`-type shared-lib errors, no `LD_LIBRARY_PATH`, no `AWS_LAMBDA_*` shims — sparticuz's bundled libs plus its default args (`--use-angle=swiftshader --enable-unsafe-swiftshader --in-process-gpu`) were sufficient on memory 3008.
- **Fluid instance reuse capped instance spread.** GLB models plateaued at 13 distinct instances (target 15) despite 160 samples each at concurrency 16; the cube reached 16. Accepted under the plan's documented-plateau clause (floor was 8).
- **The automation-bypass secret is invisible to `vercel env pull`** — it lives in project settings (`protectionBypass`), not the env table; retrieval is via the projects API. Worth knowing before P2M5's deployed gate runs.

## Numbers

Deployed sampling: four preview deploys, bursts of 16 concurrent requests per model until instance targets or the 160-sample cap; every sample records hash, instanceId (module-scope UUID — distinguishes cold from warm), cpuModel, region, timings. Determinism held across all of it, and the reviewer independently reproduced all four hashes both locally (3 fresh launches) and against the live preview, including a fresh cold start. Warm render cost scales with texture-heavy PBR (BoomBox ~4s at 2 vCPU) — relevant to P2M4's budget for 6-angle stills.

## Next

P2M2 builds the real deterministic harness in `renderer/`: `rig.json` studio rig, camera-fit formula, the six standard angles, Draco/meshopt/KTX2 decoders, per-angle render evidence, and the `RenderBackend` seam with a local backend — validated 3× over the full clean corpus locally.
