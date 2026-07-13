---
title: "Hardening particlr's layer seams: three HIGH correctness bugs no test crossed"
date: 2026-07-12
project: particlr
phase: 7
tags: [correctness, determinism, migrations, testing]
draft: true
summary: "A correctness audit found three HIGH bugs at particlr's layer seams, including a valid document that crashed the runtime; all fixed with zero golden churn."
repo_ref: "745e6a9"
decisions:
  - what: "Fix the validator/runtime seam by normalizing absent nullable fields to explicit null in parseParticle, between migrate and validate"
    why: "Enforces the format's explicit-null convention at the single gate every document passes, instead of weakening the runtime's strict !== null guards; forgiving to npm consumers who hand-build docs"
    alternatives: ["Make the validator reject present-or-null violations (rejects existing hand-built docs)", "Relax the runtime guards to != null (leaves the convention unenforced at the sim)"]
  - what: "Reconcile the parent/child radius constraint in the editor action layer, clamping the child field down in the same gesture"
    why: "Lowering a parent radius honors the user's drag by pulling the dependent field down; putting the clamp in the action makes every future caller safe by construction"
    alternatives: ["Clamp inside the inspector components (misses non-UI callers)", "Push the parent radius up to satisfy the child"]
  - what: "Export validates before writing and refuses an invalid file; autosave stays ungated"
    why: "A file the editor cannot reopen should never be written, but a 500ms-debounced autosave must not block on validation; the action-layer clamp removes the only known invalid-authoring path"
    alternatives: ["Gate autosave on validation too", "Add a new export error dialog instead of reusing the import-failure surface"]
  - what: "Rewrite the round-trip guard to drive every property through its named editor action"
    why: "The audit's recurring finding is that bugs live at seams no test crosses; exercising the action layer is the seam test that would have caught the radius bug"
    alternatives: ["Keep the serialize-then-parse table (structurally blind to action-layer bugs)"]
benchmarks:
  - metric: "vitest suite after remediation"
    value: "1527 passing (from 1384; +143)"
    target: "green — npx vitest run exits 0"
  - metric: "runtime bundle (core+format, gzipped)"
    value: "23.26 KB (+0.48)"
    target: "≤ 25 KB gzipped"
  - metric: "golden-frame churn across 57 presets"
    value: "0 frames changed"
    target: "0 (zero-behavior-change invariant)"
  - metric: "no-op proof: presets byte-identical through parse"
    value: "57 of 57"
    target: "all presets byte-identical before/after normalize"
  - metric: "editor smoke suite"
    value: "52 of 52"
    target: "green"
---

## What shipped

A correctness audit worked over particlr's most expensive-to-get-wrong
machinery: determinism discipline, the v1 to v12 schema migration chain, and
round-trip fidelity. The sim core held — every determinism mechanism probed
(draw-table gating, event ordinals, ribbon ordering, scratch discipline, PRNG
hygiene) was sound. The nine findings (three HIGH, two MEDIUM, four LOW) all
lived at layer seams: editor-action versus format, validator versus runtime,
migration versus spec — boundaries no existing test crossed.

The remediation shipped as four milestones (M1 `4631d64`, M2 `4ce894b`, M3
`06b0dea`, M4 `745e6a9`). M1 closed a silent work-loss bug in the editor. M2
hardened the format's parse gate. M3 rebuilt two test guards that had been
checking the wrong layer. M4 wrote down three scope limitations that are
inherent rather than fixable. End state: the vitest suite went from 1384 to
1527 tests, the editor smoke suite stayed 52/52, the runtime bundle held at
23.26 KB gzipped against a 25 KB budget, and all 57 preset golden frames were
byte-unchanged.

## Decisions

The load-bearing decision was where to fix C2 — the finding that the validator
accepted documents omitting an optional module while the runtime dereferenced
it behind a strict `!== null` guard. A v12 document omitting
`noise`/`collision`/`bySpeed`/`attractor`/`wind` returned `ok` from
`parseParticle`, then crashed `new Effect().step()`. Three fixes were on the
table: make the validator reject present-or-null violations (strictest, but it
rejects the hand-built documents npm consumers legitimately write), relax the
runtime guards to `!= null` (weakest — it leaves the format's explicit-null
convention unenforced at the sim), or normalize absent fields to explicit
`null` in `parseParticle`, between migrate and validate. We took normalization:
one pure function, `normalize.ts`, pinned compile-time-exhaustive against the
TypeScript types via the `satisfies` pattern, so adding a nullable field
without listing it fails `tsc`. The convention is now enforced at the one gate
every document passes, and the validator additionally emits a non-blocking
`E43` warning at the 22 sites that used to tolerate absence.

The parent/child radius bug went into the editor action layer rather than the
inspector components: lowering a parent `radius` now clamps the dependent child
field (`innerRadius`, `killRadius`) down in the same gesture, so any future
caller is safe by construction. Export gained a validation step that refuses to
write a file the editor itself could not reopen, reusing the existing
import-failure surface; autosave stayed ungated, because a 500 ms debounce must
never block on validation and the action clamp removes the only known
invalid-authoring path. The round-trip guard was rewritten to drive every
property through its named editor action — the seam the serialize-then-parse
table structurally could not see.

## What broke

The M2 fix nearly reproduced the defect it was hardening against. The first cut
of the normalizer operated on the migrated document in place. Because the
migration walkers shallow-spread and leave unrewritten subtrees aliasing their
input (finding C8, filed LOW on the assumption that no caller mutates a migrated
doc), normalizing wrote back through those aliases into the caller's original
object — `parseParticle` was mutating its argument. Review caught it before it
merged. The fix was to `structuredClone` the input at the top of
`parseParticle`, with a no-mutation regression test so the guarantee is now
enforced rather than assumed.

M3 had a smaller surprise. Folding the emission accumulators (`acc`, `accDist`,
`spawnCounter`, `burstGates`) into the `_statehash` digest — closing a blind
spot where drift could hide in a fractional-spawn counter — changed 42 of the
57 committed digest snapshots. That churn is mechanical: the hash function
changed, not the behavior. Run-versus-run determinism stayed green across every
preset before and after, and the 15 presets that touch none of the folded
features kept their exact digests. The snapshots were regenerated under review,
not slipped in.

## Numbers

Test count moved 1384 to 1527 across the arc: M1 added 5 (radius clamps,
refused export, autosave round-trip), M2 added 73 (the five crash shapes now
parse-then-step cleanly, the absent-versus-null velocity sub-track holds an
identical stateHash over 60 steps, the no-op proof), M3 added 65 (the
action-driven round-trip section grew that one file from 8 to 73 cases). The
no-op proof is the number that mattered most for confidence:
`serializeParticle(parseParticle(text))` is byte-identical for all 57 presets
before and after normalization, so the change is provably invisible to any
valid document. The bundle cost of `normalize.ts` was +0.48 KB gzipped, landing
the runtime at 23.26 of its 25 KB ceiling.

## Next

The recurring lesson — three audits running, defects only ever at seams —
points the next test-writing effort at boundaries rather than layers: drive new
guards through `parseParticle`, named actions, and `new Effect`, never the code
beneath them. The two remaining open items are unrelated to correctness: the
Tier-2 UV-distortion/heat-haze primitive parked to the WebGPU v2 design, and a
Polar license-key ops follow-up.
