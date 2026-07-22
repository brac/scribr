---
title: "A deterministic UV rasterizer, twelve texture checks, and a duck that would not pass"
date: 2026-07-13
project: "meshcheck"
phase: 0
milestone: 4
tags: [rust, gltf, uv, rasterization, determinism]
draft: true
summary: "The six UV checks on a shared integer rasterizer and the six MAT checks complete all 28 Phase 0 deterministic checks; Duck.glb's UVs genuinely overlap."
repo_ref: "p0m4"
decisions:
  - what: "Shared UV rasterizer: integer edge-function scanline, top-left fill rule, sampled at texel centres on a ×2 integer lattice"
    why: "Determinism first — no anti-aliasing, no floating accumulation into the grid, no SIMD. Integer edge functions with the top-left rule count a texel straddled by two edge-sharing triangles exactly once. Sampling at centres (vertices on even lattice points, samples on odd) avoids the corner-vertex double-exclusion that pixel-corner sampling produces."
    alternatives: ["tiny-skia / lyon (AA + SIMD are a determinism liability)", "pixel-corner sampling (the shared quad corner ends up owned by neither triangle)"]
  - what: "One occupancy grid per textured material, built at most once per Scene behind an OnceLock, consumed by UV-002/UV-005/MAT-006"
    why: "Materials share texture space, so all of a material's triangle-list primitives rasterize into one grid. The grid is derived state like the geometry kit, so it caches on the Scene; the OnceLock makes a single build safe under the parallel check engine."
    alternatives: ["rebuild per consuming check (three 8.7ms builds for Duck instead of one)"]
  - what: "grid_size lives in the params of every grid-consuming check (UV-002/UV-005/MAT-006), all set to the spec constant 1024"
    why: "Config delivers params per check, but the OnceLock build needs the grid from whichever consumer runs first. Duplicating the value keeps each check self-describing and magic-number-free while a single shared build stays consistent because the values are identical."
    alternatives: ["a fallback constant in code (violates the no-magic-number rule)", "threading the whole ChecksConfig into CheckContext"]
  - what: "Non-tiling triangles are translated by the integer floor of their per-axis minimum UV, not fract() per vertex"
    why: "Per-vertex fract() collapses a legitimate full [0,1] quad because fract(1.0) = 0. Translating the whole triangle by floor(min) lands compact islands in [0,1) (equivalent to fract() for islands that do not straddle an integer boundary) without collapsing edge-aligned UVs."
    alternatives: ["fract() each vertex independently (full-square UVs collapse to zero span)"]
  - what: "Tiling triangles (UV span > 1 on an axis) excluded from the grid and counted; exact/mirrored UV triples deduped by their sorted bit-key before rasterizing"
    why: "Binding P0M4 decisions: tiling is UV-003's domain, not overlap; SPEC_01's 'excluding exact mirrored duplicates' is read as bit-equal UV vertex sets (a mirror only reverses winding, so the sorted-vertex key catches it)."
    alternatives: ["rasterize tiling geometry into the grid (turns intentional tiling into false overlap)"]
  - what: "Profile-conditional escalation via a new CheckContext.profile_name plus an escalate_profiles string-array config param (MAT-003)"
    why: "Generalizes SPEC_01's 'warning for mobile' into config-driven data: when the active profile name is in escalate_profiles, the effective severity escalates to escalate_to and the info check warns. No profile name is hardcoded in check code."
    alternatives: ["hardcoding a `== \"mobile\"` test in MAT-003 (embeds policy in code)"]
  - what: "SceneMaterial gains base_color_image, has_metallic_roughness_texture, and texture_images (image indices)"
    why: "MAT-005 needs to know which materials lack a base-color / metallic-roughness texture; UV-005/006 and MAT-006 need the material's declared texture dimensions, resolved from referenced image indices."
    alternatives: ["re-walking the glTF document inside each check (parsing already resolved this)"]
  - what: "Duck.glb's UV warns are accepted as true positives (reviewer ruling after the STOP report); the expected-warning exception is deferred to the M5 corpus manifest per SPEC_06"
    why: "Duck's authored UVs genuinely overlap — summed UV-triangle area 1.197 exceeds its UV bounding box 0.919, impossible without overlap (near-mirror same-region texturing of its era, not bit-exact, so the mirrored-duplicate exclusion correctly does not fire; an independent Python rasterizer agrees: 94.46% vs our 94.37%). Thresholds untouched; the Duck integration test locks verdict warn with exactly UV-002/004/005 tripped, and Duck enters corpus/clean/ in M5 with documented exceptions"
    alternatives: ["tuning uv_overlap_pct until Duck passes (hides a defect class the product exists to catch)", "swapping Duck for a different Khronos model (loses a realistic textured regression)"]
  - what: "clean_textured.gltf provides the clean-textured-pass regression Duck was originally slated for"
    why: "Something must prove a textured model CAN pass every check end-to-end. Two closed regular tetrahedra, each unwrapped as a connected 4-triangle net island: watertight (GEO stays clean), islands ~24px apart at the 64px texture scale, zero overlap, exactly uniform texel density (p95 stretch = 1.0), ~29% coverage so even MAT-006 reports zero findings — pc verdict pass with zero warnings"
    alternatives: ["a flat textured quad (its open boundary trips GEO-002, so the verdict could never be pass)"]
