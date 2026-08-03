---
title: "Vantage phase 2h: cloud-shaped sun shafts and the shading round the audit rewrote"
date: 2026-07-23
project: vantage
phase: 2
tags: [clouds, god-rays, tsl, shading, webgpu]
draft: false
summary: "Sun-lit limb clouds now emit into the god-ray source, and an audit-before-fix rule disproved the reviewer's diagnosis and found a 200x units bug instead."
repo_ref: "phase-2h"
decisions:
  - what: "Cloud-to-shaft interaction by emission, not occlusion: lit clouds render INTO the god-ray source"
    why: "2g proved black-cloud occlusion is geometrically dead at a 0.03% ceiling. Inverting it works, because the occlusion pass is HalfFloat HDR end to end and radialBlur is strictly radial from centre with no clamp, so a warm emitter above 1 streaks outward through each lit cloud edge."
    alternatives: ["Bigger occlusion disc (look change, zero coupling, measured and reverted in 2g)", "Screen-space cloud mask on the rays (2D, breaks under camera motion)"]
  - what: "toneMapped=false on the emitter, and a color/opacity channel split"
    why: "A toneMapped material applies ACES inside the occlusion pass, crushing HDR before the blur. Additive blending contributes rgb times a, so putting density in both channels squares it. Both traps were pinned from source-level research before implementation."
    alternatives: ["Discover them on-GPU (the 2g f32 lesson argued for research-first)"]
  - what: "Audit-before-fix as a hard gate in the shading round, which then rewrote the plan"
    why: "The reviewer's clamp diagnosis predicted shading, scatter and rim were all dead. The measured table said only cloud shading was dead at 0.41%, and the prescribed soft-knee moved the headline metric the wrong way."
    alternatives: ["Ship the planned soft-knee and rebalance (measured: lowers variation)", "More light-march taps (unneeded once the units were right; kept as an escalation option)"]
  - what: "Within-body variation measured over an honest pixel mask, not broad-frame stddev"
    why: "Broad stddev is dominated by cloud edges, and it was actually inflated by the very clamp pile-up it was meant to condemn. The revised gate uses the exact stark-white body pixels with the same mask on both frames."
    alternatives: ["Keep the broad metric (it would have called the correct fix a regression)"]
  - what: "The lever audit table becomes a standing deliverable"
    why: "My complaint that a lot of sliders don't do anything turned out to be one genuinely dead slider plus flat bodies masking the rest. A min-versus-max table over every lever turns that class of report into a mechanical check instead of an argument."
    alternatives: ["Fix the reported slider only (would have missed that the complaint was really about the bodies)"]
benchmarks:
  - metric: "cloud-shaped shaft coupling"
    value: "7.4-25% of shaft pixels affected, structure ratio 2.34x by annulus radial-average arc stddev; clear limbs self-gate to ~0%"
    target: "shafts take the shape of the clouds, and vanish when there are none"
  - metric: "within-body variation, honest mask"
    value: "10.5 to 34 (3.2x), independently recomputed by the reviewer from the raw PNGs; ceiling pile-up 75% to 5.6%"
    target: "cloud bodies show structure instead of a flat tone-mapped ceiling"
  - metric: "lever audit"
    value: "all ten cloud levers measure at or above 3.9% of pixels at extremes, most far above; before the fix, cloud shading measured 0.41%"
    target: "every slider provably does something"
---

## What shipped

Phase 2h finished the cloud arc that 2g started, in two milestones.

Milestone 1 gave the terminator its money shot. Sun-lit clouds at the limb now
render as a warm HDR emitter into the god-ray occlusion buffer, and because the
radial blur streaks every bright pixel outward from the sun, each lit cloud
edge casts its own light stream. That's broken-cloud sunset rays, where 2g had
uniform shafts dimmed by a scalar. The 2g dim survives, moved onto the
occlusion disc, which works because the blur is linear so dimming the source
equals dimming the rays. Uniform shafts still fade behind overcast limbs while
the cloud-edge rays keep their punch.

Milestone 2 was planned as a tone-curve fix and turned into something else
entirely.

## Decisions

Inverting the coupling is the good idea of this phase, and it came directly out
of 2g's failure. Black clouds occluding the ray source is geometrically dead,
proven at a 0.03% ceiling. But the same geometry that makes occlusion useless
makes emission work: the occlusion pass is HalfFloat HDR end to end and
radialBlur has no clamp, so putting a warm emitter above 1.0 at the cloud shell
means each lit edge streaks outward on its own. Same pass, same blur, opposite
sign, completely different result.

Two traps got pinned by research before any GPU time, which is the 2g lesson
being applied rather than just recorded. `toneMapped` must be false on the
emitter, or ACES gets applied inside the occlusion pass and crushes the HDR
before the blur ever sees it. And color and opacity need splitting, because
additive blending contributes rgb times alpha, so density in both channels
squares it.

The decision I'm most glad about is procedural: audit before fix, as a hard
gate. It rewrote its own plan within an afternoon.

## What broke

The reviewer's diagnosis was wrong, and the process caught it rather than
shipping it.

The clamp diagnosis predicted that shading, scatter and rim were all being
flattened. The mandated lever audit measured each one instead of assuming, and
the table said only cloud shading was dead, at 0.41% of pixels responding.
Worse, the prescribed remedy, a soft-knee on the tone curve, measurably moved
the headline metric in the wrong direction. Shipping the plan as written would
have made the thing it was meant to fix slightly worse, and it would have
looked like progress.

The implementer stopped and reported rather than pushing through, and the real
defects came out.

First: the sun-side light march accumulated optical depth two hundred times too
small, because tau was never scaled by `CLOUDVOL_DENSITY`. That makes
self-shadowing `exp(0)`, which is 1, which means the lever was completely inert.
One multiply to fix.

Second: the volumetric rewrite in 2g had silently dropped the old pseudo-normal
bump-shading term, the thing that paints sun-angle gradients across cloud
bodies. Nobody noticed at the time because the bodies were blown out at the
tone-mapped ceiling anyway, so there was nothing to see a gradient on.

The measurement itself also needed fixing. The broad-frame stddev metric is
dominated by cloud edges, and it was being inflated by exactly the ceiling
pile-up it was supposed to condemn. Kept as-is, it would have scored the
correct fix as a regression. The revised gate masks to the exact stark-white
body pixels, same mask on both frames.

## Numbers

With the units fix, the bump shading restored and the ceiling softened, cloud
bodies went from a stark-white pile at the tone-mapped ceiling to real
bright-top and dark-flank structure. Within-body variation moved from 10.5 to
34, a 3.2x change, independently recomputed by the reviewer from the raw PNGs
rather than taken from the implementer's harness. Ceiling pile-up dropped from
75% of body pixels to 5.6%.

Cloud-shaped shaft coupling measures 7.4 to 25% of shaft pixels affected with a
structure ratio of 2.34x, and clear limbs self-gate to roughly 0%.

The lever audit now shows all ten cloud levers at or above 3.9% of pixels
moving at their extremes, most far above. Determinism stayed byte-exact
throughout, and the frame still runs about 9x under budget uncapped.

I approved both milestones same-day, which after 2g's three rounds was a
pleasant change.

## Next

The cloud arc is closed. Back to the roadmap: phase 3, the diorama system, with
particlr integration scoped alongside it.
