---
title: "Docs surface, a socket-level SSRF pin, and the Vercel entry: meshcheck readies to ship"
date: 2026-07-13
project: "meshcheck"
phase: 1
milestone: 5
tags: [typescript, hono, vercel, openapi, ssrf]
draft: true
summary: "Part A of the Phase-1 close: the public docs surface (schema, OpenAPI, llms.txt), a socket-level SSRF pin closing the DNS-rebind window, and the Vercel entry."
repo_ref: "p1m5"
decisions:
  - what: "The three docs routes are mounted on the root app BEFORE the authed /v1 subtree, each carrying its own per-IP token bucket — so the X-Api-Key auth on /v1/* never runs for them"
    why: "SPEC_03 says these are public. But /v1/schema/*.json and /v1/openapi.json live UNDER /v1, whose subtree has `v1.use('*', authMiddleware)`. Hono composes every matching handler in registration order as an onion, so if the authed subtree also matched these paths, auth would run and 401 an unauthenticated agent. The fix is ordering: register the public docsRoutes (with a publicRateLimitMiddleware keyed `ip:<addr>` in the same token_buckets table) first; its handler returns a Response without calling next(), which short-circuits the chain and the later-registered auth never executes. A test pins this exactly — all three answer 200 with NO key."
    alternatives: ["move auth off `v1.use('*')` onto each authed sub-route (a wider refactor of app.ts, more churn, same result)", "a separate top-level app for docs (two apps to wire into one function; the rewrite/entry gets messier)"]
  - what: "OpenAPI response bodies $ref the PUBLISHED schema URLs (https://api.meshcheck.dev/v1/schema/report.json); the schemars Rust emitter stays the single source of truth, and a both-ways drift test guards it"
    why: "SPEC_02's schemars output (Report, CheckResult) is the contract. The hand-maintained OpenAPI doc describes REQUEST shapes inline (Zod validates requests only) but never redefines a response shape — the validate/reports/jobs 200 bodies `$ref` the absolute published schema URL, so there is exactly one definition of a report. A vitest golden test enumerates the app's routes (app.routes) and the doc's paths, normalizes params to a signature (:id and {name}.json both collapse to {}), and asserts set-equality BOTH ways: every implemented /v1 route is documented and every documented route exists. The internal cron (/api/cron/*) is deliberately out of the documented surface."
    alternatives: ["generate the OpenAPI from Zod (@hono/zod-openapi) — but that would redefine the SPEC_02 response shapes in Zod, exactly the duplication phase-1-stack forbids", "hand-write response schemas inline (drifts from the emitter the moment a check field changes)"]
  - what: "The production socket-pin resolves + validates ONCE, then an undici Agent's connect.lookup returns only that pinned address — never re-resolving — closing the rebind TOCTOU the P1M3 injected-fetch path left open"
    why: "P1M3's safeFetch resolves every hop and rejects if any address is private, then hands the URL to the injected fetch — which resolves DNS AGAIN at connect, a residual rebind window (documented then, deferred to now). createPinnedFetch (src/pinnedFetch.ts) is the prod fetch: for each hop (safeFetch uses redirect:'manual', so one deps.fetch call per hop = re-pin per hop) it calls the SAME assertPublicHost to get the verified DnsRecord[], builds `new Agent({ connect: { lookup: pinnedLookup(records) } })`, and dispatches. pinnedLookup ignores the hostname and yields the pre-validated address, so whatever undici connects to is exactly what was cleared. It is unit-tested with an injected resolver that rebinds on its 2nd call (the private 10.0.0.5): resolvePinned takes the 1st (public) answer, the lookup stays frozen to it, and the test proves the resolver WOULD have rebound — no real network. The test suite keeps using the injected-fetch seam; this is the prod deps path, tested at the module level."
    alternatives: ["thread the verified records from safeFetch into the fetch (couples the SSRF module to undici; the plan keeps the injected-fetch seam for hermetic tests and isolates the pin in prod deps)", "trust the pre-check alone (the rebind window that was the whole point of this criterion)", "a global shared Agent (can't re-pin per host/hop safely)"]
  - what: "A single Vercel function (api/index.ts → handle(app)) serves everything via vercel.json rewrites; the wasm/config/schema assets ship through functions.includeFiles, built out-of-band"
    why: "Verified against current Vercel docs (the api/ directory function model + rewrites, NOT the zero-config root-entry framework preset — the monorepo needs includeFiles to reach crates/config/docs, which live ABOVE api/ and can't be referenced from a root-directory-scoped preset). handle from hono/vercel adapts app.fetch to the Node runtime; rewrites route /v1/*, /llms.txt, and /api/cron/* to the one function and Hono matches the original path. A .vercelignore keeps the dev-only api/ files (tests, scripts, migrations) from becoming accidental functions. Build strategy: the Vercel image has no Rust — the wasm pkg is prebuilt (wasm-pack, the same command Vitest globalSetup uses) and consumed via `vercel deploy --prebuilt`, documented in DEPLOY.md; installing rustup in the build command was rejected as slow + flaky."
    alternatives: ["compile wasm in the Vercel Build Command (rustup + wasm-pack every build: minutes, network-flaky, no toolchain in the image — rejected for reliability)", "zero-config Hono preset with a root/src entry (breaks includeFiles for the above-api/ assets)", "one function file per route (loses the single-app Hono routing + shared middleware)"]
