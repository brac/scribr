---
title: "Bytes in, the exact report out: meshcheck's /validate goes end-to-end"
date: 2026-07-13
project: "meshcheck"
phase: 1
milestone: 3
tags: [typescript, hono, wasm, ssrf, credits]
draft: true
summary: "POST /v1/validate runs end-to-end: three input modes, the verbatim wasm report, one credit burned, the report stored and re-fetchable, upload blob deleted."
repo_ref: "p1m3"
decisions:
  - what: "The /validate response body IS the wasm-produced report string, passed through verbatim — never JSON.parse'd or re-stringified anywhere in the request path"
    why: "Byte parity with the native build is the P1M1 gate, and JS JSON.stringify key-ordering/number-formatting can't be trusted to match Rust's serde_json. The wasm binding returns serde_json::to_string_pretty as a String; the route responds with that string, stores that same string in Blob, and GET /reports streams it back verbatim. A test pins body === stored blob === a direct wasm run with the same injected meta. The ONLY JSON.stringify in the path is on INPUT (overrides + the report meta), never on the report."
    alternatives: ["parse the report to read verdict/report_id then re-serialize (breaks byte parity; forbidden by the plan)", "return a typed object and let Hono serialize (same problem)"]
  - what: "Charge lands AFTER input acquisition + size/format/bundle validation and BEFORE the wasm run; a post-charge MALFORMED_GLTF stays charged"
    why: "Input-acquisition failures (bad body, private-IP url, missing blob, oversize, unsupported magic, unusable bundle) must never burn a credit, so they all throw pre-charge. The charge is the atomic row-locking CTE from P1M2 — 402 INSUFFICIENT_CREDITS before any heavy work. Once charged, a wasm-level MALFORMED_GLTF is the user's bad file: SPEC_03 promises no refunds, so it stays charged. Both directions are tested (UNSUPPORTED_FORMAT ⇒ balance unchanged; MALFORMED_GLTF ⇒ balance −1)."
    alternatives: ["charge first, refund on failure (SPEC_03 makes no refund promise; adds a ledger-reversal path we don't want in v1)", "charge only on success (a cheap way to DoS the wasm with malformed files for free)"]
  - what: "mode:\"full\" is accepted but charges 1 credit (the checks_only price) in M3, and >20MB returns a 413 with a documented async-deviation note"
    why: "Both are temporary, plan-binding scope calls. We don't charge 2 for screenshots the (not-yet-built) renderer can't deliver — screenshots:[] and RND checks skip (the core already does this), so full ≡ checks_only in M3; Phase 2 flips the cost to SPEC_03's 2. And async (>20MB) lands in P1M4: rather than half-build a job path, a >20MB (within-plan) file returns 413 FILE_TOO_LARGE with detail.note 'async path arrives with jobs API' — a documented, temporary contract deviation that creates NO job rows (no zombies on redeploy)."
    alternatives: ["charge 2 for full now (charging for undeliverable screenshots)", "202 + a fake job envelope for >20MB (a zombie job the P1M4 worker never picks up)"]
  - what: "BUNDLE_INCOMPLETE (API 422) vs SPEC-003 (report finding) split lives at the zip boundary"
    why: "A structurally unusable archive — unreadable, over the 200-entry / 500MB-declared caps, unsafe entry paths, or with no single top-level .gltf/.glb primary — is a BUNDLE_INCOMPLETE API error. A READABLE bundle whose .gltf references a file absent from the zip is NOT an API error: the bytes flow to the core, which reports a SPEC-003 fail. That is the product working. Tested both: a zip of missing_bin.gltf alone returns 200 with SPEC-003 fail + verdict fail; a zip with no primary returns 422."
    alternatives: ["treat any missing resource as BUNDLE_INCOMPLETE (hides the product's actual finding behind a 4xx)", "run the core on unreadable zips (crashes or garbage instead of a clean 422)"]
  - what: "url-mode SSRF guard resolves ALL A/AAAA, rejects the whole set if ANY address is private/reserved, and re-validates every redirect hop (≤3), with a 25MB/10s cap"
    why: "phase-1-stack's resolve-check-pin. Rejecting the entire resolved set (not just one address) defeats a rebind that mixes one public + one private answer; re-checking on every hop defeats redirect-to-private. The classification predicate covers v4 (private/loopback/link-local/CGNAT/TEST-NET/benchmark/multicast/reserved) and v6 (::1, ::, ULA fc00::/7, link-local fe80::/10, multicast, v4-mapped, 2001:db8::/32), and fails closed on anything unparseable. All network is injected (Deps.fetch + Deps.resolveDns) so the whole guard is unit-tested with mocked DNS and a mocked fetch — no real network in the suite."
    alternatives: ["a library (dssrf) — hand-rolled keeps the classification auditable and the injection seam clean", "check only the first resolved address (a mixed answer slips a private IP through)"]
  - what: "BAD_REQUEST (400) added to SPEC_03 (review round), with a TS pre-flight on overrides so ill-formed options are rejected BEFORE charge()"
    why: "SPEC_03's new rule (added with the code): client-side errors detectable from the input alone must be caught before credits are charged, and INTERNAL never describes a client error. TS validates override SHAPE against the nine profile parameters (SPEC_01/ResolvedProfile — max_tris, max_verts, max_texture_dim, max_texture_mem, max_materials, max_draw_calls, max_file_bytes as integers; min_extent, max_extent as floats): unknown key, non-number, negative, or fractional-for-integral ⇒ 400 BAD_REQUEST naming the offending key, pre-charge. The core remains the authority on override SEMANTICS — TS is a pre-flight only, so a residual core CONFIG_ERROR after the pre-flight passes is genuinely our bug and stays INTERNAL. Unparseable request bodies/options also remap to BAD_REQUEST, keeping UNSUPPORTED_FORMAT strictly for model-FILE format problems."
    alternatives: ["let bad overrides reach the core and surface as post-charge INTERNAL (the shipped-then-rejected v1: charges for a client mistake and mislabels it a server fault)", "duplicate full override semantics in TS (two sources of truth; drifts from the core)"]
  - what: "Object storage lives behind a 4-method BlobStore seam (MemoryBlobStore for tests, VercelBlobStore compile-ready), and upload blobs are deleted in a finally on BOTH success and error"
    why: "Privacy is a feature (CLAUDE.md rule 5): uploads deleted immediately after processing, reports private + expiring. The seam (putPrivate/get/del/list) means the request path never touches a vendor SDK; the in-memory impl makes the whole suite fast + hermetic, and VercelBlobStore (@vercel/blob, access:'private') is compile-ready for the P1M5 switch — same pattern as the Neon driver. Upload-blob deletion sits in a try/finally around the whole validate body, so it fires whether the run succeeds, 413s, or throws MALFORMED_GLTF after the charge — all three tested via the MemoryBlobStore."
    alternatives: ["write reports/uploads to disk directly (no seam; couples routes to a storage impl)", "delete only on success (leaks upload bytes on every error path — a privacy regression)"]