benchmarks:
  - metric: "Duck.glb UvRaster::build, 1024 grid, 4212 tris (release, 2k iters)"
    value: "8740 us/iter"
    target: "single shared build per report; feeds the Phase 0 perf baseline"
  - metric: "Duck.glb full report (release CLI, pc)"
    value: "total 22ms, checks 20ms, parse 0ms"
    target: "well under the Phase 0 checks_only budget"
  - metric: "cargo test --workspace"
    value: "182 passing (153 core + 17 integration + 12 corpus), 3 ignored"
    target: "all green"
  - metric: "cargo clippy --workspace --all-targets -- -D warnings"
    value: "clean"
    target: "no warnings"
  - metric: "wasm32 --no-default-features build of meshcheck-core"
    value: "compiles (rasterizer is pure integer math)"
    target: "rasterizer must build for wasm"
---

## What shipped

meshcheck now has all 28 Phase 0 deterministic checks. This milestone added the six UV checks and the six MAT checks, plus the shared UV rasterizer they stand on (`crates/meshcheck-core/src/uvraster.rs`). The rasterizer builds one occupancy grid per textured material: every triangle-list primitive bound to that material rasterizes into it via an integer edge-function scanline with the top-left fill rule, sampled at texel centres on a ×2 integer lattice. It records saturating coverage counts, island labels (triangle-connectivity components over exact-welded UV vertices), and tiling/dedupe counts. It caches on the `Scene` behind an `OnceLock`, mirroring the geometry kit, and is consumed by UV-002 (overlap), UV-005 (island padding via a multi-source BFS distance transform), and MAT-006 (coverage-vs-declared resolution).

UV-001 (missing UVs), UV-003 (outside [0,1]), UV-004 (texel stretch), and UV-006 (density variance) round out the UV group; the stretch and density checks are per-triangle distributions rather than grid consumers. The MAT group covers texture resolution, memory, NPOT (with profile-conditional escalation), material count, PBR value sanity (surface-area-weighted via the geometry kit), and oversized textures. `SceneMaterial` grew texture-image bookkeeping, `CheckContext` grew `profile_name`, and `CheckParams` grew a string-array getter for `escalate_profiles`. Six fixtures joined the corpus: Duck.glb (Khronos, pinned SHA), four tiny hand-authored `data:`-URI trip assets (one per target check), and `clean_textured.gltf` — two watertight tetrahedra with well-separated UV net islands that pass every check on `pc` with zero warnings, the proof that a textured model *can* come through clean.

## Decisions

