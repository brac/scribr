---
title: "The report contract before the parser: meshcheck's data model and check engine"
date: 2026-07-13
project: "meshcheck"
phase: 0
milestone: 1
tags: [rust, gltf, schema, config, determinism]
draft: true
summary: "A compiling, tested Cargo workspace with the full SPEC_02 report, check engine, and TOML config, whose CLI prints a schema-valid report before any glTF parsing."
repo_ref: "p0m1"
decisions:
  - what: "CheckId is a struct { group, num } with derived Ord, not a string newtype"
    why: "Ordering (group rank then number) is the canonical report order, so deriving Ord gives report determinism for free; string form is only the serde surface"
    alternatives: ["CheckId(&'static str) parsed on every compare", "an exhaustive enum of all ids"]
  - what: "Timestamps and report ids are caller-supplied via ReportMeta; core never reads the clock"
    why: "Determinism rule — same file + same profile must yield byte-identical bytes; the clock lives only at the CLI layer"
    alternatives: ["read SystemTime inside core report assembly"]
  - what: "Every reported float passes through q6 (round to 6 decimals)"
    why: "Kills platform FP noise before it reaches serde so report bytes are stable across machines"
    alternatives: ["report raw f64", "format-time rounding in serde"]
  - what: "Schema emission is a dedicated `emit-schema` bin in meshcheck-core"
    why: "Keeps the drift test and the writer sharing one canonical string function; simpler than a corpus subcommand that would need core's schema module anyway"
    alternatives: ["a `meshcheck-corpus emit-schema` subcommand"]
  - what: "RFC3339 timestamps are hand-rolled in the CLI (Hinnant civil-from-days)"
    why: "Avoids pulling chrono/time into the tree for ~20 lines of date math that the out-of-scope list did not sanction"
    alternatives: ["add the chrono crate", "add the time crate"]
  - what: "An illegal warn/fail from an info-severity check is rewritten by the engine to status error with an explanatory message"
    why: "error is the truthful bucket for a check that violated its contract — it surfaces via verdict_confidence: partial instead of fabricating a passing result, and never panics a report"
    alternatives: ["silently clamp to pass (masks a broken check)", "debug_assert!(false) on illegal info status (panics in debug builds)"]
  - what: "summary buckets are aligned with rollup semantics; engine error statuses are counted in no bucket"
    why: "errors = error-severity fails, warnings = warns plus non-error-severity fails — the same classification rollup uses, so summary and verdict can never contradict; engine errors surface via verdict_confidence: partial"
    alternatives: ["count every fail as an error (contradicts a warn verdict)", "count engine errors in the errors bucket (conflates broken checks with failing assets)"]
  - what: "hole_area_pct default set to 1.0 (SPEC_01 left it unspecified)"
    why: "SPEC_01 names the parameter but gives no number; 1% of surface area is a defensible starting default and lives in TOML where corpus tuning will revise it"
    alternatives: ["omit the param until GEO-002 lands in P0M2"]
benchmarks:
  - metric: "clean workspace build (cargo build --workspace after cargo clean)"
    value: "9.38s"
    target: "green on stable, Windows"
  - metric: "test count (cargo test --workspace)"
    value: "37 passing (32 core + 5 corpus)"
    target: "all green"
  - metric: "wasm build (meshcheck-core --no-default-features, wasm32-unknown-unknown)"
    value: "success"
    target: "compiles"
---

## What shipped

A two-crate Cargo workspace (`meshcheck-core`, `meshcheck-corpus`) that encodes the entire SPEC_02 report contract, runs a pure check engine over it, and drives both from a CLI — all before a single byte of glTF is parsed. `meshcheck-core` holds the report structs (`Report`, `CheckResult`, `Location`, the lowercase-serialized `Verdict`/`Severity`/`Status`/`Category` enums), the `Check` trait plus a rayon-or-sequential engine with per-check panic isolation, the verdict rollup, a TOML config system, and JSON Schema emission. `meshcheck-corpus` is the clap CLI: `check <file> --profile web [--override k=v]` reads a file, hashes it (sha2 0.11), detects GLB/glTF from magic bytes, resolves a profile, runs the (empty) registry, and prints a schema-valid envelope. `generate` and `bench` are explicit "not until P0M5/P0M6" stubs.

Two config files ship fully populated: `config/profiles.toml` (web/mobile/pc/hero, all nine budget params from SPEC_01) and `config/checks.toml` (every SPEC/GEO/XFM/UV/MAT/PERF/RND/VIS row with its default severity, params, and a `phase` marker). `docs/schema/report.schema.json` and `check_result.schema.json` are committed, emitted by the `emit-schema` bin, and guarded by a drift test that re-emits and byte-compares.

