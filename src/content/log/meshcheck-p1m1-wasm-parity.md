---
title: "Same bytes on two machines: compiling the meshcheck core to wasm"
date: 2026-07-13
project: "meshcheck"
phase: 1
milestone: 1
tags: [rust, wasm, wasm-bindgen, determinism, parry3d]
draft: true
summary: "meshcheck-core runs in Node via a wasm-bindgen binding emitting byte-identical reports to the native CLI across the 27-asset corpus, GEO-009 included."
repo_ref: "p1m1"
decisions:
  - what: "The report JSON is produced by serde_json inside Rust and crosses the wasm boundary as an opaque String; JS never re-serializes it"
    why: "Byte parity with native is the product gate. JS `JSON.stringify` cannot be trusted to match Rust's key ordering or float formatting, so the only safe contract is: Rust serializes, JS compares raw strings. `validate` returns `to_string_pretty` output verbatim."
    alternatives: ["serde-wasm-bindgen returning a JS object (JS then stringifies — ordering/number drift)", "return structured data and rebuild the envelope in TS (two serializers, guaranteed drift)"]
  - what: "Build GEO-009 (parry3d) ON for wasm rather than taking the documented skip-fallback"
    why: "Research proved parry3d compiles on wasm32 and that `enhanced-determinism` routes float math through libm on both targets; the open question was runtime byte-parity. The corpus parity bench answered it: Box__self_intersect measures 52 intersecting pairs identically native↔wasm, and every GEO-009 measured block matched byte-for-byte. The fallback (skip GEO-009 hosted) was never needed and stays documented but unused."
    alternatives: ["ship wasm without geo-selfx and let GEO-009 report skipped (a reviewer-decided fallback, reserved for a drift we did not hit)"]
  - what: "`--zero-timing` on the CLI also suppresses spec-validator discovery, not just timing"
    why: "The wasm build has no validator subprocess, so `CheckContext.validator = None` there and SPEC-001 always skips. For byte parity the native side must skip SPEC-001 identically. `--zero-timing` is the parity/determinism switch, so coupling 'no clock' with 'no external non-deterministic subprocess' under one flag keeps the deterministic pipeline coherent — and means parity holds regardless of whether a gltf_validator happens to be on PATH."
    alternatives: ["a separate --no-validator flag (more surface for the same effect)", "rely on the validator being absent on dev/CI (fragile: a machine with gltf_validator installed would fail parity on SPEC-001 only)"]
  - what: "meshcheck-wasm depends on meshcheck-core via a direct `path` dep with `default-features = false`, not the `{ workspace = true }` inherited form"
    why: "Cargo silently IGNORES `default-features = false` when it is set on a member that inherits a workspace dependency which did not itself set it — a warning-level footgun that would have dragged rayon into the wasm build (rayon does not target wasm32-unknown-unknown here). A direct path dep guarantees the sequential, no-rayon core for the isolated wasm-pack build while the host workspace build still unifies to parallel+geo-selfx."
    alternatives: ["set default-features=false on the workspace dep and re-enable features per consumer (correct, but perturbs meshcheck-corpus's feature set repo-wide for one crate's need)"]
  - what: "The parity harness (`scripts/wasm-parity.mjs`) is plain Node with a hand-rolled minimal manifest.toml reader"
    why: "No package manager exists in the repo yet (Phase 1 introduces pnpm later), so the harness uses only Node built-ins + the wasm-pack CommonJS glue. It needs only name/kind/files/profile per asset, so a ~30-line block-and-array reader beats pulling a TOML dependency."
    alternatives: ["add a TOML npm dependency (needs a package manager we don't have yet)", "have Rust emit the asset list as JSON (an extra CLI surface for data the manifest already holds)"]
benchmarks:
  - metric: "wasm↔native report parity, full corpus"
    value: "27/27 byte-identical (6 clean + 21 broken), GEO-009 ON"
    target: "byte-identical (fixed meta, zeroed timing) — Phase 1 gate"
  - metric: "wasm↔wasm determinism (double validate per asset)"
    value: "27/27 byte-identical"
    target: "no run-to-run drift"
  - metric: "release .wasm size (wasm-opt applied by wasm-pack)"
    value: "1,074,342 bytes (~1.05 MiB)"
    target: "well under the 250 MB Vercel bundle cap (research: ~1–2.5 MB expected)"
  - metric: "wasm-pack build --target nodejs --release"
    value: "~14 s cargo compile, ~20 s end-to-end (incl. wasm-opt)"
    target: "fast enough to run per-CI-job"
  - metric: "GEO-009 on wasm (Box__self_intersect)"
    value: "52 intersecting pairs, 24 triangles tested — identical to native"
    target: "parry3d byte-parity, not a skip"
  - metric: "cargo test --workspace"
    value: "214 passing (up from 202), +12"
    target: "all green"
  - metric: "cargo clippy --workspace --all-targets -D warnings + wasm32 core gate"
    value: "clean / compiles"
    target: "no warnings; core stays wasm-safe"
