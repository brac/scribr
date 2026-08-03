---
title: "Townwick output quality: the section engine, the toolbox, and motion you can measure"
date: 2026-08-01
project: townwick
phase: 3
tags: [astro, css, motion, research, gates]
draft: false
summary: "Three milestones in one day: page composition becomes config data, six research-derived section types land, and motion ships with its perceptibility measured."
repo_ref: "output-quality-q2b"
decisions:
  - what: "Page composition is an ordered, typed `sections[]` in the config; absent means the exact previous composition, proven byte-identical"
    why: "Research across 34 successful sites found no two share a section order, so the hardcoded five-section page was the deepest source of every-site-looks-the-same. The engine landed with zero visible change, diffed empty twice."
    alternatives: ["Add sections but keep fixed order (doesn't close the gap the research found)", "Per-vertical hardcoded orders (same problem, more copies)"]
  - what: "New sections render ONLY from config data, empty is silence, and the seeds got no new data; the review surface is a persistent FICTIONAL client"
    why: "Team bios, founding years and origin stories are facts, and we don't know them for the real seed businesses. Inventing them for a sales demo is misrepresentation."
    alternatives: ["Enrich seeds with plausible content (fabrication on a pitch artifact)", "Placeholder text in empty sections (the template read the whole program exists to escape)"]
  - what: "The nav label IS the section's resolved heading; rename the roster 'Meet the fam' and the nav link says 'Meet the fam'"
    why: "Q1 derived nav labels independently and a gate row asserted it, but Q2's research said authorable headings carry voice, and a nav that disagrees with its own heading is a bug. The Q1 row was inverted as a dated decision."
    alternatives: ["Fixed nav labels (heading and nav drift apart)", "Separate nav-label config field (two names for one thing)"]
  - what: "Motion is the third per-variant personality axis, on a hard property allowlist, with scroll-reveal INVERTED from every platform studied"
    why: "Ours ships HTML visible by default and a synchronous script opts into hiding only when an observer exists and reduced motion is off, so script failure can never blank a page. Every platform studied does the opposite."
    alternatives: ["A motion library (weight without evidence of value)", "Platform-style opacity-0-in-HTML (blank page when JS fails)", "No motion (the research found real cheap wins)"]
  - what: "Press feedback is a JS-driven .is-pressed class; :active is only a fallback"
    why: "My phone found every press state dead. :active is unreliable in iOS browser wrappers and Mobile Safari won't fire it on non-interactive elements without a touchstart listener. A delegated pointer listener works everywhere the same way."
    alternatives: [":active + touchstart enabler alone (dead on the exact device class customers use)", "No touch feedback (hover-only motion is invisible on phones)"]
benchmarks:
  - metric: "seed identity across the engine refactor"
    value: "3/3 seeds, normalized diff EMPTY"
    target: "verified independently at review, both milestones that promised it"
  - metric: "gates"
    value: "sections 30/30, sections-q2 108/108, motion 99/99"
    target: "every negative row driven to FAIL before trust; reviewer re-falsified independently each round"
  - metric: "LCP with the motion layer"
    value: "median 83ms to 66ms (17ms faster)"
    target: "no worse than +100ms; the LCP element is never animated"
  - metric: "reveal perceptibility (the taste fix, made measurable)"
    value: "7-8 of 9 sections mid-transition at 30% visibility, at 800/1000/1200 px/s"
    target: "committed metric script, not a session vibe"
---

## What shipped

Three milestones closed in one day, all downstream of one complaint: the three
demo sites were structurally identical. Same sections, same order, same
headings. Only the colors, fonts, words and pictures changed.

**Q1, the section engine.** Composition became config data, an ordered typed
`sections[]` with per-section heading overrides, validation rules that report
per index, and a registry the page iterates. Zero visible change, and that was
the gate: absent config equals the exact old page, byte for byte.

