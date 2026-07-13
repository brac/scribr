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

Every weapon now evolves. The level-up flow gained a per-weapon level cap: a
weapon takes four stat upgrades (level 1 through 4), and its fifth and final
pick is a one-time evolution that leaves it maxed. `WeaponState` grew a `level`
and an `evolved` flag per weapon, and `rollUpgrades` became level-aware,
grouping the upgrade pool by weapon and firing kind so it can drop a weapon's
stat cards once it is eligible and slot in the evolution card instead.

Five evolutions landed, each a branch inside the weapon's existing `update*()`
system keyed on `evolved`: the Dagger becomes Thousand Fangs (three parallel
daggers, near-constant fire at a 0.05s cooldown, each stopping at its first
hit); the Whip becomes Reaper (the same wedge, alternating front-back-front on a
0.5s cadence at extended reach); Garlic becomes Black Aura (1.6x radius, 3x
damage, a 0.28s re-tick versus the base 0.45s, dark-tinted, flicking a tendril
to each struck enemy); the Axe becomes Cyclone (gravity off, eight axes flung
outward on a rotating spiral, each 100% bigger); and the Laser becomes Prism
(forking from each impact point up to a depth cap). This commit also raised base
laser damage from 17 to 26 and added a dev menu (backtick key) that sets any
weapon to base / +1 / max / evolved on the fly so each stage is testable without
grinding level-ups.

## Decisions

The load-bearing decision was the evolution trigger. The genre's reference
implementation, Vampire Survivors, gates each evolution behind a specific paired
passive, which means tracking prerequisite pairs and teaching the player a hidden
recipe. The backlog item read literally — "upgraded 5 times, then becomes
something much more powerful" — so we made the fifth pick *be* the evolution: four
stat picks accumulate a level, and the fifth is the transform. It needs no
prerequisite bookkeeping and keeps the whole rule explainable in one sentence.
Honestly, I think VS's paired-passive recipes are wiki-driven design — a game
is better when its signature rule fits in one sentence you can learn by playing.
Level counts picks for that weapon, not which stat, so taking count + rate +
damage + damage is level 4 and unlocks the evolution.

The second decision was how the evolution is offered. Left in the random pool, a
player could go a whole run without ever seeing the card for the weapon they
built around. So once a weapon hits level 4 and is not yet evolved, its evolution
card is force-included in the three choices and styled gold. The player still
chooses it — the moment stays an act of agency, not an automatic swap — but RNG
can no longer deny it. After evolving, the weapon leaves the upgrade pool
entirely and contributes nothing to future rolls.

The third was scope: no evolution gets a new subsystem. Each reuses the hitbox
its base weapon already owns, so the entire feature is data plus one conditional
branch per weapon system, and the collision/pooling backbone is untouched.

## What broke

The guaranteed-card rule collides with the three-slot upgrade roll. If several
weapons reach level 4 in the same level-up, more evolution cards want a
guaranteed slot than there are slots. The naive fill would have silently dropped
the overflow, meaning a player could be owed an evolution they never get offered.
The fix was to give guaranteed evolution cards priority for the three slots and
have any extras wait for the next level-up rather than vanish — logged, not
dropped.

Prism shipped as a first cut, not a final shape. The doc flagged the evolution
names and numbers as placeholders pending a balance pass, and Prism's
fork-from-impact tree was the weakest of the five in play. The two commits
immediately after this one (`ca1bced`, then `82adf93`) reworked its sizing and
behavior — the splitting tree was ultimately replaced by a reflecting beam. The
mechanic-first, tune-second order was deliberate, but Prism is the clearest case
of the first working version not being the one that stuck. I'd still ship it in
that order every time — you can't balance a weapon you haven't felt.

## Numbers

This phase added no dedicated performance benchmark; it is a gameplay feature, and
the gate it had to hold was the standing frame budget from the vertical slice —
weapon work does not proceed unless the 2000-enemy target still holds. The
project's recorded steady-state numbers are ~1-2 ms logic and <1 ms render at
2000 enemies, against a 4 ms / 8 ms budget, and the evolutions stay inside it
because they add bounded work to pools that already exist: Cyclone's eight-axis
rings and Prism's fork tree both draw from the shared projectile pool with no new
per-frame allocation. The one hard number that moved in this commit is a tunable,
not a measurement — base laser damage from 17 to 26.

## Next

The immediate follow-up is the balance pass the placeholder names and numbers
were deferring, starting with Prism. Beyond that, the next phase pivots the whole
game from a top-down arena to a side-scroller, which re-aims several of these
evolutions downrange and forces the Axe and Whip reworks.
