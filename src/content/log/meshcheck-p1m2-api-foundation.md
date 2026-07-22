---
title: "The contract before the core call: meshcheck's API foundation on Postgres"
date: 2026-07-13
project: "meshcheck"
phase: 1
milestone: 2
tags: [typescript, hono, postgres, credits, rate-limiting]
draft: true
summary: "The api/ pnpm workspace: a Hono app with the full DB schema, sha256 key auth, a row-locking credit ledger, a token-bucket rate limiter, and GET /v1/account."
repo_ref: "p1m2"
decisions:
  - what: "Integration tests run on PGlite (embedded Postgres), not Neon branches, behind a one-function driver factory"
    why: "Neon isn't provisioned until P1M5 (needs Ben's marketplace consent). The db layer is a tiny `Db.execute<T>(sql): Promise<T[]>` interface with two adapters — neon-http in prod, PGlite in tests/admin — so the exact same SQL runs on both. Every statement is plain Postgres (CTEs, ON CONFLICT, LEAST, EXTRACT EPOCH); no vendor extensions."
    alternatives: ["stand up a Neon branch per CI run now (blocked on marketplace consent)", "mock the DB (would not exercise the ledger CTE or token-bucket SQL, which are the whole point)"]
  - what: "The credit charge is a row-locking CTE over a materialized balance: WITH upd AS (UPDATE account_balances SET balance = balance - amount WHERE account_id = … AND balance >= amount RETURNING …) INSERT INTO credit_ledger … SELECT … FROM upd RETURNING id"
    why: "Over-draw must be impossible under true concurrency, and a guard on SUM(delta) is not: under READ COMMITTED two concurrent charges snapshot the same sum, both pass, both insert — negative balance (EvalPlanQual only re-evaluates conditions on UPDATE/DELETE target rows, not subqueries over other rows). Putting the guard on a row the statement itself UPDATEs makes the loser block on the row lock, re-check the committed balance, and correctly fail. Ledger append rides in the same single statement; SPEC_04 already names the design ('balance = materialized sum'); a CHECK (balance >= 0) is belt-and-braces. Zero rows ⇒ 402 INSUFFICIENT_CREDITS with {balance, needed}. credit_ledger itself stays append-only — no UPDATE/DELETE path on it exists anywhere."
    alternatives: ["INSERT … SELECT … WHERE (SELECT SUM(delta)…) >= amount (the shipped-then-rejected v1 — races under READ COMMITTED, see What broke)", "read balance then insert (TOCTOU race, needs a transaction/lock)", "SERIALIZABLE isolation + retry loops (heavier, and Neon-HTTP is one-shot statements)"]
  - what: "The rate limiter is one atomic INSERT … ON CONFLICT … DO UPDATE … WHERE (refilled >= cost) … RETURNING"
    why: "The WHERE guard on DO UPDATE is the trick: the row is decremented only when a token is available, so RETURNING yields exactly one row on allow and zero on deny — an unambiguous signal. A denied request updates nothing, so no accrued refill time is lost (updated_at only advances on a successful consume). A naive single-statement decrement can't distinguish allow from deny by the post-tokens value alone (the ranges overlap in [0,1)); the guard sidesteps that entirely."
    alternatives: ["always subtract and treat negative tokens as denied (drives the bucket into unbounded debt under a burst of denials)", "read-then-write in a CTE (loses true atomicity; the guard form keeps the consume in one indivisible statement)"]
  - what: "Plan values are seeded from SPEC_03 in one dedicated migration (0001_seed_plans.sql), not as TS constants"
    why: "Thresholds are data, not code (CLAUDE.md rule 4). The four launch plans (free/indie/studio/scale) live in a versioned, idempotent (ON CONFLICT DO NOTHING) SQL migration keyed to the SPEC_03 table; the app reads rate_per_min and max_file_bytes from the plans row on every auth. The credit-cost table (costs.ts) is the one other place SPEC numbers land, isolated with a comment and consumed starting P1M3."
    alternatives: ["hardcode plan limits in middleware (scatters magic numbers; violates rule 4)", "a config TOML read at boot (the DB is already the source of truth for per-account plan assignment)"]
  - what: "Everything non-deterministic (db, clock, crypto) is injected via a Deps object; createApp(deps) is the whole app"
    why: "Determinism discipline (plan rule): no raw Date.now() in logic — time enters only through deps.now(), which the test harness pins and advances to exercise token refill deterministically. The injected crypto seam generates the `mc_live_` + 32-byte key and hashes it; storage is hash-only. The app is fully drivable through app.fetch(new Request(...)) with a controllable clock."
    alternatives: ["import Date.now()/crypto directly (untestable clock, non-deterministic rate-limit tests)"]
  - what: "The full 15-code SPEC_03 error table (incl. the review-added NOT_FOUND) is pinned through the actual Hono error handler via a probe app, even for codes no route can reach yet"
    why: "Only /v1/account exists this milestone (P1M3 brings the charging routes), so only MISSING_API_KEY, INVALID_API_KEY, RATE_LIMITED, NOT_FOUND and INTERNAL are naturally reachable through app.fetch. The rest are pinned by driving toErrorResponse with a thrown ApiError for each code and asserting status+envelope — the same handler production uses — so the whole table (status, envelope shape, no-stack-leak) is locked before the routes that raise them land. NOT_FOUND (404) was added to SPEC_03 in review as the generic unknown-route/resource code: INTERNAL must never describe a client-side path error."
    alternatives: ["only test reachable codes (leaves most codes' status/shape unverified until later milestones)", "invent throwaway routes in the production app (pollutes the real router)", "reuse INTERNAL for unknown routes (the shipped-then-rejected v1: a 404 labelled INTERNAL misleads agents into retrying/reporting a server fault)"]
