---
title: "Reading retopology quality out of triangle soup: meshcheck's TOP check family"
date: 2026-07-17
project: "meshcheck"
phase: 5
tags: [rust, topology, calibration, schema, wasm]
draft: false
summary: "Phase 5 adds four topology-quality checks read from triangle fingerprints, calibrated on a 21-asset corpus, behind the project's first schema minor bump."
repo_ref: "phase-5"
decisions:
  - what: "New permanent check family TOP- (Topology & Surface Structure), IDs TOP-001..004, appended last in the fixed ID order"
    why: "Edge-flow/retopology quality is the market audit's #1 gap and does not fit GEO's defect semantics; these are structure-quality measurements, not integrity defects"
    alternatives: ["overload GEO (muddies defect semantics)", "VIS-based wireframe inspection (non-deterministic, breaks the deterministic-core brand)"]
  - what: "All four TOP checks live in meshcheck-core, pure and wasm-clean, with no new dependencies (cargo tree diff clean)"
    why: "Pure geometry math must run byte-identically on the hosted wasm path and native; a new crate would risk the wasm build"
    alternatives: ["parry3d / external mesh libs (wasm risk, unneeded)"]
  - what: "Default severities all info; warning promotion only via the MAT-003 escalation params (escalate_to / escalate_profiles), dormant in v1"
    why: "An all-triangle or decimated asset is legitimately 0% quads, so flagging it as a defect is a false accusation; numbers first, judgment via config"
    alternatives: ["warning/error defaults (false positives on optimized assets)", "profiles.toml numeric overrides (those are budgets only, not severity)"]
  - what: "TOP-001/002 adjacency built on a tolerance-welded graph via a new shared weld.rs module (grid-hash, 0.001, OnceLock-cached on Scene); TOP-004 also rides the tolerance weld"
    why: "UV/normal seams split vertices in glTF and unwelded adjacency inflates valence and breaks pairing; the existing GeometryKit welds exact-bitwise and GEO-005's grid-hash was private inline code, so it had to be extracted (A4)"
    alternatives: ["raw index adjacency (wrong on any textured mesh)", "reuse GeometryKit exact weld for TOP-004 (M1 data showed it understates hard edges, rejected)"]
  - what: "TOP-004 uses the normal-deviation convention, ≥ hard_edge_deg (90°, inclusive), manifold-interior edges only, emitting both hard_edge_count and hard_edge_len_pct (A1)"
    why: "The Khronos Asset Auditor measures the angle between face normals, hard-codes >= π/2, counts edges with no length weighting, and welds by ~1e-5 rounding; matching its convention (not inventing a metric) while adding length weighting as our documented improvement"
    alternatives: ["interior dihedral angle (not what the Auditor measures)", "count only, no length weighting (a million tiny edges drown one long seam)", "claim 'same metric' (false, we add length weighting)"]
  - what: "TOP-001 shape gate is quad_shape_deg (max corner-angle deviation from 90°), scored with Blender's quad_calc_error 3-term sum (planarity + shape + concavity), greedy-matched in a fixed total order (A2, A3)"
    why: "Blender's tris-to-quads shape limit is corner-deviation, not an aspect/skew ratio; matching its scoring keeps the measurement defensible, and a total order (error asc, tie-break lowest global triangle-index pair) is a required determinism divergence from Blender's tie-break-free heap"
    alternatives: ["aspect-ratio quad_shape_max (the original proposal assumption, wrong)", "Blender's heap ordering verbatim (implementation-defined on ties, non-deterministic)"]
  - what: "First schema minor bump in project history: SCHEMA_VERSION 1.0 -> 1.1, additive only (four TOP results, new 'topology' Category value, TOP group appended last)"
    why: "CLAUDE.md convention: additive fields are a minor bump; agents pinning on major are unaffected; server openapi.json/llms.txt are hand-authored and drift-tested, so both were hand-edited (A8)"
    alternatives: ["major bump (breaking, unwarranted for additive checks)", "no version change (would silently break schema validation of reports carrying 'topology')"]
  - what: "Calibration numbers stayed provisional until P5M1 measured real corpora, becoming hard gates only when Ben locked them at end of M1 (D6)"
    why: "Thresholds are data (product principle #4) and the data did not exist at planning time; inventing hard thresholds up front would be fabricated gates"
    alternatives: ["invent hard thresholds at adoption (fabricated gates, forbidden by D6)"]
  - what: "M1 locked thresholds (Ben, per D6): quad_planar_deg 40, quad_shape_deg 30, hard_edge_deg 90 inclusive, valence regular band 5-7 with poles <=3/>=8, min_interior_verts 100"
    why: "Derived from the 21-asset calibration sweep, not copied from Blender: 40/30 maximizes retopo-vs-soup separation while the jittered authored torus still reconstructs 100%; below 100 interior verts valence is noise"
    alternatives: ["tighter quad_planar_deg 20 (costs ~1 separation point; Ben's call went to 40 so a hand-modeled torus is not punished)", "provisional proposal numbers as gates (forbidden by D6 without data)"]
  - what: "quad_pct authored band locked at >= 60% (soup reference ~29%); area_cv info-only with clean-median ~1.5 as the reference point, no hard default"
    why: "The authored quad-grid torus sits at 100% and a decimated Duck at 18.7% still verdict-passes (D3), so 60% cleanly separates authored from soup without accusing legitimate low-quad assets; TOP-003 is a reference number, not a gate"
    alternatives: ["low-band gate on soup (would false-accuse decimated/scan assets)", "a hard area_cv default (TOP-003 is info)"]
  - what: "Bench runner gains a measured_op 'lt' operator and a topo-assertion family for the low-band info-severity fixtures (A6)"
    why: "Info-severity fixtures assert via manifest measured_* fields and the bench only supported measured_op 'gt'; low-band assertions (soup <= band) need 'lt'"
    alternatives: ["assert only high-band 'gt' checks (leaves the soup discrimination unguarded)"]