benchmarks:
  - metric: "pnpm -r test (Vitest, PGlite + in-memory Blob + wasm bridge)"
    value: "80 tests / 11 files, ~9s (up from 21/6 at p1m2 — 59 new incl. the review round)"
    target: "all green, hermetic, no services/network"
  - metric: "pnpm -r typecheck (tsc --noEmit, strict, exactOptionalPropertyTypes)"
    value: "clean"
    target: "strict TS, no errors"
  - metric: "byte-pin: /validate body === stored blob === direct wasm output (Box.glb)"
    value: "identical (15,093-byte report string)"
    target: "byte-for-byte identical"
  - metric: "cargo test --workspace (Rust gates untouched)"
    value: "214 passed, 3 ignored — unchanged from p1m1/p1m2"
    target: "still green, untouched"
  - metric: "error codes reachable through app.fetch"
    value: "13 of 16 (all but JOB_NOT_FOUND, RENDER_FAILED, INSPECT_UNAVAILABLE — later milestones)"
    target: "every M3 input/validation/credit code end-to-end"
---

## What shipped

`POST /v1/validate` — the core product — now works end-to-end on the dev machine. Bytes come in three ways (SPEC_03): a multipart `file` field, a JSON `{ url }` the server fetches under an SSRF guard, or a JSON `{ blob_id }` pointing at a previously-uploaded blob. The report goes out as the **exact string meshcheck-core produced in wasm**, stored in a Blob and re-fetchable, with one credit burned atomically and the upload blob deleted afterwards.

