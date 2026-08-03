---
title: "Vantage phase 1: the hero planet, and the god rays that weren't"
date: 2026-07-21
project: vantage
phase: 1
tags: [threejs, tsl, webgpu, planet-rendering, post-processing]
draft: false
summary: "The risk phase: a TSL-shaded planet with terminator, city lights, ocean glint and atmosphere, and a god-rays node that turned out to be the wrong effect."
repo_ref: "phase-1"
decisions:
  - what: "God rays via occlusion buffer plus radialBlur, not the built-in godrays() node"
    why: "r185's godrays() is volumetric shadow-map raymarching, which is the wrong effect and the heaviest option. radialBlur over a black-planet/bright-sun occlusion pass gives the disc-occluded shafts the design calls for, far cheaper."
    alternatives: ["Volumetric godrays() node (kept as documented upgrade ceiling)", "EffectComposer + legacy GLSL godrays (frozen path)"]
  - what: "Keep ACES over AgX after a same-frame comparison"
    why: "ACES gives deeper ocean blues, an inkier night side and more dramatic contrast. AgX read flatter and slightly milky on this scene. Decided on pixels; both curves stay one tunable away."
    alternatives: ["AgX (research-recommended for emissive highlights)", "Neutral"]
  - what: "Ocean glint as PBR roughness/metalness driven by the ocean mask, not an additive Blinn term"
    why: "Low-roughness water under the sun DirectionalLight makes the engine's own specular path produce the glint, so it's integrated with lighting instead of double-counted on top of it."
    alternatives: ["Hand-rolled additive pow(dot(N,H)) highlight on top of albedo"]
  - what: "Animation driven by a simSeconds uniform from the fixed-timestep clock, never TSL's time node"
    why: "Keeps every twinkle and cloud position deterministic against the phase-0 loop. timerLocal is also simply gone in r185."
    alternatives: ["Wall-clock time node (non-deterministic, drifts from game time)"]
benchmarks:
  - metric: "frame rate, 2560x1440, all layers on"
    value: "median 119 fps steady-state, p90 9.4ms; reviewer cross-checked ~890 fps uncapped submission"
    target: "60 fps hard gate, passed with ~2x headroom"
  - metric: "screenshot checklist"
    value: "7 of 7 (terminator, twinkle, glint tracking, cloud independence, both-limb rim, occluded god rays, tonemap pair)"
    target: "all items visually verified by implementer and reviewer"
  - metric: "texture set on disk"
    value: "22.0 MB, 6 files, git-ignored, one-command fetch"
    target: "no binaries in git; idempotent script"
---

## What shipped

The planet. Three concentric spheres: a PBR surface
(`MeshStandardNodeMaterial` with colorNode, emissiveNode, normalNode and
roughnessNode), an unlit scrolling cloud shell, and an additive BackSide
fresnel atmosphere, all over a milky-way starfield and lit by a single sun
DirectionalLight whose direction is the one source of truth every shader reads.

The post chain is scene pass, then bloom, then radialBlur god rays sourced from
a black-planet/bright-sun occlusion scene, composited in linear HDR before
ACES. All 40-odd knobs live in `src/data/planet.ts`. Textures fetch by script
from Solar System Scope under CC-BY, credited in CREDITS.md, and never touch
git.

This was the phase most likely to fail, so it went first.

## Decisions

The research round earned its keep twice.

The small catch: `bloom` lives in `three/addons`, not `three/tsl`, which is the
kind of thing that costs an hour of confused importing.

The big one: r185's built-in `godrays()` node is volumetric shadow-map
raymarching. That is not the effect the design wants. What I want is the
classic screen-space disc-occluded shafts, and the built-in is simultaneously
the wrong look and the most expensive option on the menu. Replacing it with a
radialBlur over an occlusion pass gets the right look for a fraction of the
cost. It's kept in the notes as a documented upgrade ceiling in case the
project ever wants true volumetrics, which as it turns out it eventually did.

The radialBlur composite was the one piece research couldn't pre-verify, so the
wiring that actually worked is written down in `src/render/post.ts` rather than
left to be rediscovered.

Tone mapping stayed ACES after a same-frame AgX comparison. AgX is what the
research recommended for emissive highlights, and on this scene it read flatter
and slightly milky, while ACES gave deeper ocean blues and an inkier night
side. Decided on pixels, not on doctrine. Both curves stay one tunable away.

## What broke

Solar System Scope ships its normal and specular maps only as Adobe-Deflate
TIFF, which no browser will load. Rather than take a dependency for one file
format, the fetch script grew a roughly 90-line TIFF decoder (zlib inflate plus
horizontal predictor) and a minimal PNG encoder, verified pixel-correct against
known geography.

The FPS verification detoured through a hall of mirrors. Headless Chrome pinned
rAF at exactly 57 fps regardless of resolution, which looks exactly like a
failed performance gate. Dropping the render resolution changed nothing, which
was the tell. It was a frame-pacing cap the whole time, and
`--disable-frame-rate-limit` exposed the real headroom underneath.

That one's now a standing lesson: a suspiciously uniform frame-time
distribution is a pacer, not a workload. If the number doesn't move when you
make the work easier, you're not measuring the work.

## Numbers

Median 119 fps steady-state at 2560x1440 with every layer on, on an NVIDIA
Ampere with WebGPUBackend confirmed rather than the WebGL2 fallback. The
reviewer cross-checked around 890 fps on uncapped submission and confirmed
resolution scaling behaves, which is what turns the 119 from a number into
evidence.

The first five seconds after load run at 10 to 40 fps while pipelines compile
and 8k textures upload. One-time cost, worth knowing about.

Textures are 22 MB on disk: day, night, clouds and stars at 8k, normal and
specular at 2k, since SSS offers no 4k tier. Build is 884 KB raw, 242 KB
gzipped. Screenshot checklist 7 of 7.

## Next

Phase 1b is the texture authoring pipeline: procedural bake to equirect maps,
a `PlanetDefinition` bundling texture set, region-ID map, terrain map and
metadata, plus channel-packing and KTX2 for the hero pass. Then the fictional
planet replaces Earth, and "looks as good as Earth did" becomes the bar to
clear.
