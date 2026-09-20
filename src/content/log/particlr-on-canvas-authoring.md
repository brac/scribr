---
title: "Dragging particlr's polyline paths on the canvas"
date: 2026-07-12
project: particlr
phase: 6
tags: [editor, authoring, splines, undo]
draft: false
summary: "Three editor arcs moved polyline authoring onto the canvas: on-canvas drag, cross-layer ghosts and snap, and Catmull-Rom smoothing, at zero golden churn."
repo_ref: "b66872d"
decisions:
  - what: "Render the polyline overlay as a DOM SVG layer above the Pixi canvas, not Pixi-drawn geometry"
    why: "Hit-testing, keyboard focus, and separation from the render path; golden/bake parity was never at risk either way since editor and export use independent Pixi Applications"
    alternatives: ["Draw handles inside the Pixi preview (loses a11y and hit-testing)"]
  - what: "Point-level polyline edits opt out of multi-select broadcast; alignment uses ghosts + snap + an explicit copy action"
    why: "Vertex coordinates are per-shape geometry, and broadcast is only well-defined for congruent point counts, so broadcasting them is never what the user means"
    alternatives: ["Broadcast point edits across selected layers", "Multi-select broadcast editing for alignment"]
  - what: "Smoothing via centripetal Catmull-Rom (alpha=0.5) with an exact-zero short-circuit; handles stay on authored points"
    why: "smoothing === 0 falls through to the pre-existing unflattened path, keeping straight polylines bit-identical; a pen tool with control handles was the rejected big lift"
    alternatives: ["Bezier control handles / pen tool", "Blend two Hermite evaluations instead of a short-circuit"]
  - what: "One flatten function, exported from runtime core, feeds both the sampler and the overlay outline"
    why: "The drawn curve and the emitted curve are identical by construction, with no duplicated spline math"
    alternatives: ["Reimplement flattening in the editor"]
benchmarks:
  - metric: "vitest suite after CURVES close"
    value: "1366 passing"
    target: "green"
  - metric: "editor bundle after CURVES (gzipped)"
    value: "169.04 KB"
    target: "<= 200 KB gz"
  - metric: "runtime bundle after CURVES (gzipped)"
    value: "22.78 KB"
    target: "<= 25 KB gz"
  - metric: "golden frames after silk-ribbon"
    value: "183 (from 180; +3)"
    target: "byte-identical existing frames + new baselines"
  - metric: "schemaVersion after CURVES"
    value: "12"
    target: "migration v11 -> v12, all presets restamped"
---

## What shipped

Polyline authoring moved from numeric inspector rows onto the canvas, across
three editor-only arcs.

POLYLINE_OVERLAY (`c1c359e`, `0753ae4`): draggable SVG handles over the preview
pane. Each move drives the existing `setPolylinePoint` action, and
`beginGesture`/`endGesture` on `HistoryCore` collapses a whole drag into one
undo step. Clicking a ghost "+" midpoint inserts a point, Delete removes the
selected one, 64-point cap.

ALIGN (`bb7d259`, `0e4f3e4`): every other polyline layer draws as a dim,
non-interactive ghost. A dragged point snaps within 8px screen space to ghost
vertices, then segments. Alt disables snap. `copyPolylineTo` replaces a target
layer's points in one undo step.

CURVES (`060d2ed`, `8de3039`): a `smoothing` slider in [0,1] backed by
centripetal Catmull-Rom, plus a 57th showcase preset, silk-ribbon. This was
the only arc that bumped the format, v11 to v12.

## Decisions

The overlay is DOM SVG above the Pixi canvas, not Pixi geometry. Hit-testing
and keyboard focus come for free, and it stays out of the render path.

Point edits don't broadcast across a multi-select. Vertex coordinates are
per-shape geometry, and broadcast is only defined when point counts match.
Alignment got ghosts, snap and an explicit copy action instead.

No bezier handles, no pen tool. Handles stay on the authored points.
`smoothing === 0` short-circuits to the old unflattened path, and one
`flattenPolyline` exported from runtime core feeds both the sampler and the
overlay outline, so the curve you see is the curve that emits.

## What broke

The short-circuit was a near miss that research caught before any code.
Tension 0 through the Hermite path is smoothstep-parameterized, not linear.
Trusting "mathematically collinear" for straight polylines would have moved
every existing golden frame. Only the exact-zero short-circuit keeps them
byte-identical, and arc-weld's frames surviving the v11 to v12 restamp
untouched is the proof. I don't trust "equivalent" in a renderer. The goldens
exist so I never have to.

silk-ribbon needed one rework. The first cut put points at zero crossings,
which starves centripetal Catmull-Rom of curvature, and open-end tangents are
chord-straight, so it barely looked curved. All four points sit at extrema
now.

## Numbers

Tests: 1315 after the overlay, 1337 after alignment, 1366 after curves. Editor
bundle 166.25 to 167.48 to 169.04 KB gz against a 200 KB budget. Runtime
22.78 KB of its 25 KB ceiling. Golden frames 180 to 183, all three new ones
silk-ribbon's, every other preset byte-unchanged.

## Next

Phase 7 is the correctness pass, adding test guards through the same action
layer. The overlay's transform, gesture and snap primitives are reserved for
attractor, floor and kill-zone handles later. Backlog note, not this arc.
