---
title: "Polar billing, a vision endpoint, and the migration that silently never ran"
date: 2026-07-18 # PENDING: finalize at phase close (soak end)
project: "meshcheck"
phase: 4
tags: [polar, billing, webhooks, ai-gateway, launch]
draft: true
summary: "Phase 4 wired Polar as merchant of record, shipped the /inspect vision endpoint through Vercel AI Gateway, and published the MCP server."
repo_ref: "phase-4" # tag lands at the phase-completion commit (soak close)
decisions:
  - what: "Polar replaces Paddle as merchant of record"
    why: "Existing Polar account meant no vendor-approval wait; Polar is MoR with a real sandbox"
    alternatives: ["Paddle (original plan; multi-day vendor approval from zero)", "Stripe (not MoR — we'd own global tax)"]
  - what: "Credit ledger stays in Neon; Polar is money movement + lifecycle webhooks only"
    why: "Keeps the billing provider swappable and the deterministic core self-contained"
    alternatives: ["Polar native metering/credits (couples usage data to the provider)"]
  - what: "Scale hard-caps at 40k credits/mo in v1; the specced $4/1k overage is deferred"
    why: "Modeling overage as a Polar metered price would force usage ingestion into Polar, breaking the invariant above"
    alternatives: ["Polar usage-based price", "track-and-invoice-manually"]
  - what: "Monthly grants key off order.created billing_reason (subscription_create|subscription_cycle), amount derived from the order's own product"
    why: "Polar has no subscription.renewed event, and webhook arrival order is not guaranteed — the account's stored plan can be stale when the order lands"
    alternatives: ["grant on subscription.updated (no renewal signal)", "grant from account.plan_name (arrival-order bug, caught in review)"]
  - what: "/inspect routes through Vercel AI Gateway; default model anthropic/claude-haiku-4-5 in config/vision.toml"
    why: "Zero-markup passthrough plus spend dashboards and a per-key monthly budget cap; Haiku lands ~$0.008/inspect against the 5-credit charge"
    alternatives: ["bare ANTHROPIC_API_KEY (no platform spend cap)", "Sonnet 5 (~2-4x cost, thin margin on Studio)", "Opus 4.8 (negative margin — prohibited as default)"]
  - what: "VIS answer schemas are TS-owned (docs/schema/vis_00{1,2,3}.json), amending SPEC_02"
    why: "The vision layer produces those answers; they never pass through the Rust core — core emitting them would be schema theater"
    alternatives: ["schemars emission from meshcheck-core per original SPEC_02"]
  - what: "Auto-refund the 5-credit inspect charge when the model double-fails; render failures never charge"
    why: "Customers pay only for delivered answers; the append-only ledger keeps refunds auditable (refund:inspect:<id>)"
    alternatives: ["charge stands on 503 (simplest, hostile at scale)"]
  - what: "Launch on meshcheck.vercel.app; Porkbun DNS for meshcheck.dev deferred"
    why: "Ben's call; every live default/example flipped in p4m3 so nothing ships pointing at a dead host"
    alternatives: ["block launch on DNS setup"]
  - what: "npm publish run by Ben locally; no --provenance in v1"
    why: "Provenance requires CI trusted publishing on a public repo; a local 2FA publish ships now"
    alternatives: ["GitHub Actions trusted-publishing workflow (post-v1)"]
  - what: "Renewal-grant path gated via synthetic signed webhooks against the deployed handler"
    why: "Polar's sandbox has no test clock and cannot simulate a renewal — verified early in research, so the gate was designed around it instead of discovered at gate time"
    alternatives: ["wait 30 days for a real renewal (absurd)", "skip the renewal gate (unacceptable)"]
benchmarks:
  - metric: "Polar sandbox lifecycle (subscribe→grant→burn→up/downgrade→renewal→revoke)"
    value: "full pass on staging deploy; ledger invariant balance == SUM(delta) held throughout"
    target: "verified in sandbox, ledger consistent"
  - metric: "/inspect schema-valid on wild/ corpus"
    value: "10/10 (real Meshy/generator GLBs, 0.1–59MB, 4–23s each, ajv-validated)"
    target: "10/10"
  - metric: "registries live"
    value: "meshcheck-mcp@0.1.0 on npm; io.github.brac/meshcheck-mcp active on the official MCP registry"
    target: "npm + MCP directories"
  - metric: "staging soak"
    value: "PENDING — hourly cloud-agent probes started 2026-07-16 04:14 UTC"
    target: "48h, zero unhandled errors"
  - metric: "per-inspect model cost (Haiku 4.5, 6x512px renders + ~1k output tokens)"
    value: "~$0.008"
    target: "positive margin at 5 credits on every paid tier"
  - metric: "server test suite"
    value: "154 → 200 tests, green throughout"
    target: "full regression green at every milestone"
