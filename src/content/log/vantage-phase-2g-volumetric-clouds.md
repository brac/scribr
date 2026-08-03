---
title: "Vantage phase 2g: volumetric clouds, and the f32 landmine three green gates missed"
date: 2026-07-23
project: vantage
phase: 2
tags: [clouds, raymarch, webgpu, tsl, god-rays]
draft: false
summary: "The 2.5D cloud shell became a true volumetric raymarch. The story is the review catching an f32 cancellation that made clouds render only at the limb."
repo_ref: "phase-2g"
decisions:
  - what: "Volumetrics as a FrontSide outer-shell raymarch over offline-baked tileable 3D noise, not compute or StorageTexture"
    why: "Everything has to run identically on the WebGL2 fallback. Compute is WebGPU-only, but Data3DTexture with texture3D() sampling works on both backends in r185, verified against backend source. The Node bake is 2-3 s and slots into the existing hash-gated deterministic bake."
    alternatives: ["WebGPU compute bake with CPU fallback (two code paths, rejected)", "Multi-shell or parallax fakes (no self-shadow or silver lining)", "VolumeNodeMaterial (BackSide, heavier than a thin shell needs)"]
  - what: "tEnd = mix(tExitOuter, tEnterInner, innerHit), never a big-sentinel mix"
    why: "The plan's suggested mix(1e9, tEnterInner, hit) cancels catastrophically in f32, since the ulp at 1e9 is 64, and it zeroed the march for every near-nadir ray. Invisible to tsc, vitest and the boot gates."
    alternatives: ["Keep the sentinel with f64 (there is no f64 on the GPU)", "Branch with If (works but divergent, and unnecessary)"]
  - what: "Wind advection via CPU-f64-wrapped offsets through the periodic tiles, replacing the 2f sinusoid oscillation"
    why: "Baked tiles are periodic by construction, so a wrapped scroll offset gives true one-directional wind that survives simSeconds past 1e7. The old oscillation could only breathe opacity in place, and MaterialX noise is aperiodic so it never could advect."
    alternatives: ["TSL time node (collapses at warp, banned)", "Keep the oscillation (the exact 'edges wiggle, opacity pulses' complaint)"]
  - what: "Cloud ground shadows from a live 512x256 equirect transmittance render target, replacing the static baked-map tap"
    why: "The old shadow sampled the static cloud texture, so shadow shape never matched the now wind-advected clouds. The RT renders a reduced density proxy per frame at ~0.13 Mpx and works on both backends via a plain RenderTarget."
    alternatives: ["Keep the static-map shadow (the original complaint)", "March-derived transmittance projection (correcter, far pricier)", "R8 target (single-channel color attachments are cross-backend roulette)"]
  - what: "Clouds influence sun shafts via a CPU density dim, not a physical occluder"
    why: "The occluder is geometrically dead. The occlusion buffer is a black background with a small bright disc, so black clouds only matter over the disc itself, and the shell's ~1% limb ring can never cover a source extending into open sky. Measured ceiling 0.03% of shaft pixels."
    alternatives: ["Bright lit clouds rendered into the ray source (deferred, and shipped in 2h)", "Bigger occlusion disc (look change, no coupling)", "Drop the coupling"]
benchmarks:
  - metric: "cloud response by radius, density-lever A/B (the bug instrument)"
    value: "before: response confined to the r/R 0.6-0.9 annulus, inner 60% of the disc binary-dead; after: response across the disc"
    target: "density lever moves pixels everywhere clouds are drawn"
  - metric: "shaft coupling at a cloudy limb vs a clear one"
    value: "9.3% of frame pixels affected at a genuinely cloudy limb, exactly 0% at a clear one"
    target: "coupling is real and self-gating, not a constant tint"
  - metric: "frame cost, triangulated across pacers"
    value: "~1.5 ms real cost (uncapped 855 and 654 fps on two runs); the paced 57 fps reading was resolution-invariant from 1080p to 360p"
    target: "decided by triangulation, never by a single paced number"
---

## What shipped

The planet's cloud layer went from a 2.5D shaded shell to a true volumetric
raymarch, across two review-gated milestones: M1 for the bake, march and wind,
M2 for live ground shadows and shaft coupling.

