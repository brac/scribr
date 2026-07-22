---
title: "Shipping the meshcheck API on Vercel Functions over a WASM core"
date: 2026-07-14
project: "meshcheck"
phase: 1
tags: [typescript, wasm, vercel, postgres, ssrf]
draft: false
summary: "meshcheck's validation API is live on Vercel Functions over the WASM core: hashed keys, a credit ledger, private Blob, async jobs, and a docs surface."
repo_ref: "phase-1"
decisions:
  - what: "The report is serialized once by serde_json inside Rust and crosses the WASM boundary as an opaque string; JS never re-serializes it, all the way to the job envelope"
    why: "Byte parity with the native build is the product gate, and JS JSON.stringify cannot be trusted to match Rust key ordering or float formatting; the route, the stored blob, GET /v1/reports, and the spliced job result are all the same bytes."
    alternatives: ["serde-wasm-bindgen returning a JS object that JS then stringifies", "return structured data and rebuild the envelope in TS", "JSON.parse the report to re-embed it in the job envelope"]
  - what: "meshcheck-wasm depends on meshcheck-core via a direct path dep with default-features = false, not the workspace-inherited form"
    why: "Cargo silently ignores default-features = false on a workspace-inherited dependency whose workspace entry did not set it, which would have dragged rayon into the WASM graph; rayon does not target wasm32 here. A direct path dep honors the flag and keeps the WASM core sequential."
    alternatives: ["set default-features = false on the workspace dep and re-enable features per consumer (perturbs meshcheck-corpus repo-wide)"]
  - what: "Integration tests run on PGlite (embedded Postgres) behind a one-function driver factory until Neon was provisioned in the deploy step"
    why: "Neon needed Ben's marketplace consent, which only landed at deploy. The db seam is a tiny Db.execute<T> interface with neon-http and PGlite adapters; every statement is plain Postgres so the same SQL runs on both."
    alternatives: ["stand up a Neon branch per CI run earlier (blocked on consent)", "mock the DB (would not exercise the ledger CTE or token-bucket SQL)"]
  - what: "Credits are charged via a row-locking CTE over a materialized account_balances row, not a guard on SUM(delta)"
    why: "Under READ COMMITTED two concurrent charges snapshot the same SUM, both pass, both insert, and the balance goes negative; Postgres re-checks a guard only on the row the statement itself UPDATEs. The loser blocks on the row lock, re-checks the committed balance, and fails. The ledger append rides in the same statement."
    alternatives: ["INSERT ... SELECT ... WHERE (SELECT SUM(delta)) >= amount (the rejected v1; races)", "read-then-write (TOCTOU)", "SERIALIZABLE + retry loops (Neon-HTTP is one-shot)"]
  - what: "BAD_REQUEST (400) and NOT_FOUND (404) were added to SPEC_03 with the rule that input-detectable client errors must be caught before charge()"
    why: "INTERNAL must never describe a client-side path error, and a bad override value must not surface as a post-charge INTERNAL. A TS pre-flight validates override shape against the nine profile parameters and names the offending key before any credit moves; the core stays the authority on semantics."
    alternatives: ["reuse INTERNAL for unknown routes and UNSUPPORTED_FORMAT for bad options (mislabels client faults, charges for them)"]
  - what: "Job state transitions are terminal-is-terminal: both failJob and the done-flip guard with status NOT IN ('done','failed')"
    why: "A first idempotency test found a re-run flipping an already-done job to failed and refunding; review then found the mirror race where a slow worker resurrected a swept-failed job to done. Guarding both transitions against either terminal state makes a re-run after completion a genuine no-op and a swept refund final."
    alternatives: ["guard the done-flip only against 'done' (lets a swept-failed job resurrect)", "rely on WDK step-retry alone (a stuck row and a charged-but-undelivered credit)"]
  - what: "The api/ package was renamed to server/ and the deployed api/ directory holds a single entry-only file"
    why: "Vercel's zero-config convention turns every .ts under a top-level api/ into its own function; the whole workspace under api/ minted 32 functions and blew the Hobby cap of 12. An entry-only api/index.js re-exporting the bundle holds Vercel to exactly one function with zero behavior change."
    alternatives: ["one function file per route (loses single-app Hono routing + shared middleware)"]
  - what: "The function is a single self-contained esbuild bundle (server/dist/bundle.mjs); the WASM glue and config/schema assets ship as real files via includeFiles"
    why: "Vercel's Node File Trace cannot follow this repo's pnpm-workspace symlink layout, so a traced function shipped a broken node_modules and crashed at boot with ERR_MODULE_NOT_FOUND: hono. Pre-bundling makes runtime resolution unnecessary; NFT only traces one relative import."
    alternatives: ["compile WASM in the Vercel Build Command (no toolchain in the image; slow, network-flaky)", "zero-config Hono preset with a root entry (breaks includeFiles for above-api/ assets)"]
  - what: "Production async processing uses a waitUntil BackgroundJobRunner behind the JobQueue seam, not the Vercel Workflow DevKit (reviewer-ratified)"
    why: "WDK requires a build-time directive transform and a framework builder; the esbuild bundle strips the use workflow/use step directives to inert strings, so start() rejected the function. BackgroundJobRunner schedules the identical shared lifecycle via waitUntil; the no-zombie invariant (charge-before-row + sweep fail-out/refund) covers the durability gap. Contract, schema, and poll path are unchanged."
    alternatives: ["adopt a WDK framework builder (a full deploy re-architecture that reintroduces the NFT problem)", "keep the temporary 413 for >20MB (no async product)"]
  - what: "The public docs limiter is attached inline per docs route, not via route.use('*') on the /-mounted sub-app"
    why: "A wildcard use('*') on a sub-app mounted at / ran the 60/min public IP bucket on every authed route, throttling authenticated callers at the public docs cap; the 20 rps load test collapsed to 1082 x 429. Scoping the limiter to the three exact GET routes fixes it."
    alternatives: ["keep use('*') (the shipped-then-fixed form; caps authed traffic at the public rate)"]
  - what: "Uploads over the request-body limit use a true presigned direct-to-Blob PUT, not an in-function PUT target"
    why: "The M3 in-function upload URL sent the 21MB client PUT through the serverless function and tripped Vercel's ~4.5MB body cap. presignUpload mints a single-use, size-capped Vercel Blob presigned URL so bytes go straight to storage; this matches the already-correct SPEC_03, so no contract change."
    alternatives: ["route uploads through the function (413 FUNCTION_PAYLOAD_TOO_LARGE above 4.5MB)"]
  - what: "Production is promoted and healthy but kept behind Vercel Authentication until the Phase 3 custom domain"
    why: "The API is live and verified, but the public surface (site, demo key, agent-facing docs URLs) is a Phase 3 concern; exposing it before the domain and demo exist adds surface with no consumer. Deliberate, not an oversight."
    alternatives: ["open production publicly now (exposes an API with no site, demo, or domain in front of it)"]