New surface under `api/src/`:
- `core.ts` — the wasm bridge. Loads `crates/meshcheck-wasm/pkg` once at module scope (sync `readFileSync` glue, same as the parity harness), reads `config/checks.toml` + `config/profiles.toml` once, exposes `runValidate(bytes, filename, profile, overrides, meta, resources) -> string`, `detectFormat` (for the pre-charge magic check), and `isKnownProfile`/`knownProfiles` (parsed from the TOML — profile names are data). Thrown wasm codes map to `ApiError` (MALFORMED_GLTF, UNSUPPORTED_FORMAT pass through; the rest become INTERNAL).
- `ssrf.ts` — the resolve-check-pin fetch: http(s) only, resolve all A/AAAA, reject the whole set if any address is private/reserved, re-validate each of ≤3 redirect hops, 25MB streamed cap, 10s timeout. Failures are `FETCH_FAILED` with structured detail.
- `zip.ts` — yauzl bundle extraction with caps enforced BEFORE inflate (200 entries, 500MB declared total), traversal/absolute/symlink rejection, and single-top-level-primary selection; structural failures are `BUNDLE_INCOMPLETE`.
- `blob.ts` — the `BlobStore` seam (`putPrivate/get/del/list`) with `MemoryBlobStore` (tests) and a compile-ready `VercelBlobStore` (`access:'private'`).
- `ids.ts` — `rpt_` + ULID report ids and account-scoped upload keys, all from the injected clock + crypto.
- `inputs.ts` — input acquisition across the three modes, returning bytes + parsed options + a `source` tag the route uses for blob deletion.
- `routes/validate.ts`, `routes/uploads.ts`, `routes/reports.ts` — the three endpoints, mounted on the existing `/v1` auth+ratelimit tree.

`Deps` grew three injected seams (`blob`, `fetch`, `resolveDns`) alongside the P1M2 `db`/`now`/`crypto`, so the whole thing stays drivable through `app.fetch(new Request(...))` with no real network or storage.

Fifty-nine new Vitest tests (80 total, including the review round) cover: the three happy paths + the byte-pin; every M3-reachable error code through `app.fetch` (including the six BAD_REQUEST shapes and a valid-override happy path that flips PERF-001 on Box); credit behaviour (exactly 1 burned; pre-charge failures — including every BAD_REQUEST — burn nothing; post-charge MALFORMED_GLTF stays charged); upload-blob deletion on success and on a post-charge error; the SSRF classifier + redirect/timeout/oversize logic (mocked DNS + fetch); the zip guard's every branch; and the reports round-trip + expiry under the injected clock. CI's `phase1-api` job now builds the wasm pkg (Rust toolchain + wasm-pack, same pin as the parity job) before typecheck/test.

## Decisions

The load-bearing decision is **verbatim passthrough**: the report string leaves Rust once and is never re-serialized. `runValidate` returns it, the route responds with it (`content-type: application/json`), the same string is stored at `reports/{id}.json`, and `GET /reports` streams those bytes back. The byte-pin test asserts `body === stored === runValidate(sameBytes, …, metaExtractedFromBody)` — the response's own `report_id`/`created_at`/`expires_at` are fed back into a direct wasm run and must reproduce the response byte-for-byte. The only `JSON.stringify` in the path is on input (overrides + meta).

**Charge placement** encodes the refund policy in control flow. Everything that can fail on the user's *request shape or input* throws before `charge()`; only the wasm run (and persistence) happens after. So the ledger only moves for a request that got far enough to actually run the core, and a malformed glTF the user uploaded stays charged (SPEC_03 promises no refund). The charge itself is the P1M2 row-locking CTE, unchanged.

The **two scope deviations** (mode:full charges 1; >20MB ⇒ 413 with an async note) are deliberately visible: the full price and the async path both arrive in later milestones, and faking either now would mean charging for undeliverable screenshots or minting zombie job rows. The **BUNDLE_INCOMPLETE/SPEC-003 split** keeps the product's actual finding (a missing referenced resource) as a 200 report, reserving the 4xx for archives the core genuinely can't read.

Everything non-deterministic stays injected: report ids and blob keys come from `deps.now()` + `deps.crypto` (no `Date.now`/`Math.random`), and the SSRF guard's DNS + fetch are `deps.resolveDns`/`deps.fetch`, which is what makes the whole SSRF suite runnable with zero real network.

## What broke

Nothing blew up at runtime, but several things bent during the build:

