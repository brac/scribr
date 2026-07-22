---
title: "The renderer measures, Rust judges: RND checks land in the core"
date: 2026-07-14
project: "meshcheck"
phase: 2
milestone: 3
tags: [rust, wasm, corpus, determinism, checks]
draft: true
summary: "RND-001/002/003 become real registry checks fed by injected render evidence; the corpus gains an invisible mutation only RND-002 can catch; parity 28/28."
repo_ref: "p2m3"
decisions:
  - what: "Render state is a three-way enum on CheckContext — NotRun ⇒ RND skipped, Failed ⇒ RND engine-error (partial confidence), Evidence ⇒ verdicts"
    why: "checks_only mode and a crashed renderer are different truths and must not share a representation: skipped says 'we did not look', error says 'we looked and the instrument broke'. The Failed path is the SPEC_04 crash-isolation contract — verified end-to-end: failed evidence yields verdict_confidence 'partial' with the report still delivered, via the existing engine-error counting and zero new confidence code."
    alternatives: ["Option<RenderEvidence> (conflates not-run with failed)", "verdicts computed in TS and injected as check results (breaks thresholds-are-data and the single Rust serializer)"]
  - what: "Evidence with engine ok but zero frames is an engine error, not a vacuous pass"
    why: "The renderer contract guarantees frames on success, so an empty list means something lied; RND-002 passing on no data would be the worst failure mode of a QA instrument."
    alternatives: ["treat as pass (vacuous)", "treat as skipped (hides a contract violation)"]
  - what: "A new wasm export validate_with_render; the existing validate signature is untouched and delegates to the same inner pipeline"
    why: "Keeps the server bridge compiling this milestone (server wiring is P2M4) while guaranteeing the two entry points cannot drift — one pipeline, two bindgen wrappers."
    alternatives: ["change validate's signature (forces server changes out of milestone scope)", "separate second pipeline (drift by construction)"]
  - what: "Duck__invisible joins the corpus flagged requires_render, excluded by name from the checks_only detection scoreboard"
    why: "The mutation (baseColorFactor alpha 0 + alphaMode BLEND) is undetectable without rendering — verified: checks_only on it yields RND skipped and no failing check. Mirroring the requires_validator exclusion keeps the Phase 0 detection row green and honest: 20/20 detected, 2 named exclusions."
    alternatives: ["let the Phase 0 detection row go red (false regression)", "silently omit the asset from the scoreboard (dishonest 100%)"]
benchmarks:
  - metric: "wasm-vs-native parity, full corpus + evidence fixtures"
    value: "28/28 assets byte-identical (RND skipped rows included) + 4/4 render fixtures (NotRun, Failed, mixed Evidence, screenshots injection)"
    target: "byte-identical — the standing Phase 1 gate, extended to evidence-fed reports"
  - metric: "RND-002 catches Duck__invisible (local render → CLI)"
    value: "invisible ⇒ RND-002 fail (0% visible); clean Duck ⇒ RND-002 pass (14.16% min angle)"
    target: "the Phase 2 BENCHMARKS row's mechanism, proven end-to-end (row flips at P2M5)"
  - metric: "corpus determinism + detection after the new asset"
    value: "0 diffs / 28 assets double-run; detection 100% (20/20), 2 named exclusions"
    target: "Phase 0 rows stay green"
  - metric: "full regression"
    value: "cargo 227 passed, clippy -D warnings clean, renderer 20, server 125, schema drift none"
    target: "all prior gates green"
---

## What shipped

`meshcheck-core` now owns render judgment. `CheckContext` carries a `RenderStatus` (NotRun / Failed / Evidence); `RenderEvidence` deserializes the exact integer-evidence JSON the P2M2 harness emits (field names frozen by `renderer/src/types.ts`). RND-001 (renders without error), RND-002 (visible pixels vs `min_visible_pct` from checks.toml), and RND-003 (silhouette coverage/aspect, info severity, new `min_coverage_pct`/`max_aspect` params) are registry checks with full unit coverage. Screenshot descriptors inject as JSON and pass through `Report::assemble`'s existing slot. The wasm binding gains `validate_with_render`; the native CLI gains `--render-evidence`/`--screenshots-json`; the parity harness drives both sides through four checked-in fixture cases. The corpus generator grows the `invisible` mutation and a `requires_render` manifest flag with a named bench exclusion.

## Decisions

See frontmatter. The enum is the one that matters downstream: P2M4's route code just picks which of three JSON shapes to hand the wasm call, and every semantics question is already answered in Rust.

## What broke

Nothing broke outright; two traps were dodged rather than hit. The stale-wasm-pkg trap (globalSetup skips rebuilding an existing pkg) was pre-empted by force-rebuilding before the server suite — worth remembering, since server tests would have silently exercised old wasm. And the corpus material serializer had to be rewritten for the invisible mutation's `baseColorFactor`/`alphaMode`; byte-compatibility for the 27 pre-existing assets was proven by the parity run and the double-run determinism diff, not assumed. Reports everywhere now carry three more `skipped` rows in checks_only mode — exactly one core integration expectation (`summary.skipped` 1→4) needed updating, and no server test pinned check counts.

## Numbers

Parity is the load-bearing number: 28/28 corpus assets byte-identical native↔wasm with the new RND rows present, plus the four evidence-fed fixtures, so the TS→Rust evidence boundary produces identical bytes from both builds. The invisible gate ran the real pipeline — LocalChromiumBackend renders `Duck__invisible.glb`, evidence flows through the CLI, RND-002 fails at 0% visible on all six angles; the clean Duck control passes at 14.16% on its worst angle. The reviewer independently re-ran every gate and negative-proofed both edges: no evidence ⇒ RND skipped and no detection (the exclusion is honest), failed evidence ⇒ partial confidence with the report delivered.

## Next

P2M4 wires it into the product: `VercelFnBackend` (the renderer as a second deployed function), `/v1/render`, full-mode `/v1/validate` calling render → Blob screenshots → `validate_with_render`, the 2-credit full price, `RENDER_FAILED` reachable, crash isolation live, and the async turntable GIF.
