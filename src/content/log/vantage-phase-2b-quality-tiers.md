---
title: "Vantage phase 2b: quality tiers, and the phone that was never going to load it"
date: 2026-07-22
project: vantage
phase: 2
tags: [webgpu, mobile, performance, bake-pipeline, quality-tiers]
draft: false
summary: "'Heavy on my phone' turned out to be 'cannot load at all'. Three quality tiers, a 2K bake variant, auto-detection, and the desktop path proven byte-identical."
repo_ref: "phase-2b"
decisions:
  - what: "Tier resolved once pre-init; a manual change reloads the page"
    why: "Verified in three r185 source: MSAA is constructor-only, backend choice happens in init(), god-ray sample count is a compile-time shader constant, and the post graph is built once. Four of the six big levers are init-only, so live switching would rebuild renderer, scene and post mid-session for zero gameplay benefit."
    alternatives: ["Live tier switching (disproportionate complexity)", "Separate mobile build (two artifacts to keep honest)"]
  - what: "2K variant emitted inside the same 8K bake run by downsampling the in-memory buffers"
    why: "A --res 2048 re-bake is a DIFFERENT planet, because region growth, capitals and settlement placement are all resolution-dependent. Downsampling the full-res buffers is deterministic and costs seconds on top of the 43s bake."
    alternatives: ["Re-bake at 2048 (rejected, resolution-dependent world gen)", "Runtime downscale (three r185's new backends have none)", "KTX2/basis pipeline (deferred, heavier tooling for the same win)"]
  - what: "A post-init capability clamp, kept separate from tier detection"
    why: "Classification (is this a phone?) and capability (can this device sample 8192-wide textures?) are different questions. Chrome 146+ ships WebGPU compat mode on Adreno/Mali Android with maxTextureDimension2D=4096, and three requests only default limits, so an 8K request there is a validation error and a black planet."
    alternatives: ["Fold capability into detection heuristics (guessing, when the limit is readable directly)", "adapter.info identity matching (requestAdapterInfo is removed; strings deliberately coarse)"]
  - what: "The showpiece row is expressed in terms of the existing data/ constants, locked by test and capture"
    why: "My one hard constraint is that desktop stays the showpiece. The row references the existing constants rather than copying their values, a unit test asserts the identity, and the gate proved the rendered frame sha256-identical between unmodified HEAD and the tiered build."
    alternatives: ["Trust code review alone (a dropped .add() in the post graph would pass every test and change the image)"]
benchmarks:
  - metric: "asset payload, phone tier vs desktop"
    value: "4.6 MB (7 maps at 2048x1024) vs 50 MB; decoded GPU memory ~78 MiB vs ~1.1 GiB"
    target: "loadable inside a phone tab's memory budget"
  - metric: "surface mesh, phone / floor vs showpiece"
    value: "33,153 / 8,385 verts vs 525,825"
    target: "cut the per-frame tiler load to phone scale"
  - metric: "desktop identity (gate 5)"
    value: "HEAD vs tiered build, byte-identical 2560x1440 capture (sha256 equal), reproduced independently by the reviewer"
    target: "zero visible change at showpiece"
  - metric: "bake with 2K emission, --verify"
    value: "all 15 hash rows OK across double bake; 8K set byte-identical to the pre-phase baseline; 19,650 night texels survive above 128"
    target: "deterministic; 8K outputs untouched; towns survive the shrink"
  - metric: "headroom ordering (uncapped headless, NVIDIA Ampere)"
    value: "showpiece ~714, phone ~1428, floor ~5000 fps"
    target: "each tier strictly cheaper; paced 60 Hz dead-flat on all tiers"
---

## What shipped

Quality tiers, selectable by `?tier=`, a stored override, or auto-detection.
**Showpiece** is today's desktop, untouched. **Phone** is 2K textures, a
256x128 sphere, no god rays or lens flare, bloom kept, dpr capped at 1.5.
**Floor** is 2K, 128x64, a flat sphere, scene pass only, dpr 1.

