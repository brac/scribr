---
title: "Townwick phase 4: billing and ops, where the automation is one email"
date: 2026-08-02
project: townwick
phase: 4
tags: [stripe, webhook, billing, runbooks, gates]
draft: false
summary: "The last numbered phase: a signature-verified Stripe webhook whose entire job is one operator email, plus the Paused and Churned checklists."
repo_ref: "phase-4"
decisions:
  - what: "Stub-first: no Stripe account exists, so every account-dependent activation is a labeled [operator] runbook step and the code ships complete and hermetically proven"
    why: "The signature scheme, event classification, email copy and catalogue plan are all provable without an account, because HMAC needs a secret and not a merchant. What can't be proven hermetically is exactly two runbook steps."
    alternatives: ["Wait for the account (loses the day)", "Fake the test-mode proof (the one thing worse than waiting)"]
  - what: "The webhook is inert by default everywhere: 503 before the body is read when STRIPE_WEBHOOK_SECRET is unset"
    why: "api/ deploys to every Vercel project in the fleet, while exactly ONE endpoint is ever registered with Stripe. Every misconfiguration degrades to 'no alert', never to 'an unverified event was processed'."
    alternatives: ["Deploy-time exclusion (fights the shared-api topology for no gain)", "200 on unconfigured (silently eats real events if a secret is ever half-set)"]
  - what: "No stripe npm package: node:crypto verification and bare-REST provisioning"
    why: "Two POST endpoints and one HMAC don't justify a dependency shipped into every client's function bundle. HMAC-SHA256 over '{t}.{rawBody}', whsec verbatim as key, timingSafeEqual, 300s two-sided tolerance."
    alternatives: ["The SDK (a version to track and a bundle everywhere, to save URLSearchParams)"]
  - what: "setup.mjs's dry-run guard IS the key: no STRIPE_SECRET_KEY prints the plan and exits 0, key present creates idempotently"
    why: "A separate --dry-run flag can drift from the condition that actually decides. Amounts import from brand.ts so the catalogue can never disagree with townwick.com."
    alternatives: ["--dry-run flag (drifts)", "Retyped amounts (the catalogue-vs-page mismatch a client finds at closing)"]
  - what: "CLIENTS.md is half generated and half hand-typed, and pnpm clients preserves the human half byte-for-byte"
    why: "Config carries slug, mode, domain and stripeCustomerId, but MRR, renewal month and notes live nowhere else, per docs/05's 'resist the urge' line. The walk-through proved an operator exploring with --help would silently rewrite the dashboard."
    alternatives: ["Full generation (needs billing fields in config, contradicting docs/05)", "Pure hand-maintenance (drifts from configs within a week)"]
  - what: "The four genuinely commercial gaps became docs/06 open questions 6 to 9 rather than invented answers"
    why: "Grace period, renewal derivation, mid-term churn and founding-spot semantics are numbers governing real money that nobody has ruled on. Blank with a question beats plausible and unowned."
    alternatives: ["Skip the walk-through (the precedent says it finds what gates miss, and it did again)", "Invent the grace period"]
benchmarks:
  - metric: "gates"
    value: "phase-4 158/158 (incl. 9 negative rows, each mutation sha-proven), full battery green, marketing 87/87 with dist byte-identical"
    target: "c2/c3 re-verified green after commit"
  - metric: "review falsifications"
    value: "tolerance weakened in product code (300 to 100000) made the gate exit 1 on exactly the boundary rows, restore sha-verified; the walkthrough agent found 6 mechanical and 4 commercial gaps"
    target: "the gate binds to product behavior, not to its own fixtures"
  - metric: "webhook tests"
    value: "38 unit tests: tolerance both sides (299/301), missing v1, v0-only, rotation, non-hex, empty body, both null classifications, moved subscription field"
    target: "docs/06's 'fires an operator email in test mode' is operator runbook steps 9 and 10, disclosed rather than claimed"
---

## What shipped

docs/05 opens with "billing is an operator workflow, not a product feature",
and that line is the entire architecture of this phase.

The automation is one webhook that sends one kind of email. That's it.
Everything else is checklists that finally got written down. Paused is the
freeze that keeps `noindex` off a page Google already ranks. Churned treats the
exit as a delivery: bundle handed over unprompted, domain offered in writing,
GBP access given up, and the reason recorded, because three churns with the
same reason is the most useful thing that table will ever tell me.

