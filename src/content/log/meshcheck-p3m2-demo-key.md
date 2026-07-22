---
title: "A demo key that can't leak clean renders: plan-forced watermarks on the public route"
date: 2026-07-14
project: "meshcheck"
phase: 3
milestone: 2
tags: [demo, watermark, rate-limiting, vercel]
draft: true
summary: "POST /v1/demo/validate goes live behind a per-IP token bucket, with watermarking enforced at the plan level so a leaked demo key never yields clean shots."
repo_ref: "p3m2"
---

# P3M2 — Demo-key path (raw material for phase-3 devlog)

Milestone draft, not the gated artifact.

## What shipped

`POST /v1/demo/validate`: the public, keyless route the site drag-and-drop demo (P3M3) calls. Multipart-only (no `url`/`blob_id` — SSRF surface stays off the unauthenticated route), profile field optional, forced `mode: full` + screenshots. Per-IP token bucket `demoip:<ip>` at 5/hour (SPEC_03), spent on every attempt before body parsing. The API authenticates internally as a demo account via the server-held `DEMO_API_KEY` env (new `demo` plan row: 50k credits/mo, 60/min, 25MB; `mc_demo_` key prefix in the admin CLI). Missing config ⇒ structured 500 "demo not configured".

Watermarking: procedural "MESHCHECK DEMO" stamp (hardcoded 5×7 bitmap font ×2, white on 50%-alpha band, bottom-right, pure integer math, zero deps/assets) in `renderer/src/watermark.ts`. Stamped AFTER `render_hash` + evidence are computed from the pristine readPixels buffer, onto copies only — corpus hashes and RND evidence untouched; report JSON has no watermark field. The invariant rides the PLAN, not the route: any demo-plan account gets watermarked output on every rendering path (validate full, /v1/render stills, turntable GIF frames, sync and async) — a leaked demo key can never produce clean shots.

## Decisions

- Plan-based watermark invariant over route-based flagging: routes/validate.ts, routes/render.ts, jobs.ts all set `watermark: account.plan.name === 'demo'`; the demo route is just another caller. Rejected: watermark only on the demo route (leaked-key hole).
- Demo route not added to openapi.json (SPEC_03: "no API docs required"); the route-drift test excludes `/v1/demo/` explicitly. Rejected: publishing an unauthenticated endpoint in the agent-facing contract.
- Bucket spent before body parsing — malformed requests can't probe for free.
- Demo account is a real account billed 2 credits/validate through the normal ledger; no special-casing in credits code.

## What broke

- **Deployed "demo not configured" with a perfect DB and a perfect env listing.** Piping the key into `vercel env add DEMO_API_KEY production` from PowerShell 5.1 stored an EMPTY value (the CLI's "Removed trailing newline from stdin input" was the whole input). Diagnosis was masked twice: `vercel env ls` shows the var as present/Encrypted regardless, and `vercel env pull` writes empty values for sensitive-typed vars by design, so pull-emptiness proves nothing. The decisive split test: `X-Api-Key: mc_demo_…` on `/v1/account` against the same deployment returned 200 (key+DB good) while the demo route 500'd (env bad). Fix: `vercel env rm` + re-add via bash `printf 'value' | vercel env add` — next deploy returned 200 with watermarked shots. Rule: never pipe secrets into vercel CLI from PowerShell.
- Review-side only: a first grep for the watermark plumbing in `routes/*.ts` came back empty due to a bad glob — re-grep confirmed all call sites carry the flag.

## Numbers

- Server suite 143 → 154 (+11), renderer 20 → 27 (+7); pnpm -r + cargo test all green (reviewer re-run).
- Watermark determinism pinned by test (double-stamp byte-identical; pixels outside `watermarkRegion` byte-identical to pristine; stamped render_hash == pristine render_hash).
- Visual review: stamp legible on Duck 512×512 without obscuring the model (reviewer-generated preview from test-output PNG).

## Next

P3M3 builds the Astro site + drag-and-drop demo against this route (contract documented in the P3M2 report: multipart `file` + optional `profile`; standard SPEC_02 report back). Astro dev-server CORS handled via dev proxy, not API changes.
