---
title: "Townwick's own site: shipping the ad without the portfolio"
date: 2026-08-01
project: townwick
phase: 3
tags: [astro, vercel, analytics, consent, pricing]
draft: false
summary: "Townwick's own page: a separate workspace app, not a fourth client. The three-demo showcase shipped held on consent grounds, behind one switch."
repo_ref: "marketing-site"
decisions:
  - what: "apps/marketing is a separate workspace app, NOT a fourth client config"
    why: "The client schema hard-requires phone, address, geo and hours, the fixed composition has no showcase or FAQ, and the generic vertical maps to LocalBusiness JSON-LD. Every one of those fixes would land inside gate-protected shared code."
    alternatives: ["Fourth client config (every schema fix lands in shared, gate-protected code)", "Separate repo (loses the theme package and the deploy tooling)"]
  - what: "The three-demo showcase SHIPPED HELD; townwick.com went live without the named-business demos (my call, 2026-07-30)"
    why: "The showcase names three real businesses that haven't signed anything. That's the same consent problem the phase-2 live gate dodged, in marketing clothes. SHOWCASE_ENABLED in lib/brand.ts holds the section, its nav link, its hero CTA and its analytics event."
    alternatives: ["Ship the showcase as planned (M9 said to, overruled on consent)", "Anonymize the demos (a portfolio of unnamed screenshots sells nothing)"]
  - what: "demo_click is absent from emitted bytes via a vite.resolve.alias component swap, not a render condition"
    why: "Astro bundles any <script> it can see whether or not the markup renders, so {SHOWCASE_ENABLED && <script>} still emitted a demo_click chunk into dist/. Measured, not assumed. Module resolution is the only gate the bundler respects."
    alternatives: ["Conditional render (leaks the chunk)", "Strip in a post-build step (a second system fighting the bundler)"]
  - what: "Pricing copy is the founding-rate framing: $149/mo founding for the first five, $249/mo standing after"
    why: "The $119 tier is retired and 'From $149/mo' undersold the standing price. The gate cross-checks the copy's spelled-out count against FOUNDING_SPOTS_TOTAL through an independent digit-word map, so the constant and the sentence can't drift apart quietly."
    alternatives: ["Keep 'From $149/mo' (reads as a floor, hides the standing rate)", "Publish tiers (there are no tiers)"]
  - what: "Marketing analytics gets its own two events, lead_submit and demo_click"
    why: "Different project, different funnel: nobody phones a website and there's nothing here to book. The doctrine's real rule, exactly the events you'll act on and zero properties, is what carried over, not the event names."
    alternatives: ["Reuse tel_click/booking_click (meaningless on this page)", "More events (a line item on a bill and a thing to maintain)"]
benchmarks:
  - metric: "gate:marketing"
    value: "87/87 (held branch)"
    target: "hermetic against built output; 4 injected defects failed exactly the 4 intended rows"
  - metric: "Lighthouse (marketing build)"
    value: "medians 1.00/1.00/1.00, LCP 1430ms, CLS 0"
    target: "same budget class as client sites, 166KB used of 512KB"
  - metric: "deployed round"
    value: "apex 200 + TLS, www 308 to apex, WAF rule present, lead round-trip in inbox untagged"
    target: "round-trip re-verified from the live domain 2026-08-01"
---

## What shipped

Townwick's own page at https://townwick.com, the venture selling itself with
the same machinery it sells. A small separate Astro app (`apps/marketing`):
hero and offer, how-it-works, care-plan scope, the founding-rate pricing
section, the Northfield angle, a compact FAQ, and a lead form posting to the
same deployed `/api/contact` every client project ships, with the exact field
contract the gate asserts byte-for-byte. Organization JSON-LD with no
deprecated `ProfessionalService`, and the repo's no-`aggregateRating` rule
holds here too. Apex-canonical with www redirecting 308, always-crawl robots, a
sitemap, and a generated og.png carrying the founding tagline.

The shared tooling grew two parameterizations instead of duplicates.
`should-build.sh` gained a `WATCH_SET` of client or marketing, with the unset
branch verified byte-identical to the old behavior, and `create-project.mjs`
gained a `--marketing` mode with the client dry-run payload verified unchanged.

What did *not* ship is the centerpiece the plan called for: the three-demo
showcase.

## Decisions

The showcase hold is the one that matters. It's the same consent line the
phase-2 live gate drew, showing up one layer higher. The page was going to name
CJ's Barbershop, Untamed Salon and Yolks On Us, with screenshots, as our
portfolio. None of them have signed anything. None of them were asked. Putting
a real business on your sales page as a reference before they're a customer is
just the live-gate problem wearing a nicer shirt.

So it ships held, behind `SHOWCASE_ENABLED` in `lib/brand.ts`, default false.
One boolean holds the section, its nav link, its hero CTA and its analytics
event, and flipping it to true the day the first client signs is the entire
re-enable path. The screenshots were captured, optimized and committed before
the question even came up, and they stay committed. They're the re-enable
asset, not scaffolding to tear out.

The other calls are structural. Making marketing a fourth client config would
have meant loosening the client schema (which hard-requires phone, address, geo
and hours) inside gate-protected shared code, to serve a page that isn't a
local business. Reuse is à la carte instead: theme tokens, the Picture and
ContactForm patterns, the OG helpers, and the deployed `/api/contact` verbatim.

## What broke

The bundler leak, again, in a new coat. Holding the showcase behind
`{SHOWCASE_ENABLED && ...}` left `demo_click` bytes in `dist/`, because Astro
bundles scripts it can see, not scripts that render. That's the exact finding
from phase 2's analytics work, re-measured here rather than remembered. The
listener lives in a component pair now, `DemoClickTracker.astro` empty and
`.live.astro` wired, swapped by a `vite.resolve.alias`. The lesson has earned
doctrine status: module resolution is the only gate the bundler respects.

The gate got falsified on purpose, twice. Four injected defects during the
build failed exactly the four rows built to catch them, and later an injected
comment containing "349" tripped the source-scan row that bans every dollar
figure except 149 and 249. A gate row you have never seen fail is a comment
with a `throw` in it. Phase 2 taught that, this round practiced it.

One flake worth recording: the phase-1 gate died once locally with a Windows
`STATUS_STACK_BUFFER_OVERRUN` inside `astro build`, then passed 107/107 on two
reruns and in CI. Filed as weather until it repeats.

## Numbers

Deployed evidence, re-verified from the live domain on 2026-08-01. Apex answers
200 with valid TLS and www redirects 308 to it. `sitemap-index.xml` is 200 and
the robots `Sitemap:` line is present. og.png is 200 at 14KB. The analytics
element is served with the page. The WAF rule `contact-form-rl` verified
present on `townwick-marketing` via `--check`. A live round-trip POST through
`/api/contact` returned `{"ok":true}` and landed in the operator inbox from
`hello@send.townwick.com`, subject untagged by `[DEMO]`, with the founding-rate
copy live on the page it was written for: $149 seven times, $249 once, nothing
else.

I approved the deployed page and ran a copy round, which is where the pricing
reframe above came from, and the `marketing-site` tag closed the milestone on
that approval. Visual judgment is mine, not the models'.

## Next

Phase 4 is billing: the Stripe product and two Prices, founding locked for
tenure and standing after five, the webhook function, and the churn and
monthly-maintenance runbooks. Still open on my side: Forward Email signup, with
DNS values written only from the account page and never from memory, the Web
Analytics dashboard toggle for the marketing project, a Google Places API key,
and stock sets for the two verticals that lack them. And the showcase waits on
a signature.