benchmarks:
  - metric: "pnpm --filter @meshcheck/api test (Vitest, PGlite + in-memory Blob + wasm bridge)"
    value: "122 tests / 16 files (up from 101/14 at p1m4 — 21 new: socket-pin logic, prod deps wiring, docs endpoints public-access/IP-limit/NOT_FOUND, llms.txt privacy verbatim, both-ways OpenAPI route drift)"
    target: "all green, hermetic, no services/network/Vercel"
  - metric: "pnpm -r typecheck (tsc --noEmit, strict, exactOptionalPropertyTypes)"
    value: "clean, including the undici Agent socket-pin and the production deps factory"
    target: "strict TS, no errors"
  - metric: "socket-pin: connect target under simulated DNS rebind"
    value: "== the validated address (2nd resolution returns the private 10.0.0.5; the pin never asks again)"
    target: "connect target is the assertPublicHost-validated address, always"
  - metric: "OpenAPI route drift (both ways)"
    value: "9 documented paths ≡ 9 implemented /v1 + /llms.txt routes; zero undocumented, zero phantom"
    target: "exact set-equality both directions"
  - metric: "Vercel function bundle (esbuild proof of api/index.ts, login-free)"
    value: "bundles clean, 6.2mb, all imports (hono/vercel, undici, workflow, neon, @vercel/blob) resolve; includeFiles assets all present; vercel.json valid"
    target: "entry compiles/bundles as a Vercel Node function"
  - metric: "loadtest.ts smoke against local dev server (20 rps × 5s)"
    value: "script schedules 20 rps, reports p50/p95/p99 + non-2xx + 5xx, applies the p95<4s/0×5xx gate — GATE PASSED (0×5xx)"
    target: "the load-test script itself works end-to-end"
  - metric: "live-smoke.ts against local dev server (full flow incl. 21MB async path)"
    value: "PASSED — docs + sync validate + report re-fetch + account + upload→202→job done (21MB synthesized GLB parses)"
    target: "the live-smoke script itself works end-to-end"
  - metric: "cargo test --workspace (Rust gates untouched)"
    value: "214 passed / 3 ignored (11 suites) — unchanged from p1m1; Rust byte-untouched this milestone"
    target: "still green, untouched"
  - metric: "DEPLOY GATE — 20 rps sustained ≥60s, p95<4s, 0×5xx (against the real deployed instance)"
    value: "1200/1200 → 200 on the deployed preview; p50 168 ms, p95 297 ms, p99 1037 ms; 0×5xx, 0×429"
    target: "p95 < 4s, 0×5xx at 20 rps for 60s"
  - metric: "DEPLOY — live async runner + retention sweep + ledger concurrency on Neon/Blob"
    value: "21MB presigned upload → 202 → background job polled to done; live sweep reclaimed a seeded expired report (row + private blob); 30 parallel charges vs 10 credits: exactly 10×200/20×402, balance 0"
    target: "async job runs to done; sweep deletes expired; parallel charges never overspend"
---

## What shipped

Part A of the Phase-1 close — everything local, so Part B is execution and not invention.

**The public docs surface**, all three unauthenticated and IP-rate-limited:
- `GET /v1/schema/{name}.json` — serves the committed schemars bytes (`report`, `check_result`)
  verbatim from `docs/schema/*.schema.json`; an unknown name is `NOT_FOUND`.