**Q2, the universal toolbox.** Six section types straight off the research's
load-bearing list (team, story, proof band, FAQ, policies, closing CTA) plus
the specificity fields: founded year in the hero eyebrow and the JSON-LD, a
one-line language note, a walk-ins line, a secondary CTA slot. And the review
surface, Fern & Fade, a fictional Minneapolis barbershop with a plant counter,
five invented barbers with nicknames, house rules with attitude, and not one
claim about a real business.

**Q2b, the motion layer.** Per-variant transition tokens (classic measured,
bold snappy, warm soft), hover lifts and image zooms, animated underlines, a
condensing header, a hero cascade that never touches the LCP element, and a
config-gated scroll reveal. About 1.5KB of CSS and three tiny inline scripts,
zero libraries.

## Decisions

The research is what earned most of these. Three Opus agents read 34 successful
sites for structure and copy, and a fourth read 14 of their stylesheets and
scripts for motion. Two headlines came back, both counterintuitive.

The first: named humans and operational refusals beat design budgets. An
objectively dated Vermont diner site out-reals a Webflow showpiece on the
strength of one paragraph about elbow-worn 1948 countertops. The second: the
"juice" on successful sites is mostly platform defaults, dead library weight,
or in one case a 1.4MB GIF, while three of the six best salons ship scroll
animations deliberately off. The full corpus is committed under
`plans/research-output-quality/`.

So motion went in on a hard property allowlist, and the scroll reveal is
inverted from every platform in the corpus. They all hide content in the HTML
and let JS reveal it, which means a script failure gives you a blank page. Ours
ships visible and a synchronous script opts into hiding, only when an observer
exists and reduced motion is off. Also worth noting: exactly 1 of the 14 sites
studied honors `prefers-reduced-motion`. Our global kill switch predates this
milestone.

The section content rule is the one with teeth. New sections render only from
config data, and empty means silence rather than placeholder text. The seeds
got no new data, because team bios and founding years are facts and we don't
know them for the real businesses. Making them up for a sales demo is
misrepresentation, full stop. That's why the review surface is a fictional shop
with a 555-01xx phone and example.com URLs, so I can look at the real product
on a real phone without a single claim about a real business.

## What broke

The taste loop earned its rounds. The reveal shipped popping (late trigger,
short travel), got "fixed" into imperceptibility (edge trigger, short travel),
and only landed on the third pass once the reference site's actual lesson was
read correctly: lateness is fine when the travel is long enough to watch. The
fix that stuck was turning perceptibility into a number, sections sampled
mid-scroll in Playwright WebKit at phone speeds, instead of a hope.

That same rig caught what source review couldn't. The reveal's stagger
selectors carried enough specificity to pin card transforms and silently
swallow every hover and press state, fixed with `:where()` and a specificity
gate row. A stray semicolon had voided a whole rule. And the gate's own D3
regex ran past closing braces on unsemicoloned declarations. Separately,
Lighthouse on the showcase surfaced an aria-prohibited-attr bug that had been
latent since phase 0, because no committed client had ever rendered a manual
review, so the branch had never existed in a built page.

And my phone falsified two rounds of desktop-verified work. Hover states are
invisible on the device class that actually matters, and `:active` is a fiction
in iOS browser wrappers (my Firefox is a WKWebView). Both fixes got proven with
synthetic touch and printed computed styles rather than re-eyeballed.

## Numbers

Identity: three seeds, empty normalized diffs across the engine refactor,
re-proven independently at review. Gates: 30 plus 108 plus 99 rows, every
negative row driven to fire at least twice, once by the implementer's harness
and once by the reviewer's own injections, which included proving that an
uncommitted marker file survives a failing gate run. LCP went *down* 17ms with
the motion layer on.

The inline-script budget's honest history: 700B target, then 787, then 853,
then 1351B actual, each revision dated and argued. The jump is the press
listener replacing a mechanism that provably does not work on iPhones.

## Next

Q3 is hero layout variants, the research's text-only voice hero and the
full-bleed overlay, plus the per-vertical kits: named menus and a
signature-dish spotlight for restaurants, the new-guest flow for salons, and
the remaining barbershop specifics. Then Q4, intake, which is the questions
that get real clients' real facts into the sections this toolbox now renders.
