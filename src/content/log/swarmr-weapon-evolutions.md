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
  - what: "The 5th upgrade pick is the evolution itself: 4 stat picks, then a one-time transform"
    why: "It is the backlog-literal reading of 'upgraded 5 times, then becomes much more powerful' and needs no new prerequisite tracking"
    alternatives: ["Vampire Survivors' paired-passive unlock (weapon + specific passive)", "A separate evolution currency or altar"]
  - what: "Once a weapon reaches level 4, its evolution card is force-included in the level-up roll, styled gold"
    why: "RNG can never lock the player out of the genre's signature moment while they still choose to take it"
    alternatives: ["Leave the evolution card in the random pool", "Auto-evolve on hitting level 4 with no pick"]
  - what: "Each evolution is an `evolved` branch inside the existing update*() system, reusing that weapon's current hitbox"
    why: "No evolution needs a new engine subsystem; projectile pool, sword arc, garlic disc, and laser segment already exist"
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

Every weapon evolves now. Each weapon has a level cap: four stat upgrades,
then a fifth pick that is a one-time evolution. `WeaponState` grew `level` and
`evolved` flags, and `rollUpgrades` is level-aware, dropping a weapon's stat
cards once it's eligible and slotting in its evolution card.

Five evolutions, each a branch in an existing `update*()` system. Dagger
becomes Thousand Fangs (three parallel daggers, 0.05s cooldown). Whip becomes
Reaper (alternating front-back-front at extended reach). Garlic becomes Black
Aura (1.6x radius, 3x damage). Axe becomes Cyclone (eight axes on a rotating
spiral). Laser becomes Prism (forking from each impact point). The same commit
raised base laser damage from 17 to 26 and added a dev menu on the backtick
key for testing each stage without grinding.

## Decisions

The trigger was the real decision. Vampire Survivors gates each evolution
behind a specific paired passive, which means prerequisite pairs and a hidden
recipe. My backlog item said "upgraded 5 times, then becomes something much
more powerful", so the fifth pick is the evolution. I think VS's recipes are
wiki-driven design. A signature rule should fit in one sentence you can learn
by playing.

Two smaller calls. Once a weapon hits level 4, its evolution card is forced
into the roll and styled gold, so RNG can't bury it, but you still have to
choose it. And no evolution gets its own subsystem. Each reuses its base
weapon's hitbox, so the whole feature is data plus one conditional branch.

## What broke

The guaranteed card collides with the three-slot roll. If several weapons hit
level 4 at once, more evolution cards want a slot than exist, and the naive
fill silently dropped the overflow. A player owed an evolution would never see
it. Guaranteed cards now take priority and extras wait for the next level-up.

Prism shipped as a first cut. Its names and numbers were flagged as
placeholders and its fork-from-impact tree was the weakest of the five. Two
later commits (`ca1bced`, `82adf93`) replaced the splitting tree with a
reflecting beam. Mechanic first, tune second. You can't balance a weapon you
haven't felt.

## Numbers

No dedicated benchmark. Gameplay work only proceeds if the 2000-enemy target
holds. Steady state is ~1-2 ms logic and <1 ms render at 2000 enemies against
a 4 ms / 8 ms budget, and the evolutions stay inside it because they only add
bounded work to existing pools. The one hard number that moved is base laser
damage, 17 to 26.

## Next

The deferred balance pass, starting with Prism. Then the next phase turns the
game from a top-down arena into a side-scroller, which re-aims several
evolutions downrange and forces the Axe and Whip reworks.
