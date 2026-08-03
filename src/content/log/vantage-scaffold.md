---
title: "Vantage phase 0: scaffolding on WebGPURenderer while dodging TypeScript 7"
date: 2026-07-21
project: vantage
phase: 0
tags: [threejs, webgpu, vite, fixed-timestep, tooling]
draft: false
summary: "The Vite + TS + three r185 scaffold: 240Hz fixed-timestep loop, seeded PRNG, tone-mapped empty scene, and a TypeScript version pin that isn't optional."
repo_ref: "phase-0"
decisions:
  - what: "WebGPURenderer (three/webgpu) with TSL as the committed shader path, wrapped in one factory module"
    why: "In three r185 the nodes/TSL system only gets new features on WebGPURenderer, which auto-falls-back to WebGL2. Classic GLSL ShaderMaterial is frozen, so phase 1's planet shaders would otherwise be built on the legacy path."
    alternatives: ["WebGLRenderer + GLSL ShaderMaterial + EffectComposer (works but frozen; future rewrite to reach WebGPU)"]
  - what: "Pin typescript@~6.0.3, never 7.x"
    why: "TS 7.0.2 (Go-native, GA 2026-07-08) is npm latest, but typescript-eslint's peer range is <6.1.0, so a bare install breaks linting."
    alternatives: ["Take TS 7 and drop typescript-eslint until 7.1's stable compiler API"]
  - what: "Epsilon guard (tickMs * 1e-9) in the fixed-timestep accumulator comparison"
    why: "TICK_MS = 1000/240 stores just above its true binary value, so naive repeated subtraction dropped 1 tick per ~2400, making tick count render-cadence dependent. The determinism gate caught it."
    alternatives: ["Integer tick accounting in microseconds", "Accept the drift and loosen the test"]
benchmarks:
  - metric: "npm run build (tsc --noEmit + vite build)"
    value: "~1.6s total, vite phase 183ms"
    target: "exit 0, zero TS errors"
  - metric: "loop determinism: ticks per 10 simulated seconds"
    value: "2400 across steady/irregular/spike-clamped cadences"
    target: "exactly 2400 regardless of render FPS"
  - metric: "lint negative proof"
    value: "2 of 2 (implementer mutation + reviewer fresh-file probe both exit 1, restore exits 0)"
    target: "Math.random in src/ fails the build"
---

## What shipped

The Vantage scaffold: Vite 8, TypeScript 6, three r185. A pure fixed-timestep
stepper (`createLoop`) decoupled from the RAF driver so determinism is testable
without a DOM. The mulberry32 PRNG as the project-wide determinism contract. A
minimal `GameState` carrying tick, simSeconds and seed. Tunables in `src/data/`.
And a `WebGPURenderer` factory with ACES tone mapping (AgX and Neutral wired as
data tunables) rendering a tone-mapped empty scene at the display cap with a
confirmed `WebGPUBackend`.

Nothing on screen but a correctly tone-mapped void, which is exactly what phase
0 is supposed to be.

## Decisions

The renderer path was the load-bearing call and I'm glad it got researched
against the live r185 release rather than from memory. Classic GLSL
`ShaderMaterial` is the frozen path now. TSL node materials on WebGPURenderer
are where new features land, and TSL compiles to both WGSL and GLSL, so the
WebGL2 fallback keeps working for free. Phase 1's planet shaders will be TSL.
Picking wrong here would have meant building the whole hero planet on a dead
path and rewriting it later.

The TypeScript pin is smaller but sharper. TS 7.0.2 went GA on 2026-07-08 and
is what npm hands you as `latest`, but typescript-eslint's peer range still
stops at <6.1.0. A bare `npm install` gives you a working compiler and a broken
linter, which is the worst combination, because the thing that stops being
enforced is the thing you stop noticing. Pinned to 6.0.3 with a note about when
to revisit.

The epsilon guard is the one I'd never have predicted. More on that below.

## What broke

The naive accumulator loop failed its own gate: 2399 ticks per 10 simulated
seconds instead of 2400.

`1000/240` is a non-terminating binary fraction, and it stores a hair above its
true value. Repeated subtraction therefore drains the accumulator very slightly
too fast, and once per roughly 2400 ticks a tick that is genuinely due gets
skipped. The visible consequence is that tick count becomes dependent on render
cadence, which is precisely the property the whole fixed-timestep design exists
to prevent.

The fix is a sub-ULP epsilon in the boundary comparison. It's worth being
careful about what that epsilon can and can't do: it can only fire a tick that
is genuinely due within a rounding error, never invent one. I sat with that for
a while before accepting it, because "add a fudge factor to the timing loop" is
the kind of fix that quietly becomes a bug two phases later.

Worth noting the gate caught this on day one, before any rendering existed to
hide it in.

## Numbers

Build is about 1.6s total, with the vite phase at 183ms. Tests are 9/9 in
roughly 200ms. Bundle is 770KB raw, 210KB gzipped, essentially all three.js and
expected.

Determinism: exactly 2400 ticks per 10 simulated seconds across steady,
irregular and spike-clamped cadences.

The lint gate got negative-proofed twice, once by the implementer mutating a
file and once by the reviewer dropping in a fresh file. Both exit 1 on a
`Math.random` in `src/`, and both restore to exit 0.

Dev run confirms WebGPU active rather than the fallback, zero console errors,
FPS counter steady at the headless compositor's 120Hz.

## Next

Phase 1 is the risk phase: the hero planet. Day/night terminator, twinkling
city lights, ocean glint, cloud layer, atmosphere rim, bloom and god rays, all
in TSL. Research pointers are already staged in
`docs/research/phase-1-rendering.md`, including the Three.js Journey earth
lesson, the O'Neil scattering ladder, and NASA Blue and Black Marble
calibration data.