---

## What shipped

`meshcheck-core` now runs in Node. A new `crates/meshcheck-wasm` crate (cdylib + rlib, wasm-bindgen 0.2.126, `console_error_panic_hook`) exposes `init_panic_hook()` and `validate(file_bytes, filename, profile_name, overrides_json, checks_toml, profiles_toml, meta_json, resources)`, which runs the identical parse → checks → assemble pipeline the native CLI runs and returns the report as the string `serde_json::to_string_pretty` produced inside Rust. The string leaves Rust untouched; JS only compares it.

Three supporting pieces make the binding provable. Core gained string entry points `ChecksConfig::from_toml_str` / `ProfilesConfig::from_toml_str` (wasm has no filesystem; `load()` delegates through them) and `ReportMeta::from_json_str` (shared by the CLI and wasm so both inject the same fixed identity). The CLI's `check` subcommand gained `--meta <json>` (inject report identity verbatim) and `--zero-timing` (zero `timing_ms` and skip validator discovery), so two native runs are byte-identical and comparable against wasm. And `scripts/wasm-parity.mjs` drives the whole corpus through both builds and raw-string-compares, per asset, exiting non-zero on any drift.

The wasm is built `--no-default-features --features geo-selfx` for core — sequential checks (no rayon on wasm), GEO-009 ON. A new `phase1-wasm-parity` CI job installs wasm-pack + Node 22, builds the pkg, generates the corpus, and runs the harness as a hard gate.

## Decisions

The load-bearing decision is the one inherited from research: the report is serialized once, in Rust, and the wasm boundary is a string, not a structure. Everything else follows — `from_toml_str`, the injected `ReportMeta`, zeroed timing, the resource resolver being a pure lookup — all exist so the wasm report is a pure function of `(bytes, config)` that matches native bit-for-bit. GEO-009 was the gamble: parry3d compiled, but only the bench could prove the tri-tri intersection floats land on the same bits. They do. See the decisions list for the `--zero-timing`/validator coupling and the Cargo default-features footgun.

## What broke

One real trap. My first cut had `meshcheck-wasm` depend on core via `{ workspace = true, default-features = false, features = ["geo-selfx"] }` — the idiomatic form. Cargo emitted a *warning*, not an error: `default-features` is ignored for a workspace-inherited dependency whose workspace entry didn't itself set it. Ignored — meaning core would build with its full defaults, dragging **rayon** into the wasm graph, which does not target `wasm32-unknown-unknown` here. The wasm-pack build would have failed at link with a confusing rayon error far from the cause. The fix was a direct `path` dep in the wasm crate, which honors `default-features = false`; `cargo tree --target wasm32` now shows no rayon / getrandom / instant / rand in the wasm subgraph, exactly as research predicted.

Smaller: the wasm crate is a workspace member, so the host `clippy --all-targets -D warnings` and `cargo test` gates compile it for Windows too. wasm-bindgen and js-sys host-compile fine (their non-wasm stubs), so this is free coverage — but it did mean `WasmError` needed a `Debug` derive for a `.unwrap()` in a unit test. And the corpus's `corrupt_json` asset turned out not to be a parse error at all: it parses cleanly (the corruption is an out-of-bounds accessor that only the Khronos validator catches), so with no validator it produces a full report on both sides and byte-compares like any other asset rather than exercising the error path.

## Numbers

27/27 corpus assets are byte-identical native↔wasm with a fixed `ReportMeta` and zeroed timing — 6 clean on `pc`, 21 broken on their manifest profile (20 `pc`, 1 `mobile`), FlightHelmet's 17-file `.gltf` bundle resolved through an in-memory resources Map, `corrupt_json` included. The same harness runs `validate` twice per asset and confirms wasm↔wasm determinism: 27/27. GEO-009 is genuinely ON, not skipped — `Box__self_intersect` reports 52 intersecting pairs / 24 triangles tested on wasm, identical to the native value recorded at P0M5. The release `.wasm` is 1,074,342 bytes (~1.05 MiB) after wasm-pack's automatic wasm-opt pass — comfortably inside the 250 MB Vercel unzipped-bundle cap. A wasm-pack release build is ~14 s of cargo compile and ~20 s end-to-end. Workspace tests rose to 214 (from 202): the new `from_toml_str` / `from_json_str` unit tests, the wasm crate's four host-side unit tests, and a CLI `--meta`/`--zero-timing` integration test that asserts byte-identical double-runs and injected identity. Clippy is clean under `-D warnings` and the wasm32 core gate still compiles.

## Next

P1M2 stands up the `api/` pnpm workspace: the Neon ledger schema, auth + rate-limit middleware, and the vitest harness. This milestone means the wasm core it will call is already proven byte-faithful — the parity harness becomes a standing CI gate (`phase1-wasm-parity`) that every later Phase 1 change must keep green, and the fixed-meta/zeroed-timing discipline established here is the same discipline the TS layer must honor for anything it hashes or compares.