benchmarks:
  - metric: "wasm-vs-native report parity, full corpus"
    value: "27/27 byte-identical (fixed meta, zeroed timing), GEO-009 included"
    target: "byte-identical — Phase 1 gate"
  - metric: "integration suite (incl. all error codes)"
    value: "125/125 passing; 16-code table pinned, 14 reachable end-to-end"
    target: "100% pass"
  - metric: "sustained load, checks_only (deployed preview)"
    value: "1200/1200 -> 200; p50 168 ms, p95 297 ms, p99 1037 ms; 0x5xx, 0x429"
    target: "20 rps for 60s, p95 < 4 s, 0x5xx"
  - metric: "upload deletion post-processing"
    value: "vitest both paths + live async upload confirmed deleted in Blob post-job"
    target: "verified both paths"
  - metric: "retention sweep correctness"
    value: "live cron run: seeded expired report swept (row + private blob)"
    target: "verified"
  - metric: "mid-job restart recovery"
    value: "terminal-is-terminal + sweep fail-out/refund; live stuck-job path via sweep"
    target: "no zombie jobs"
  - metric: "ledger concurrency on Neon"
    value: "30 parallel charges vs 10 credits: exactly 10x200 / 20x402, balance 0"
    target: "parallel charges never overspend"
  - metric: "release .wasm size (post wasm-opt) / function bundle"
    value: "1,074,342 bytes (~1.05 MiB) wasm; bundle 3.9 MB after WDK tree-shake (from 6.2 MB)"
    target: "under the 250 MB Vercel unzipped bundle cap"
---

## What shipped

The meshcheck API is deployed on Vercel Functions and answers requests over `meshcheck-core` compiled to WASM. A single Hono app (assembled by `createApp(deps)`, everything non-deterministic injected) serves `POST /v1/validate` in three input modes — multipart upload, server-fetched URL, and previously-uploaded `blob_id` — plus `GET /v1/reports/:id`, `GET /v1/jobs/:id`, `GET /v1/account`, `POST /v1/uploads`, and the internal cron sweep. The report leaves Rust once as a string and is passed through verbatim to the response, the stored blob, and the job envelope; a byte-pin test holds `body === stored === a fresh wasm run`. The WASM build carries GEO-009 (parry3d) on, byte-identical to native across all 27 corpus assets.