- **yauzl guards filenames before my code does.** My `isUnsafeEntryName` (traversal/absolute/drive-letter/backslash/null) turned out to be *behind* yauzl's own validator — yauzl emits an `error` for `..` and absolute/drive paths first, so the archive-level test saw a `{cause}` detail, not my `{entry}` detail. The right call was to keep my predicate as defense-in-depth, test it directly as a pure function, and assert only the *outcome* (BUNDLE_INCOMPLETE) at the archive level. The guard is still worth having — it documents the policy and covers anything a future zip reader wouldn't.
- **The timeout test would have taken 10 real seconds.** The SSRF caps were hardcoded constants, so exercising the abort path meant waiting the full 10s (and the oversize path meant a 25MB buffer). I added an optional `SafeFetchOpts { maxBytes, timeoutMs, maxRedirects }` to `safeFetch` (the route always uses the SPEC_03 defaults); the timeout test now aborts at 10ms against a fetch mock that rejects on `signal`, and the oversize test caps at 100 bytes. Fast, deterministic, same code path.
- **`exactOptionalPropertyTypes` bit twice.** `@vercel/blob`'s `list({ cursor })` rejects `cursor: string | undefined` (the option must be present-and-string or absent), so the pagination loop builds the options object conditionally. And `FormDataEntryValue` isn't a global under `types: ["node"]` + `lib: ES2023`, so the multipart-overrides helper takes `unknown` and narrows with `typeof`.
- **SPEC_03 had no generic 400 code, and my first mapping papered over it — review rejected that.** The v1 shipped unparseable request bodies as `UNSUPPORTED_FORMAT` (415), which stretches a code that means "your model file isn't glTF" to cover "your JSON is broken", and worse: a bad override *value* slipped past the route entirely and surfaced as a **post-charge INTERNAL** from the core's CONFIG_ERROR — a client mistake, charged, and mislabeled a server fault. Review added `BAD_REQUEST` (400) to SPEC_03 (docs first, same as NOT_FOUND in P1M2) plus the rule that input-detectable client errors must precede the charge. The remap: unparseable bodies/options and unknown/ill-typed/negative overrides ⇒ 400 BAD_REQUEST pre-charge (the override pre-flight names the offending key); UNSUPPORTED_FORMAT is now strictly for model-file format problems; unknown *profile*/*blob_id*/*report* stay `NOT_FOUND` (named resources, all pre-charge, all tested). Residual core CONFIG_ERROR after the TS pre-flight passes remains INTERNAL — at that point it genuinely is our bug.
- **`@vercel/blob` `access:'private'` is a compile-time cast.** The 2.x option surface's literal union is pinned differently across minors, so the private-put option is cast to the SDK's parameter type to stay compile-ready without chasing a specific minor. That path is deploy-smoke-tested (P1M5), not unit-tested — the same treatment the Neon driver got in P1M2.

Known weaknesses, deliberately deferred:
- **The SSRF pin is app-level, not socket-level (M3).** We resolve + reject the whole set on every hop, but the injected fetch resolves again at connect, leaving a narrow DNS-rebind TOCTOU window. True socket pinning (an undici dispatcher bound to the verified address) is layered into the production fetch at deploy, like VercelBlobStore. The *decision logic* — the part that could have a bug — is fully unit-tested; the residual is a connect-time re-resolution, and url mode is the least-used input.
- **Big files are fully buffered before the 413.** A >20MB (or >plan) blob_id/url is read into memory before the size gate rejects it. That's the cost of sync-only in M3; the async path (P1M4) streams to storage and never materializes the whole file.
- **No transaction spans the charge + Blob put + index insert.** A crash between them could leave a charged-but-unstored report or an orphan blob. Acceptable for v1: reports are cheap, the ledger is the source of truth, and the P1M4 retention cron sweeps orphans (that's what `BlobStore.list` is for).

## Numbers

Measured on the dev machine (Windows, Node 24.15, pnpm 9.15 via corepack). `pnpm -r typecheck` (strict `tsc --noEmit`, `exactOptionalPropertyTypes`) is clean. `pnpm -r test` runs 80 Vitest tests across 11 files in ~9s, each suite spinning up its own in-memory PGlite (migrations + plan seed) and an in-memory BlobStore; the Vitest `globalSetup` builds the wasm pkg once if missing and no-ops when present. The byte-pin holds: the `/validate` response body, the stored blob, and a direct wasm run of `Box.glb` are all the same 15,093-byte string. Thirteen of the sixteen SPEC_03 error codes are now reachable through `app.fetch` — everything except `JOB_NOT_FOUND` (P1M4 jobs), `RENDER_FAILED` (Phase 2 renderer), and `INSPECT_UNAVAILABLE` (vision). The Rust gates are untouched: `cargo test --workspace` is still 214 passed / 3 ignored, exactly as at p1m1/p1m2.

## Next

P1M4 brings the async path: `POST /v1/validate` on >20MB files returns 202 + a job envelope instead of the temporary 413, backed by a real jobs row (no zombies — the plan's Vercel Workflow seam), plus `GET /v1/jobs/:id` (making `JOB_NOT_FOUND` reachable) and the retention cron that sweeps unclaimed upload blobs and expired reports via `BlobStore.list`. P1M5 provisions Neon + real Vercel Blob, flipping `MemoryBlobStore`→`VercelBlobStore` and adding the deploy smoke tests that finally exercise `access:'private'`, the client-upload token flow, and the socket-level SSRF pin under real network.