---

## What shipped

Billing end to end: three Polar recurring products (Indie/Studio/Scale), checkout and customer-portal
routes, and a Standard-Webhooks-verified `/api/polar/webhook` that maps subscription lifecycle events onto
the existing Neon credit ledger — grants on `order.created`, plan swaps on `subscription.updated`, revert
to Free on `revoked`. The ledger stayed the sole source of truth; Polar never sees usage.

The `/inspect` endpoint: VIS-001/002/003 vision checks through Vercel AI Gateway with GA structured
outputs, a `deps.vision` seam mirroring the render seam, strict-parse-plus-one-retry on the model, credit
refund on double failure, and TS-owned answer schemas served at `/v1/schema/`. Distribution: `meshcheck-mcp`
0.1.0 published to npm and the official MCP registry. Launch content: a comparison page against
gltf-validator built on a real spec-valid-but-broken corpus case, finalized Meshy/Tripo cookbooks, and a
Show HN draft. Plus key hygiene (all eight accumulated test keys revoked) and a wild/ corpus of ten real
generator GLBs.

## Decisions

See frontmatter for the full list. Two are worth prose. First, the Paddle→Polar swap happened before a
line of billing code existed, triggered by a simple observation: Ben already had a Polar account, and
Paddle approval from zero is calendar time. The research round then confirmed Polar's sandbox and webhook
catalog were workable — with one exception that became the phase's design constraint: no test clock, no
renewal simulation. The renewal-grant gate was therefore designed as synthetic signed webhooks against the
deployed handler from day one, rather than discovered as impossible at gate time.

Second, grant amounts derive from the order's own `product_id`, not the account's stored plan. The first
implementation used the stored plan; review flagged that Polar does not guarantee `subscription.created`
arrives before `order.created`, so an order-first delivery would grant a new Indie subscriber the Free
plan's 300 credits instead of 3,000. The fixture files already carried `product_id` — the bug was purely
in what the handler chose to trust.

## What broke

- **The p3m2 migration journal carried a hand-written future timestamp (2026-07-22).** Drizzle decides
  "pending" by timestamp comparison, so migration 0006 was silently skipped while `db:migrate` printed
  success — discovered only because the reviewer introspected `information_schema` after applying. Every
  migration generated before July 22 would have no-opped the same way. Repaired on both sides (DB journal
  row + `_journal.json`).
- **`/api/polar/webhook` was a platform 404 on the deployed preview** — the Hono route existed but
  `vercel.json` had no rewrite for it, a gap hermetic tests cannot see. Fixed plus a route-coverage drift
  test that fails if any mounted route lacks a rewrite (negative-proven by deleting the rewrite).
- **Claim-before-dispatch idempotency would have lost grants forever**: a transient DB error mid-grant left
  the event marked processed, so Polar's retry no-oped. Now claim-and-compensate (delete the claim on
  dispatch failure, rethrow, let Polar retry).
- **Missing `MESHCHECK_PUBLIC_URL` degraded checkout into an opaque 500**: `?? ''` built a relative
  `success_url`, Polar 422'd it, and the route surfaced INTERNAL with no clue. Now a fail-fast
  `BILLING_UNAVAILABLE` — the base URL is part of the billing config contract.
- **The MCP registry rejected our server.json at publish time** (description > 100 chars, found live
  during Ben's `mcp-publisher` run) — trivial, but a reminder that registry validation only happens at the
  door. One unreproduced full-suite flake (1 failure in ~254s under load, identity lost, five consecutive
  greens after) is on watch for the soak. And a cosmetic p3m3 bug surfaced in visual review: Astro's
  `compressHTML` collapsed a newline before a link into "inllms.txt".

## Numbers

The lifecycle gate ran against a real deployed preview with a real sandbox checkout (Stripe test card,
driven headless), not stubs: one +3,000 order-keyed grant, a real 1-credit burn, plan swaps both
directions with the upgrade's proration order correctly not granting, a synthetic `subscription_cycle`
renewal grant, a duplicate delivery no-oping, and revoke-to-Free — ledger invariant held at every step.
The wild gate ran ten genuine generator GLBs (0.1–59MB) through the deployed presigned-upload → inspect
path: 10/10 schema-valid in 4–23s, with plausible variance (three clean scans, others 3–5 concrete
findings). Suite grew 154 → 200 tests. Research-verified image-token math (`⌈w/28⌉²`) put 512px inspect
renders at ~$0.008 of Haiku spend against the 5-credit charge. Soak result: PENDING at draft time.

## Next

Close the soak, promote to production, and run the launch checklist: live Polar org (products, webhook,
production env), bypass-secret rotation, test-key revocation, Show HN when Ben decides. Post-v1 backlog
unchanged — GPU worker, hosted MCP, repair endpoints, and the deferred Scale overage design.
