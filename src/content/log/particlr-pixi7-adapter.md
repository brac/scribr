---
title: "Shipping a PixiJS v7 adapter for particlr without forking the runtime"
date: 2026-07-16
project: "particlr"
phase: 10
tags: [pixijs, runtime, packaging, rendering]
draft: true
summary: "A second Pixi major behind one subpath — full feature parity, its own golden baseline, and a dissolve fork that ports the v8 erosion math to v7."
repo_ref: "phase-10"
decisions:
  - what: "Full dissolve parity via a forked v7 ParticleRenderer/ParticleBuffer, not a degraded effect"
    why: "v7 has no custom-shader hook on ParticleContainer, but its fragment already receives premultiplied tint×alpha, so the v8 erosion math ports exactly; anything less breaks preview/runtime parity for dissolve presets"
    alternatives: ["degrade dissolve to a plain alpha fade on v7", "route dissolve through the trail mesh path"]
  - what: "The v7 golden lane has its own committed baseline, not a pixel-equality check against v8"
    why: "v7 and v8 are not byte-identical renderers; parity is 'same sim, faithful render', which is only provable per-lane against that lane's own goldens at maxDiffPixels 0"
    alternatives: ["assert the v7 output is pixel-equal to the v8 goldens", "unit tests only, no golden lane"]
  - what: "Ship v7 as a ./pixi7 subpath inside the existing @particlr/runtime package"
    why: "One install, one version, one peer range ('>=7.2.0 <9'); a consumer picks their major by import path with no second package to keep in lockstep"
    alternatives: ["publish a separate @particlr/runtime-pixi7 package"]
  - what: "The ./pixi7 entry exports the same names as ./pixi (PixiParticleRenderer, PixiParticleRendererOptions, generateBuiltinTexture, TextureData)"
    why: "Migrating a game between majors becomes a one-line import change; the API shape is identical by construction"
    alternatives: ["v7-specific export names", "re-export trail/dissolve internals like ./pixi does"]
  - what: "Every runtime-created v7 texture passes explicit alphaMode UNPACK (premultiply-on-upload)"
    why: "v7's Texture.fromBuffer defaults to non-premultiplied, which would make ADD/SCREEN resolve to different GL blend funcs than v8's premultiplied world and drift the goldens"
    alternatives: ["accept v7's default alphaMode and re-derive blend funcs per texture"]
  - what: "The sprite pool keeps ParticleContainer.children equal to the live prefix via removeChildren/addChild"
    why: "v7 draws children.length unconditionally, ignores child.visible, and has no setSize(n); trimming a preallocated Sprite pool is the only clean mapping to our swap-compacted core pool"
    alternatives: ["set children.length = count directly (invalid on a v7 Container)", "toggle child.visible (ignored inside ParticleContainer)"]
benchmarks:
  - metric: "unit + adapter test suite"
    value: "1677 passed (+50 in the new pixi7 vitest project)"
    target: "exit 0, full regression (was 1627)"
  - metric: "pixi7 golden lane, double-run determinism"
    value: "183 frames at maxDiffPixels 0; second run 44.8s, strict pass, zero diff vs first"
    target: "byte-stable across two consecutive local runs"
  - metric: "runtime core (gzipped)"
    value: "23.33 KB (unchanged)"
    target: "<=25.00 KB"
  - metric: "editor bundle (gzipped)"
    value: "173.03 KB (unchanged)"
    target: "<=200.00 KB"
---

## What shipped

`@particlr/runtime` now plays `.prt` effects on PixiJS v7 as well as v8. The v7
code lives entirely under `src/pixi7` and reaches consumers through a new
`./pixi7` subpath; `./pixi` remains the v8 adapter. A game still on v7 — the
v7→v8 migration is a large lift, and this was the first community request on the
launch post — installs the runtime, changes one import, and consumes the same
effects with no migration.

The adapter is a full port, not a subset: the sprite renderer
(`renderer.ts`), trail ribbons including connect mode (`trailMesh.ts`), and a
forked particle pipeline for dissolve (`dissolveRenderer.ts`). Sub-emitters ride
the shared core, so they render for free. The one hard limit is the renderer —
v7 has no WebGPU, so the v7 adapter is WebGL only. Packaging widened the
`pixi.js` peer range to `">=7.2.0 <9"` and added a `pixi7` npm-alias devDep
(`npm:pixi.js@7.4.3`) plus a per-config tsconfig paths override, so `src/pixi7`
typechecks against v7 types while `tsc` still emits bare `import ... from
"pixi.js"`. The version bumped to 0.5.0.

