---
title: "Townwick phase 1: three demo sites deployed, and the SEO plan the research killed"
date: 2026-07-29
project: townwick
phase: 1
tags: [vercel, sharp, satori, seo, lighthouse]
draft: false
summary: "The demo pipeline: photo processing, OG images, JSON-LD, demo-mode behaviors, and all three seed clients live on Vercel previews."
repo_ref: "phase-1"
decisions:
  - what: "No aggregateRating or review markup in JSON-LD, ever. Plain-text rating with a Google link instead"
    why: "Google's review-snippet policy bans self-served review markup outright, and a violation escalates to a manual action that strips every rich result the site has."
    alternatives: ["Follow docs/04 verbatim", "Move the rating onto Organization markup (explicitly also banned)"]
  - what: "Demo robots.txt ALLOWS crawling; the noindex meta tag does the work"
    why: "Disallow: / blocks the crawl, so the noindex is never read and the URL can still be indexed from an external link."
    alternatives: ["robots disallow all (the docs' original design)"]
  - what: "Ignored-build-step script instead of Vercel's workspace-graph skipping"
    why: "clients/<slug>/ isn't a workspace package, so Vercel calls any client edit a global change and rebuilds every project. Exit codes are inverted per Vercel: 0 cancels, 1 builds."
    alternatives: ["Vercel auto-skip (measured: rebuilds everything)", "one repo per client"]
  - what: "satori then sharp for OG images; fontsource .woff devDeps for satori only"
    why: "satori rejects WOFF2 and Astro's Fonts API emits only content-hashed WOFF2, so its fonts can't be reused. sharp rasterizes satori's path-only SVG in 13ms and drops the resvg native dep."
    alternatives: ["@resvg/resvg-js (18x slower here, extra native binding)", "astro-og-canvas"]
  - what: "Commit stock-photo binaries with a sha256 and license-snapshot ledger; no fetch-on-build, no APIs"
    why: "The Unsplash/Pexels license survives the photo being deleted but the URL does not, and the platform APIs impose stricter terms. CI verifies every committed byte against the ledger."
    alternatives: ["URL manifest fetched at build", "Unsplash API", "git-lfs"]
benchmarks:
  - metric: "phase-1 gate"
    value: "107/107"
    target: "demo/live divergence proven; ledger tamper-checked"
  - metric: "Lighthouse (local, median of 5)"
    value: "perf 1.00, a11y 1.00, bytes 236KB/512KB"
    target: "budgets green; SEO 0.69 = demo noindex only, all other SEO audits green"
  - metric: "30-minute test (tooling path)"
    value: "2m47s scaffold to deployed URL"
    target: "under 30 min (floor: excludes human data-gathering)"
---

## What shipped

All three seed clients are live demos: townwick-cjs-barbershop,
townwick-untamed-salon and townwick-yolks-on-us, one Vercel project each,
created by script over the REST API. Each one has an ignored-build-step so
editing a client rebuilds only that client. That's proven, not assumed. A
cjs-only commit left the other two CANCELED in the deployments API.

The pipeline itself grew a lot. Sharp photo processing strips EXIF and GPS,
corrects orientation, and emits AVIF, WebP and JPEG at four widths each plus a
150-byte WebP LQIP. satori renders OG images at about 10KB. LocalBusiness
JSON-LD. Demo and live mode genuinely diverge now. The contact form is
Resend-backed with a honeypot and a minimum fill time. And there are 13 Pexels
placeholders sitting under a sha256 provenance ledger.

Fixtures use verified public data only. Untamed's hours are empty on purpose
because they genuinely haven't published any, and Yolks' hours came from the
Chamber because their own website still carries Square's template defaults,
including a map pin in San Francisco.

## Decisions

Two of the five are corrections to our own design docs, which is the best
possible outcome for a research round.

First: no `aggregateRating` or review markup in JSON-LD, ever. Google's
review-snippet policy bans self-served review markup outright for
"LocalBusiness or any other type of Organization", and the penalty isn't a
shrug. It escalates to a manual action that strips every rich result the site
has. docs/04 had a snapshot-feeds-aggregateRating plan written down. It got
killed before a line of code existed.

Second: demo `robots.txt` allows crawling and the `noindex` meta does the work.
The original combo, disallow everything plus noindex, is self-defeating. Block
the crawl and the crawler never reads the noindex, and the URL can still get
indexed off an external link.

The rest is plumbing with teeth. Vercel's own workspace-graph skipping can't
help here because `clients/<slug>/` isn't a workspace package, so Vercel treats
any client edit as a global change. The ignored-build-step script fixes it,
with exit codes inverted from every instinct you have. satori won't take WOFF2
and Astro's Fonts API only emits content-hashed WOFF2, so satori gets its own
`.woff` devDependencies and sharp rasterizes the path-only SVG in 13ms, which
dropped the resvg native dependency entirely.

Stock photos get committed as binaries with a sha256 and a license snapshot.
The Unsplash and Pexels licenses survive the photo being deleted, but the URL
does not, so a fetch-on-build manifest is a demo that breaks for reasons
outside the repo.

## What broke

An API outage killed the first implementer twice and ate both transcripts. The
replacement inherited the working tree and, to its credit, didn't trust it. It
found two real defects: a `CLIENT` env typecheck failure that CI had been
masking, and two stock photos whose ledger entries falsely claimed no visible
trademarks. One had a WAHL wordmark, the other a sticker. Both cropped and
re-hashed.

Offboarding the scratch client I'd used for the timing test then exposed a
latent CI bug, where a deleted client's slug still entered the Lighthouse
matrix and reddened a run. Fixed by filtering to clients that still exist,
which is a sentence I'd have bet money was already true.

## Numbers

Review re-ran the battery independently: 124 tests, gate 107/107. Then it
negative-proofed the gate by injecting an `aggregateRating`, and 8 checks
failed exactly as designed.

Live-artifact probes did the rest. noindex confirmed on the deployed demos,
405s where they belong, honeypot submissions returning a silent 200 with no
email created, and three [DEMO]-tagged deliveries verified through the Resend
API rather than by squinting at an inbox.

Lighthouse medians of 5 came in at perf 1.00 and a11y 1.00 on 236KB of a 512KB
budget. SEO reads 0.69, which is the demo noindex and nothing else. The
scaffold-to-deployed-URL run was 2m47s against a 30 minute target, though
that's a floor, since it skips the human part of gathering a real business's
data.

## Next

Phase 2 is the live pipeline: the custom-domain checklist, production Resend
with a verified sending domain, Google reviews sync with compliance rendering,
analytics with two events, and one seed client promoted to a real test domain.
Open dependency: actually acquiring townwick.com.
