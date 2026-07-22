---
title: "Manufacturing defects on purpose: the meshcheck corpus generator"
date: 2026-07-13
project: "meshcheck"
phase: 0
milestone: 5
tags: [rust, gltf, corpus, determinism, testing]
draft: true
summary: "A ChaCha8-seeded defect factory fetches pinned Khronos assets and stamps out 21 byte-reproducible broken GLBs, one labelled defect each, plus a manifest."
repo_ref: "p0m5"
decisions:
  - what: "Build broken assets from a serde_json::Value glTF document framed by gltf::binary::Glb, not a typed gltf_json::Root"
    why: "The factory builds assets from scratch rather than editing a document, and constructing a fully-typed Root from nothing is dominated by Checked<T>/USize64/Index<T>/feature-gated-field boilerplate. A serde_json::Value has BTreeMap-sorted keys (order-stable, byte-deterministic), and the load-bearing requirement — the Khronos-validator-safe 0x20/0x00 4-byte chunk padding — is still supplied by gltf::binary::Glb."
    alternatives: ["typed gltf_json::Root construction", "hand-rolled GLB framing (research rejected this)"]
  - what: "Per-mutation seed = ChaCha8Rng::seed_from_u64(fnv1a64(base_name) ^ fnv1a64(defect_name))"
    why: "Portable, version-stable randomness so the corpus regenerates byte-for-byte; the per-mutation derivation means adding a defect never perturbs another's stream."
    alternatives: ["SmallRng (platform/version-dependent algorithm)", "one global seed advanced across all mutations (adding a mutation shifts everything after it)"]
  - what: "unweld jitters each duplicated vertex by 1e-5 world units"
    why: "Pure per-face duplication produces bit-identical coincident copies, which GEO-005 explicitly excludes (they would self-weld) — so the naive unweld tripped nothing. A sub-tolerance jitter (100x below the 0.001 weld tolerance, so copies share a grid cell) makes them coincident-but-unwelded, which is exactly GEO-005's signal."
    alternatives: ["pure per-face duplication (GEO-005 reports zero)"]
  - what: "Manifest carries a measured_* assertion for info-severity targets (GEO-006, GEO-009)"
    why: "Those checks can only ever `pass`, so 'target reports warn/fail' is meaningless for them. The manifest records field/op/value (e.g. intersecting_pairs > 0) for M6's bench to assert against the measured block instead of the status."
    alternatives: ["status-only manifest (can't express info-check detection)"]
  - what: "FlightHelmet's file list is discovered from its .gltf, not hardcoded"
    why: "Fetching FlightHelmet.gltf and reading its buffer/image URIs means the bundle list can never drift from the pinned document; a hardcoded list silently rots on a re-pin."
    alternatives: ["hardcode the 17-file list (research §13's suggestion)"]
  - what: "png pinned to =0.17.16 with the Up filter + Default compression"
    why: "0.17.16 is already in the dependency tree with a known encoder API, and the Up filter turns a flat image's rows into all-zero deltas so an 8192² texture deflates to ~360 KB instead of its 268 MB raw size."
    alternatives: ["png 0.18 (unknown Compression API surface)", "NoFilter+Fast (stored blocks: a 268 MB corpus file)"]
  - what: "GEO-002 hole_area_pct recalibrated 1.0 → 50.0 against the clean corpus (reviewer ruling); all clean-asset findings ruled as documented expected_warnings"
    why: "The 1.0 was an M1 placeholder — SPEC_01 named the parameter without a number. Calibrated on known-good assets: Avocado's seam opening is 6.78% of surface area and the deliberately-open DamagedHelmet bust is 47.7%; both must warn, not fail — error is reserved for majority-open meshes. The remaining clean-asset warns (unwelded seams, tight UV packing, FlightHelmet's 284.5 MB texture memory) are true measurements, recorded per asset in the manifest with their measured values; error-level findings on clean/ are never acceptable."
    alternatives: ["per-asset error exceptions (rejected — SPEC_06 only sanctions expected-warning exceptions)", "leaving hole_area_pct at 1.0 (rejected — fails known-good assets)"]
benchmarks:
  - metric: "generate from scratch (network), 6 clean + 21 broken"
    value: "81.5 s wall"
    target: "one-time; cache-backed thereafter"
  - metric: "generate --offline (warm cache)"
    value: "13.5 s wall"
    target: "deterministic re-run"
  - metric: "double-generate byte-identity (clean/ + broken/ + manifest.toml)"
    value: "identical"
    target: "SPEC_06 reproducibility, tested at generation level"
  - metric: "mutation detection (20 non-validator defects on their profile)"
    value: "all trip target; self_intersect measures 52 intersecting pairs, orphan_data 1 unreferenced accessor"
    target: "each labelled defect fires"
  - metric: "generated broken GLBs (excl. FlightHelmet bundle)"
    value: "6.3 MB across 20 files"
    target: "small enough to regenerate freely"
  - metric: "cargo test --workspace"
    value: "192 passing (up from 182), 3 ignored"
    target: "all green"
  - metric: "clean-asset precision sweep on pc (post GEO-002 retune)"
    value: "zero error-level findings; all six warn sets exactly equal manifest expected_warnings"
    target: "M6 bench precision gate, verified at generation time"
  - metric: "cargo clippy --all-targets --features smoke -D warnings + wasm32 core build"
    value: "clean / compiles"
    target: "no warnings; core stays wasm-safe"