The engine is final in shape even though the registry is empty: `Check::run(&Scene, &ResolvedProfile, &CheckParams) -> CheckOutcome`, with the engine merging in configured severity and enforcing the info-status and locations-cap rules. P0M2 replaces `Scene`'s internals without touching the trait.

## Decisions

The load-bearing call was `CheckId`. Making it a `{ group, num }` struct whose `CheckGroup` enum is declared in canonical order means `derive(Ord)` yields exactly the SPEC report order (SPEC < GEO < ... < VIS, numeric within group). The engine can run checks in any (parallel) order and a single `sort_by_key(|r| r.id)` restores determinism; the "run twice, byte-identical" test confirms it. The string `"PERF-001"` form is just a custom serde/schemars impl on top.

Determinism drove the rest: `ReportMeta` injects `report_id`/`created_at`/`expires_at` so core stays clock-free, and every float goes through `q6`. To keep the CLI's clock use from dragging in a date crate — which the out-of-scope list did not bless — RFC3339 formatting is hand-rolled with Hinnant's civil-from-days algorithm.

Two places where SPEC/plan left gaps: `hole_area_pct` had no default number, so it is set to 1.0 in TOML (tunable later); and the `summary` block's exact counting semantics were loose. After a review pass, summary buckets mirror the rollup classification exactly — `errors` counts only error-severity fails (the thing that forces a fail verdict), `warnings` counts warns plus non-error-severity fails, info-severity passes land in `info`, and engine `error` statuses are counted in no bucket at all, surfacing instead as `verdict_confidence: "partial"`. The same review moved the info-severity rule enforcement into the engine: a warn/fail from an info check is rewritten to status `error` with a message naming the illegal status, rather than clamped to a fabricated pass. Both semantics are documented on `summarize` and covered by unit tests, including an end-to-end misbehaving-info-check test through `run_all`, `summarize`, and `rollup`.

## What broke

Four real failures. First, the info-severity clamp originally carried `debug_assert!(false, ...)`; the engine test that feeds an info check a `Fail` status runs in debug, so the assert fired and the test panicked instead of observing a clamp. The first fix made clamping silent (rewrite to `pass`), which review then correctly rejected as fabricating a passing result: a check that violates its severity contract is a broken check, and the truthful report is status `error`. Final behavior: the engine rewrites the status to `error` with a message naming the illegal status, which also flips `verdict_confidence` to `partial`.

Second, the initial `summarize` counted every `fail` and every engine `error` in the `errors` bucket, which contradicted the rollup: a report whose only finding was a warning-severity fail said `verdict: "warn"` next to `summary: {errors: 1, warnings: 0}` — two agents keying off different fields would disagree. Review caught it; the buckets now share the rollup's classification and the exact incoherence case is a regression test.

Third, `CliError` lacked `#[derive(Debug)]`, so `.unwrap()` in the CLI tests failed to compile (`unwrap` needs `E: Debug`). Added the derive.

Fourth, clippy under `-D warnings` rejected `results.sort_by(|a,b| a.id.cmp(&b.id))` in favor of `sort_by_key`, and a hand-computed RFC3339 test constant was simply wrong (I had the wrong unix seconds for 2026-07-13T18:04:11Z); recomputing gave 1783965851. Both fixed.

## Numbers

Measured on the dev machine (Windows, cargo 1.96). A clean `cargo build --workspace` after `cargo clean` took 9.38s. `cargo test --workspace` runs 37 tests (32 in core, 5 in the CLI), all passing. `cargo clippy --workspace --all-targets -- -D warnings` is clean. The wasm gate — `cargo build -p meshcheck-core --no-default-features --target wasm32-unknown-unknown` — succeeds, confirming the sequential-checks / no-rayon / no-getrandom path compiles. The emitted report validates against the committed schema (Python `jsonschema`, draft 2020-12), and perturbing the committed schema makes the drift test fail as intended. No performance benchmarks yet — there are no real checks to time until P0M2.

## Next

P0M2 brings the `gltf` crate in and fills `Scene` with real parsed geometry and the first checks (SPEC/PERF-shaped), reading their thresholds from the `config/*.toml` already shipped here. The trait and report contract are frozen, so that milestone is additive: implement checks, add corpus fixtures that trigger them, and start recording the checks_only timing the Phase 0 gate wants.
