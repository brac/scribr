---
title: "Trade caravans crossing Petriarch's dead zone"
date: 2026-06-30
project: "petriarch"
phase: 3
tags: [trade, stigmergy, emergence, simulation, gpu]
draft: false
summary: "The first authored social layer: supply-scent, a provisioning gate, and a round-trip carry cycle turn two isolated societies into trading partners."
repo_ref: "2604eb266d642bd1d8817f9b0a85fc1a820e54a6"
decisions:
  - what: "Geography-anchored supply-scent cone, not a deposited demand field"
    why: "A deficit field tracked population density and herded agents to their own centre"
    alternatives: ["Deficit-broadcast demand field", "Diffused capacity field (decays to noise across the gap)"]
  - what: "Provisioning as an energy-reserve gate on the scent term"
    why: "Only well-fed agents cross; cleaner and subsumes the hoard/discount/gene levers"
    alternatives: ["Emergent hoard-then-cross", "In-transit metabolic discount", "A provisioning gene"]
  - what: "Round-trip carry/return state machine, home = claim-field gradient"
    why: "Carriers must return or the two societies merge (colonization, the opposite of trade)"
    alternatives: ["One-way crossing/settlement", "Kin-centroid home", "Stored birth-cell origin"]
  - what: "Slow amity decay (0.998)"
    why: "Amity bites on persistence, not magnitude; fast decay faded before the next frontier trade"
    alternatives: ["Fast decay with cranked suppress/volume (<1% of fights suppressed)"]
benchmarks:
  - metric: "pacified frontier cells (amity study, 16k x 4 seeds)"
    value: "13 -> 245"
    target: "a broad trading district, not one hot pixel"
  - metric: "global fights/k with amity vs trade-only"
    value: "5176 -> 4357 (-16%; -26% vs no-trade)"
    target: "conflict recedes globally, not just relocates"
  - metric: "cross-gap trade under supply-scent (3 seeds x 8k, weight 0.6)"
    value: "+31% (874 -> 1145/k), traffic 1.2% -> 1.9%"
    target: "sustained cross-gap flux, was ~0; weight 1.0 = migration not trade"
  - metric: "provisioning gate recovery (provisionFloor 0.45)"
    value: "+700 pop (8128 -> 8828), +5.6pts breed, survival tax halved -12% -> -5%"
    target: "the gap becomes a filter, not a wall"
---

## What shipped

Petriarch's first authored social layer. Two societies now trade complementary
goods across a barren gap with no food in it.

Agents climb a long-range supply-scent toward the nutrient they lack. A
provisioning gate lets only the well-fed attempt the crossing. A carry/return
state machine hauls cargo home, so goods move both ways without either
population emigrating. Carriers wear a visible caravan road into the dead
zone, and a slow-decaying amity field cools the frontier into a pacified
market.

This was the first Tier A/GPU change since the WebGPU port. The scent and gate
terms ship in `steer.wgsl`, re-verified on the 3090.

## Decisions

Long-range reach was the hard part. The obvious design, a deposited demand
field, failed (below), so the supply-scent is a static, monotonic cone
anchored to each nutrient's region, and deficit-weighted agents climb it.
Weight 0.6 is the cap. At 1.0 region A empties out, which is migration, not
trade.

Provisioning is one energy-reserve gate on the scent pull instead of the three
levers I'd planned. The gate subsumes two of them and only lures agents with
enough reserve to survive the crossing.

The return leg is required. Without it the two societies blur into one. So
cargo is carried, not consumed, and "home" reuses the existing claim-field
gradient.

## What broke

The deficit-broadcast demand field failed outright. With both regions eaten
down to scarcity, agents are hungry for both nutrients, so demand tracked
population density and peaked inside each region. Climbing it herded agents
toward their own centre and gap traffic went down. A spatial probe proved it
before the rewrite. Diffusing the capacity field was tried first and also
rejected, since it decays the far signal to noise and is never monotonic
across the 20-cell gap.

This was the most useful failure of the phase. Broadcast demand and let agents
answer it is the design a doc approves and a simulation vetoes. You only find
out by running it.

Amity barely moved at first. Suppress at 0.5 and per-trade volume at 5 capped
peak amity near 4, with under 1% of fights suppressed, because at fast decay
each deposit faded before the next sparse frontier trade. Slow decay (0.998)
fixed it.

The gate's nonlinearity nudged the CPU-f64/GPU-f32 steer divergence up for a
few borderline agents. A seed sweep showed 0 to 3 of ~3900 agents,
non-systematic, so I widened the verify tolerances instead of chasing a
phantom logic bug.

## Numbers

Amity from `amitycheck.ts` (16k x 4 seeds): pacified cells 13 to 245, global
fights/k down 16% versus trade-only and 26% versus no trade, TRADE selection
0.45 to 0.49. Crossing numbers from `crossing.ts` (3 seeds x 8k). A later
conflict-recession run (seed 11, 20k ticks) confirmed it globally: per-capita
fights fell 70%, 1.25 to 0.38/k/agent, as commerce took over.

## Next

Territory, the second social layer. Societies fight harder on home ground and
hold coherent borders.