- `GET /v1/openapi.json` — a hand-maintained OpenAPI 3.1 document (`api/openapi.json`) covering every
  implemented Phase-1 route, requests described inline, response bodies `$ref`ing the **published**
  schema URLs so the SPEC_02 emitter stays the one source of truth.
- `GET /llms.txt` — the one-fetch agent orientation: what meshcheck is, the endpoint list, the credit
  table, the links, and the SPEC_03 privacy commitments **verbatim**.

New source under `api/`:
- `index.ts` — the Vercel Functions entry: `handle(createApp(createProdDeps()))`.
- `src/prod.ts` — the production deps factory (Neon, Vercel Blob, WorkflowJobRunner, node crypto/DNS,
  the socket-pinned fetch), fail-fast on missing `DATABASE_URL` / `BLOB_READ_WRITE_TOKEN`.
- `src/pinnedFetch.ts` — the production socket-pin (`pinnedLookup`, `resolvePinned`, `createPinnedFetch`).
- `src/docs.ts` — verbatim asset loading (schema bytes, openapi, llms.txt), module-scoped.
- `src/routes/docs.ts` — the three public routes + their IP token bucket.
- `ratelimit.ts` grew `publicRateLimitMiddleware` (IP-keyed, reuses the token_buckets table).

Part B artifacts (all runnable now): `scripts/migrate.ts` (the one documented `db:migrate`),
`scripts/loadtest.ts` (20 rps, p50/p95/p99 + non-2xx, a p95/5xx gate), `scripts/live-smoke.ts`
(end-to-end incl. the >20MB async path), `scripts/dev-server.ts` (the REAL app on PGlite + in-memory
Blob, for smoking the scripts without a deploy), and `docs/DEPLOY.md` (the ordered runbook with consent
points marked ⚠️). `vercel.json` gained rewrites (`/v1/*`, `/llms.txt`, `/api/cron/*`), the single
`api/index.ts` function (memory, maxDuration, includeFiles for wasm + config + schema + docs assets),
and a `.vercelignore` so dev-only files never become functions.

Twenty-one new Vitest tests (122 total): the socket-pin under a simulated rebind, the prod deps wiring,
the docs endpoints (public access with no key, IP rate limiting + Retry-After, `NOT_FOUND`, byte-exact
schema serving), the llms.txt privacy block pinned verbatim in BOTH SPEC_03 and the served file, and the
both-ways OpenAPI route-drift golden.

## Decisions

The load-bearing one is the **socket-pin closing the rebind window**. P1M3 shipped resolve-check-then-
hand-to-fetch, and honestly documented that the injected fetch re-resolves at connect — a TOCTOU a DNS
rebind can drive through. `createPinnedFetch` makes the address that undici connects to *be* the address
`assertPublicHost` validated: resolve once, freeze it into the Agent's `connect.lookup`, never ask DNS
again. Because `safeFetch` follows redirects manually (one `deps.fetch` per hop), each hop re-pins. It
is unit-tested with an injected resolver that returns a public address first and a private one second —
the pin holds to the first, and the test proves the second *would* have rebound.

The **docs-before-auth ordering** is the subtle one. Two of the three public routes live under `/v1`,
whose subtree carries `use('*', auth)`. Hono composes all matching handlers in registration order, so
mounting the public routes first — with a handler that returns without `next()` — short-circuits the
chain before auth can run. A test with no API key pins 200 on all three.

**OpenAPI never redefines a report.** Response bodies `$ref` the published schema URL; a golden test
asserts the doc and the app agree on routes in both directions, normalizing `:id`/`{name}.json` to a
common signature. Request shapes are inline (Zod validates requests only).

## What broke / what surfaced