benchmarks:
  - metric: "TOP-001 fixture discrimination at locked thresholds (quad_pct)"
    value: "quad-grid torus 100.0% and jittered variant 100.0% (authored, >= 60% band); marching-tet soup 29.3%; decimated Duck 18.7% and verdict pass (D3)"
    target: "authored >= 60%, soup below band, decimated asset verdict pass"
  - metric: "topo fixture discrimination bench row"
    value: "4/4 fixtures hold their locked bands (bench topo-assertion family green)"
    target: "all bands hold"
  - metric: "checks_only p95 with TOP enabled"
    value: "76 ms @ <=50k tris; 549 ms @ <=500k tris"
    target: "< 500 ms @ <=50k tris; < 3 s @ <=500k tris (Phase 0 rows, TOP included)"
  - metric: "wasm-vs-native report parity (full corpus incl. topo)"
    value: "32/32 byte-identical"
    target: "byte-identical (fixed meta, zeroed timing)"
  - metric: "determinism double-run diff (fixtures + full corpus)"
    value: "0 diffs"
    target: "0 diffs"
  - metric: "schema 1.0 -> 1.1 drift gate"
    value: "docs/schema/ re-emitted, drift diff is exactly the additive 'topology' enum on report + check_result schemas; docs.test.ts green"
    target: "no undocumented drift"
  - metric: "M3 deployed-preview e2e (wild asset end-to-end)"
    value: "gothic-knight POST to /v1/demo/validate on preview returned HTTP 200, schema_version 1.1, four TOP results (category topology, status pass) byte-identical to the local wasm path and committed calibration numbers"
    target: "deployed preview returns TOP for a wild asset end-to-end"
---

## What shipped

Phase 5 gives meshcheck a vocabulary for topology quality. Four new checks in `meshcheck-core`: TOP-001 quad reconstructibility (share of triangles that pair cleanly back into quads), TOP-002 vertex valence regularity, TOP-003 triangle regularity and density chaos, TOP-004 hard-edge share. glTF only carries triangles. Quads and edge flow are authoring structure the export destroys, so each TOP check reads a fingerprint of that structure out of the soup and reports a number. None of them accuses. All four ship at info severity, with MAT-003 escalation params wired but dormant.

Under them is a new shared `weld.rs`: a grid-hash tolerance weld (0.001, `OnceLock`-cached on `Scene`) that TOP-001/002/004 build adjacency on. `CheckGroup::Top` and `Category::Topology` are appended last so no existing report ordering moves.

It shipped behind the project's first schema minor bump, `SCHEMA_VERSION` 1.0 to 1.1, additive only. SPEC_01 gained the TOP family section, SPEC_02 a dated 1.1 changelog, `checks.toml` four locked entries, the hand-authored `openapi.json` and `llms.txt` were hand-edited to match, the MCP validate description mentions topology, and the site compare/checks/home pages carry the new rows. Every threshold traces to `TOPO_CALIBRATION.md`, a 21-asset distribution table (6 clean, 4 topo, 10 wild, 1 sanity) that I locked the numbers from.

