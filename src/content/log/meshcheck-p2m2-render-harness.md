---
title: "108 renders, one byte-stable table: the production render harness"
date: 2026-07-14
project: "meshcheck"
phase: 2
milestone: 2
tags: [threejs, playwright, determinism, typescript, rendering]
draft: true
summary: "renderer/ gains the studio rig, camera fit, six standard angles, decoders, integer evidence, and a RenderBackend seam — 3x deterministic over the full corpus."
repo_ref: "p2m2"
decisions:
  - what: "Render evidence is integer measurements only (pixel counts, bboxes, dimensions); every ratio and verdict is computed later in Rust against checks.toml thresholds"
    why: "Float formatting in TS must never be able to influence the report. Integers cross the wasm boundary exactly; non_bg_pixels and bbox are exact counts over the hash-verified RGBA buffer, so the P2M3 Rust checks derive visible-fraction and silhouette coverage from clean inputs."
    alternatives: ["quantized floats computed in TS (introduces a second float-formatting authority)", "verdicts in TS (breaks the thresholds-are-data-in-Rust-config principle)"]
  - what: "Engine failure is a value ({status:'error'}), never a thrown exception; the backend throws only on its own infrastructure failures"
    why: "This is the crash-isolation contract SPEC_04 requires in P2M4: a model that fails to load must yield a report with RND errors and partial confidence, not a 5xx. Box__corrupt_json exercises it — GLTFLoader throws inside the page, the backend returns a stable engine-error value."
    alternatives: ["exceptions for load failures (forces every caller to reconstruct the partial-report path)"]
  - what: "Evidence integers computed Node-side from the transferred buffer, with a mandatory in-page-vs-Node hash equality assertion on every frame"
    why: "The buffer is provably byte-identical to what produced render_hash (the self-check throws on mismatch), so this is equivalent to in-page computation while keeping computeEvidence a pure, synthetic-buffer-testable function."
    alternatives: ["compute counts/bbox in-page next to the hash (harder to unit test, same result)"]
  - what: "One camera fit from the whole-scene bounding sphere, shared across all six angles"
    why: "Per-angle refitting would rescale the model between views, making silhouette coverage incomparable across angles and turntables pulse. dist = radius/sin(fov/2) * margin, direction from (rv, rh)."
    alternatives: ["per-angle bounding-box fit (tighter frames, incomparable coverage)"]
benchmarks:
  - metric: "clean-corpus determinism (3 fresh-launch runs x 6 assets x 6 angles)"
    value: "108/108 cells identical: hash, integer evidence, and PNG bytes"
    target: "byte-identical across runs on the same backend (Phase 2 contract, local half)"
  - metric: "broken-corpus outcome stability (2 runs x 21 assets)"
    value: "21/21 stable (20 stable hashes, 1 stable engine-error); zero backend throws"
    target: "deterministic outcomes incl. failure values"
  - metric: "spike cross-validation"
    value: "BoomBox three_quarter hash = P2M1 spike hash byte-for-byte (06286f08…)"
    target: "productionizing must not move the same-backend bytes"
  - metric: "full clean determinism run wall time"
    value: "17.7s (3 runs, 18 launches, 108 renders; FlightHelmet ~2.1s/asset)"
    target: "informational baseline for P2M5 budgets"
---

## What shipped

`renderer/` is now a real package: `rig.json` (the SPEC_04 `studio` rig — size, background, camera fov/margin, three-light setup, the six SPEC_02 standard angles), a production harness (`renderer/harness/harness.html`) with GLTFLoader plus registered Draco/Meshopt/KTX2 decoders and multi-file `.gltf` support via route-served sibling resources, and a typed seam: `RenderBackend` / `RenderRequest` / `RenderResult` / `AngleEvidence` in `renderer/src/`, implemented by `LocalChromiumBackend` (local Playwright Chromium under the spike's SwiftShader flags). Frames come back as integer evidence plus a pngjs-encoded PNG; `render_hash` is computed in-page over the raw RGBA readPixels buffer and re-verified in Node on every frame. A determinism script runs the whole corpus; vitest covers rig loading, evidence math, PNG roundtrip, FlightHelmet's resources map, and the corrupt-JSON engine-error path (20 tests).

## Decisions

See frontmatter. The integer-evidence rule is the load-bearing one: it fixes the exact shape P2M3's `RenderEvidence` input into `meshcheck-core` consumes, and it keeps every threshold judgment in Rust where `checks.toml` lives.

## What broke

- **KTX2Loader's multiline import of `ktx-parse.module.js` slipped past the first vendor sweep** — the harness 404'd on it and `window.__renderAngles` never appeared (integration test timeout). Fixed by adding it to the vendor map; `sync-vendor.mjs` now fails loudly on any missing source file so three-version drift can't silently repeat this.
- **Nothing else.** The corpus itself uses no compression extensions, so the Draco/Meshopt/KTX2 wiring is spec-completeness verified only by loader registration — KTX2-under-SwiftShader output remains untested by any fixture (noted for the wild/ corpus later).

## Numbers

The determinism gate ran three full fresh-launch passes over the six clean assets at all six angles: every one of the 108 (asset, angle) cells produced identical render_hash, identical integer evidence, and identical PNG bytes across passes (reviewer re-ran independently; spot values matched to the pixel — Duck front `non_bg_pixels` 49347, Duck top bbox {107,148,389,360}). The 21 broken assets are outcome-stable across two passes, including the one intended engine failure (`Box__corrupt_json` → stable RangeError value) and `FlightHelmet__break_uri`, which three.js tolerates deterministically (renders with the missing texture). The production harness reproduced the frozen spike's BoomBox hash exactly, so the "same backend" bytes did not move while productionizing.

## Next

P2M3 moves the judgment into Rust: `RenderEvidence` on `CheckContext`, RND-001/002/003 as registry checks with `checks.toml` thresholds, screenshots into `Report::assemble`, evidence params on the wasm binding and native CLI, the `invisible` corpus mutation, and wasm-vs-native parity re-run over evidence-fed reports.