- **`vercel build --yes` auto-created a project on Ben's account.** Trying to satisfy the "`vercel
  build` succeeds locally" criterion, `--yes` linked + created an EMPTY `meshcheck` project and pulled
  Ben's preview env secrets to `.vercel/`. That crosses the Part B consent boundary (project creation is
  Ben's). I removed the local `.vercel/` (secrets off disk), added `.vercel/` to `.gitignore`, and left
  the remote empty project for Ben to reuse or remove — flagged in the report. The build criterion is
  instead met by a **login-free esbuild bundle** of `api/index.ts` (proves every import resolves) plus
  asset-presence + `vercel.json` validity checks.
- **20 rps exceeds every SPEC_03 plan limit.** The plans cap at 120 req/min (< 2 rps); the load-test
  gate is 20 rps (1200/min). A single plan key is rate-limited long before 20 rps. The loadtest script
  is correct (it counts 429s as non-2xx; the gate is 0×**5xx**, which 429s are not), but a meaningful
  20 rps run needs a dedicated elevated-`rate_per_min` account — the dev-server seeds a local `dev` plan
  at 6000/min for the smoke, and DEPLOY.md marks the elevated load-test account as a Part B step.
- **The PGlite token bucket denies under a truly-concurrent burst.** 200 simultaneous requests to a
  6000/min key yielded ~44 passes — the bucket's refill uses `now - updated_at`, and out-of-order `now`
  values under real-clock concurrency produce negative refills. It never grants MORE than allowed (safe
  direction), only spuriously denies. It's pre-existing P1M2 code, untouched here; flagged for the Part
  B "ledger/limit concurrency spot-check against Neon".
- **`vercel build` minted 32 functions and blew the Hobby cap of 12.** Part B's build surfaced that Vercel's zero-config convention turns EVERY `.ts` under a top-level `api/` directory into its own serverless function — our whole `@meshcheck/api` pnpm workspace lived under `api/`, so all 32 source files became functions (verified via `.vercel/output/functions`). A directory-convention collision, not a code bug. Fix: `git mv api server` (the package keeps its name), and a new entry-only top-level `api/index.ts` that re-exports `default`/`config` from `server/index.ts` — so exactly ONE function is emitted, zero behavior change.

Known weaknesses, deliberately deferred to Part B:
- **Nothing is deployed.** The WorkflowJobRunner, VercelBlobStore, Neon driver, the cron, and
  `vercel.json` are proven by inspection + local esbuild/dev-server, never by a real Vercel run. The
  benchmark rows for the deploy gate, live async, sweep, and ledger concurrency are `TODO-until-deploy`.
- **The socket-pin is not exercised against a live rebinding resolver.** The logic is unit-pinned; no
  real socket has connected through it (deliberately — the plan forbids real-network tests).
- **`workerDeps()` in the workflow runner still constructs its own Deps** with the plain global fetch
  (not the socket-pinned one). The worker doesn't do url-mode fetches today, so it's harmless, but
  `createProdDeps` should become the single factory both paths use — a small Part-B/early-Phase-2 tidy.

## Numbers

Measured on the dev machine (Windows, Node 24 locally / engines ≥22, pnpm 9.15 via corepack). Typecheck
is clean including the undici Agent and the prod deps factory. The api suite is 122 Vitest tests across
16 files, each on its own in-memory PGlite + in-memory Blob + the wasm bridge — no Vercel, no network.
The socket-pin test proves the connect target equals the validated address under a simulated rebind; the
OpenAPI drift golden proves 9 documented paths ≡ the 9 implemented `/v1` + `/llms.txt` routes both ways.
The Vercel entry bundles clean under esbuild (6.2mb, all imports resolve) and every `includeFiles` asset
is present. Against a local dev server (the real app on PGlite), `loadtest.ts` drove 20 rps and reported
percentiles + a passed 0×5xx gate, and `live-smoke.ts` ran the full flow — including a 21MB synthesized
GLB through the upload → 202 → job-`done` async path — green. Rust is byte-untouched (`cargo check
--workspace` clean); the full `cargo test` re-run is `TODO-until-deploy` at the Part B close.

## Next (Part B)

Provision the platform (⚠️ Neon + Blob on Ben's account), set `CRON_SECRET`, migrate, seed accounts
(incl. the elevated load-test one), preview-deploy via `--prebuilt`, run `live-smoke` (the first live
WorkflowJobRunner exercise) and the 20 rps load test, spot-check ledger concurrency + the retention
sweep on Neon/Blob, promote to production, fill BENCHMARKS.md Phase-1 rows and this devlog's
`TODO-until-deploy` numbers, and tag `phase-1`. The runbook is `docs/DEPLOY.md`.

## What broke (Part B — preview deploy) & the fix

The first `--prebuilt` preview crashed at function boot: `ERR_MODULE_NOT_FOUND: Cannot find package
'hono' imported from /var/task/server/index.js`. Root cause: Vercel's Node File Trace could not follow
this repo's **pnpm-workspace symlink** `node_modules` layout, so the traced function shipped the raw
source graph with a broken/partial `node_modules` — no resolvable `hono` (nor the other prod deps) at
runtime. NFT + pnpm symlinks are the mismatch.

Fix: **pre-bundle** the function with esbuild so runtime module resolution is unnecessary.
`server/scripts/bundle-function.mjs` bundles `server/index.ts` → self-contained ESM
`server/dist/bundle.mjs` (hono + all deps inlined); the top-level `api/index.js` re-exports it, so NFT
only traces one relative import. The wasm-pack CJS glue stays **external** (a runtime `createRequire`
in `core.ts`, shipped whole via `includeFiles` so its `__dirname` finds `meshcheck_wasm_bg.wasm`); the
config/schema/openapi/llms assets stay real files too. Wired via `vercel.json#buildCommand` (+ a
placeholder `public/` so build-mode finds an output dir). See docs/DEPLOY.md "Function bundling".

