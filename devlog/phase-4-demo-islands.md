---
title: "Embedding a live particlr demo without taxing every other page"
date: 2026-07-13
project: scribr
phase: 4
tags: [islands, pixijs, performance, accessibility, mdx]
draft: true
repo_ref: "phase-4"
summary: "Phase 4 drops a live PixiJS particle demo into the seed post as a lazy Preact island — 283 KB gzipped that only loads on scroll — and fixes the font strategy the LCP gate exposed."
decisions:
  - what: "Let the island own the Pixi Application, ticker, and teardown; load pixi + @particlr/runtime only via dynamic import inside useEffect"
    why: "The runtime is host-driven (no mount-on-canvas factory), and dynamic imports keep the ~283 KB graph out of SSR and out of every other page's chunk graph — the figure ships as an inert shell until it scrolls into view"
    alternatives: ["A static import at module top (pulls pixi into the SSR eval and the island's eager chunk)", "A prebuilt canvas-recording GIF (no live runtime, larger bytes, no reduced-motion story)"]
  - what: "Vendor ember-field.prt as a ?raw string inlined into the island chunk, not a fetched asset"
    why: "Presets aren't published to npm and the runtime carries zero network capability by design; a 7 KB raw import is one fewer request and keeps the preset versioned in-repo"
    alternatives: ["fetch() the .prt at runtime (adds a request, and the runtime deliberately has no fetch)", "Depend on a presets package (doesn't exist)"]
  - what: "Reduced motion renders a deterministic static poster with an explicit ▶ play opt-in, not an auto-playing animation"
    why: "WCAG 2.2.2 — auto-moving content needs a control; stepping the sim 90 frames and painting one frame gives a populated image with zero ongoing rAF, and the button lets a user override the media query on intent"
    alternatives: ["Hide the demo entirely under reduced motion (loses the artifact)", "Autoplay regardless (accessibility fail)"]
  - what: "Gate headless fps at >= 50 and record the measured number, rather than asserting the 60fps target literally"
    why: "Headless Chromium renders through SwiftShader (software GL) below real-GPU rates; a hard 60 would flake on the harness while proving nothing — the measured value (60.0 here) goes in the record"
    alternatives: ["Assert 60 (flakes under SwiftShader)", "Skip fps entirely (loses the regression signal)"]
  - what: "Serve WOFF2 to browsers (woff2 first in each variant's src) while keeping the committed TTFs for og-canvas; inline the stylesheet; preload only the above-the-fold faces"
    why: "The LCP <= 1500ms gate exposed the phase-3 font strategy: 311 KB of preloaded TTFs put every page at 2.5-2.7s simulated LCP. WOFF2 is 113 KB for the same subsets, inlining the 7.5 KB stylesheet removes the only render-blocking request, and dropping serif italic/semibold from the preload set removes ~60 KB of critical-path contention"
    alternatives: ["Keep TTFs and relax the LCP ceiling (rejected in review)", "WOFF2-only (breaks og-canvas, which needs TTF)", "font-display: optional (titles could permanently render in fallback)"]
  - what: "Hydrate the /log/ filter chips with a custom client:lazyidle directive (load event + double-rAF + idle) instead of client:idle"
    why: "Lighthouse's Lantern model puts every request that starts before the observed LCP into the pessimistic LCP graph; plain client:idle raced the font-swap paint and randomly added ~300ms of simulated LCP to /log/. Deferring hydration until after the first paints are committed is honest (the chips are server-rendered enhancement) and makes the number deterministic"
    alternatives: ["client:idle (nondeterministic 1353-1802ms LCP)", "modulepreload injection for the island graph (shortens the chain but keeps it inside the LCP window)", "No hydration (loses filtering)"]
