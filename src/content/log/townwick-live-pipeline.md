---
title: "Townwick phase 2: the live pipeline, and four bugs that only existed off my machine"
date: 2026-07-30
project: townwick
phase: 2
tags: [vercel, resend, google-places, analytics, rate-limiting]
draft: false
summary: "The live pipeline: Google reviews with compliance rendering, live-only analytics, two-layer rate limiting, and a fake client on a real domain to prove it."
repo_ref: "phase-2"
decisions:
  - what: "The live gate uses a THROWAWAY fictional client, not a seed client as docs/06 said"
    why: "Promoting a real shop's demo to an indexable live site under our domain, before they've signed anything, is a consent problem rather than an engineering one. The mechanics prove out identically either way."
    alternatives: ["Promote cjs-barbershop as written (real business, real SEO exposure)", "Skip the deployed gate"]
  - what: "Analytics is gated by a build-time module alias, not a {!demo && <Analytics />} render condition"
    why: "Astro bundles any <script> it can see in the render graph whether or not the component renders, so the conditional version still shipped the whole runtime into a demo dist/. Every failure mode of the alias is 'no analytics', never 'analytics on a prospect's demo'."
    alternatives: ["Conditional render (measured: leaks 3 chunks)", "Integration injectScript (works, but drops the pinned /astro entry point)"]
  - what: "Google review cards render the FULL display name; manual review cards keep first-name-only"
    why: "Places attribution policy requires the author's display name as given, so shortening it modifies required attribution. Manual quotes are client-supplied, so the policy doesn't reach them."
    alternatives: ["First name everywhere (consistent, non-compliant)", "Full name everywhere (leaks surnames of people who never dealt with Google)"]
  - what: "Contact-form rate limiting is WAF plus in-memory, with the WAF deliberately LOOSER"
    why: "The tight layer (5/60s) lives in the function so an over-limit visitor gets our own 429 with a phone number on it. Equal limits would hand every legitimate over-limit visitor a generic block page."
    alternatives: ["Upstash/KV shared counter (a bill and a dependency for a form that emails one person)", "WAF only (generic block page)", "code only (no protection under real flood)"]
  - what: "The reviews cost guard counts DISTINCT live slugs, plus a per-run request budget"
    why: "As specced the guard could never fire, because planned calls were always under the live-client count they were compared against. Distinct slugs fixes the ratio; the runtime budget catches retries the pre-flight count can't see."
    alternatives: ["Pre-flight check only (structurally unable to fail)", "No guard (Places bills $25/1k past the free tier)"]
benchmarks:
  - metric: "phase-2 gate"
    value: "67/67"
    target: "hermetic; fixture-driven so CI never spends a billed Places call"
  - metric: "deployed rate limiting"
    value: "5x200, 5x429 (in-code), 1x403 (edge) across 11 rapid POSTs"
    target: "at least one 429 under flood; in-code layer trips first"
  - metric: "Resend sending domain"
    value: "send.townwick.com verified in ~60s (DKIM + SPF TXT + MX)"
    target: "verified inside the 72h ceiling"
---

## What shipped

The live half of the product. `pnpm reviews` pulls Google reviews through
Places API (New) v1, since the legacy endpoint is closed to new Cloud projects.
It filters by `minRating`, clamps bodies at 280 characters on a word boundary,
and writes `clients/<slug>/reviews.json`, which a weekly Action refreshes so
nothing on a page is ever older than the 30-day cap the Places terms impose.
The rating renders as plain text linking to the listing, never as
`aggregateRating`. That ban from phase 1 held.

Analytics is Vercel Web Analytics with exactly two events, `tel_click` and
`booking_click`, on live sites only. The contact form grew a
`send.townwick.com` sender, an optional operator BCC, and two layers of rate
limiting. `create-project.mjs` provisions the WAF rule itself now, so a new
client is protected at creation instead of at go-live if someone remembers.