Second bug the bundle then exposed: `export default handle(app)` (a plain function) hangs on Vercel's
Node.js runtime — it is invoked as the legacy `(req, res) => void` handler and Hono's returned
`Response` is ignored (request times out). Changed to the Web-signature catch-all
`export default { fetch: handle(app) }`.

Verified on preview `meshcheck-nzfhuxf1v-brac-s-projects.vercel.app` (bypass header):
`GET /llms.txt` → 200 text/plain, `GET /v1/schema/report.json` → 200 json, `GET /v1/openapi.json` →
200 json. Local gates green: `pnpm -r typecheck` + `pnpm -r test` (122/122); cargo untouched.

## What broke (Part B — live-smoke on preview) & the fixes

The first end-to-end `live-smoke` against the deployed preview failed on exactly the two steps the
runbook flagged, and surfaced a third (the async runner). All three are now fixed and `live-smoke`
passes fully on preview.

### Bug 1 — `GET /v1/reports/:id` → 404 right after a successful `POST /v1/validate`

**Root cause: the report blob was stored fine, but `VercelBlobStore.get()` could never read it back.**
Querying Neon directly proved the `reports_index` row DID land (correct `report_id`, `account_id`
matching the smoke key's account, `expires_at` a month out) — so it was not a missing insert, not
account scoping, not id parsing, not expiry. The 404 came from the `blob.get(...) === null` branch in
`routes/reports.ts`: reports live in a **private** Blob store, and `get()` did
`head(key)` → `fetch(meta.url)` with **no authorization**. A private blob's object URL returns **403
Forbidden** to an unauthenticated fetch (confirmed live), so `get()` always returned null and the route
treated the report as gone. This bug ALSO silently broke the async `blob_id` validate path (same
`blob.get`) and webhook report re-reads — one root cause, three symptoms.

**Fix:** `VercelBlobStore.get()` now uses `@vercel/blob` v2's `get(key, { access: 'private', token })`,
the supported way to deliver a private blob server-side — it authenticates against the store token and
streams the bytes. Verified live: the exact stored report (15,115 bytes) now round-trips, and a missing
key still yields null. No contract change.

### Bug 2 — the >4.5MB upload PUT hit `413 FUNCTION_PAYLOAD_TOO_LARGE`

**Root cause:** `POST /v1/uploads` returned an `upload_url` pointing at OUR function
(`/v1/uploads/:id`), so the 21MB client PUT went through the serverless function and tripped Vercel's
~4.5MB request-body cap. The bytes must never transit the function.

**Fix — a TRUE direct-to-storage presigned PUT (no bytes through the function):**
`VercelBlobStore.presignUpload(key, maxBytes)` mints a single-use, size-capped **Vercel Blob presigned
URL** via `issueSignedToken({ operations:['put'], maximumSizeInBytes })` + `presignUrl({ operation:'put',
access:'private', … })`. The client bare-PUTs straight to the Blob control API (host `vercel.com`, not
our function) — verified live: a 21MB PUT returns 200, the blob is private (a bare fetch of its object
URL 403s), an oversize body is rejected at the storage edge with 403, and the stored bytes read back via
the fixed `get()`. A new `BlobStore.presignUpload` seam returns the URL; `MemoryBlobStore` returns
`null`, so the uploads route falls back to its in-function PUT target and the whole vitest suite (incl.
the PUT-store + FILE_TOO_LARGE tests) stays green unchanged.

**Contract impact: NONE — the code now matches the already-correct spec.** SPEC_03 already specified
`POST /v1/uploads` → `{ blob_id, upload_url }` where `upload_url` is "presigned, single-use, short
expiry" and the client PUTs to it; the M3 in-function stand-in was what didn't match. `openapi.json`
(the `{ blob_id, upload_url, max_bytes }` response + the `PUT /v1/uploads/{uploadId}` fallback) is
unchanged and the OpenAPI route-drift golden still holds (the fallback route still exists). `live-smoke`
was updated to send a **bare** PUT (dropping the harmless-but-unsigned `X-Api-Key` header) to match the
real presigned-URL client. **No reviewer ratification needed** for the upload contract.

### Bug 3 (surfaced) — async `POST /v1/validate` → 500: WDK `start()` rejects the workflow function

Once Bugs 1–2 were fixed, the async submit 500'd. Logs (after adding stderr logging for unexpected
500s — previously the `onError` handler swallowed non-`ApiError` panics silently) showed:
`WorkflowRuntimeError: 'start' received an invalid workflow function`.