benchmarks:
  - metric: "island chunk graph (gzipped)"
    value: "283 KB across 25 chunks; 277 KB is pixi/runtime-only (not shared with the chips island)"
    target: "loads only on the demo post, only on scroll"
  - metric: "sustained fps, 30s headless run"
    value: "60.0 fps, 0 console errors"
    target: ">= 50 sustained (SwiftShader)"
  - metric: "reduced-motion rAF over a 2s window"
    value: "0 frames (static poster, all Pixi tickers stopped)"
    target: "exactly 0"
  - metric: "LCP, three URLs (Lighthouse simulated mobile, median of 3)"
    value: "/log/ 1354ms · demo post 1353ms · field-note 1204ms (CLS 0.000 on all)"
    target: "<= 1500ms each; island must not regress the fold's paint"
  - metric: "webfonts shipped to browsers"
    value: "113 KB WOFF2 across 5 faces (from 311 KB TTF; TTFs kept for og-canvas)"
    target: "same subsets, no tofu, CLS 0"
  - metric: "Lighthouse, three URLs (median of 3)"
    value: "perf 100, a11y 100, best-practices 100, seo 100 — all three URLs"
    target: ">= 95 all categories, all three URLs"
---

## What shipped

The seed post is now MDX, and the end of its "Numbers" section carries a live
`ember-field` particle demo: a `<figure>` with a 16/9 canvas and a mono caption
(`demo ▸ ember-field`) beside a pause/play button. It renders on the current
`@particlr/runtime@0.4.2` build over `pixi.js@8.19.0`, seeded at 1337 for
deterministic playback.

The whole thing is a Preact island hydrated `client:visible`. Its shell — the
figure, caption, and a disabled button — server-renders with zero cost; every
pixi and runtime import is a dynamic `import()` inside `useEffect`, so the heavy
graph resolves only when the figure scrolls into view. The runtime is
host-driven, so the island owns the pieces itself: it creates the `Application`,
parses the preset, builds an `Effect` + `PixiParticleRenderer`, awaits the
renderer's textures, drives `fx.step()` / `view.sync()` from the ticker, and
tears down in the required order (`view.destroy()` then
`app.destroy(true, { children: true })`) on unmount.

A second published post landed too — a short `field-notes` note on what this log
is and how it gets written — because the "post without demos" gates need a
published non-demo page once the only published post becomes the demo post.

The zero-`<script>`-on-posts invariant from Phase 3 got a scoped exception: a
post carrying an `<astro-island>` may inline the two small hydration bootstraps,
but must still ship no external `<script src=>` and no `modulepreload`. The
field-note post keeps the strict zero-script check alive for the non-demo case.

The phase's LCP gate (<= 1500ms simulated mobile on all three URLs) forced a
font-strategy overhaul that Phase 3 had left on the table: browsers now get
WOFF2 (113 KB across five faces, generated by `scripts/fonts-woff2.mjs` from
the committed subsetted TTFs, which og-canvas keeps consuming directly), the
stylesheet is inlined, only the above-the-fold faces are preloaded, and the
`/log/` filter chips hydrate through a new `client:lazyidle` directive that
waits for the first paints to commit.

## Decisions

The isolation is the point, and it comes for free from Astro's island model plus
dynamic imports: only the demo post's HTML references the `ParticlrDemo` and
`pixi` chunks, and only preact-core (three chunks) is shared with the filter-chips
island — the 277 KB of pixi/runtime bytes are loaded by nothing else. No
`manualChunks` config was needed.

Reduced motion was the interesting design call. Rather than hide the demo, it
advances the simulation deterministically (90 steps at 1/60) and paints a single
populated frame, then stops the ticker — a still image of the effect, no motion.
The caption button reads `▶ play`, and pressing it starts the ticker (explicit
intent overriding the media query). In motion mode the same button is the
WCAG-required pause control.

## What broke

