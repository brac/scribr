---
title: "Designing scribr as an engineering record: title blocks, OG cards, and a Windows Lighthouse detour"
date: 2026-07-13
project: scribr
phase: 3
tags: [design, fonts, lighthouse, open-graph, astro]
draft: true
repo_ref: "phase-3"
summary: "Phase 3 gives scribr its look — a lab-record aesthetic built on a title block — plus per-post OG cards and a green Lighthouse gate that fought Windows the whole way."
decisions:
  - what: "Render every post as an engineering record with a bordered title-block metadata grid under the h1"
    why: "scribr posts ARE phase artifacts — project/phase/date/repo_ref is real structured metadata, so encoding it as an engineering-drawing title block makes the layout mean something instead of decorating it"
    alternatives: ["A conventional blog header (loose date + tag pills)", "A card grid with cover images"]
  - what: "Set h1 and all labels/data in IBM Plex Mono 600; body in Source Serif 4"
    why: "A machine-scribed display face is the deliberate aesthetic risk — the record reads as instrument output — while a real long-form serif keeps the prose comfortable at a 68ch measure"
    alternatives: ["A single humanist sans for everything", "Mono body (unreadable at length)"]
  - what: "Treat --pass/--broke as semantic-only: benchmark gate checks and the 'What broke' section rule, never decoration"
    why: "Colour that only ever marks pass/fail keeps the record honest; a green ✓ per benchmark row records a gate that was met by contract, and the red rule flags the failure section without a word"
    alternatives: ["A brand accent gradient", "Computing met/failed by parsing mixed comparators (<, ≤, >=) — too brittle"]
  - what: "Generate OG images with astro-og-canvas (CanvasKit WASM), not satori"
    why: "CanvasKit renders identically on Windows dev and Linux CI, accepts the same committed TTFs the site self-hosts, and its rest-param route shape sidesteps the trailing-slash endpoint bug entirely"
    alternatives: ["satori/@vercel/og (needs its own font pipeline, different text metrics)", "Pre-rendered static images (no per-post automation)"]
  - what: "Subset the committed TTFs to Latin plus the ~10 symbols actually used"
    why: "The full faces were 988 KB; forced onto the critical path they put LCP at 6.2s and sank Performance to 78. Subsetting to 311 KB (and dropping mono hinting) is the difference between a failing and a passing perf gate"
    alternatives: ["Ship the full TTFs", "Preload nothing and accept a 2s blank first paint"]
  - what: "Drive Lighthouse via its Node API against a self-launched Chromium instead of `lhci autorun`"
    why: "On Windows, chrome-launcher cannot remove its temp profile dir during teardown (Chromium holds a lock) and the EPERM crashes the run AFTER results are computed; owning the Chromium process avoids that code path entirely while keeping lighthouserc.cjs as the source of truth"
    alternatives: ["lhci autorun (crashes on Windows teardown)", "A system Chrome install (non-deterministic across machines/CI)"]
benchmarks:
  - metric: "Lighthouse /log/ (median of 3)"
    value: "perf 96, a11y 100, best-practices 100, seo 100"
    target: "≥ 95 all four categories"
  - metric: "Lighthouse post page (median of 3)"
    value: "perf 97, a11y 100, best-practices 100, seo 100"
    target: "≥ 95 all four categories"
  - metric: "global stylesheet"
    value: "6.3 KB shipped (9.5 KB raw with comments)"
    target: "lean, < ~8 KB"
  - metric: "self-hosted fonts after subsetting"
    value: "311 KB across 5 TTFs (from 988 KB)"
    target: "small enough to keep LCP ≥ 0.9"
  - metric: "OG cards generated"
    value: "2 (log.png 21 KB, particlr-spatial-hash.png 63 KB); 0 drafts"
    target: "exactly {published posts} ∪ {log}, no draft leak"
  - metric: "astro build"
    value: "12 pages + 9 feeds + 2 OG cards + sitemap in ~2.7s"
    target: "exit 0"
---

## What shipped

