---
title: "Townwick trust round: what a real prospect's questions turned into code"
date: 2026-08-01
project: townwick
phase: 3
tags: [copy, export, verification, stock-labeling, gates]
draft: false
summary: "One prospect conversation turned into five FAQ answers, a shorter term, and the pipeline code that makes each answer true: an exit bundle and a verify gate."
repo_ref: "trust-1"
decisions:
  - what: "The term is now a 90-day trial, then a year at a time, built from constants in brand.ts"
    why: "A year-long minimum was the single scariest sentence on the page for a first-client conversation. The trust gate greps marketing source and dist for the old twelve-month phrasing so it can't come back as a stray sentence."
    alternatives: ["Keep twelve months (the objection the feedback surfaced)", "No minimum at all (a trial has to end somewhere or the deal has no shape)"]
  - what: "Every trust answer on the page ships with the pipeline code that makes it true, in the same milestone"
    why: "The page says I'll hand over a complete copy of the site on request. That's only honest if the command exists, so `pnpm export <slug>` shipped alongside it and the gate unzips the result in a temp dir to check a stranger could host it."
    alternatives: ["Publish the promise now, build the command later (the exact gap this whole product argues against)"]
  - what: "`pnpm verify <slug>`: every phone, price, time, year and proper noun on the built page must trace to config, the reviews snapshot, or the theme's template lexicon"
    why: "The deepest fear the conversation surfaced was the site saying something about the business that nobody at the business said. Entity-class extraction makes that a checked property instead of a promise."
    alternatives: ["Full-text subtraction (stronger, but fails on every template tweak everywhere)", "Trust the personalization prompts' rules alone (rules without a gate are comments)"]
  - what: "B2 (per-staff booking) shipped as documentation plus proof, NOT as the brief's literal `booking.staff:` list"
    why: "team.members[].bookingUrl already renders per-person buttons. A second people-list under booking would be a second source of truth for names, which is precisely the disease pnpm verify exists to cure."
    alternatives: ["Add booking.staff as specified (two lists of people that can disagree)", "Alias it to team.members (magic nobody can predict from the YAML)"]
  - what: "Demo-mode stock labeling is keyed on `demo && asset.placeholder`, and the footer's stand-ins line only renders when the page actually uses stock"
    why: "A demo built from a shop's real photos must not go around claiming those photos are fake. Both negatives are gate rows: a live build carries zero tag bytes, and a demo with no placeholder flags carries neither tag nor stand-ins line."
    alternatives: ["CSS-content tag (text ships in live CSS bytes)", "Tag whenever demo (lies in the other direction on real-photo demos)"]
benchmarks:
  - metric: "gates"
    value: "trust 82/82; every prior gate green and unedited (phase-0 18, phase-1 107, phase-2 67, phase-3 81, sections 30, q2 108, motion 110, q3a 87, q3b 123, marketing 87, c1 68, c4 107)"
    target: "c2/c3 verified after commit, since they're structurally red on a dirty tree"
  - metric: "verify across the fleet"
    value: "6/6 clients trace clean; 4/4 planted facts each fail with the planted value listed"
    target: "the negative rows are the feature"
  - metric: "exit bundle"
    value: "cjs-barbershop, 12.0 MB zip, 108 entries, opens from disk, zero repo references"
    target: "usable by a web person who has never heard of Townwick"
---

## What shipped

A prospect I'll call Rosie asked a list of questions the page had no answer to.
What happens if you get bored. Do I keep the site. Do you take my Google
listing hostage. Do my staff lose their Booksy pages. How do I know the site
won't say something about us that nobody said.

Five of those became FAQ answers. The part that matters is that each answer
shipped with the code that makes it true, in the same milestone
(`plans/trust-1.md`), with one new dependency (fflate, zero transitive) and one
new gate wired into CI.

`pnpm export <slug>` produces a zip with a README that lets a stranger host the
site with zero repo access. `pnpm verify <slug>` walks the built page and
requires every phone number, price, time, year and proper noun to trace back to
config, the reviews snapshot, or the theme's enumerated template lexicon.
Anything it can't trace fails the build with a listing of what it found.
Demo-mode stock labeling puts a corner tag on placeholder images and a
stand-ins line in the footer. Per-staff booking got proven rather than built,
which I'll come back to.

The term changed too: 90-day trial, then a year at a time, built from
`TRIAL_MONTHS` in brand.ts the same way founding spots build from
`FOUNDING_SPOTS_TOTAL`.

## Decisions

The rule this round ran on is simple. Don't publish a promise before the thing
that makes it true exists. The page now says I'll hand over a complete copy of
the site on request, and that sentence is only honest because `pnpm export`
landed in the same commit range. Publishing the promise now and building the
command later is exactly the gap this whole product argues against.

`pnpm verify` is the one I'm proudest of. The deepest fear the conversation
surfaced wasn't price or lock-in, it was the site saying something about the
business that nobody at the business said. Entity-class extraction against a
maintained template lexicon turns "nothing reaches a page that nobody wrote"
into a checked property. Four falsification rows plant a fake name, price, time
and phone, and each asserts the verifier names the exact planted value. It also
emits the owner read-through checklist that the go-live runbook now requires
before we touch DNS.

The term call was mine from the feedback round: three months to start, then we
talk. The other rulings from that round were pricing unchanged at $149 founding
and $249 standing, a $200 flat refresh shoot that lives in docs/05 only (the
page still says "a flat fee we agree on first", and the marketing gate still
allows exactly two dollar figures anywhere on it), and edits within two
business days, which overrides the brief's next-evening default.

## What broke

Nothing broke in the running-code sense, but one item shipped deliberately
off-spec and I'd rather have it on the record than buried.

B2 in the brief asked for a literal `booking.staff:` list. I didn't build it.
`team.members[].bookingUrl` with a business-level fallback has been rendering
per-person `Book with <name>` buttons since output-quality-q2, and adding a
second people-list under booking would create a second source of truth for
staff names, which is precisely the disease `pnpm verify` exists to cure. So B2
shipped as documentation plus proof: the gate proves three staff on three
distinct URLs render three distinct buttons, proves the fallback works, and
proves the strict schema *rejects* a `booking.staff` key instead of silently
stripping it. Deviating from a written brief is fine. Deviating quietly is not.

The stock-labeling negatives were the other place I had to stop and think. The
tag lives in `Picture.astro` because there's no second way an image reaches a
page, and it's keyed on `demo && asset.placeholder` rather than just `demo`.
Both negatives are gate rows: a live build of the same client carries zero tag
bytes, and a demo whose manifest has no placeholder flags carries neither the
tag nor the stand-ins line. A demo built from a shop's real photos must not go
around claiming those photos are fake.

## Numbers

Trust gate is 82/82, and every prior gate is green and unedited: phase-0 18,
phase-1 107, phase-2 67, phase-3 81, sections 30, q2 108, motion 110, q3a 87,
q3b 123, marketing 87, c1 68, c4 107. c2 and c3 get verified after the commit,
since they're structurally red on a dirty tree.

`pnpm verify` runs clean across all 6 clients in the fleet, and all 4 planted
facts fail with the planted value named in the output. The negative rows are
the feature here. A verifier that has never caught a plant is decoration.

The exit bundle for cjs-barbershop comes out at 12.0 MB and 108 entries, opens
from disk, and has zero repo references anywhere in it.

## Next

The marketing page is built but not deployed. A push to main deploys it, so
that push waits on my read of the diff. After that it's phase 4, billing, which
is the last numbered phase in docs/06.