The reduced-motion "zero rAF" assertion failed at first, and the reason was
non-obvious. Stopping `app.ticker` left the poster frame correct and the button
reading `▶ play` — yet a rAF counter showed a steady 60 frames/second. Instrumenting
the tickers showed `app.ticker.started: false` but `Ticker.system.started: true`
with a live request id. Pixi keeps a *global* system ticker (pointer-event
polling, `autoStart = true`) independent of the app ticker; it schedules
`requestAnimationFrame` forever regardless of whether anything renders. The fix:
in poster mode, also stop `Ticker.system` and `Ticker.shared`. A later pointer-over
can restart the system ticker for event polling, but that's still zero rendering
because the app ticker stays stopped until the user presses play.

A smaller trap was in the e2e request filter. The "did pixi load?" check matched
request URLs against `/pixi|particlr/i` — which also matches the demo post's own
URL (`…/log/particlr-spatial-hash/`). The navigation document self-matched and
looked like a leaked pixi byte. Excluding `resourceType === "document"` fixed it.

The LCP gate was the long fight, in three rounds. Round one: the baseline
measured ~2.55–2.70s on *every* page, demo and non-demo alike — the demo post
landed at 2553ms, identical to the millisecond with the plain field-note post,
proving the island adds 0ms (it's below the fold and lazy). The real cost was
the Phase 3 font strategy: five preloaded TTFs (311 KB) feeding a serif-text
LCP under Lantern's simulated slow-4G. Serving WOFF2 instead (113 KB, same
subsets, TTFs kept for og-canvas) took every category to 100 and LCP to
1653–1802ms. Still short. Round two: trimming serif italic/semibold out of the
preload set (~60 KB off the critical path) and inlining the 7.5 KB stylesheet
(the only render-blocking request) got the post pages to 1353/1203ms — but
inlining initially *worsened* the demo post, because the gate's static server
served uncompressed bytes and the 21.5 KB raw HTML spilled across extra
simulated TCP windows. Production always compresses, so the gate server now
gzips — a fidelity fix, not a cheat. Round three: `/log/` alone still swung
1353↔1802ms between runs. Lighthouse's pessimistic LCP graph includes every
request that *starts* before the observed LCP, and the filter chips'
`client:idle` hydration raced the font-swap paint — sometimes its five JS
chunks landed inside the LCP window, sometimes not. The fix is a custom
`client:lazyidle` directive (hydrate after load + double-rAF + idle): the
chips are server-rendered enhancement either way, and deferring the fetch past
the first paints makes `/log/` a deterministic 1354ms. All three URLs now
clear the 1500ms ceiling with CLS 0.000 — the size-adjusted fallback faces
absorb the swap without a shift.

## Numbers

Measured on this machine (Node 24, Windows 11). The island chunk graph is 25
chunks totalling 940 KB raw / 283 KB gzipped; 22 of those (927 KB / 277 KB gz)
are pixi/runtime-only, shared with no other page, and only preact-core crosses
over to the chips island. The demo post's built HTML carries exactly one
`<astro-island component-url="…/ParticlrDemo…js">`, no external script, no
modulepreload; the field-note post carries zero scripts.

The 30-second headless run held 60.0 fps with zero console errors and zero page
errors. Under reduced-motion emulation the poster frame produced exactly zero rAF
over a 2-second window after settling, with the `▶ play` control present.

Lighthouse medians of three runs, every category 100 / 100 / 100 / 100
(performance / accessibility / best-practices / SEO) on all three URLs. LCP:
`/log/` 1354ms, demo post 1353ms, field-note post 1204ms — all under the
1500ms ceiling, CLS 0.000 everywhere, TBT 0ms on the two index-adjacent pages.
Fonts shipped to browsers total 113 KB WOFF2 (from 311 KB TTF); the demo
island's contribution to LCP is unmeasurable because it never touches the
fold.

The vendored `ember-field.prt` (6961 bytes) is byte-identical to the particlr
repo's copy.

## Next

Phase 5 is deployment. The Lighthouse gate's static server now mirrors
production compression, but the real CDN (and its HTTP/2 prioritization) is
the thing to verify once the site is live — re-run the LCP numbers against the
deployed origin before trusting them.
