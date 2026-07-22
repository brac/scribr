---
title: "From bytes to a report card: meshcheck parses glTF and runs its first thirteen checks"
date: 2026-07-13
project: "meshcheck"
phase: 0
milestone: 2
tags: [rust, gltf, parsing, determinism, checks]
draft: true
summary: "meshcheck-core now parses real GLB/glTF into a normalized Scene, fills the stats block, and runs SPEC/XFM/PERF checks — Box.glb gets a genuine report card."
repo_ref: "p0m2"
decisions:
  - what: "CheckOutcome gains severity_override; effective severity = override.unwrap_or(configured)"
    why: "SPEC_01 has checks whose severity depends on the measurement (XFM-002, SPEC-001 passthrough); the override lets a check escalate/downgrade from config without hardcoding a Severity, and the info-status rule applies to the effective severity so an info-base check can legally warn once escalated"
    alternatives: ["a second severity field on the wire (breaks schema)", "hardcoding escalated severities in check code (violates the no-magic-number rule)"]
  - what: "Parse with gltf::Gltf::from_slice_without_validation, not from_slice"
    why: "The gltf crate's own validation rejects assets that require unknown extensions or have unresolved references — exactly the conditions SPEC-001/002/003 must *report*, not choke on. Spec conformance is our checks' job; only a broken container (bad JSON/GLB framing) is a parse error"
    alternatives: ["from_slice + treat its rejection as MALFORMED_GLTF (would make SPEC-002/003 unreachable)"]
  - what: "CheckContext threads the validator handle + raw file bytes + filename into every check"
    why: "SPEC-001 (validator) and SPEC-004 (file size) need inputs beyond the parsed Scene; injecting them keeps the Check trait pure and the validator an optional, swappable dependency (skipped when absent)"
    alternatives: ["a global/singleton validator", "stuffing raw bytes into Scene (couples parsing to the container)"]
  - what: "data: URIs are decoded inside meshcheck-core; the ResourceResolver only sees external URIs"
    why: "A data: URI is inline, self-contained data, not an external resource — decoding it in-parser keeps self-contained .gltf files working with a NullResolver and on wasm (no filesystem), and keeps the resolver purely about file IO"
    alternatives: ["route data: URIs through the resolver too (plan's literal wording; forces every resolver to embed a base64 decoder)"]
  - what: "Added LocationKind::Resource for SPEC-001 pointers and SPEC-003 URIs"
    why: "A validator JSON pointer and a missing external URI are not indexable scene entities (mesh/node/material/image), so the M1 entity-only LocationKind could not represent them; Resource carries the pointer/URI string in `name`. Additive enum value, schema re-emitted"
    alternatives: ["cram URIs into an Image location with a fake index (misleading)", "drop the locations and put everything in measured (fails the 'URI in locations' acceptance criterion)"]
  - what: "PERF-004 is measurement-only in v1 (info severity, empty threshold, no max_nodes)"
    why: "The budget profiles define no node-count budget and SPEC_01 marks PERF-004 info (can never warn/fail); it reports the node total now, and a threshold can be filled in later without a schema change"
    alternatives: ["invent a max_nodes budget not sanctioned by SPEC_01"]
  - what: "PERF-005 flags COLOR_n only when the primitive has no material at all"
    why: "Core glTF gives no signal for whether a material consumes vertex colors, so we stay conservative to avoid false positives; a material-less primitive's vertex colors are unambiguously unused. TEXCOORD/TANGENT bloat is decided against the primitive's actual material"
    alternatives: ["always flag COLOR_0 (noisy false positives)", "never flag COLOR_0 (misses the clear material-less case)"]
benchmarks:
  - metric: "Box.glb parse + checks (release, pc profile)"
    value: "<1ms each (parse and checks both round to 0ms; ~1-2ms total wall incl. process start)"
    target: "well under the Phase 0 checks_only budget"
  - metric: "cargo test --workspace"
    value: "100 passing (83 core + 5 integration + 12 corpus), 1 ignored live-validator test"
    target: "all green"
  - metric: "cargo clippy --workspace --all-targets -- -D warnings"
    value: "clean"
    target: "no warnings"
  - metric: "wasm32 build (meshcheck-core --no-default-features)"
    value: "success"
    target: "compiles"
  - metric: "live gltf_validator (2.0.0-dev.3.10) passthrough"
    value: "Box.glb clean ⇒ SPEC-001 pass; fake_ext ⇒ 2 errors ⇒ SPEC-001 fail"
    target: "subprocess path works against the real binary"
---

## What shipped

meshcheck-core now turns bytes into a report card. `Scene::from_bytes(bytes, &dyn ResourceResolver)` parses GLB and glTF via the `gltf` crate (no image import), resolves buffers (GLB BIN chunk, `data:` URIs, external URIs via the resolver), builds world-space primitive instances, and reads image dimensions header-only through `imagesize`. A missing external reference lands in `Scene::missing_references`, not a parse error. `Scene::stats(mip_factor)` fills the entire SPEC_02 `stats` block.

Thirteen checks run: SPEC-001..004, XFM-001..003, PERF-001..006, one file each under `crates/meshcheck-core/src/checks/`, every threshold from `checks.toml`/`profiles.toml`. The engine gained two things without touching the report wire shape: a `severity_override` on `CheckOutcome` (config-driven escalation) and a `CheckContext` (validator handle + raw bytes + filename) threaded through `run_all`. SPEC-001 is a `trait SpecValidator` in core with a mock-tested passthrough; the subprocess `GltfValidatorCli` lives in meshcheck-corpus, reporting `skipped` when no binary is discoverable.