State lives in Neon Postgres: accounts and sha256-hashed keys, an append-only credit ledger with a materialized `account_balances` row, and a Postgres token-bucket rate limiter. Uploads and reports live in private Vercel Blob — presigned direct-to-Blob PUTs for large files, HMAC-signed webhooks over the exact body bytes, and a 30-day retention sweep run by a nightly cron. The `>20MB` path returns a `202` job envelope and runs behind the `JobQueue` seam via a `waitUntil` `BackgroundJobRunner`. A public, unauthenticated docs surface (schema endpoints serving the schemars bytes, an OpenAPI 3.1 doc that `$ref`s the published schema URLs, and `llms.txt` with the SPEC_03 privacy commitments verbatim) sits ahead of the authed subtree. Production is promoted and healthy, kept behind Vercel Authentication until the Phase 3 custom domain — deliberate, since the site and demo do not exist yet.

## Decisions

The load-bearing decision, inherited from Phase 0, is that the report is a pure function of `(bytes, config)` serialized once in Rust; every TS layer treats it as opaque bytes. The credit charge and the token-bucket consume are each a single atomic Postgres statement whose guard lives on the row the statement itself updates — the only form that survives true concurrency. Two error codes (`BAD_REQUEST`, `NOT_FOUND`) were added to SPEC_03 in review, with the rule that input-detectable client errors are caught before `charge()`. Job transitions are terminal-is-terminal on both paths. The deploy shape — an entry-only `api/` directory, a self-contained esbuild bundle, WASM and config through `includeFiles`, and `waitUntil` in place of WDK — was forced by how Vercel resolves and counts functions, not by preference. See the `decisions` array for each rejected alternative.

## What broke

This phase had real failures, several caught only in review or only on the deployed instance.

The first credit-charge CTE guarded on `SUM(delta)` in a subquery. It passed every sequential PGlite test and was wrong: under READ COMMITTED two concurrent charges snapshot the same sum, both pass, both insert, the balance goes negative. PGlite is single-threaded and could not surface it; review rejected it and the fix was the materialized-balance row-lock the spec had named all along.

The `20 rps` load test collapsed to `1082 x 429` on a key rated `6000/min`. The suspected cause — a negative token-bucket refill from out-of-order `now` — was a real latent bug, clamped and regression-tested, but it did not move the number (`1082 -> 1081`). The actual cause was a wildcard `route.use('*')` on the `/`-mounted docs sub-app: the `60/min` public IP limiter ran on every authed route. The signature gave it away — `119` passes over `60s` is exactly `60 + 60` refilled, a `60/min` bucket, never `6000`. Scoping the limiter to the three docs routes fixed it; the load test then ran `1200/1200 -> 200`.

Three more surfaced on the preview deploy. `GET /v1/reports/:id` returned `404` right after a successful validate: the row was in Neon, but `VercelBlobStore.get()` fetched a private object URL with no authorization and got `403`, so the route saw the report as gone — one root cause behind report reads, async reads, and webhook re-reads. WDK's `start()` rejected the workflow function because the esbuild bundle stripped its `"use workflow"` directives to inert strings, forcing the `waitUntil` runner (reviewer-ratified). And `vercel build` minted `32` functions against the Hobby cap of `12` because every `.ts` under `api/` became a function, fixed by renaming to `server/` behind an entry-only `api/index.js`. An earlier boot bug dropped every response: `export default handle(app)` is invoked as the legacy `(req, res)` handler on the Node runtime, so Hono's `Response` was ignored until it became `{ fetch: handle(app) }`.

## Numbers

The deploy gate ran against the deployed preview: `20 rps x 60s = 1200/1200 -> 200`, p50 `168 ms`, p95 `297 ms`, p99 `1037 ms`, `0 x 5xx`, `0 x 429`. WASM-vs-native parity is `27/27` byte-identical. Ledger concurrency on Neon: `30` parallel charges against `10` credits yielded exactly `10 x 200 / 20 x 402` with the balance never negative. The live cron sweep reclaimed a seeded expired report (row plus private blob), and the stuck-job path was exercised through the sweep's fail-out and refund. The local api suite is `125/125` across the vitest files, each on its own in-memory PGlite plus Blob plus the WASM bridge. Measurements are from the deployed preview and production on Vercel plus the dev machine for the local suites.

## Next

Phase 2 adds the renderer as a second function (playwright-core plus a serverless Chromium build with Three.js), behind the existing `RenderBackend` seam. The gate is `render_hash` determinism validated on the deployed platform — fixed rig, fixed lighting, seeded, stable screenshot bytes across runs — after which the RND checks light up in `mode: "full"` and `RENDER_FAILED` becomes reachable.
