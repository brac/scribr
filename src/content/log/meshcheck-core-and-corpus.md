---
title: "meshcheck Phase 0: a deterministic glTF report card and the corpus that proves it"
date: 2026-07-13
project: "meshcheck"
phase: 0
tags: [rust, gltf, determinism, corpus, benchmarks]
draft: false
summary: "28 deterministic glTF checks, a schema-valid report, and a byte-reproducible corpus gate: 100% detection, zero false positives, 0 diffs."
repo_ref: "phase-0"
decisions:
  - what: "CheckId is a { group, num } struct with derived Ord; the string form is only the serde surface"
    why: "Group-then-number ordering is the canonical report order, so deriving Ord gives report determinism for free after a single sort_by_key"
    alternatives: ["CheckId(&'static str) parsed on every compare", "an exhaustive enum of all ids"]
  - what: "Timestamps and report ids are caller-supplied via ReportMeta; core never reads the clock, and every reported float passes through q6 (round to 6 decimals)"
    why: "Determinism rule — same file + same profile must yield byte-identical bytes; the clock lives only at the CLI layer and q6 kills platform FP noise before serde"
    alternatives: ["read SystemTime inside core", "report raw f64"]
  - what: "Parse with gltf::Gltf::from_slice_without_validation, not from_slice"
    why: "The gltf crate's own validation rejects assets with unknown required extensions or unresolved references — exactly the conditions SPEC-001/002/003 must report, not choke on"
    alternatives: ["from_slice and treat its rejection as a parse error (makes SPEC-002/003 unreachable)"]
  - what: "Config-driven severity escalation via CheckOutcome.severity_override, including profile-conditional escalation keyed on CheckContext.profile_name"
    why: "SPEC_01 has checks whose severity depends on the measurement (XFM-002) or the profile (MAT-003 NPOT on mobile); the effective severity is override.unwrap_or(configured), sourced only from config, never a hardcoded Severity"
    alternatives: ["a second severity field on the wire", "hardcoding escalated severities or a == \"mobile\" test in check code"]
  - what: "Edge identity uses exact-bitwise position welding, not vertex indices"
    why: "Meshes split vertices for normals/UVs (Box.glb: 24 vertices for 8 corners); index-keyed edges would make every seam a false boundary and Box would fail every manifold check"
    alternatives: ["index-keyed edges", "tolerance welding in the shared kit (kept only inside GEO-005 where near-coincidence is the signal)"]
  - what: "GEO-009 self-intersection uses parry3d 0.29 intersection_test with a hand-rolled deterministic sweep-and-prune broadphase"
    why: "An empirical check confirmed parry 0.29's glam dispatcher handles flat triangle/triangle correctly, so the pinned dependency is usable; a hand-rolled Moller fallback was written first, then deleted once parry proved reliable"
    alternatives: ["ship the hand-rolled Moller tri-tri test", "parry Qbvh broadphase"]
  - what: "The shared UV rasterizer is an integer edge-function scanline with the top-left fill rule, sampled at texel centres on a ×2 lattice"
    why: "Byte-identical output first — no anti-aliasing, no float accumulation, no SIMD; centre sampling avoids the shared-corner double-exclusion that pixel-corner sampling produces"
    alternatives: ["tiny-skia / lyon (AA + SIMD break determinism)", "pixel-corner sampling"]
  - what: "Per-mutation corpus seed = ChaCha8Rng::seed_from_u64(fnv1a64(base) ^ fnv1a64(defect)); broken binaries regenerated in CI, not committed"
    why: "Portable, version-stable randomness so the corpus regenerates byte-for-byte; per-mutation derivation means adding a defect never perturbs another's stream"
    alternatives: ["SmallRng (platform/version-dependent algorithm)", "one global seed advanced across mutations"]
  - what: "Broken assets are built from a serde_json::Value glTF document framed by gltf::binary::Glb, not a typed gltf_json::Root"
    why: "A Value has BTreeMap-sorted keys (byte-deterministic) and avoids the Checked/USize64/Index boilerplate of constructing a typed Root from nothing, while the validator-safe 4-byte chunk padding still comes from gltf::binary::Glb"
    alternatives: ["typed gltf_json::Root construction", "hand-rolled GLB framing"]
  - what: "Duck.glb's UV-002/004/005 warns are accepted as true positives and recorded as manifest expected_warnings, not tuned away"
    why: "Duck's authored UVs genuinely overlap (summed UV area 1.197 > UV bbox 0.919; an independent rasterizer agrees at ~94.5%), a real defect class the product exists to catch; Khronos samples are spec-perfect but not game-ready"
    alternatives: ["tune uv_overlap_pct until Duck passes (hides a defect class)", "swap Duck for another model"]
  - what: "GEO-002 hole_area_pct recalibrated 1.0 → 50.0 against the clean corpus; error reserved for majority-open meshes"
    why: "1.0 was an M1 placeholder (SPEC_01 named the parameter without a number); Avocado's 6.78% seam and DamagedHelmet's 47.7% open bust must warn, not fail — logged in config/CHANGELOG.md"
    alternatives: ["per-asset error exceptions (SPEC_06 only sanctions expected-warning exceptions)", "leaving it at 1.0"]
  - what: "meshcheck-core carries a wasm feature graph from day one: default = parallel + geo-selfx, --no-default-features drops rayon and parry3d"
    why: "The hosted API path is the wasm core; keeping rayon and parry3d optional (GEO-009 reports skipped, never omitted, when geo-selfx is off) means the wasm build is a feature toggle, not a rewrite"
    alternatives: ["a wasm-only fork of core", "unconditional rayon/parry3d (neither builds on the wasm target here)"]
  - what: "The M6 bench measures latency out-of-band with Instant and zeroes timing_ms in every report"
    why: "The corpus pipeline assembles reports with Timing::default(), so double-run reports are byte-identical without normalizing timing; perf is a separate wall-clock measurement over parse + checks"
    alternatives: ["normalize/strip timing_ms before diffing (fragile)", "read latency from the report's own timing_ms"]
  - what: "corrupt_json detection is reported as excluded (validator absent), never as a pass, when no Khronos validator is discoverable"
    why: "SPEC-001 is the only check that needs an external validator; counting it as detected without one would be dishonest, so the scoreboard shows n/N with the exclusion named"
    alternatives: ["count it as a pass", "hard-fail the gate when no validator is installed"]
  - what: "The BENCHMARKS.md updater rewrites only the current/status cells of Phase 0 rows it measured"
    why: "Targets are human-owned; the tool reads the target cell to decide pass/fail and preserves metric/target bytes and every other phase's table character-for-character (a golden test pins the output)"
    alternatives: ["regenerate the whole table (clobbers human-owned targets)"]
