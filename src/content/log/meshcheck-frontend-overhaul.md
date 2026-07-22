---
title: "Turning meshcheck's site into the instrument it describes"
date: 2026-07-20
project: "meshcheck"
phase: 7
tags: [astro, css, design-system, responsive, typography]
draft: false
summary: "A visual-only overhaul: one rebuilt stylesheet, a report-card hero, and mobile-overflow fallout fixed with three CSS rules. No markup or islands changed."
repo_ref: "phase-7"
decisions:
  - what: "Near-black field, one signal-cyan accent, a semantic pass/warn/fail triad, one cool-gray ramp"
    why: "Grounded in the subject (a bench instrument) and is the shipped dark-only brief, not a default reached for"
    alternatives: ["warm-cream editorial look", "dual accent colors", "neon accent glow"]
  - what: "Signature element is the readout-bar plus report-card hero"
    why: "The product's real artifact is a machine-readable report card, so the hero renders one"
    alternatives: ["keep the dark-helmet-in-a-dark-box render", "big-number-with-label hero"]
  - what: "System font stacks only, zero web fonts or remote assets"
    why: "Loading no third-party resource is a shipped privacy commitment and a hard build gate"
    alternatives: ["self-hosted display face via @font-face"]
  - what: "Used frontend-design (process), redesign-skill (audit guardrails), taste-skill (pre-flight only); rejected the others in vetting"
    why: "The three fit an Astro plus one-CSS-file stack; the rejected skills assume a component framework or an agency-gloss default that fights authentic devtool fixtures"
    alternatives: ["shadcn (needs a component framework plus Tailwind, violates the one-stylesheet constraint)", "minimalist-skill (pastel surfaces)", "soft-skill (soft shadows and expensive-card chrome)"]
  - what: "Kept a section eyebrow on every section, a deviation from taste-skill's max-one-per-three rule"
    why: "The eyebrows are navigational labels bound to real anchors (#measured, #demo, #agents, #pricing, #privacy), not marketing decoration; monotony is broken structurally with a spec-sheet, a terminal block, and a commitments ledger"
    alternatives: ["cull eyebrows to ceil(sections/3) per the skill"]
  - what: "Prose tables scroll only under a max-width 860px media query"
    why: "Keeps the full-width desktop table layout while stopping wide tables from pushing the 390px viewport"
    alternatives: ["global display:block on tables (regresses desktop tables to content width)"]
benchmarks:
  - metric: "site build plus forbidden-path guard"
    value: "green, exit 0"
    target: "green including guard (stop condition 1)"
  - metric: "route e2e suite"
    value: "15 of 15 passed, tests unmodified"
    target: "15 of 15 green, tests unmodified (stop condition 2)"
  - metric: "external resource origins in site/dist"
    value: "0 (own-domain canonical meta aside)"
    target: "empty external-origin grep (C2, stop condition 3)"
  - metric: "max page horizontal scrollWidth at a 390px viewport"
    value: "390px, down from up to 621px on docs content pages"
    target: "at or under 390px, no mobile overflow"
  - metric: "shared stylesheet size"
    value: "22,495 bytes, up from 13,926 pre-phase-7"
    target: "measured for the page-weight table"
---

## What shipped

The site went from a competent dark SaaS layout to something that reads as the instrument it documents. The whole change lives in one rebuilt stylesheet plus a small report-card component. `global.css` carries a token plan in its header comment, a signal-cyan accent over a near-black measured-grid field, a real type scale driven by weight rather than size, and a repeating "readout bar closed by a ruler tick-strip" motif that ties the hero card, the demo panel, and the terminal blocks into one visual family. The hero now renders an actual report card, with real check IDs and verdict chips, in place of the old render-in-a-box.

Milestone 7.2 carried that system across the remaining surfaces: signup, dashboard, billing success, the docs index and content pages, the docs layout, the cookbooks, and the three legal pages. These pages already referenced the system's class vocabulary, so the work was consistency and fallout, not reinvention. The islands (`AuthForm`, `Dashboard`, `BillingSuccess`) were left frozen; their markup already spoke the token vocabulary. The devlog you are reading is the phase artifact.

## Decisions

The palette was the first thing to lock. A near-black surface with a single accent is one of the common AI looks, and the token-plan self-critique says so plainly. It stayed anyway, because it is the shipped dark-only brief and it comes from the subject, an oscilloscope readout crossed with a printed lab report, rather than being a default. The accent is a desaturated brand cyan and the only other colors are a semantic verdict triad that appears on verdicts alone.

The skill vetting mattered more than usual. Three skills were adopted for their process and guardrails. Several others were rejected on the stack: shadcn would drag in a component framework and Tailwind against a one-stylesheet constraint, and the minimalist and soft skills push pastel surfaces and soft-shadow "expensive card" chrome that would fight the real check IDs, curl snippets, and report JSON the product needs to show. Those fixtures are content here, not decoration, so the taste-skill's ban on them was overridden on purpose.

The most visible deviation is eyebrows. The pre-flight rule caps them at one per three sections. meshcheck keeps one per section because each is a navigational label tied to a real anchor. Monotony is broken with structure instead: one spec-sheet, one terminal block, one commitments ledger, no repeated card wall.

## What broke

Mobile overflow was the real fault. The docs content pages scrolled to 621px wide inside a 390px viewport because the rebuilt `.docs-shell` grid children lacked `min-width: 0`, so a wide code block or table stretched the single mobile column. The cookbooks leaked a few pixels from `white-space: nowrap` inline code. Three CSS rules fixed it: `min-width: 0` on the docs-shell children, `overflow-wrap: break-word` on inline code, and a `display: block` scroll box for prose tables under 860px. After the fix every page measures exactly 390px at that viewport.

One near-miss was worth recording. The privacy page uses the commitments list without a ledger wrapper, and the theory said the new two-column grid would render it wrong. The screenshot showed it rendering as a clean definition list, so the page was left untouched. That was an over-correction the review caught before it became an edit.

The page-weight measurement also hit a transient build crash. Building the pre-phase-7 commit in an isolated worktree failed with `ERR_PACKAGE_IMPORT_NOT_DEFINED: Package import specifier "#module-sync-enabled" is not defined`, a fresh vite resolution against Node 24. Junctioning the main tree's working `node_modules` into the worktree cleared it and produced the before numbers.

## Numbers

Per-page HTML is byte-identical to the start of the phase apart from a shared header and footer shift of about 36 bytes, which confirms 7.2 changed no page markup. The weight moved in the shared stylesheet: 13,926 bytes before the phase, 22,495 after, loaded once and cached. Combined first-load HTML plus CSS by page: home 31,009 to 41,782; pricing 22,069 to 30,653; signup 22,896 to 31,428; dashboard 21,951 to 30,483; billing success 22,115 to 30,648; docs overview 19,767 to 28,299; getting started 25,801 to 34,333; report schema 33,689 to 42,221; cookbook 26,957 to 35,489; privacy 21,602 to 30,136. The route e2e suite stayed at 15 of 15 with no test edits, and the external-origin grep of the built output is empty.

## Next

The next work is not a new phase: phase 6's deferred live gates (email delivery, deploy, live e2e) run once the owner unblocks them, against a deploy that now includes this visual layer. The next visual pass, if any, is a reduced-motion-safe scroll reveal, kept optional and skippable.