benchmarks:
  - metric: "pnpm install (cold, downloads)"
    value: "3.6s (68 packages added, 74 downloaded); frozen re-install 0.4s"
    target: "fast enough per-CI-job; no services"
  - metric: "pnpm -r typecheck (tsc --noEmit, strict)"
    value: "~1.6s, clean"
    target: "strict TS, no errors"
  - metric: "pnpm -r test (vitest, PGlite)"
    value: "21 tests / 6 files, ~3.6s (post-review; 18 pre-review)"
    target: "all green"
  - metric: "cargo test --workspace (Rust gates untouched)"
    value: "214 passed, 3 ignored — unchanged from p1m1"
    target: "still green"
  - metric: "database objects"
    value: "8 tables, 3 migrations (schema + idempotent plan seed + account_balances with CHECK >= 0 and backfill)"
    target: "full schema lands now; jobs/reports_index used from P1M4"
---

## What shipped

The `api/` pnpm workspace (`@meshcheck/api`, Node 22, strict TS, ESM) is the first TypeScript in the repo. It contains a Hono 4.12 app assembled by `createApp(deps)`, where `deps = { db, now, crypto }` is injected so the whole thing is testable through `app.fetch`.

The database schema (`db/schema.ts`, drizzle-orm 0.44) defines all eight tables — `accounts`, `api_keys`, `plans`, `credit_ledger`, `account_balances`, `jobs`, `reports_index`, `token_buckets` — and drizzle-kit `generate` emits the committed migrations: `0000_init.sql` (DDL), a hand-written `0001_seed_plans.sql` that seeds the four SPEC_03 plans idempotently, and `0002_account_balances.sql` (the review-driven materialized balance table with `CHECK (balance >= 0)` plus a from-ledger backfill). Timestamps are all `timestamptz` and are supplied explicitly from the injected clock (no `defaultNow()`), so wall-clock never sneaks into a write.

Middleware and helpers under `src/`:
- `errors.ts` — the 15-code `ErrorCode` union (incl. `NOT_FOUND`, added to SPEC_03 in review), `ERROR_STATUS` map, `ApiError` with `{code,message,detail}` envelope + optional headers (for `Retry-After`), and the `toErrorResponse` handler (ApiError ⇒ status+envelope; anything else ⇒ 500 INTERNAL, never a stack). Unknown routes return 404 `NOT_FOUND` via the Hono `notFound` handler.
- `auth.ts` — `X-Api-Key` ⇒ sha256 ⇒ join over `api_keys`/`accounts`/`plans` (revoked_at IS NULL); missing ⇒ 401 MISSING_API_KEY, unknown/revoked ⇒ 401 INVALID_API_KEY; account+plan onto the context.
- `credits.ts` — `charge()` (the row-locking materialized-balance CTE), `grant()` (upsert + ledger append, one statement), `balance()` (reads the materialized row), `usageThisPeriod()` (current calendar month, UTC).
- `ratelimit.ts` — the Postgres token bucket with the WHERE-guarded atomic consume and a `Retry-After` computed from the token deficit.
- `routes/account.ts` — `GET /v1/account` returning plan, balance, and this-period usage.
- `db.ts` — the driver factory (`neonDb`, `pgliteDb`, `createDbFromEnv`).
- `costs.ts` — the SPEC_03 credit-cost table (data, consumed from P1M3).