benchmarks:
  - metric: "broken/ detection rate"
    value: "100% (20/20; corrupt_json excluded, validator absent)"
    target: "100%"
  - metric: "clean/ false positives"
    value: "0"
    target: "0"
  - metric: "determinism (double-run diff, full corpus)"
    value: "0 diffs across 27 assets"
    target: "0 diffs"
  - metric: "checks_only p95, ≤50k tris"
    value: "44 ms"
    target: "< 500 ms"
  - metric: "checks_only p95, ≤500k tris"
    value: "567 ms"
    target: "< 3 s"
  - metric: "JSON Schema drift"
    value: "none"
    target: "none"
  - metric: "wasm32 feature build"
    value: "compiles"
    target: "compiles"
  - metric: "Box.glb geometry kit build (release, 100k iters)"
    value: "3.69 µs/iter"
    target: "feeds the checks_only baseline"
  - metric: "Box.glb full check registry, kit cached (release, 100k iters)"
    value: "49.61 µs/iter"
    target: "well under the checks_only budget"
---

## What shipped

At the end of Phase 0 meshcheck is a working, demoable product with no server attached. A two-crate Cargo workspace turns a GLB/glTF file into a machine-readable report card: `Scene::from_bytes` parses the container (buffers from the GLB BIN chunk, `data:` URIs, and external files via an injected resolver), fills the entire `stats` block, and 28 deterministic checks run over it — SPEC-001..004, GEO-001..009, XFM-001..003, UV-001..006, MAT-001..006, PERF-001..006 — each reading its thresholds from `config/*.toml`. The report is the full SPEC_02 envelope with a canonical id order, a summary/verdict rollup, and a committed JSON Schema guarded by a drift test. `meshcheck-corpus check file.glb --profile pc` prints it.