Then `livegate-cafe`, a fictional cafe with an invented phone number and stock
photos, went live on `livegate.townwick.com` to prove the whole thing on real
infrastructure, and got deleted an hour later.

## Decisions

Two of the five are ethics calls rather than engineering ones, and both went
against what was written down first.

docs/06 said to promote a seed client for the live gate. That means taking a
real shop's demo, pointing an indexable live site at it under our domain, and
doing it before they've signed anything or even been asked. The mechanics prove
out identically with a fake cafe, so that's what we used.

The other one is smaller and stranger. Google review cards render the
reviewer's full display name, manual review cards keep first names only. Places
attribution wants the author's name as given, so trimming it is modifying
required attribution. Manual quotes are client-supplied, so the policy doesn't
reach them. Looks inconsistent on the page, correct in both halves.

The rate-limit split is the one I'd defend hardest. The tight layer lives in
the function so an over-limit visitor gets our own 429 with a phone number on
it. The edge rule is looser on purpose and only exists to catch volumes the
function should never see. Matching the two would hand every legitimate
over-limit visitor a generic block page instead of a way to reach the shop.

## What broke

Four things, and the pattern is the interesting part: **every one of them was
invisible on my machine.**

The worst was a `node:fs` import in `packages/config-schema/src/index.ts`.
Re-exporting the snapshot loader from the barrel dragged Node builtins into the
type graph of `@townwick/theme`, a package that renders in a browser.
`pnpm typecheck` passed on Windows and failed on ubuntu-latest and macos-latest
with `TS2307`. I had already reported that round green. CI caught it, I hadn't
looked. The loader lives behind a `/reviews-fs` subpath now and the gate fails
if a `node:` import ever reappears in the barrel.

The analytics leak was the same shape. `{!demo && <Analytics />}` looks
obviously correct and is obviously wrong. Astro bundles scripts it can *see*,
not scripts that *render*, so demo builds shipped the entire analytics runtime
as unreferenced chunks. I only found it because I built the demo flavour and
grepped `dist/` instead of trusting the JSX.

The cost guard caught itself. Writing the gate row for "a fan-out past 2x the
live-client count aborts", I couldn't construct a case that failed, because
planned calls were always under the number they were compared against. A guard
that can't fire is a comment with a `throw` in it.

And the WAF behaved twice as documented and twice as not. It works, but `deny`
answers **403**, not the 429 the plan predicted, and a block covers the
tripping IP **project-wide** for a minute, so `GET /` was 403 too, not just the
form. Both accepted as designed, both written down now, because "the site went
down for a minute" is a call you want to be able to answer.

## Numbers

The deployed gate: HTTPS 200 with a Let's Encrypt cert, `grep -i noindex`
empty, `sitemap-index.xml` 200, the robots `Sitemap:` line present, the WAF
rule verified present and verified *absent* on a control project, so the check
can actually fail. Six sequential POSTs against one warm instance returned five
200s then a 429 with `Retry-After: 60`, which is the in-code counter proven at
its exact boundary in production. Eleven rapid POSTs added the edge layer at
request 11. The round-trip landed in the inbox from
`notifications@send.townwick.com`, reply-to the submitter, subject untagged by
`[DEMO]`, operator BCC delivered.

A fresh-session docs walk-through then failed with three improvisation points,
which is the gate item doing its job. The sharpest: `--stock` is advertised as
if it works for every vertical, but sets only exist for barbershop, salon and
restaurant, while docs/00 targets trades and cleaners too. Not fixed by
grabbing images, since every stock file carries a hash-verified provenance
entry and doing that properly is an afternoon of licence-checking. Fixed by
saying so out loud, in the CLI error, the checklist and the backlog.

## Next

Next is the Townwick marketing site, the venture's own page on the apex domain,
then phase 4 for billing. Still open from this phase: a Google Places API key,
so the reviews path stays fixture-proven rather than key-proven; the Web
Analytics per-project toggle, which has no API and needs a dashboard click; and
stock sets for the two verticals that don't have them.
