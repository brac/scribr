---
title: "Vantage phase 1b: a planet from a seed"
date: 2026-07-22
project: vantage
phase: 1
tags: [procedural-generation, simplex-noise, texture-pipeline, tooling]
draft: false
summary: "The Earth placeholder is gone. One seed becomes the whole texture set, deterministically, in 11 seconds: continents, biomes, night lights, clouds, regions."
repo_ref: "phase-1b"
decisions:
  - what: "3D simplex sampled on the unit sphere, never 2D on the unrolled equirect"
    why: "Seam-free and pole-safe by construction, since lon +180 and -180 are the same 3D point. Verified by there being zero seam special-casing anywhere in the pipeline."
    alternatives: ["2D noise with seam blending and pole fixes (fragile)", "cube-sphere sampling (more code, no benefit here)"]
  - what: "Regenerate-on-clone instead of committing baked textures (amends BUILD_PLAN's 'output committed')"
    why: "Measured: a 4k set is ~16 MB of non-delta-compressible PNG per art iteration, in history forever. The bake is SHA-256-deterministic from the seed, so script plus seed plus a committed preview is equivalent storage."
    alternatives: ["Commit PNGs once with a frozen seed", "Git LFS"]
  - what: "Night lights as scattered 1-2 texel sparks, not gaussian splats"
    why: "Review round 1 rejected the first pass: wide soft splats read as glowing cotton balls. Black Marble character comes from grainy point clusters, so the texture stays sharp and bloom supplies the glow at render time."
    alternatives: ["Density-field intensity (reads as fog)", "Larger splats with tighter falloff (still blobs)"]
  - what: "Region and terrain in one data PNG (R=region id, G=terrain enum), decoded once via DecompressionStream for both DataTexture and CPU picking"
    why: "One source of truth. Canvas readback corrupts integer IDs through premultiply and color management, and DataTexture's defaults are exactly right for ID maps. The flipY mismatch against loaded visual textures gets reconciled, with a test proving it."
    alternatives: ["Canvas/OffscreenCanvas getImageData (footgun)", "Separate decode paths for GPU and CPU (drift risk)"]
benchmarks:
  - metric: "full 4k bake (6 maps + preview + regions)"
    value: "10.6-10.9 s, height stage on 8 worker threads"
    target: "under 60 s, one command"
  - metric: "determinism"
    value: "SHA-256 identical across double-bake for all 7 outputs (reviewer re-verified independently)"
    target: "same seed gives a byte-identical set"
  - metric: "sampling gate"
    value: "24 capitals, 6 ocean probes, both poles, flipY agreement, ~90 assertions; negative proof: breaking the row flip fails 3 tests"
    target: "20+ known lat/lon points assert correct region/terrain IDs"
  - metric: "land fraction (printed by bake)"
    value: "33.08%"
    target: "28-35%"
---

## What shipped

`npm run bake` turns `planet.json`, which is a seed plus tunables, into the
complete texture set. Domain-warped FBM continents with land-biased ridged
mountains. Biome albedo from latitude, altitude and moisture climate belts.
cos(lat)-corrected Sobel normals. Procedural continent-scale clouds.
Black-Marble-style clustered city lights. And the region and terrain data map,
grown by cost-weighted multi-source flood-fill out from seeded capitals.

`PlanetDefinition` loads all of it from data, so `?planet=test-moon` swaps in an
entirely different world with zero code changes.

The game now orbits **Vantage Prime**, not Earth. That was the actual bar for
this phase: not "the pipeline runs" but "the fictional planet looks as good as
the NASA photography did."

## Decisions

Sampling 3D simplex on the unit sphere rather than 2D noise on the unrolled
equirect is the decision everything else rests on. It makes seams and poles
non-problems by construction, because longitude +180 and -180 are literally the
same point in 3D. The proof that it worked is negative and I like it: there is
zero seam special-casing anywhere in the pipeline. No blending band, no pole
fixup, no "and then we fade the last few columns."

The one build-plan amendment is that baked output gets regenerated rather than
committed. What's in git is the script, the seed, and a 512px preview. I changed
this on a measurement, not a preference: a 4k set is about 16 MB of PNG that
delta-compresses essentially not at all, and that lands in history on every
single art iteration, forever. What makes it safe rather than reckless is the
byte-determinism, which is verified rather than assumed.

The night lights call came out of review rather than planning, which is the
right way round for an art decision.

## What broke

Round 1 of review rejected the art outright, and it was correct to.

The night lights splatted as soft blobs, described in review as glowing cotton
balls, which is exactly right and exactly the opposite of the Black Marble look
I was after. The clouds were scattered puffs. And the coastlines were uniformly
crinkled confetti at roughly 50% land, which reads as noise rather than
geography.

Every fix was bake-side, which is a good sign about the architecture. A
point-scatter rewrite of the lights. Weather-mask frequency halved. Continent
frequency lowered with warp raised. Sea level up until land hit 33%. And a
connected-component pass that sinks island specks under 30 texels, since a
thousand tiny dots is what makes coastlines read as static.

The determinism gate quietly earned its keep through all of this. Every art
iteration re-verified byte-identical double bakes, so I never had to wonder
whether a visual change was the tweak I made or noise in the pipeline.

## Numbers

The 4k bake is 10.6 s end-to-end with workers on the height stage, against a
60 s target. All seven outputs SHA-identical across double bakes, re-verified
independently by the reviewer rather than taken from my run.

14 tests green. The region-sampling gate was proven non-vacuous by breaking the
flipY reconciliation on purpose and watching three tests fail with the exact
expected signature, which is a northern capital resolving to a southern region.
That's the failure I wanted to see, not just any failure.

Land fraction prints at 33.08% against a 28-35% target.

## Next

Phase 2 is the ship on its inclined track: orbit camera, time warp, raycast
picking that turns a click into lat/lon and then into the region data this
phase produced, and the mission-control minimap with its sinusoid ground track.