---

## What shipped

`meshcheck-corpus generate` now produces the full SPEC_06 corpus. It fetches six clean Khronos sample assets (Box, Duck, Avocado, BoomBox, DamagedHelmet as GLB, FlightHelmet as a multi-file `.gltf` bundle) pinned to commit `2bac6f8c`, caches each download by URL sha, and records every fetched file's sha256 in the manifest for tamper/re-pin detection. It then stamps out 21 broken assets — one labelled defect per file, named `{base}__{defect}` — and writes `corpus/manifest.toml`, the committed ground truth that M6's bench will read verbatim.

The generator is built from six new modules in `crates/meshcheck-corpus/src/corpus/`: a seed-derivation helper, a fetcher, a deterministic flat-PNG encoder, a base-mesh extractor (which reuses `Scene` so the factory sees exactly the geometry meshcheck does), a `GlbAsset` builder, and the mutation factory itself. Mutations span the whole check surface: geometry (punch_holes → GEO-002, flip_faces → GEO-003, degenerate, unweld, orphan_data, add_debris, negative_scale, self_intersect), transforms (giant/tiny → XFM-001, offset_pivot), UV (strip/stack/stretch/crush), textures (upsize 8192², npot 1000²), SPEC-003 via a FlightHelmet bundle missing one texture, PERF-001 via a 7×-subdivided Box (196,608 triangles), MAT-004+PERF-003 via 20 materials across 40 primitives, and SPEC-001 via an out-of-bounds accessor. A `smoke`-gated integration test confirms five representative mutations trip their target on `pc` and that two from-scratch generations are byte-identical.

## Decisions

The biggest call was JSON-as-`Value` over a typed `gltf_json::Root` — see the decisions list. The reproducibility spine is the ChaCha8 per-mutation seed and the gltf crate's padded chunk writer; everything else is arranged so the same pinned inputs yield the same bytes (f32 positions, sorted-key JSON, a fixed PNG encoder). The mutation parameters (fraction of faces punched, subdivision depth, texture dimensions) live as documented constants in the mutation module, which the module doc explicitly exempts from the no-magic-number rule: that rule governs *check* thresholds, and these are the *test inputs* chosen to clear those thresholds with margin.

## What broke

Two real corrections. First, the naive `unweld` — split every shared vertex by per-face duplication — tripped nothing: the duplicated corners are bit-identical, and GEO-005 excludes bit-identical pairs because they would self-weld. The fix is a 1e-5 sub-tolerance jitter so copies are coincident-but-unwelded, GEO-005's actual signal. Second, the 8192² upsize texture initially wrote a 268 MB file — `NoFilter`+`Fast` deflated the flat image as stored blocks — ballooning the corpus to 475 MB. Switching to the `Up` filter (flat rows become zero deltas) with `Default` compression dropped it to 360 KB.

Smaller ones: rand 0.10 renamed the `Rng` trait to `RngExt`; png 0.18's Compression API is different, so I pinned the already-cached 0.17.16; and a bin-only crate can't be a dependency of `tests/`, so the corpus grew a `lib.rs`.

The clean-asset precision run also flagged real findings on four of six Khronos assets (Avocado, BoomBox, DamagedHelmet, FlightHelmet — mostly GEO-002 open boundaries plus assorted UV warnings), including two error-level GEO-002 fails (Avocado at 6.78% open area, DamagedHelmet at 47.7%). These went to the reviewer as `review_todo` markers rather than being self-approved. The ruling came back in two parts: GEO-002's `hole_area_pct` was an M1 placeholder and is recalibrated to 50.0 (error reserved for majority-open meshes; the retune is logged in the new `config/CHANGELOG.md`), and the remaining warns are true measurements — Khronos samples are spec-perfect but not game-ready — now recorded as `expected_warnings` with per-asset measured-value comments in the manifest. The ruling table lives in the generator itself so a regeneration can never clobber it.

## Numbers

A from-scratch run is 81.5 s wall (dominated by FlightHelmet's ~60 MB of PBR textures); a warm-cache offline run is 13.5 s. The generated broken GLBs total 6.3 MB across 20 files (the FlightHelmet break_uri bundle is a separate 44 MB, gitignored). All 20 non-validator mutations trip their labelled target — self_intersect measures 52 intersecting triangle pairs, orphan_data one unreferenced accessor; Box__punch_holes still trips GEO-002 after the retune (33.3% boundary area ⇒ warn, which counts as detection). After the `hole_area_pct` recalibration the clean sweep on `pc` reports zero error-level findings, and each of the six assets' warn sets exactly equals its manifest `expected_warnings` — the exactness M6's bench will assert. The workspace test count rose to 192 (plus the two smoke-gated integration tests), clippy is clean under `-D warnings` with the smoke feature, and `meshcheck-core` still compiles for wasm32.

## Next

P0M6 is the bench runner: it consumes this manifest verbatim, asserts detection across `broken/` (status for warn/fail targets, `measured_*` for info targets, `requires_validator` gating for SPEC-001) and exact-precision across `clean/`, and writes the BENCHMARKS.md scoreboard.
