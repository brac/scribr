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

Across three editor-only arcs — POLYLINE_OVERLAY (`c1c359e`, `0753ae4`),
ALIGN (`bb7d259`, `0e4f3e4`), and CURVES (`060d2ed`, `8de3039`) — polyline path
authoring moved from numeric inspector rows onto the preview canvas. The first
arc put draggable SVG handles over the pane: each move drives the existing
`setPolylinePoint` action, and a gesture-scoped `beginGesture`/`endGesture` on
`HistoryCore` collapses one drag into a single undo step. Insert clicks a ghost
"+" midpoint; Delete removes a selected handle, under a 64-point cap. The second
arc added cross-layer alignment: every other polyline layer
draws as a dim, non-interactive ghost, and a dragged point snaps in screen space
within 8px to ghost vertices (then segments), with Alt disabling snap;
`copyPolylineTo` replaces a target layer's points in one undo step. The third
arc gave polylines curvature — a `smoothing` in [0,1] tension slider backed by
centripetal Catmull-Rom, plus a new 57th showcase preset, silk-ribbon. The
overlay and alignment arcs held schemaVersion 11; only CURVES bumped the format
to v12.

## Decisions

The overlay is DOM SVG above the Pixi canvas, not Pixi-drawn — chosen for
hit-testing, keyboard focus, and render-path separation. Point-level edits opt
out of multi-select broadcast, because vertex
coordinates are per-shape geometry; the same reasoning ruled out broadcast for
alignment, which uses ghosts, snap, and an explicit copy action instead. For
curves we
rejected bezier control handles and a pen tool — handles stay on authored
points — and made `smoothing === 0` short-circuit (exact zero) to the
pre-existing unflattened path. A single `flattenPolyline`, exported from
runtime core, feeds both the sampler and the overlay outline, so the drawn curve
and the emitted curve match by construction.

## What broke

The exact-zero short-circuit was a near-miss the research caught before
implementation: tension-0 through the Hermite flatten path is
smoothstep-parameterized, not linear, so trusting math collinearity for straight
polylines would have moved every existing golden. Only the short-circuit
delivers bit-exactness — arc-weld's frames staying byte-identical through the
v11-to-v12 restamp is the proof. That near-miss is why I don't trust
"mathematically equivalent" in a renderer. Bit-exact or it didn't happen — the
goldens exist precisely so this argument never has to be won twice. The silk-ribbon showcase then needed one rework
round: zero-crossing point placement starves centripetal Catmull-Rom of
curvature and open-end tangents are chord-straight, so the first cut barely
looked curved. The rebuild puts all four points at extrema.

## Numbers

The vitest suite grew across the arc — 1315 after the overlay, 1337 after
alignment, 1366 after curves. The editor bundle moved 166.25 to 167.48 to 169.04
KB gz against a 200 KB budget; the runtime landed at 22.78 of its 25 KB ceiling.
Golden frames went 180 to 183 with silk-ribbon's three new baselines, while
every other preset's frames were byte-unchanged.

## Next

The correctness pass (phase 7) follows, driving new test guards through the same
action layer these arcs exercised. The overlay's transform, gesture, and snap
primitives are reserved for future attractor, floor, and kill-zone handles — a
backlog note, not this arc's scope.