`scripts/admin.ts` (tsx) runs `create-account`, `create-key` (prints the raw `mc_live_…` key exactly once, stores only hash + prefix), and `grant` against `DATABASE_URL` — Neon-HTTP for a real URL, embedded PGlite (auto-migrated + seeded) when unset or `pglite://dir`. Verified end-to-end: the admin-minted key authenticates through the live app, storage holds only the sha256 (raw key absent), and a `grant 1000` shows up as `balance: 1000` on `/v1/account`.

Twenty-one Vitest tests across six files cover auth (missing/unknown/revoked/valid), rate limiting (deny at capacity, correct `Retry-After`, refill under the injected clock, fresh-bucket allow), credits (exact 5/5 boundary, 5/6 over-draw ⇒ 402 with detail and no row written, sequential over-draw never goes negative, zero-cost no-op, the balance ≡ SUM(ledger) invariant after a mixed grant/charge/402 sequence, and the CHECK constraint rejecting a direct negative write), `/v1/account` (seeded plan values, balance, month-windowed usage), the full error table plus an unknown-route 404 `NOT_FOUND` through `app.fetch`, and the cost table.

## Decisions

The load-bearing SQL is the reason this milestone is mostly about two statements. The **credit charge** puts its guard on a row the statement itself updates: `UPDATE account_balances … WHERE balance >= amount` row-locks, so a concurrent loser blocks, re-evaluates against the winner's committed balance, and fails cleanly; the ledger append rides in the same CTE. One atomic statement, one round trip, over-draw impossible under real concurrency, identical on PGlite and Neon. (The first version guarded on `SUM(delta)` in a subquery instead — see What broke for why review rejected it.) The **token bucket** leans on a less-obvious Postgres feature: `ON CONFLICT DO UPDATE … WHERE`. Guarding the update with `refilled >= cost` means `RETURNING` gives one row on allow and zero on deny — an unambiguous decision — while a denied request writes nothing and therefore loses no accrued refill time. Note the two guards are safe for the *same* reason: both live on the row being updated, where Postgres re-checks them against the committed winner.

Both statements are plain Postgres so the PGlite-now / Neon-later split (the binding planner deviation) costs nothing at the SQL level. The db seam is one 6-line interface; swapping drivers is a one-line change in `createDbFromEnv`.

Determinism drove the shape of everything time-touching: `deps.now()` is the only clock, which let the rate-limit refill test advance a controllable clock by exactly 6s and watch one token return. Plan numbers live in a migration and cost numbers in one commented table — no SPEC magic scattered in code.

## What broke

Honestly, not much at runtime — the first `tsc` run was clean and the first `vitest` run was 18/18 green. The real failure was a design one that survived until review:

