---
title: "Shipping brac.dev/log on Vercel after the Cloudflare plan met reality"
date: 2026-07-13
project: scribr
phase: 5
tags: [deploy, vercel, dns, analytics]
draft: true
summary: "Phase 5 put the devlog live at brac.dev/log — on Vercel, not the spec's Cloudflare Pages, after the locked plan collided with three wrong assumptions."
repo_ref: "phase-5"
decisions:
  - what: "Deploy on Vercel instead of the spec's locked Cloudflare Pages decision"
    why: "The account already ran six Vercel projects with the GitHub app installed; linking scribr took one CLI command while the Cloudflare Pages flow was unfindable in the current dashboard. The site is static, so migrating later is a DNS change"
    alternatives: ["Cloudflare Pages per SPEC #11", "wrangler CLI direct-upload with a GitHub Action"]
  - what: "Vercel Web Analytics instead of Umami on the droplet"
    why: "Zero infrastructure against a Docker+Postgres+Caddy install on a droplet whose SSH credentials were not at hand; same signal (pageviews, referrers) for the traction question. Cost: short retention on the free tier"
    alternatives: ["Umami self-hosted per SPEC #14", "Umami Cloud free tier"]
  - what: "Gate the analytics tag on VERCEL_ENV === \"production\" at build time"
    why: "The tag exists only in Vercel production output, so local builds keep the zero-script guarantee, every local gate passes unchanged, and localhost/preview traffic is excluded by construction rather than by filter"
    alternatives: ["@vercel/analytics package (adds JS to every page)", "runtime hostname check in the client"]
  - what: "Keep DNS at Porkbun with an A record, not Vercel nameservers"
    why: "Five sibling projects already resolve from the Porkbun zone; delegating nameservers to Vercel would move them all for no benefit. Vercel marks the A-record path dns-change-recommended but working"
    alternatives: ["Delegate brac.dev NS to Vercel", "Move the zone to Cloudflare (the spec's assumed state)"]
benchmarks:
  - metric: "vercel build (cold, framework auto-detect)"
    value: "21s"
    target: "build succeeds on push"
  - metric: "push-to-live round trip (analytics-tag commit)"
    value: "under 30s (live on first 15s re-poll)"
    target: "push to main deploys with no manual step"
  - metric: "production route sweep"
    value: "9 of 9 routes 200; unknown path 404"
    target: "all Phase 1 routes reachable at brac.dev"
  - metric: "existing production subdomains after apex move"
    value: "4 of 4 still 200 (crawlers, particlr, portfolio, signal)"
    target: "no existing URL breaks"
  - metric: "analytics script in local/test builds"
    value: "0 script tags (VERCEL_ENV unset)"
    target: "localhost and previews never report"
---

## What shipped

The devlog is live at brac.dev/log. The scribr repo is linked to a Vercel
project with the GitHub integration, so every push to main builds (21s,
framework auto-detected) and deploys with no manual step — verified by a real
round trip, where the analytics-tag commit was live on the production alias
within one 15-second re-poll. The apex domain, parked at the registrar since
purchase, now serves the site: index, posts, per-project listings, all nine
feeds, sitemap, robots.txt, OG images, and the styled 404.

Analytics is Vercel Web Analytics: a single deferred first-party script tag in
the base layout, emitted only when the build runs in Vercel's production
environment. Local builds — including every test gate and the Lighthouse
runner — contain zero script tags, exactly as before.

## Decisions

Two locked spec decisions were deliberately overridden, both for the same
reason: the plan was written against an infrastructure state that turned out
not to exist. SPEC #11 chose Cloudflare Pages partly because DNS was "already
in the CF ecosystem" — it wasn't; the zone lives at the registrar (Porkbun),
and there was no Cloudflare zone at all. With no CF footing and six sibling
projects already on Vercel with the GitHub app installed, Vercel was one
`vercel link` away while the Pages setup couldn't even be located in the
current Cloudflare dashboard. The bandwidth-cap concern that originally
rejected Vercel is real but deferred: the site is fully static, so if a post
ever spikes past the hobby tier, the migration is a DNS record.

SPEC #14's Umami-on-droplet fell next. The droplet exists and serves one
project, but its SSH credentials weren't at hand on this machine, and standing
up Docker, Postgres, and a Caddy site over a browser console to avoid a script
tag is the wrong trade for v1. Vercel Web Analytics answers the actual
question — is anyone reading, and from where — with zero infrastructure. The
build-time `VERCEL_ENV` gate makes the preview/localhost exclusion structural:
the tag isn't suppressed at runtime, it was never emitted.

## What broke

The apex was dead and nobody knew. brac.dev's A records pointed at the
registrar's parking service, which doesn't even complete a TLS handshake — the
domain had been parked since purchase. A wildcard parking record was also
swallowing every undefined subdomain. Both were deleted as part of the move.

The domain attach failed silently the first time: `vercel domains add` from
outside the project directory registered the domain at the account level
without binding it to the project, and the binding had to be repeated
explicitly. Certificate issuance for the apex then took the better part of
twenty minutes, during which every probe returned TLS handshake failures with
no indication of progress.

One verification couldn't be automated: Vercel's analytics script detects
headless browsers, so the scripted Playwright visit loaded the tag but
recorded nothing. The "real pageview" check is inherently a human visit.

## Numbers

Cold build on Vercel is 21s for 12 pages, 9 feeds, 3 OG images, and the
sitemap. The push-to-live round trip measured under 30 seconds. The production
sweep hit 9 routes at 200 and confirmed the 404; all four pre-existing
subdomains (crawlers, particlr, portfolio, signal) still return 200 after the
apex change. Local builds carry zero analytics bytes.

## Next

Phase 6 is the process gate, not code: paste the devlog contract into project
CLAUDE.md files, complete one real phase in particlr with the gate active,
sync, edit inside the 20-minute ceiling, publish, and distribute one post. The
editing-pass economics are the product; that's what gets measured.