Detection is pointer coarseness plus screen short edge, with Chromium's
deviceMemory as a demote-to-floor signal. iPads classify as phones for now,
which I'll revisit if an M-series one feels sandbagged.

The dev panel grew a QUALITY row that reloads on click, plus a readout of what
the device actually resolved to, which matters more than it sounds when the
whole feature is about devices you don't have in your hand. The bake now emits
the 2K set in the same run, hash-verified alongside the 8K.

## Decisions

The reframe is the story of this phase. What I reported was "it's heavy on my
phone." What the research round came back with was "it hard-fails on a large
slice of phones," which is a completely different bug.

WebGPU compat mode has been mainstream on Android since February, and it
defaults `maxTextureDimension2D` to 4096. three r185 requests only default
limits, and unlike the legacy WebGLRenderer, the new backends have no
oversize-image resize path at all. So an 8K texture on a compat-mode device
isn't slow, it's a validation error and a black planet. Separately, the full
set decodes to about 1.1 GiB of GPU memory, which is a tab kill on iOS even
where the dimensions are legal.

That's why the capability clamp is deliberately separate from tier detection.
"Is this a phone" and "can this device sample an 8192-wide texture" are
different questions, and the second one is directly readable after
`renderer.init()` rather than something to guess at from user-agent
heuristics. The clamp forces the 2K set regardless of what tier you asked for.

The 2K variant gets downsampled from the in-memory 8K buffers rather than
re-baked, because a re-bake at 2048 is a genuinely different planet: region
growth, capitals and settlement placement are all resolution-dependent, so it
would diverge from the committed regions metadata. Each channel needed its own
downsample rule. Night lights get sum-clamp, because a box average would dim
one and two-texel towns by 8 to 16 times into invisibility. Region data gets
stride-nearest, since the values are integer IDs and averaging them is
meaningless. Height is box-averaged in float and quantized once at the end.

## What broke

Nothing came back from review. Zero comment rounds, which is rare enough to
note.

The reviewer independently reproduced the desktop-identity capture, getting a
byte-equal hash from a fresh browser profile, and then closed the one gap I'd
disclosed rather than hidden: the WebGL2 fallback branch of the capability
clamp had never executed, because a WebGPU dev box never takes it. They
exercised it by launching Chrome with WebGPUService disabled. three fell back,
the GL path read MAX_TEXTURE_SIZE at 16384, and the full scene rendered.

Two pre-existing quirks got flagged to the backlog rather than fixed in this
phase: `hud.setVisible` has a truthiness bug that leaves the arcade GS readout
visible when chrome is hidden (`src/ui/hud.ts:166`), and three r185
deprecation-warns that PostProcessing is now RenderPipeline.

The capture harness also fought back once more. After the app's RAF chain
stops, headless Chrome 150 with WebGPU never composites new presents, so
single-shot captures return a stale frame. The workaround is to render the same
absolute state every rAF, so whichever frame you grab is the right one. That's
in the gate recipe now rather than in someone's head.

## Numbers

Phone tier is 4.6 MB of assets against desktop's 50 MB, and roughly 78 MiB of
decoded GPU memory against 1.1 GiB. Surface mesh is 33,153 verts on phone and
8,385 on floor, against 525,825 at showpiece.

Desktop identity held: the 2560x1440 capture is sha256-equal between unmodified
HEAD and the tiered build, reproduced independently. That's the gate I care
about most, because a dropped `.add()` in the post graph would pass every unit
test and still change the image.

Bake with 2K emission passes all 15 hash rows across a double bake, the 8K set
is byte-identical to the pre-phase baseline, and 19,650 night texels survive
above 128, so the towns made it through the shrink.

Headroom ordering is strictly monotonic: showpiece ~714, phone ~1428, floor
~5000 fps uncapped, all dead flat when paced at 60 Hz. Determinism verified on
real hardware, nvidia/ampere, not SwiftShader.

## Next

I review from the couch. Real-hardware spot checks on an actual Android
compat-mode device and an iPhone whenever one is handy, and tablet
classification gets revisited if an M-series iPad feels sandbagged. Then phase
3, dioramas, with particlr integration scoped alongside it per the backlog.
