---
title: "Testing our own pitch: a pre-registered study of meshcheck-gated generation"
date: 2026-07-21
project: "meshcheck"
phase: 8
tags: [study, tripo, validation, pre-registration]
draft: false
summary: "We pre-registered three criteria, ran 15 prompts through 3 arms against Tripo, and our marketing claim failed its own test."
repo_ref: "qs-m4"
decisions:
  - what: "Run the quality study before any further payment work"
    why: "No point verifying billing for a claim that might not survive measurement"
    alternatives: ["payment verification first (original launch order)", "both in parallel"]
  - what: "Pre-registered criteria (v2.1) locked before any study data, amendments dated and pre-data"
    why: "The honest-failure clause only means something if the thresholds can't move after the data lands"
    alternatives: ["exploratory analysis after the run"]
  - what: "trimesh 4.12.2 as the primary independent instrument"
    why: "Only instrument that discriminated generator output in research; gltf-validator scored a defective wild mesh clean"
    alternatives: ["gltf-validator primary", "headless Blender battery", "pooled multi-instrument score"]
  - what: "face_limit and smart_low_poly declared mutually exclusive in the arm-C feedback table"
    why: "The pair crashes Tripo v3.1-20260211 deterministically (error 1004, 3/3); every other reachable lever set succeeds"
    alternatives: ["drop the TOP lever entirely", "retry-and-hope"]
  - what: "Seeds treated as labels, not reproducibility levers"
    why: "Identical params + identical seeds produced measurably different models (8k face delta, different defect profile)"
    alternatives: ["trust Tripo's documented 'identical models' claim"]
  - what: "Launch copy pivots to unattended acceptance + triage; no quality-multiplier claim ships"
    why: "P2 failed 3/15 against a 50% threshold; the honest-failure clause is the product decision"
    alternatives: ["re-run with a looser budget profile", "ship the claim on P1 alone"]
  - what: "Passive mode after close-out"
    why: "The subscription-justifying claim did not survive; burn is near zero, so the option stays open without further investment"
    alternatives: ["marketing runway on the triage pitch", "sunset"]
benchmarks:
  - metric: "P1: median trimesh finding count (accepted asset per arm)"
    value: "A 43,576 · B 41,262 · C 13,634"
    target: "C < A and C < B (pre-registered), PASS"
  - metric: "P2: blind pairwise C vs B, preferred-or-tie"
    value: "3 of 15 (20%); B preferred 12/15"
    target: ">= 50% (pre-registered), FAIL"
  - metric: "P3: Tripo credits per accepted asset"
    value: "C 40 vs B 60 (ratio 0.67)"
    target: "<= 1.25x B (pre-registered), PASS"
  - metric: "Raw generations violating the pc triangle budget on first attempt"
    value: "44 of 45"
    target: "none; this is the measured market fact the pitch now rests on"
  - metric: "Arm C acceptance"
    value: "15/15 accepted, every cell in exactly 2 attempts"
    target: "K=3 cap never hit"
  - metric: "Study cost"
    value: "~2,400 Tripo credits (~$24) + 186 meshcheck credits, all-in incl. probe and crash waste"
    target: "design-doc estimate $45–85, revised to $21–30 after research"
  - metric: "wasm/native parity after meshopt fix"
    value: "33/33 byte-identical"
    target: "no divergence with the new corpus fixture"
---

## What shipped

A pre-registered three-arm study of the product's own core claim, and the
result, which didn't go my way.

Arm A: one ungated generation per prompt. Arm B: blind best-of-3,
human-picked. Arm C: a meshcheck-gated loop. Generate, validate against the
`pc` profile, map failing check families to Tripo parameters, retry up to K=3.
Fifteen prompts across five categories, all against production meshcheck and
pinned Tripo `v3.1-20260211`.

Alongside the study: the probe that froze its config (six questions, every
answer measured, five of them contradicting Tripo's docs), a deterministic
analysis script that unblinds the judge verdicts and writes RESULTS.md, and a
core fix for meshopt. A GLB requiring `EXT_meshopt_compression` used to
produce SPEC-002 *plus fabricated geometry*, 799 triangles reported against
4,212 real. Geometry-dependent checks now degrade to `skipped` with a
structured reason instead of wrong numbers.

## Decisions

The important one was made before any data existed: three pass/fail criteria,
thresholds locked, and a standing rule that a failing criterion gets reported,
not renegotiated.

Two amendments were locked after the probe but before any study cell ran. The
fl/slp mutual exclusion, because that pair crashes Tripo deterministically
(isolating it across all seven study-reachable lever sets cost under $2, since
failed tasks refund). And seeds-as-labels, because same params plus same seeds
gave a different model, an 8,000-face delta and a validator error the first
run didn't have.

The instrument was picked by measurement too. gltf-validator scored a visibly
defective wild mesh clean, so trimesh became primary and the validator a
secondary reporter.

## What broke

Most of it was the point. Five documented Tripo behaviors are false in
practice: meshopt is not the default output, seeds do not reproduce, the
5-concurrent cap did not reject six, untextured tasks cost 20 credits not 10,
and stale output URLs outlive the documented 5-minute expiry.

The live run crashed three times on my side. An auth header written as
`Authorization: Bearer` against an API that reads only `X-Api-Key`. A 20MB
direct-upload threshold that ignored Vercel's ~4.5MB body cap (413 on the
first `face_limit`'d mesh). An uncaught TLS socket drop 42MB into a blob
upload. Each fix left something behind: a retry wrapper, per-cell fault
isolation, gate assertions.

One process failure. An automated artifact clean-regen destroyed the live
probe's paid records an hour after the run. The "wipeable tree" convention
from the harness milestone had gone stale the moment live data landed in it,
and nobody noticed. The records were rebuilt from session context into dated
files, and the convention is dead: a dry-run driver may overwrite its own
outputs and never delete anyone else's.

## Numbers

P1 passed clearly but carries a confound I recorded rather than hid. Finding
count is dominated by boundary edges, which scale with tessellation, and arm
C's accepted meshes are about 10× smaller by construction. P1 measures defects
in the shipped asset, which is real, but read next to P2 it does not mean
cleaner per triangle.

P2 is the headline. Blind, the judge preferred B's unconstrained 1.4M-triangle
meshes 12 of 15 times over C's budget-compliant 144k ones. Against arm A, C
was a 7 to 8 coin flip. P3 passed at a 0.67 ratio.

The one number the pitch now rests on: 44 of 45 raw generations violated the
`pc` budget on the first attempt.

## Next

Passive mode. The core fix deploys, the copy drops every quality-multiplier
claim in favor of unattended acceptance and triage, and the launch sequence
stays parked until I decide otherwise. Whether a looser budget profile would
pass P2 is recorded in RESULTS.md as data for a later decision, not chased
now.