The rasterizer is the milestone. The binding constraint was byte-identical output, which ruled out tiny-skia and lyon (anti-aliasing plus SIMD). The integer edge-function scanline with the top-left rule is the standard determinism-friendly choice, and the top-left rule is what makes two edge-sharing triangles count a shared texel exactly once. The subtle part was sampling: with pixel-corner sampling the shared corner of a quad's two triangles lands on a "not-top-left" edge in *both* triangles and is owned by neither, dropping a texel. Sampling at texel centres on a ×2 lattice (vertices on even coordinates, samples on odd) fixes that while staying integer.

Wrapping was the other trap. The plan said "fract()-wrapped", but fract() per vertex collapses a full [0,1] quad because fract(1.0) = 0. Translating each triangle by the integer floor of its per-axis minimum lands compact islands in [0,1) without collapsing edge-aligned UVs, and equals fract() for any island that doesn't straddle an integer boundary.

Profile-conditional escalation (MAT-003) generalized the existing `escalate_to` mechanism: a new `CheckContext.profile_name` plus an `escalate_profiles` list in config means "warn on mobile" is data, not a hardcoded string comparison.

## What broke

The headline: **Duck.glb does not pass cleanly, and it is not a bug.** The plan committed Duck as the "clean textured regression" expected to pass on `pc` with zero error/warn findings. It does not. Its authored UVs genuinely overlap: the summed UV-triangle area is ≈1.197 while the entire UV bounding box is only ≈0.919 — total painted area exceeding the bounding region is geometrically impossible without overlap. An independent Python rasterizer put overlap at 94.46%; ours reports 94.37%. There are zero exact/mirrored duplicate triples, so the SPEC exclusion does not reduce it. So UV-002 (overlap), UV-004 (stretch), and UV-005 (0px island gap) all legitimately warn. Per the plan this was a STOP-and-report case; no thresholds were tuned. The reviewer's ruling: the warns are accepted as true positives (near-mirror same-region texturing of Duck's era — a real defect class for a game asset), the Duck test locks verdict `warn` with exactly those checks tripped, and the expected-warning exception moves to the M5 corpus manifest per SPEC_06. The clean-textured-pass role Duck was slated for went to the hand-authored `clean_textured.gltf` instead.

Three smaller ones. The pixel-corner sampling bug above surfaced as a full quad covering 63 of 64 texels; switching to centre sampling fixed it. The UV-005 padding test asserted a 3px gap but the BFS distance transform reported 4px (an off-by-one in my hand estimate of the corridor width), so the test now uses an 8px minimum against a known ~4px gap. Clippy under `-D warnings` rejected a manual `!RangeInclusive::contains` in UV-003, an elided-lifetime `CheckContext` return in a MAT-003 test helper, an explicit lifetime in an integration helper, and a loop-index in the island labeller; all mechanical fixes.

## Numbers

Measured on the dev machine (Windows, cargo 1.96). Duck's rasterizer build at the 1024 grid over 4212 triangles is 8740 us/iter in release (2k iterations); it is built once per report and shared, so a full Duck report is 22ms total with 20ms in checks. The rasterizer reports covered=638232, overlap=602325, 10 islands, 0 tiling triangles. `cargo test --workspace` is 182 passing (up from 139) with three ignored (two timing benches, one live validator). Clippy is clean under `-D warnings`, and `meshcheck-core` still compiles for `wasm32-unknown-unknown` with `--no-default-features` — the rasterizer is pure integer math. Double-run byte-identity holds across all fourteen committed fixtures, Duck and `clean_textured.gltf` included.

## Next

P0M5 builds the corpus generator (`meshcheck-corpus generate`): ChaCha8-seeded mutations that produce a broad, versioned fixture set so every check is exercised beyond the handful of hand-authored assets here. That is also where the Duck overlap question gets its proper home — corpus curation, with the reviewer's call on whether a clean textured pass-fixture is worth sourcing separately.