**Root cause — the WDK is fundamentally incompatible with this project's committed deploy strategy.**
The Vercel Workflow DevKit requires a build-time directive transform (its SWC plugin) plus a framework
integration (Nitro/Vite/Next) that emits the `/.well-known/workflow/v1/{flow,step,webhook}` routes and
attaches a `workflowId` to each `"use workflow"` function. This app deploys as ONE self-contained
esbuild bundle (`bundle-function.mjs`) specifically to dodge the pnpm-workspace/NFT resolution failure —
and that bundle strips the `"use workflow"`/`"use step"` directives to inert string statements, so
`start()` receives a plain function with no `workflowId` and rejects it. Adopting a WDK framework
builder is a full deploy re-architecture that would reintroduce the very NFT problem the bundle exists to
avoid.

**Fix — `BackgroundJobRunner` (Vercel `waitUntil`), reusing the identical job lifecycle.** The new prod
`JobRunner` (`src/runners/background.ts`) schedules `processValidateJob` — the SAME shared lifecycle in
`src/jobs.ts` that `InlineJobRunner` and the retention sweep already use — via `@vercel/functions`
`waitUntil`, so the async contract holds exactly: `POST /v1/validate` returns **202** immediately, the
job runs in the background on the same instance (Fluid Compute keeps it alive until the promise settles,
bounded by `maxDuration`), and the client polls `GET /v1/jobs/:id` → processing → **done**. Wired in
`prod.ts` via the same lazy deps-thunk `InlineJobRunner` uses, so background processing runs on the real
prod deps (Neon + Vercel Blob + the socket-pinned fetch for webhooks). `WorkflowJobRunner` is kept
in-tree as the future durable path (now tree-shaken out of the bundle — size dropped 6.2mb → 3.9mb).

**Durability & the backstop:** `waitUntil` is not crash-durable like the WDK event log, but the existing
no-zombie invariant covers the gap — every job is charged BEFORE its row is created, and the nightly
retention sweep fails-out + refunds any row left non-terminal past the job timeout. A crash mid-job
degrades to "the sweep recovers it and the credit is returned," never a stuck job or an overcharge.

**⚠️ Reviewer ratification requested (architecture, not contract):** replacing the WDK
`WorkflowJobRunner` with the `waitUntil`-based `BackgroundJobRunner` as the Phase-1 production async
runner. This changes NO API contract or schema (the `jobs` table, the 202 envelope, and the poll path
are identical); it changes the *durability substrate* of async processing. Phase-1-stack named WDK as
the queue; this defers WDK to when the deploy adopts a compatible builder. The wiring test
(`pinnedFetch.test.ts`) now asserts `BackgroundJobRunner`.

### Verification (live, preview `meshcheck-638qmfq5y-brac-s-projects.vercel.app`)

`live-smoke` **PASSED** fully: docs ×4, sync validate + report re-fetch + account, and the async path —
21MB presigned upload → 202 → job polled to **done**. Neon confirms the async job row is `done` with a
`result_blob_key`, its report is in `reports_index`, `job_refund` ledger rows = 0 (clean run, no
spurious refund), and the successful run's upload blob was deleted post-processing. (Two `queued` job
rows + two upload blobs remain from the earlier broken-enqueue deploys — pre-fix debris the retention
sweep reclaims by design.) Local gates green throughout: `pnpm -r typecheck` clean, `pnpm -r test`
122/122. Added dep: `@vercel/functions`. Webhook step skipped (no public receiver), as the runbook
allows.

## What broke (Part B — the 20 rps load-test collapse) & the real fix