## Decisions

Research shaped the phase before any code, and two of my proposal's assumptions were wrong against source.

I assumed TOP-004 was "beveled-edge parity" with the Khronos Asset Auditor. Reading `Primitive.ts` and `EdgeXyz.ts` showed the Auditor measures the angle *between face normals*, hard-codes `>= π/2`, counts edges with no length weighting, and welds by ~1e-5 rounding. So TOP-004 matches that convention exactly and adds `hard_edge_len_pct` as a labeled improvement. The public wording is "same 90° threshold and edge convention; we add length weighting", never "same metric".

I assumed TOP-001's shape limit was an aspect or skew ratio. Blender's `bmo_join_triangles.cc` uses max corner-angle deviation from 90°, scored by a 3-term `quad_calc_error`. So `quad_shape_max` became `quad_shape_deg`, with a total-order tie-break that Blender's heap doesn't have, which is a required determinism divergence.

Every threshold stayed provisional until M1 measured real corpora. The locks in the table are calibration outputs, not numbers copied from Blender. And the weld had to be extracted: GEO-005's grid-hash was private inline code and `GeometryKit` welds exact-bitwise, so `weld.rs` is new.

## What broke

M1 review caught a scoring bug that claimed source fidelity it didn't have. The Blender error normalization was implemented as `1 - cos` with the shape term overweighted 4x, instead of `angle / 2π`. The fix moved only Duck-family sweep cells (max +0.81); anchor assets were unchanged. The round-2 report then understated its own change (Duck moved +0.28 at the recommended cell), so the artifact got verified internally consistent instead.

The weld basis was the second M1 catch. Exact-bitwise welding understates hard edges on any mesh with near-duplicate positions. `Duck__unweld` reported 0 hard edges exact versus 46 tolerance-welded (clean Duck has 47), and 5 of 10 wild assets were understated. The long sword went from 0.14% to 3.28% between bases. A weld-basis comparison table surfaced it and is why TOP-004 is locked to the tolerance weld.

Two more. The soup fixture, specced as marching cubes, became marching tetrahedra (no ambiguous-case tables, same smooth iso-surface). And `Blob__mc_soup` did not land near zero. It scores 29.3% quad-reconstructible at the locked pair, because a smooth iso-surface is locally planar and partially reconstructs. The shape limit carries the discrimination, not planarity, and it still separates cleanly from the 100% authored torus.

In M2 the schema was out of scope, but `Category::Topology` needed to serialize, so the `JsonSchema` derive was hand-frozen at the 1.0 eight-variant enum. "topology" appeared in reports but not in `docs/schema/`, an accepted deviation with an M3 obligation. M3 paid it: derive restored (nine variants), `docs/schema/` re-emitted, the drift being exactly the added enum value.

## Numbers

Gates held across M2 and M3. `checks_only` p95 with TOP enabled is 76 ms (≤50k tris) and 549 ms (≤500k tris), inside the Phase 0 gates of 500 ms and 3 s. wasm-vs-native parity 32/32 byte-identical including the topo fixtures. Determinism double-run, 0 diffs. A negative proof backed the bench: tampering the Blob `quad_pct` band from 35 to 20 made the gate exit 1, and a deterministic regenerate restored green.

The M4 sweep pushed all 10 wild GLBs through the deployed preview `/validate` with TOP enabled. Two small assets sync, the eight large ones (20.6 to 56.7 MB) through presigned upload and the async job path. All HTTP 200, `schema_version` 1.1, four TOP results at `status` pass. Every number reproduced the M1 calibration: TOP-002/003 to the decimal, TOP-004 matching the locked tolerance-weld columns exactly (long sword 39,856 hard edges, 3.28%), TOP-001 within 0.05 on all 10, with retopologized output at 56 to 70% and dense scans at 13 to 34%. The one non-exact match was war pig's TOP-001: core 69.73% versus the throwaway prototype's 69.69%, a 0.04-point tie-break difference between two independent greedy implementations. The core value is deterministic (double-run and wasm parity byte-identical), and the four gated fixtures matched the prototype exactly.

## Next

Phase 5 closes on the M4 sweep and the reviewer's `phase-5` tag, and the branch merges into the Phase 4 launch soak. The `authoring` profile that promotes TOP checks to warning through the dormant escalation params is out of scope here. Next are the launch soak's own gates: the 48-hour staging run and the registry submissions that unblock `npx meshcheck-mcp`.