Nubis-style density shaping (coverage remap, detail erosion, powder) now runs
per march step, with a short sun-side light march for self-shadowing, two-lobe
Henyey-Greenstein phase for the silver linings, and an angle-aware extinction
blend so a thin shell reads as actual volume overhead rather than only at the
limb.

The noise is offline-baked tileable 3D Perlin-Worley loaded into Data3DTextures,
which was the call that kept the WebGL2 fallback alive. Wind is real advection
now, not the old sinusoid that could only pulse opacity in place.

## Decisions

The backend constraint drove the architecture. Compute shaders would have been
the natural way to generate 3D noise, and they're WebGPU-only, which would mean
two code paths forever. Data3DTexture with `texture3D()` sampling works on both
backends in r185, and I verified `wrapR` is honored on both by reading the
backend source rather than assuming. The bake is 2 to 3 seconds and drops into
the existing hash-gated deterministic bake with no special handling.

The shaft coupling decision is the one where I had to accept a disappointing
answer. The physically motivated version, where clouds occlude the ray source,
is geometrically incapable of doing anything. The occlusion buffer is a black
background with a small bright disc on it, so black clouds only matter where
they overlap the disc, and the cloud shell's roughly 1% limb ring can never
cover a source that extends into open sky. The measured ceiling was 0.03% of
shaft pixels. The rescue attempt, enlarging the source disc, changed the
approved look by 11 to 18% and delivered zero cloud benefit, so it got reverted.
I picked the CPU density dim from the presented options instead: it samples
weather at the grazing-limb point with shader-identical shaping, cuts shafts by
about 70% at a cloudy limb, leaves a clear limb untouched, and is warp-safe by
construction.

Also worth writing down: perf gates get decided by triangulation now, never by
a single paced number. This phase hit every failure mode at once.

## What broke

This is the real story of the phase, and it's the review loop working exactly
as designed.

The first delivery passed every machine gate. Tests green, both backends
booting, perf fine, determinism A/Bs clean. And my eye still said the clouds
were sitting on the horizon layer. That's an unfalsifiable-sounding complaint,
the kind that usually gets answered with "it looks fine to me."

Instead the reviewer built a pixel instrument: settled single-render captures,
then radial bucketing of a density-lever A/B. That turned my taste note into a
number. Cloud response existed only in a hard-edged annulus between r/R 0.6 and
0.9. The inner 60% of the disc was binary-dead. So "clouds on the horizon
layer" wasn't taste at all, it was a measured bug, and I'd been describing it
accurately without knowing why.

The cause was one line. `mix(1e9, tEnterInner, hit)` in the ray-shell bounds,
which the plan itself had suggested. In f32 that cancels catastrophically: the
ulp at 1e9 is 64, so `1e9 + (t - 1e9)` evaluates to 0, and the march length
went to zero for every near-nadir ray. Three green gate suites could not see
it, because nothing about it is a type error, a failed assertion, or a
non-deterministic result. It's just quietly wrong arithmetic in a place nobody
was measuring.

That's now a standing rule: in shader graphs, select between real values. Never
mask with large sentinels.

## Numbers

The density-lever A/B with radial bucketing is the measurement that mattered.
Before the fix, response was confined to the 0.6-0.9 annulus with the inner 60%
of the disc dead. After, it's across the disc.

Shaft coupling measures 9.3% of frame pixels at a genuinely cloudy limb and
exactly 0% at a clear one, which is the self-gating behavior I wanted rather
than a constant tint.

Frame cost is about 1.5 ms real, established by triangulation. The paced
reading said a dead-flat 57 fps, and the tell was that it stayed 57 from 1080p
all the way down to 360p, so it was the headless pacer again. Uncapped runs
gave 855 and 654 fps. Separately, a 120-versus-38 fps mystery turned out to be
Marvel Rivals holding 82% of the GPU in the background, and some runs degraded
mid-measurement on a cold shader cache. Any one of those numbers on its own
would have failed a passing build, and two of them nearly did.

## Next

Phase 2h finishes the cloud arc: the deferred idea from this phase, where
sun-lit clouds render into the ray source as a bright emitter instead of trying
to occlude it, plus a shading-fidelity round on the cloud bodies themselves.
