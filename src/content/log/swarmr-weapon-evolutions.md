---
title: "Every weapon evolves: swarmr's guaranteed 5th-pick upgrade"
date: 2026-06-24
project: "swarmr"
phase: 5
tags: [gamedev, weapons, progression, pixijs, typescript]
draft: false
summary: "A per-weapon level cap turns the 5th upgrade pick into a one-time evolution, guaranteed as a gold card, reshaping all five weapons with no new subsystems."
repo_ref: "9923837"
decisions:
  - what: "The 5th upgrade pick is the evolution itself — 4 stat picks, then a one-time transform"
    why: "It is the backlog-literal reading of 'upgraded 5 times, then becomes much more powerful' and needs no new prerequisite tracking"
    alternatives: ["Vampire Survivors' paired-passive unlock (weapon + specific passive)", "A separate evolution currency or altar"]
  - what: "Once a weapon reaches level 4, its evolution card is force-included in the level-up roll, styled gold"
    why: "RNG can never lock the player out of the genre's signature moment while they still choose to take it"
    alternatives: ["Leave the evolution card in the random pool", "Auto-evolve on hitting level 4 with no pick"]
  - what: "Each evolution is an `evolved` branch inside the existing update*() system, reusing that weapon's current hitbox"
    why: "No evolution needs a new engine subsystem — projectile pool, sword arc, garlic disc, and laser segment already exist"
    alternatives: ["New per-evolution systems and pools", "A generic modifier layer stacked on base weapons"]
benchmarks:
  - metric: "logic tick @ 2000 enemies"
    value: "~1-2 ms"
    target: "<=4 ms (the standing budget the phase had to hold)"
  - metric: "render @ 2000 enemies"
    value: "<1 ms"
    target: "<=8 ms (the standing budget the phase had to hold)"
---

## What shipped

Every weapon now evolves. The level-up flow gained a per-weapon level cap: four
stat upgrades, then a fifth pick that is a one-time evolution. `WeaponState` grew
`level` and `evolved` flags, and `rollUpgrades` became level-aware, dropping its
stat cards once eligible and slotting in its evolution card.

Five evolutions landed, each a branch in an existing `update*()` system:
Dagger becomes Thousand Fangs (three parallel daggers, 0.05s cooldown); Whip
becomes Reaper (alternating front-back-front at extended reach); Garlic becomes
Black Aura (1.6x radius, 3x damage); Axe becomes Cyclone (eight axes on a rotating
spiral); and Laser becomes Prism (forking from each impact point). The commit also
raised base laser damage from 17 to 26 and added a dev menu (backtick key) for
testing each stage without grinding.

## Decisions

The evolution trigger was the load-bearing decision. Vampire Survivors gates each
evolution behind a specific paired passive — prerequisite pairs and a hidden
recipe. Our backlog item read literally ("upgraded 5 times, then becomes
something much more powerful"), so the fifth pick *is* the evolution. Honestly, I
think VS's paired-passive recipes are wiki-driven design — a game is better when
its signature rule fits in one sentence you can learn by playing.

Two smaller calls followed. To keep RNG from burying it, a weapon's evolution card
is force-included in the level-4 roll and styled gold — chosen, not automatic —
then it leaves the pool. And no evolution gets a new subsystem: each reuses its
base weapon's hitbox, so the whole feature is data plus one conditional branch.

## What broke

The guaranteed-card rule collides with the three-slot roll: if several weapons
reach level 4 at once, more evolution cards want a slot than exist, and the naive
fill would silently drop the overflow — a player owed an evolution they never see.
The fix gave guaranteed cards priority and made extras wait for the next level-up.

Prism shipped as a first cut. The doc flagged its names and numbers as
placeholders, and its fork-from-impact tree was the weakest of the five; two later
commits (`ca1bced`, `82adf93`) reworked it, replacing the splitting tree with a
reflecting beam. Mechanic-first, tune-second was deliberate. I'd still ship it in
that order every time — you can't balance a weapon you haven't felt.

## Numbers

No dedicated benchmark this phase — a gameplay feature gated only by the vertical
slice's frame budget: weapon work does not proceed unless the 2000-enemy target
holds. Steady-state is ~1-2 ms logic and <1 ms render at 2000 enemies against a
4 ms / 8 ms budget, and the evolutions stay inside it by adding only bounded work
to existing pools. The one hard number that moved is a tunable — base laser damage
from 17 to 26.

## Next

The immediate follow-up is the deferred balance pass, starting with Prism. Beyond
that, the next phase pivots the game from a top-down arena to a side-scroller,
re-aiming several evolutions downrange and forcing the Axe and Whip reworks.