The other half is the ground truth. `meshcheck-corpus generate` fetches six pinned Khronos sample assets and stamps out 21 programmatic mutations — one labelled defect each — writing `corpus/manifest.toml`, the committed record of expectations. `meshcheck-corpus bench --full-gate` consumes that manifest and asserts detection over `broken/`, exact-precision over `clean/`, byte-identical double runs over every asset, and `checks_only` p95 latency per size class, then rewrites the Phase 0 table in `BENCHMARKS.md` and exits non-zero on any red row. A GitHub Actions workflow runs the whole gate on every push to main.

## Decisions

The spine of the phase was determinism, and most decisions serve it. `CheckId` is a `{group, num}` struct whose derived `Ord` is the canonical report order, so parallel checks sort into stable output. Core never reads the clock — `ReportMeta` injects ids and timestamps — and every float passes through `q6`. Parsing uses `from_slice_without_validation` because the gltf crate's own validation rejects exactly the assets SPEC-001/002/003 exist to report on. Edge identity welds vertices by exact position bits, so Box.glb's 24 split vertices collapse back to 8 corners and the cube reads as closed.

Two calibration decisions were forced by real assets rather than theory. Duck.glb does not pass cleanly — its authored UVs genuinely overlap — so its UV warns were ruled true positives and recorded as manifest `expected_warnings` instead of being tuned away. GEO-002's `hole_area_pct` was recalibrated from an M1 placeholder of 1.0 to 50.0 so that seam-open Khronos assets warn rather than fail, with error reserved for majority-open meshes. Both are logged, not silent.

The bench itself made two honesty calls. Latency is measured out-of-band with `Instant` while `timing_ms` stays zeroed, so double-run reports are byte-identical with no normalization. And `corrupt_json`, which needs the external Khronos validator to trip SPEC-001, is reported as *excluded* when no validator is installed — never counted as a pass.

## What broke

Plenty, and it was useful. The gltf crate refused the unknown-extension fixture until we stopped validating at parse time. The validator CLI flag was wrong on the first pass (`-s -o <dir>` instead of the real `-o` stdout flag); downloading the 2.0.0-dev.3.10 binary and reading `--help` settled it. parry3d produced 189 compile errors when `default-features = false` stripped its required dim3/std features — the fix was enabling `required-features` and `std` alongside `enhanced-determinism`. A hand-rolled Moller tri-tri test was written as a parry fallback, then deleted once parry proved reliable on flat triangles.

The corpus surfaced two more. The naive `unweld` tripped nothing, because duplicating a shared vertex produces bit-identical copies that GEO-005 excludes (they would self-weld); a 1e-5 sub-tolerance jitter fixed it. The 8192² upsize texture first wrote a 268 MB file under `NoFilter`+`Fast`; the `Up` filter turns flat rows into zero deltas and dropped it to 360 KB. And the clean-corpus sweep flagged two error-level GEO-002 fails (Avocado, DamagedHelmet) that went to review as `review_todo` markers rather than being self-approved — which is what produced the `hole_area_pct` retune above.

## Numbers

All measurements are from the dev machine (Windows, cargo 1.96, release). Detection is 100% of the 20 evaluated broken assets, with `corrupt_json` excluded because no validator is present. Precision is zero false positives and zero regressions across the six clean assets, whose warn sets exactly equal their manifest expectations. Determinism is 0 byte diffs over all 27 assets run twice. `checks_only` p95 is 44 ms for the ≤50k-tri class and 567 ms for the ≤500k-tri class (a 196k-tri exploded Box dominates the big class), against targets of 500 ms and 3 s. Schema drift is none and the wasm32 core build compiles. The per-check budget has headroom: Box.glb's geometry kit builds in 3.69 µs and its full check registry runs in 49.61 µs with the kit cached.

## Next

Phase 1 lifts the core onto Vercel Functions with `meshcheck-core` compiled to wasm behind a TypeScript API — `/validate`, uploads, jobs, an API-key credit ledger in Neon Postgres, and Blob storage with a retention sweep. The gate that matters most is wasm-vs-native report parity over the corpus, byte-identical modulo the documented GEO-009 skip, so the same determinism guarantees survive the platform move.
