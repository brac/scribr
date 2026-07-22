---
title: "Self-serve signup: from owner-minted keys to a stranger holding one in two minutes"
date: 2026-07-20
project: "meshcheck"
phase: 6
tags: [auth, billing, polar, resend, astro]
draft: false
summary: "Magic-link accounts, a real pricing page, and dashboard key minting shipped to prod. Gmail's link scanner ate our first token."
repo_ref: "phase-6"
decisions:
  - what: "Hand-rolled magic-link auth: single-use hashed tokens plus stateless HMAC session cookies"
    why: "The dashboard needs exactly three abilities (see credits, mint or revoke a key, reach the Polar portal); an auth framework is weight without benefit at that scope"
    alternatives: ["Better Auth (heavier, framework peer-deps)", "Lucia (deprecated upstream)", "Polar customer portal as sole auth (cannot reveal or rotate our keys)"]
  - what: "Free tier stays off Polar; signup is our own email flow"
    why: "Reaffirms the phase-4 settled decision; signup keeps working when billing is down and no zero-dollar product is needed"
    alternatives: ["free as a $0 Polar product for one uniform provisioning path"]
  - what: "The Polar webhook remains the only writer of paid-plan state; the success page just polls Neon"
    why: "A checkout_id in a redirect URL is not proof of payment; anyone can paste an open checkout's id"
    alternatives: ["provision synchronously on the success redirect"]
  - what: "Emailed link lands on a side-effect-free GET interstitial; only its auto-submitted POST claims the token"
    why: "Mail providers prefetch GET links and burn single-use tokens; scanners do not submit forms"
    alternatives: ["consume on GET (shipped first, failed live)", "longer-lived reusable tokens (weakens single-use)"]
  - what: "Keys are minted from the dashboard on demand, never at signup, shown once"
    why: "Only hashes are stored, so a later reveal is impossible; minting at signup would force showing a key nobody asked for yet"
    alternatives: ["auto-mint first key at account creation"]
benchmarks:
  - metric: "server test suite"
    value: "274 passed / 274"
    target: "full suite green (stop conditions, all milestones)"
  - metric: "site e2e suite"
    value: "15 passed / 15, tests unmodified"
    target: "15/15 green"
  - metric: "live preview e2e checklist (deployed function, real Resend, real Neon)"
    value: "9/9 pass after the scanner fix"
    target: "every gate: delivery, CSRF, create+grant, intent, replay, tamper, key mint, key on /v1/account, checkout URL"
  - metric: "production signup round-trip (human, meshcheck.dev)"
    value: "signed in, 300 credits, key mintable"
    target: "stranger-flow works with zero owner involvement"
---

## What shipped

Until this phase every meshcheck API key was minted by hand from an admin CLI. Phase 6 shipped the missing front door, live on meshcheck.dev: a real `/pricing` page with the four plans, `/signup` that emails a single-use sign-in link (Resend, `resend@6.17.2`), account auto-creation with the free plan's 300 credits granted idempotently, a `/dashboard` for minting and revoking keys (raw key shown once, five active max) and upgrading through the existing Polar checkout, and `/billing/success`, which had been a dangling redirect target since phase 4. Server-side that is a new `/api/web/*` surface outside the keyed `/v1` subtree: stateless HMAC session cookies, dual IP-and-email rate buckets on link requests, an Origin-check CSRF guard, and migration 0008 (`auth_tokens`). The pricing-page CTA carries a plan intent through the email round-trip, so a paid pick lands the user in Polar checkout right after verification.

## Decisions

The auth question had a strong gravitational pull toward frameworks. Research settled it: Lucia is deprecated, Better Auth is real but heavy, and the Polar portal cannot reveal keys it does not hold. A magic link plus a signed cookie covers the dashboard's three abilities in about two hundred lines, tests included. Free-off-Polar was reaffirmed rather than relitigated, which kept signup independent of billing availability. The provisioning-truth decision (webhook writes, success page reads Neon) came straight from research flagging the redirect-replay trap, and it shaped both the success page and the `checkout-status` endpoint, which reports the account's current Neon plan rather than trusting Polar's redirect.

## What broke

The launch-blocking find came from the live gate, not the suite: the first real signup email's link showed "expired" before its owner ever clicked it. Gmail's link scanner had prefetched the GET and burned the single-use token — the mechanism worked perfectly, for a robot. The fix is the standard interstitial: GET is now side-effect-free and returns a tiny auto-submitting form; only the POST claims the token. The re-test with a human click passed, and repeated GETs on a used link are inert.

Two false alarms are worth recording. A deployed cookie-tamper probe returned 200 and looked like an HMAC bypass; the "tamper" had replaced the cookie's last character with the same character. Redone with guaranteed changes it returned 401 both ways. And right after the production promote, `/signup/` returned 404 with the correct page body — a stale CDN entry from the pre-promote deployment, gone on the next requests. One real deploy stumble: `vercel deploy --prebuilt --prod` rejects a preview-built output; production needs its own `vercel build --prod` first.

## Numbers

The server suite grew from 244 to 274 tests across the three milestones; the site e2e suite from 12 to 15, including a 390px header-visibility gate. The live preview checklist passed 9 of 9 after the scanner fix: real email delivery, cross-origin 403, account creation with exactly one 300-credit grant (re-login does not re-grant), intent carry-through, replay burn, tamper rejection, key mint, that key authenticating against `/v1/account`, and a sandbox Polar checkout URL. The production round-trip was performed by a human: signup, click, dashboard, 300 credits. The real-card paid test was deliberately deferred to the L5 launch matrix.

## Next

Two test accounts (`+p6test`, `+p6prod`) join the prune list. The owed L6 soak now certifies a config that includes phases 6 and 7. Owner UI notes from first contact with the shipped design are queued as input for the next visual iteration.
