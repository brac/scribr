---
title: "Vantage phase 2: riding the orbit, and the sign flip the textbook hides"
date: 2026-07-22
project: vantage
phase: 2
tags: [orbital-mechanics, picking, minimap, time-warp, tsl]
draft: false
summary: "The ship rides its inclined track with follow-cam, time warp, click-picking and a minimap. Ground track verifies to 1e-13 degrees, after a sign flip."
repo_ref: "phase-2"
decisions:
  - what: "Analytic ray-sphere picking instead of raycasting the tessellated mesh"
    why: "128x64 sphere facets deviate from the true sphere by more than a 4k texel at glancing angles. The closed form against centre and radius is exact and cheaper, and worldToLocal undoes the planet spin before lat/lon conversion."
    alternatives: ["three.Raycaster against SphereGeometry (sub-texel errors at the limb)", "Higher tessellation (costs more, still approximate)"]
  - what: "Ground-track longitude uses the sign-flipped textbook form, atan2(-cos i*sin th, cos th)"
    why: "Our lon = atan2(-z, x) convention mirrors the standard formula east to west. The unflipped version passes a visual eye-test and fails against the region maps. Verified to 1.1e-13 degrees against an independent rotation-matrix construction."
    alternatives: ["Textbook form plus flipping the texture (breaks every other consumer)"]
  - what: "Wrapped phase uniforms for shader time instead of raw simSeconds"
    why: "Measured: f32 resolution degrades to 3.9ms at simSeconds=1e5, so a long 1000x warp session would visibly freeze the twinkle. Logic stays f64; shaders get cloud phase mod 1.0 and twinkle phase mod 1e3."
    alternatives: ["Feed raw simSeconds (decays)", "Reset the clock on warp exit (hitches)"]
  - what: "Region borders composited into emissiveNode, plus a camera-distance atmosphere fade for the follow-cam"
    why: "Albedo-mixed borders vanish on the night side, while emissive reads on both hemispheres and stays under the bloom threshold. The distance fade keeps the far hero framing byte-identical while taming the limb up close."
    alternatives: ["Albedo mix (night-invisible)", "Global bloom or intensity cuts (dulled the hero, rejected against the hard constraint)"]
benchmarks:
  - metric: "ground-track analytic vs independent 3D construction"
    value: "maxLatErr 0.0 deg, maxLonErr 1.137e-13 deg over a full orbit including spin drift"
    target: "under 1e-9 deg"
  - metric: "picking accuracy (36 synthetic rays, 3 spin angles)"
    value: "max angular error 3.0e-14 deg; all region and terrain IDs correct"
    target: "20 points matching the data maps"
  - metric: "frame rate, 1440p, full scene (reviewer, real GPU, uncapped)"
    value: "~775 fps sustained, median frame 1.3 ms"
    target: "60 fps"
---

## What shipped

Vantage plays like an orbit now.

The ship rides a 55-degree inclined track with a smoothed follow-cam composing
the vast arc. `,` and `.` step time warp through 1x, 10x, 100x and 1000x, with
the auto-return-to-1x stub wired for later. Clicking the globe resolves region
and terrain through the exact body-fixed transform chain. The minimap draws the
wrap-split sinusoid ground track with a ship marker and predicted pass windows.
And `b` toggles thin cyan region borders drawn in-shader straight from the
region-ID texture, default off, because the naked planet is the hero.

## Decisions

The research round caught two traps before either became a bug, and they're
both the kind that would have been miserable to find later.

The first: the textbook ground-track longitude formula is east-west mirrored
under our longitude convention. We use `lon = atan2(-z, x)`, and the standard
form assumes the other handedness. What makes this nasty is that the wrong
version looks completely fine. The track sweeps across the globe at the right
inclination with the right period, and your eye has no way to tell it's
reflected. It only dies when you check it against the region maps, where the
ship is suddenly over the wrong continent. That's a class of error I want
caught by data every time, because eye-tests structurally cannot catch it.

The second: f32 shader time decays. At simSeconds = 1e5 the resolution has
degraded to 3.9ms, which means after a long 1000x warp session the star twinkle
would visibly freeze. Game logic stays f64 and the shaders get wrapped phase
uniforms instead, cloud phase mod 1.0 and twinkle phase mod 1e3. Resetting the
clock on warp exit was the obvious alternative and it hitches.

Picking went analytic for a similar precision reason. At glancing angles the
128x64 sphere's facets deviate from the true sphere by more than a 4k texel,
which is enough to resolve the wrong region near the limb. The closed form is
both exact and cheaper.

## What broke

Review rejected the first vast-arc framing, and the diagnosis was more
interesting than the bug.

At follow-cam range, the additive atmosphere fresnel spans a wide grazing band.
Stack that with bloom over backlit clouds and the limb blows out into a wall of
white. The obvious fixes are global: turn down bloom, or turn down the lit
clouds. Both were measured, and both dulled the standard-distance hero shot,
which runs straight into the one hard constraint on this project.

So the fix became a camera-distance ramp instead: a smoothstep that fades
atmosphere scale from 1.0 to 0.5 and lit-cloud peak from 1.0 to 0.92 as the
camera closes in. The far framing came out byte-identical, which is the proof
that matters. The near framing reads as a controlled bright rim rather than a
blown one.

## Numbers

Ground track verified to 1.1e-13 degrees against an independent matrix
construction, against a 1e-9 target. Picking to 3e-14 degrees across 36
synthetic rays at three spin angles, with every region and terrain ID correct.

22 tests green. Reviewer-measured around 775 fps sustained uncapped at 1440p on
the real GPU with a median frame of 1.3 ms, so the 60 fps gate holds with an
order of magnitude of headroom.

## Next

Phase 3 is the diorama system: a separate staged scene per surface tile, seeded
generation, orbit-to-diorama transitions with GameState hash integrity, and the
first autonomous agents, which are vehicles on splines kicking up dust.
