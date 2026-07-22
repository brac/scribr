---
title: "Teaching meshcheck to see holes: exact welding, edge maps, and the geometry checks"
date: 2026-07-13
project: "meshcheck"
phase: 0
milestone: 3
tags: [rust, gltf, geometry, determinism, parry]
draft: true
summary: "A shared geometry kit — welding, boundary loops, shells, components — and all nine GEO checks, so Box.glb's 24 split vertices read as one closed, manifold cube."
repo_ref: "p0m3"
decisions:
  - what: "Edge identity uses exact-bitwise position welding, not vertex indices"
    why: "Meshes split vertices for normals/UVs (Box.glb: 24 vertices for 8 corners); index-keyed edges would make every edge look like a boundary and Box.glb would fail every manifold check. Coincident world positions weld by their f64::to_bits triple in first-encounter BTreeMap order"
    alternatives: ["index-keyed edges (every split-vertex seam becomes a false boundary)", "tolerance welding in the kit (non-deterministic bin boundaries; kept only inside GEO-005 where it belongs)"]
  - what: "One GeometryKit built lazily and cached on the Scene via OnceLock"
    why: "Adjacency/welding/components/areas are shared by GEO-001/002/003/004/007/009; building once (sequentially, deterministically) and caching behind a thread-safe OnceLock lets the parallel check engine share a single build instead of each check re-welding the soup"
    alternatives: ["per-check recompute (O(checks x n), and each check would re-derive the same edge map)"]
  - what: "GEO-009 narrowphase uses parry3d 0.29 intersection_test; broadphase is a hand-rolled sweep-and-prune"
    why: "We verified empirically that parry 0.29's glam-based dispatcher handles flat triangle/triangle correctly (crossing, coplanar overlap, separation all report right), so the pinned dependency is usable as intended; the deterministic sweep-and-prune on triangle AABBs prunes the O(n^2) pair space, which the plan sanctions as a BVH-free capped broadphase for an info check"
    alternatives: ["hand-rolled Moller tri-tri (written as a fallback, then removed once parry proved reliable)", "parry Qbvh broadphase (deferred; sweep-and-prune is simpler and deterministic)"]
  - what: "GEO-006 per-primitive unreferenced-vertex counts are computed in-check, not stored on ScenePrimitive"
    why: "The scene already carries each primitive's index buffer and vertex_count, so the count is derivable without a new field or parse-time cost. Scene still gained unreferenced_accessors/unreferenced_images at parse time as specified (those need document-wide cross-referencing)"
    alternatives: ["a new ScenePrimitive field set at parse time (churns every test literal for data we already have)"]
  - what: "ScenePrimitive gains is_triangle_list; only mode-4 primitives feed the kit"
    why: "Strips/fans/points/lines 'contribute nothing' per the plan, and a strip/fan index buffer is not in triangle-list order, so the kit must know the real mode rather than infer triangles from the index count"
    alternatives: ["treating any triangle_count>0 primitive as a triangle list (miswinds strips/fans)"]
  - what: "Config additions: escalate_to for GEO-002/004/005 plus duplicate_vert_pct, scale_eps, selfx_pair_cap"
    why: "Escalation targets and every new tolerance live in checks.toml so no severity or threshold is embedded in code; the info-status rule applies to the effective (possibly escalated) severity so GEO-005 can legally warn past 10%"
    alternatives: ["hardcoding escalated severities (violates the no-magic-number rule)"]
benchmarks:
  - metric: "Box.glb geometry kit build (release, 100k iters)"
    value: "3.69 us/iter"
    target: "feeds the Phase 0 perf-gate baseline"
  - metric: "Box.glb all checks with kit cached (release, 100k iters)"
    value: "49.61 us/iter (kit+checks ~= 53 us)"
    target: "well under the Phase 0 checks_only budget"
  - metric: "cargo test --workspace"
    value: "139 passing (117 core + 10 integration + 12 corpus), 2 ignored (live-validator, timing bench)"
    target: "all green"
  - metric: "cargo clippy --workspace --all-targets -- -D warnings"
    value: "clean"
    target: "no warnings"
  - metric: "wasm32 --no-default-features build"
    value: "compiles; GEO-009 returns skipped"
    target: "geo-selfx excluded, check never omitted"
---

## What shipped

meshcheck now detects the classic AI-generated-mesh defects. A new shared geometry kit (`crates/meshcheck-core/src/geometry.rs`) is built once, lazily, and cached on the `Scene` behind an `OnceLock`. It exact-welds every triangle-soup vertex by its world-position bits, builds a per-primitive edge to face incidence map with canonical `(min,max)` welded keys, chains boundary edges into deterministic loops (length plus a Newell projected area), labels shells and their minority winding, and runs union-find over welded vertices for whole-model connected components. Total surface area and the model AABB diagonal come along for the hole-area and debris heuristics.

