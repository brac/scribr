---
title: "Vantage 2.x: the look-and-feel arc, flat horizons and driving the ship"
date: 2026-07-22
project: vantage
phase: 2
tags: [camera, displacement, webgpu, game-feel, dev-tools]
draft: false
summary: "A polish arc between phases: the low-orbit flat horizon (which meant lowering the ship's orbit), displaced mountains, and a dev panel for live taste work."
repo_ref: "f112599"
decisions:
  - what: "Lower the ship's orbit from 1.35R to 1.12R to get the flat huge-planet horizon"
    why: "Three camera-tuning rounds proved a geometric impossibility: a ship at 1.35R sits 45+ degrees above any flat horizon, and no lens fixes that. Curvature is governed by camera height over planet radius, and the rig change took h/R from 0.66 to 0.31."
    alternatives: ["Keep tuning FOV (exhausted, telephoto just crops)", "Letterbox and aspect tricks", "Ship the thin-strip compromise (rejected as a composition regression)"]
  - what: "Arcade thrust-driving as a default-on option, revising the locked 'no manual steering' decision"
    why: "I want to drive. Orbit state moved into GameState with per-tick integration, and unperturbed it reproduces the closed form exactly, so the machine-precision gates still stand."
    alternatives: ["Set-a-value coarse steps only (remains the planned alt mode)", "Full free-flight (rejected, sim-y but arcadey, two axes only)"]
  - what: "Vertex displacement from the baked height field, 8-bit, with two coupled fixes"
    why: "The baked normal map comes from the same height field, so it stays self-consistent with no recompute. Clouds had to rise to 1.016R and the god-ray occluder had to scale, or peaks poke through the deck and rays leak through mountainous limbs."
    alternatives: ["16-bit via a DataTexture decode route (escape hatch if plains terrace)", "Normal-map-only relief (no silhouette)"]
  - what: "A dev panel with live levers instead of screenshot review cycles for taste work"
    why: "I judge look directly, so framing, terrain relief and bloom are backtick-panel sliders now, persisted to localStorage with copy-to-clipboard for baking values back in. Taste iterates at hand speed and the reviewer verifies mechanics only."
    alternatives: ["Continue agent-capture, reviewer-judge, owner-judge rounds (three hops per taste call)"]
benchmarks:
  - metric: "8k bake (8 maps including height, deterministic)"
    value: "43-44s, SHA-identical across double bakes"
    target: "under 60s, --verify green"
  - metric: "frame budget at 1440p with 8k textures, 526k-vert displaced sphere and flare"
    value: "~1.4ms/frame submit sustained (uncapped ~714fps); vsync median 60"
    target: "median 60 fps or better"
  - metric: "orbit integration vs closed form (unperturbed)"
    value: "theta error under 1e-9 rad, track under 1e-7 deg over a full orbit"
    target: "analytic gates unchanged and green (26/26 tests)"
---

## What shipped

The orbit view I actually wanted. Camera riding low at h/R 0.31 over a flat,
screen-spanning horizon with the chrome dropship sitting on the line. An 8k
archipelago world with mountain silhouettes that break the limb, on a dev-panel
lever between 0 and 2%. Tinier, denser Black-Marble city lights. A gradient
atmosphere that dissolves into space instead of stopping. A subtle
occlusion-aware lens flare. W/S/A/D thrust-driving that bends the ground track
live, all the way down to a geosync stop that hides the track line entirely.

And the backtick dev panel, which is the thing that made the rest of the arc
possible at conversation speed.

This wasn't a numbered phase. It's a polish arc that happened between them,
driven by me looking at the thing and not liking it yet.

## Decisions

The load-bearing decision was admitting that a rig problem isn't a tuning
problem.

I spent three camera-tuning rounds trying to get a flat, huge-planet horizon by
adjusting the lens, and one round even shipped a "flatter" result that was
really a composition regression. The geometry doesn't care: a ship at 1.35R
sits more than 45 degrees above any flat horizon, and no FOV value changes
that, because telephoto just crops the same curve. Horizon curvature is
governed by camera height over planet radius. Lowering the actual orbit to
1.12R took h/R from 0.66 to 0.31 and put the ship on the horizon line
immediately. It was safe to change because nothing yet depended on the value.

The lesson I want to keep: when three rounds of tuning a parameter all fail the
same way, stop tuning and check whether the thing you're tuning can reach the
target at all.

Second, I consciously revised one of my own locked decisions. "No manual
steering" was written down, and I overrode it to get thrust-driving, as a
toggleable option, with the CLAUDE.md row updated and dated rather than quietly
edited. Geosync turned out to need slightly retrograde omega, because the
planet keeps turning under a parked ship. That one was found empirically, not
derived.

Third, the taste-iteration workflow itself changed. Live levers replaced
screenshot rounds, which collapses a three-hop loop into me moving a slider.

## What broke

The Tripo dropship loaded as a coal-black silhouette. Its baseColor texture
averages 24.5 out of 255 luminance, so the PBR path reflected almost nothing.
First fix was a tunable hull lift, later superseded by the chrome treatment,
and that ordering mattered: going straight to full metalness over that dark
albedo would have produced a black mirror, so the base map gets dropped and the
hull tinted neutral instead.

The model also flew backwards. A vertex-taper "nose" inference beat the actual
authorial intent, which is a nicely humbling way to be wrong. An orientation
probe, dotting the engine glow against velocity, settled it.

And the first displacement pass would have shipped mountains poking straight
through the cloud deck if research hadn't quantified the clearance change
first. That's two coupled fixes for one feature, which is usually a sign the
feature is touching more than it looks like it is.

## Numbers

8k bake at 43s and deterministic across double bakes. 26/26 tests green, with
the orbit integration reproducing the closed form to under 1e-9 rad on theta
and under 1e-7 degrees on track, so moving orbit state into per-tick
integration didn't cost any of the machine-precision guarantees from phase 2.

Frame submit is about 1.4ms at 1440p with everything on, roughly an order of
magnitude under budget. VRAM sits near 1GB at 8k, which is fine on desktop and
is exactly the problem phase 2b went on to solve for phones.

## Next

I tinker with the levers until the orbit feels right. Open backlog items, which
are the moon, particlr dynamic clouds and volumetrics, and the particlr MCP
interface, are annotated in docs/BACKLOG.md. Then phase 3, the diorama system.