Phase 3 is the design pass. scribr now looks like what it is — a lab notebook of
build phases — and the load-bearing element is a **title block**: the bordered
metadata grid from engineering drawings, sitting directly under each post's h1
and carrying `PROJECT ▸ particlr`, `PHASE 05`, `DATE`, and `REF` as real cells.
field-notes posts drop the PHASE and REF cells; their absence is the
differentiation, no special styling required.

The type is the risk: h1 and every label render in IBM Plex Mono 600, body in
Source Serif 4 at a 68ch measure. Colour is semantic only — a green `✓` per
benchmark row (a record of gates met), a red rule on the "What broke" section,
underline-on-hover shifts to green, and nothing else. The whole system is one
~6 KB stylesheet with light and dark tokens driven by `prefers-color-scheme`,
plus a ten-line inline normalize. No framework, no JS added anywhere.

Two more pieces landed: per-post Open Graph cards rendered at build by
astro-og-canvas (dark scheme, the `--pass` accent as a bottom rule, the same
committed TTFs feeding both the site and the cards), and the platform bump to
Astro 7.0.8 — which let the Phase 1 feed workaround retire (see below).

## Decisions

The title block is the whole idea, so everything else follows from it: the
tables are `--panel`-filled with mono headers and captions, the index entries
lead with a mono metadata line above a serif title, and the project pages get a
title-block-style header strip. The engineering-record framing is what makes
those choices cohere rather than read as arbitrary.

The Lighthouse decision was forced by the platform (below), but it's the one I'd
flag for anyone building on Windows: `lhci autorun` is the documented path, and
it does run — it just can't survive its own Chromium teardown here. Driving
Lighthouse's Node API against a Chromium I launch and kill myself keeps the gate
declarative (URLs and thresholds still live in `lighthouserc.cjs`) without
inheriting chrome-launcher's cleanup.

## What broke

Two things, both in the perf gate.

First, fonts. The committed TTFs are ~988 KB, and preloading the two primary
faces put every byte on the critical path. Under Lighthouse's default mobile
throttling the largest paragraph didn't paint until the serif font arrived — LCP
6.2s, Performance 78, a hard fail. The fix was to subset each face with
fontTools to Latin plus the exact symbols in use (`▸ ✓ ≤ → · © ² —` and the
smart quotes markdown emits), dropping TrueType hinting on the mono faces. That
took the total to 311 KB and Performance to 96–97. I verified the OG cards still
render `O(n²)` and the em dash with no tofu after subsetting — the family names
in the `name` table had to survive so CanvasKit could still match the SemiBold
face.

Second, Windows. `lhci autorun` computed all categories cleanly, then crashed in
chrome-launcher's `destroyTmp`: `EPERM` removing `Temp/lighthouse.XXXX`, because
a lingering Chromium child still held the profile lock. Pointing Chrome at a
profile dir I owned (via `--user-data-dir`) didn't help — Chromium locked its
own temp dir regardless. The resolution was to stop letting lighthouse launch
Chrome at all: launch Playwright's Chromium myself with a remote-debugging port,
connect the Lighthouse Node API to it, and clean up on my own terms.

## Numbers

Measured on this machine (Node 24, Windows 11). Lighthouse medians of three runs:
`/log/` scored 96 / 100 / 100 / 100 and the post page 97 / 100 / 100 / 100
(performance / accessibility / best-practices / SEO), every category clearing
the 95 gate. The stylesheet is 6.3 KB shipped. Fonts total 311 KB across five
subsetted TTFs, down from 988 KB. The build emits 12 pages, 9 feeds, 2 OG cards,
and the sitemap in ~2.7s; `dist/og/` contains exactly the one published post's
card plus `log.png`, with the drafts correctly absent.

The feed workaround retirement was clean: Astro 7.0.8 fixes the trailing-slash
extension-endpoint miscompile, so the plan-original dynamic
`src/pages/log/[project]/rss.xml.ts` builds all eight feeds at the same URLs.
The `injectRoute` integration and its shared endpoint are gone, feed validation
passes unchanged, and the config is simpler for it.

## Next

Phase 4 is the demo islands — the PixiJS-backed interactive pieces that some
posts will embed — which is the first time this site ships meaningful client JS
beyond the filter chips. The zero-`<script`-on-post invariant the meta audit now
enforces will need a deliberate, scoped exception there.