On top of the kit sit nine checks, one file each: non-manifold edges (GEO-001), open boundaries (GEO-002), winding (GEO-003), degenerate triangles (GEO-004), duplicate vertices (GEO-005, its own tolerance grid), unreferenced data (GEO-006), floating debris (GEO-007), zero/negative scale nodes (GEO-008), and sampled self-intersection (GEO-009). The parser gained `unreferenced_accessors`/`unreferenced_images` bookkeeping and an `is_triangle_list` flag per primitive. Four hand-authored fixtures (`punched_hole`, `flipped_faces`, `debris`, `negative_scale`) each trip exactly their target check in integration tests, and Box.glb — 24 split vertices for 8 corners — passes all nine, the real proof of the welding design.

## Decisions

The load-bearing call was making edge identity exact-bitwise position welding rather than vertex indices. Box.glb stores 24 vertices for its 8 cube corners (split for per-face normals); if edges were keyed by index, every corner seam would look like a boundary and the cube would fail manifoldness, boundary, and winding. Welding coincident world positions by their `f64::to_bits` triple (first-encounter order via `BTreeMap`, with `-0.0` folded to `+0.0`) collapses the 24 back to 8 and the cube reads as one closed shell. GEO-005's tolerance-grid welding is deliberately kept separate — it is the one check that *wants* to find near-but-not-exact coincidences.

The self-intersection narrowphase is the decision that flipped mid-milestone. The plan pinned parry3d and warned that GJK on flat triangles is historically unreliable, so I first wrote a full Moller triangle-triangle test (with the coplanar 2D path) as the sanctioned fallback. Then I actually ran parry: a throwaway experiment confirmed parry 0.29's glam-based dispatcher returns crossing=true, coplanar-overlap=true, separated=false. Since the plan prefers parry when usable, I deleted the ~150-line Moller module and switched to `parry3d::query::intersection_test`, keeping a hand-rolled deterministic sweep-and-prune for the broadphase.

The kit is shared, not recomputed: six of the nine checks read it, so it is built once behind a `OnceLock` (construction sequential and deterministic; the lock only makes the cache safe under the rayon check engine).

## What broke

Five real ones. First, parry3d would not compile: `default-features = false, features = ["enhanced-determinism"]` stripped its `required-features` (dim3 + f32) and `std`, producing 189 errors where `Vector` resolved to `()`. Enabling `["required-features", "std", "enhanced-determinism"]` fixed it — still no SIMD.

Second, the Moller detour above: I built the fallback before verifying the primary, which made it dead code the moment the experiment passed. Honest cost, but the verification is what the plan asked for.

Third, a fixture test premise was wrong. `punched_tetra_warns` expected a plain warn, but a tetrahedron missing one face has a hole worth ~33% of its remaining surface, which correctly escalates to error. The code was right; the test now uses a generous `hole_area_pct` to exercise the warn path and a single triangle to exercise escalation.

Fourth, `box_glb_all_geo_checks_pass` failed under `--no-default-features` because GEO-009 returns `skipped`, not `pass`. The assertion now accepts pass-or-skip for GEO-009 (which is exactly the acceptance wording) while still requiring 1..=8 to pass.

Fifth, clippy under `-D warnings` rejected `!(tol > 0.0)` (neg-cmp on a partial order) and a bbox-expand range loop; fixed with a bool binding and a shared `expand_bbox` helper. Two wasm-only unused imports (`json`, `Status`) when `geo-selfx` is off were cfg-gated.

## Numbers

Measured on the dev machine (Windows, cargo 1.96). Building the geometry kit for Box.glb takes 3.69 us/iter and running the full check registry with the kit cached takes 49.61 us/iter in release (100k iterations each), so a full report's kit-plus-checks work is roughly 53 us — the corpus CLI rounds Box.glb's `checks` timing to 0 ms and reports 2 ms total. `cargo test --workspace` is 139 passing plus two ignored (the live-validator test and the new timing bench). Clippy is clean under `-D warnings`; the wasm32 `--no-default-features` build compiles with GEO-009 returning `skipped`. Double-run byte-identity holds across all eight committed fixtures, GEO-009 included.

## Next

P0M4 turns to UV checks (UV-001..006): the hand-rolled integer-scanline rasterizer for overlap/coverage, plus the UV-space adjacency the stretch and padding checks need. The corpus generator (P0M5) later replaces these hand-authored GEO fixtures with mutation-driven ones so every check is exercised against a broad, versioned corpus rather than four tiny tetrahedra.