The sim and format cores, the v8 adapter, and the v8 golden baseline are byte-for-byte
unchanged — the whole feature is additive.

## Decisions

The load-bearing call was dissolve. v7 exposes no custom-shader hook on
`ParticleContainer`, so a per-particle erosion effect had two honest routes:
degrade it to an alpha fade on v7, or fork v7.4.3's `ParticleRenderer` and
`ParticleBuffer` (~400 LOC across the two plus two shader strings) and replace
the fragment. The fork won because v7's stock fragment already receives
`vColor` as premultiplied tint×alpha, so the v8 dissolve math — un-premultiply,
threshold against a noise sample, smoothstep an edge band, re-premultiply —
ports across unchanged. A whole-container `Filter` was rejected outright: it
post-processes the batch, not each particle.

Golden strategy followed from the renderers not being byte-identical. Asserting
v7 output equal to the v8 goldens would fail on legitimate rendering
differences, so `tests/golden-pixi7/` renders the same presets, frames, and
seeds through the v7 adapter on SwiftShader against its own committed baseline
at `maxDiffPixels: 0`. Packaging chose the `./pixi7` subpath over a second
package so there is one version and one peer range to keep honest; the entry
mirrors `./pixi`'s export names so migration is a one-line import change. Two
smaller locks kept the goldens stable: every v7 texture is created with explicit
premultiply-on-upload alphaMode (v7 defaults to non-premultiplied, which would
drift ADD/SCREEN blend funcs), and the sprite pool keeps `children` equal to the
live prefix via `removeChildren`/`addChild` because v7 draws `children.length`
unconditionally and ignores `child.visible`.

## What broke

The plan's routing hypothesis for dissolve was wrong. It assumed a
`pluginName` field would steer a `ParticleContainer` subclass to the forked
plugin, but v7 hardcodes `renderer.plugins.particle` in its render path; the fix
was a `render()` override on the subclass that binds the noise sampler and
dissolve uniforms and dispatches to the forked plugin directly.

The plan's suggested headless fallback also backfired. It proposed a
`MeshMaterial` fallback for trails in a no-DOM environment, but `MeshMaterial`
throws the same eager-GL-probe error (`document is not defined`) it was meant to
avoid — so the fallback is now a shaderless mesh skip, and the real path is
covered under jsdom.

Three plumbing failures were caught in review rather than in production. The
vitest runtime-resolution trap: tsconfig `paths` fixes types only, so without a
vitest project split the entire pixi7 suite would have silently tested against
the installed v8 package — flagged in M0 review, fixed in M1 by splitting the
suite into a `pixi7` project with its own `pixi.js` alias and a test that pins
the resolved version to 7.4.3. The M0 peer-range widening turned the v8 peer
canary red, because that test asserts the literal range string — synced to the
new value. And the plan's `port+1` guess for the golden lane collided with the
bench lane already on 5189, so the v7 render server moved to 5190.

## Numbers

The suite grew from 1627 to 1677 tests; the 50 new tests are the `pixi7` vitest
project (renderer, blend, trail, dissolve, and the version-pin canary). The v7
golden lane renders 183 frames and was run twice locally to prove determinism —
the second run finished in 44.8s as a strict pass with zero diff against the
first; local PNGs were `git clean`ed and never committed, since baselines are
only ever generated in the pinned CI container. Runtime core held at 23.33 KB
gzipped and the editor at 173.03 KB — both untouched, as expected: the size gate
bundles only `src/index.ts` and the v7 adapter adds no shipped editor weight
(jsdom is a test-only devDep).

## Next

Baseline generation is the open half: Ben dispatches `golden-update.yml` to
commit the v7 goldens in the CI container, then publishes 0.5.0 (npm OTP is
human-gated) and posts the community reply. A v7 performance pass is possible
later — v7 pays per-frame `Container` add/remove overhead inside
`ParticleContainer` that v8's particle API avoids, and heavy effects may want a
tighter pool trim.