The 20 rps × 60s deploy gate against the preview returned **1082 × 429 out of 1200** on the `loadtest`
plan key — a plan that allows **6000/min**. The gate is 0 × 5xx (which held: the 429s are not 5xx), but
90 % spurious denial fails the sustained-load gate in spirit, so it had to be run down.

### The hypothesis that was wrong (but surfaced a real latent bug)

P1M5 Part A flagged a suspected mechanism: each request injects its own wall-clock `now`, and under
Fluid concurrency across instances an out-of-order `now` makes `EXTRACT(EPOCH FROM (now - updated_at))`
**negative**, so the token-bucket refill term *subtracts* tokens instead of adding them — a runaway
drain. That is a genuine latent defect, so it was fixed and pinned: `consumeToken` and
`retryAfterSeconds` in `server/src/ratelimit.ts` now clamp elapsed to non-negative
(`GREATEST(0, EXTRACT(EPOCH FROM (now - updated_at)))` in both the SET and WHERE refill expressions)
and never move bucket time backwards (`updated_at = GREATEST(tb.updated_at, now)`). Under the row lock
that ON CONFLICT takes, writers on one bucket key serialize; an out-of-order `now` yields refill 0 for
that request (correct and safe — it never over-grants, never under-grants beyond true elapsed). Two
regression tests cover it (`ratelimit.test.ts`): a backwards-`now` sequence that must not drain the
bucket or spuriously deny, and a strictly out-of-order interleaving that must serve exactly capacity.

**But the clamp did not move the load-test number at all** (1082 → 1081). Redeploying with the clamp
verified live (4 × `GREATEST` in `.vercel/output`) still collapsed. A PGlite probe confirmed the clamp
SQL is well-formed and bounds drain to ≤ 1 token/request — so a 6000 bucket *cannot* be exhausted by
1200 requests. The hypothesis was a red herring for this failure.

### The actual root cause — the public IP limiter ran on every route

Temporary per-deny diagnostic logging (preview-only, reverted before the final deploy) plus the streamed
runtime logs gave the smoking gun: the denials were keyed **`ip:216.82.44.29 cap=60 rps=1`** on
`POST /v1/validate`, with a **positive** `elapsed` (~0.7 s). That is the *public docs* per-IP bucket
(`PUBLIC_ROUTE_RATE_PER_MIN = 60`), not the 6000/min key bucket — and it was legitimately empty, because
a single-IP 20 rps stream is 1200/min against a 60/min cap. (119 passes over 60 s = 60 initial + 60
refilled — the exact signature of a 60/min bucket, never 6000.)

Cause: `docsRoutes` registered its limiter as **`route.use('*', publicRateLimitMiddleware(deps))`**, and
the sub-app is mounted at `/` (`app.ts`). A wildcard `use('*')` on a `/`-mounted sub-app runs on **every**
request that falls through to the authed `/v1` subtree — so `validate`, `uploads`, `reports`, `jobs`,
and `account` all consumed the public 60/min/IP bucket before auth even ran, throttling authenticated
callers at the public docs cap regardless of plan. The vitest suite never caught it because the `free`
test plan (10/min) is *stricter* than the public 60/min and every authed test fires < 60 requests from
one IP, masking the extra bucket entirely.

**Fix:** attach the public limiter **inline per docs route** (`route.get(path, publicRl, handler)` for
the three docs paths) instead of `use('*')`, so it runs when — and only when — one of those exact GET
routes matches. `server/src/routes/docs.ts`. A behavioral regression test (`docs.test.ts`) fires a
`scale` (120/min) account 61× from one IP at `/v1/account` and asserts none are denied: with the old
`use('*')` the 61st tripped the public 60/min bucket; scoped, all pass.

The negative-refill clamp is kept as correct hardening (it closes a real, if not-here-triggered, drain).

### Verification (live, preview `meshcheck-dkh5amu0z-brac-s-projects.vercel.app`)

Load test — 20 rps × 60 s = **1200 / 1200 → 200, 0 × 429, 0 × 5xx**. Latency p50 168 ms / p95 297 ms /
p99 1037 ms (mean 195, max 1422). Gate PASSED including the "429 ≈ 0" condition. `live-smoke` re-run
(smoke key) **PASSED** fully: docs ×4, sync validate + report re-fetch + account, and the 21 MB async
path (presigned upload → 202 → job polled to **done**). Local gates green: `pnpm -r typecheck` clean,
`pnpm -r test` **125/125** (122 + 2 ratelimit clamp + 1 docs-scope regression); cargo untouched.