- **The first charge CTE could over-draw under true concurrency — caught in review, not by tests.** The shipped-then-rejected v1 was `INSERT … SELECT … WHERE (SELECT COALESCE(SUM(delta),0) …) >= amount`: single-statement, "atomic by construction", 402 on zero rows. It passes every sequential test — and is wrong. Under READ COMMITTED, two concurrent charges each snapshot the *same* SUM, both pass the guard, both insert, and the balance goes negative. Postgres's EvalPlanQual re-checks conditions against a concurrent winner's commit only for UPDATE/DELETE *target rows*; a subquery over other rows is never re-evaluated. PGlite (single-threaded) can't surface this, which is exactly why it slipped through. The fix is the design SPEC_04 had named all along ("balance = materialized sum"): an `account_balances` row per account, charged via `WITH upd AS (UPDATE … SET balance = balance - n WHERE … AND balance >= n RETURNING …) INSERT INTO credit_ledger … FROM upd` — the UPDATE row-locks, the loser blocks and re-checks the committed row, and the ledger append rides in the same statement. `CHECK (balance >= 0)` backs it as belt-and-braces (and has its own test), the ledger stays append-only, and a new invariant test pins `account_balances.balance === SUM(credit_ledger.delta)` across a mixed grant/charge/402 sequence. Textbook lesson: "single statement" is not the same as "serializable"; the guard must live on a row the statement writes.
- **Unknown routes claimed `INTERNAL` — review rejected that too.** The Hono `notFound` handler originally reused `INTERNAL` for 404s because SPEC_03's closed enum had no generic not-found code. Review added `NOT_FOUND` to SPEC_03 (docs first), and the handler, enum, and tests now use it: a 404 labelled `INTERNAL` would mislead an agent into treating a typo'd path as a server fault.
- **corepack couldn't install a pnpm shim.** `corepack enable` and `corepack prepare --activate` both hit `EPERM` writing into `C:\Program Files\nodejs` (no admin). The fix was to stop trying to install a shim and invoke `corepack pnpm@9.15.0 …` directly, which resolves the pinned version from the root `packageManager` field. CI uses `corepack enable` (GitHub runners are admin) — noted so the two environments don't diverge silently.
- **A design trap I caught before it shipped, not after.** My first sketch of the token bucket was a naive single-statement decrement returning the post-decrement token count, with the middleware deciding allow/deny from that number. It doesn't work: on allow the result lands in `[0, capacity-1]` and on deny in `[0, 1)` — the ranges overlap, so the post value can't tell you which happened. The `DO UPDATE … WHERE` guard (row returned ⇔ allowed) is the clean fix and is what shipped. Recording it because the naive version typechecks, passes a happy-path test, and is wrong.
- **`noUncheckedIndexedAccess` did its job.** Every `rows[0]` is `T | undefined`, which forced explicit `row === undefined` handling at each query site — verbose but exactly the discipline that keeps a stray empty-result from becoming a runtime `NaN`. A `require`-named flag helper also shadowed a global and got renamed to `requireFlag`.

Known limitations, deliberately deferred:
- **PGlite is single-threaded**, so it cannot exercise *true* concurrency — the very gap that let the SUM-guard bug survive local testing. The charge/grant CTEs and the token-bucket consume are now correct by row-lock semantics and boundary-tested sequentially here; genuine parallel-writer verification happens on real Neon in P1M5 (the plan's stated split). The rate limiter's `Retry-After` uses a second, non-atomic read purely to compute the header — informational only, not part of the consume.
- **Ten of the fifteen error codes are not yet reachable through `app.fetch`** because the routes that raise them (charging/validation) land in P1M3+. They are pinned through the real error handler via a probe app; `INSUFFICIENT_CREDITS` is additionally exercised end-to-end against PGlite through `charge()`. Explicitly reachable through the production app this milestone: `MISSING_API_KEY`, `INVALID_API_KEY`, `RATE_LIMITED`, `NOT_FOUND`, `INTERNAL`.

## Numbers

Measured on the dev machine (Windows, Node 24.15, pnpm 9.15 via corepack). Cold `pnpm install` was 3.6s (68 packages added); a frozen re-install is 0.4s. `pnpm -r typecheck` (strict `tsc --noEmit`) runs clean in ~1.6s. `pnpm -r test` runs 21 Vitest tests across 6 files in ~3.6s (18 before the review fixes added the invariant, CHECK, and NOT_FOUND tests), each suite spinning up its own in-memory PGlite with migrations applied and plans seeded. The Rust gates are untouched: `cargo test --workspace` is still 214 passed / 3 ignored, exactly as at p1m1. The schema is 8 tables across 3 migrations; the error table is 15 codes, all pinned.

## Next

P1M3 brings `/v1/validate` over the wasm core: it wires `charge()` into the request path (making `INSUFFICIENT_CREDITS` reachable through `app.fetch`), enforces `max_file_bytes` from the plan (`FILE_TOO_LARGE`), and adds the upload/url input shapes with their SSRF and zip guards (`FETCH_FAILED`, `UNSUPPORTED_FORMAT`, `MALFORMED_GLTF`, `BUNDLE_INCOMPLETE`). The seams are in place: the cost table, the injected clock, and the driver factory all carry forward unchanged, and the ledger/rate-limit SQL is frozen. P1M5 provisions Neon and adds the branch-per-CI-run integration job that finally tests these statements under real concurrency.