The code is a signature-verified Stripe webhook, a catalogue script that's
dry-run by default, and `pnpm clients`, which keeps CLIENTS.md as a
half-generated dashboard.

No Stripe account exists yet, so this shipped stub-first. Everything
account-shaped is a labeled `[operator]` step in an eleven-step activation
runbook, ending with `stripe trigger invoice.payment_failed` against the
deployed endpoint and an ACTION email landing tagged [TEST MODE]. Until I run
those, the function answers 503 on every deployment in the fleet, which is the
correct shape for a webhook nobody has registered.

## Decisions

Stub-first was my call, made on a day I was away from the keyboard, and I think
it holds up. The signature scheme, the event classification, the email copy and
the catalogue plan are all provable without an account, because HMAC needs a
secret and not a merchant. What genuinely can't be proven hermetically is
exactly two things: a real signed event arriving at a deployed URL, and the
email landing. Those are two runbook steps. docs/06's gate line about test mode
is recorded as satisfied by those steps rather than by code, which is the
honest version of it. Faking the test-mode proof is the one thing worse than
waiting.

The webhook is inert by default everywhere. `api/` deploys to every Vercel
project in the fleet because of the null root directory, while exactly one
endpoint will ever be registered with Stripe. So it answers 503 before it even
reads the body if `STRIPE_WEBHOOK_SECRET` is unset. The polarity is fail-safe
throughout: every misconfiguration degrades to "no alert", never to "an
unverified event got processed". The one exception is deliberate. A missing
mail env answers 500, so Stripe's own retry-then-notify path becomes the alarm
when the alarm itself is broken.

No `stripe` npm package. Two POST endpoints and one HMAC don't justify a
dependency shipped into every client's function bundle. Research turned up two
traps and both are handled in place: `invoice.subscription` is gone, it's
`parent.subscription_details.subscription` now, and `next_payment_attempt ===
null` conflates retries-exhausted with a never-retried manual invoice. Those
are two completely different phone calls, so the alert copy distinguishes them.

## What broke

The fresh-session docs walk-through ran as a review gate again, and again it
found what 158 hermetic checks couldn't. Six mechanical gaps and four
commercial ones.

Mechanically: a pause tier with no price, a doc line that was factually wrong
about the alert subject, and a self-inflicted cancellation alert. The comment
round closed all of those.

The one I liked least was `pnpm clients`. The walk-through proved that an
operator poking at it with `--help` would silently rewrite the dashboard.
CLIENTS.md is half generated and half hand-typed, since config carries slug,
mode, domain and stripeCustomerId, but MRR, renewal month and notes live
nowhere else. Rewriting the hand-typed half by accident is unacceptable, so
`--check` never writes and unknown args refuse before reading anything.

The four commercial gaps did not get answers. Grace period, renewal derivation,
mid-term churn, founding-spot semantics. They became docs/06 open questions 6
through 9 rather than invented numbers. Blank with a question beats plausible
and unowned, which is the same rule the intake kits apply to client facts,
pointed at our own paperwork for once.

## Numbers

The phase-4 gate is 158/158, including 9 negative rows, each mutation
sha-proven. Full battery green. Marketing stayed 87/87 with dist
byte-identical, which confirms `REFRESH_SHOOT_USD` moves zero rendered bytes.
c2 and c3 are dirty-tree-only before the commit and re-verified after it.

38 unit tests on the webhook: tolerance on both sides at 299 and 301, missing
v1, v0-only, key rotation, non-hex, empty body, both null classifications, and
the moved subscription field.

Review falsified it properly by weakening the tolerance in the product code
from 300 to 100000, which made the gate exit 1 on exactly the boundary rows and
nothing else, restore sha-verified. That's the test I actually care about,
because it shows the gate binds to product behavior rather than to its own
fixtures.

## Next

There's no phase 5 in docs/06. What's left is the activation runbook, which
needs a Stripe account and about twenty minutes, then the CI reconciliation
round for the five older gates pinned to the old seed state. After that the
backlog is commercial rather than technical: the four open questions, and a
first client to sign.