The corpus CLI's `check` subcommand is real end-to-end: file-relative `.gltf` resolution (refusing path traversal), scene parse, stats with the MAT-002 mip factor, validator discovery, and real `parse`/`checks` timings plus `input.gltf_version`. Four tiny fixtures are committed (Box.glb pinned to a Khronos commit SHA, plus hand-authored missing-buffer, unsupported-extension, and non-uniform-scale cases) with integration tests asserting Box.glb's known stats and byte-identical double runs.

## Decisions

The engine amendment was the load-bearing one. SPEC_01 has checks whose severity is a function of the measurement — XFM-002 is "info, but warning if the model sits more than a diagonal off the origin"; SPEC-001 passes through the validator's own error/warning split. Rather than add a field to the wire, `CheckOutcome` gained `severity_override: Option<Severity>`, and the engine computes `effective = override.unwrap_or(configured)`. The subtlety is the info-status rule (info checks may only pass/skip/error): we apply it to the *effective* severity, so an info-base check that escalates to warning via its config `escalate_to` may legally `warn`, while the same check without an override still gets an illegal warn rewritten to an engine error. Three unit tests pin those interactions. A check may only source an override from config params, never a literal `Severity` — keeping the no-magic-number rule intact.

The second decision was forced by the `gltf` crate: `from_slice` runs Khronos-style validation and *rejects* an asset whose `extensionsRequired` we don't recognize. That is precisely the SPEC-002 signal, so calling `from_slice` would make the check unreachable — the fake_ext fixture failed to parse at all until we switched to `from_slice_without_validation`. Spec conformance is our checks' job; the parser's job is only to reject a genuinely broken container.

Two representational calls: `data:` URIs are decoded inside core (the `ResourceResolver` only ever sees external file URIs, keeping self-contained assets working with a `NullResolver` and on wasm), and `LocationKind` gained a `Resource` variant — a validator JSON pointer or missing URI is not an indexable entity, so it goes in `name`. An additive schema change; schemas re-emitted, drift test green.

## What broke

Three real ones. First, the fake_ext fixture: the CLI returned `MALFORMED_GLTF: "invalid glTF: extensionsRequired[0] = \"FAKE_ext\": Unsupported extension"` instead of a report with SPEC-002 failing. The `gltf` crate validates by default and refuses the asset; the fix was `from_slice_without_validation`, which also made SPEC-003's missing-buffer case *our* finding rather than a parse abort.

Second, the validator CLI flag. The research pinned `gltf_validator -o <asset>` for stdout; I second-guessed it and coded `-s -o <tempdir>`. Downloading the real binary (2.0.0-dev.3.10) and reading `--help` settled it: `-o`/`--stdout` is a boolean flag, there is no `-s`. Corrected, plus: parse stdout regardless of exit code (non-zero merely means errors were found). The live run then behaved — Box.glb clean ⇒ SPEC-001 pass, fake_ext ⇒ 2 validator errors ⇒ SPEC-001 fail with severity override to error.

Third, clippy under `-D warnings` rejected the thousands-separator helper's `% 3 == 0` in favor of `.is_multiple_of(3)` (a 1.96 lint). Fixed, and while there I named PERF-006's fixed glTF encoding sizes (`POSITION_BYTES_PER_VERTEX`, `INDEX_BYTES`, `PERCENT`) so the magic-number grep sees only structural constants.

Review caught a fourth, in output hygiene: an *undecodable* `data:` URI fell through to the file resolver and was recorded verbatim in `missing_references` — a malformed embedded buffer could dump megabytes of base64 into SPEC-003's output, whose message and measured list were also unbounded. Fixed by never handing `data:` URIs to the resolver (a short `data: URI (undecodable, N chars)` placeholder on decode failure) and capping SPEC-003's message at five named URIs plus "… and N more", with `measured.missing_references` capped at 20 alongside a `missing_references_truncated` flag; `missing_count` keeps the true total. A panicking mock resolver proves `data:` URIs never reach file IO.

## Numbers

Measured on the dev machine (Windows, cargo 1.96). `cargo test --workspace` runs 100 tests green (83 core unit, 5 fixture-integration, 12 corpus) plus one `#[ignore]`d live-validator test that passes when `MESHCHECK_GLTF_VALIDATOR` is set. Clippy is clean under `-D warnings`; the wasm32 no-default-features build still compiles (gltf and imagesize are pure Rust). Box.glb on the pc profile parses and runs all thirteen checks in under a millisecond each in release (~1–2ms total wall including process start), verdict `pass` with the expected stats: 12 triangles, 24 vertices, 1 mesh/primitive/material, 0 textures, 2 nodes, AABB `[-0.5,-0.5,-0.5]..[0.5,0.5,0.5]`. The double-run integration test confirms byte-identical reports with a fixed `ReportMeta`.

## Next

P0M3 brings the geometry checks (GEO-001..009): the shared edge→face adjacency map, manifold/boundary/winding analysis, and the parry-backed self-intersection sampler — the first consumers of the transform-applied triangle soup this milestone produces. The corpus generator (P0M5) later replaces hand-authored fixtures with mutation-driven ones.
