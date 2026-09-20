---
title: "Porting Petriarch's Tier A sim to WebGPU for 20,000 agents"
date: 2026-06-26
project: "petriarch"
phase: 2
tags: [webgpu, wgsl, gpu, performance, simulation]
draft: false
summary: "Every per-agent Tier A pass moves to WGSL compute kernels, verified against the CPU golden reference, scaling the sim to 20k agents on an RTX 3090."
repo_ref: "2f0645162d8457c045693471551077745f6924dc"
decisions:
  - what: "One compute pass per Tier A kernel, not one pass for the chain"
    why: "WebGPU only synchronizes memory between passes, not between dispatchWorkgroups"
    alternatives: ["Single pass with multiple dispatches (corrupted cell offsets)"]
  - what: "Treat the GPU as its own determinism domain; CPU stays the golden reference"
    why: "Atomic scatter/CAS execute in thread order, so same-seed runs diverge"
    alternatives: ["Force bit-identical CPU/GPU output"]
  - what: "Resource intake as a bitcast atomic<u32> compare-exchange clamp loop"
    why: "WGSL has no atomic float; conserves energy under the one shared Tier A write"
    alternatives: ["Non-atomic write (loses/duplicates resource under contention)"]
benchmarks:
  - metric: "agent count on GPU (RTX 3090)"
    value: "20,000"
    target: "MAX_AGENTS raised 5,000 -> 20,000 for real GPU headroom"
  - metric: "per-tick GPU sync (20k agents, max)"
    value: "~4ms/tick mapAsync"
    target: "the profiling wall; compute was microseconds, Tier B ~0.6ms/tick"
  - metric: "GPU vs CPU statistical equivalence @ 250 ticks"
    value: "GPU pop 813 / meanSIZE 1.596 vs CPU pop 760 / 1.623"
    target: "same equilibrium + regime, differing only in chaotic detail"
  - metric: "steer kernel verify vs CPU golden reference"
    value: "0 mismatches, worstAbs ~3e-4"
    target: "deterministic blend matches CPU on the same seed"
---

## What shipped

All five Tier A passes (spatial hash, sense, steer, integrate, metabolism) now
run as WGSL compute kernels with state resident in GPU buffers. Press `g` and
an async pump drives the loop. The whole chain runs in one submission, the CPU
reads it back once per tick, and the symbolic Tier B systems (conflict,
reproduce, death) run unchanged on the CPU. `MAX_AGENTS` went from 5,000 to
20,000, and the sim ran headful on an RTX 3090.

## Decisions

The buffer contract made the port mechanical. Every Tier A pass reads flat
structure-of-arrays typed arrays at fixed strides and writes one output
buffer, so `global_invocation_id.x` maps straight onto the agent index. Only
the host language changed.

I gave up on bit-identical GPU runs. The scatter and metabolism atomics execute
in thread-dependent order, so same-seed runs diverge (863 vs 861 agents across
two runs). The CPU path stays the golden reference for snapshots and headless
runs. GPU correctness means statistically equivalent and stable, not
reproducible. That felt wrong for about a day. It isn't. Pretending atomics
have an order is how you lose a month.

Resource intake is the one shared write in Tier A. WGSL has no atomic float,
so the resource buffer is bound as `array<atomic<u32>>` holding f32 bit
patterns, and intake is a bitcast compare-exchange clamp loop. Energy is
conserved; order under contention is not. Each pass was verified against the
live CPU pass on the same seed before moving to the next.

## What broke

Encoding the four hash kernels in one compute pass corrupted nearly every cell
offset. WebGPU synchronizes memory between passes, not between
`dispatchWorkgroups` calls, so `scan` read `counts` before `count` finished.
One compute pass per kernel fixed it.

The steer kernel silently produced zero-init output. WGSL refuses to infer
precedence between `*` and `^`, so the shader never compiled, and nothing said
so until I captured `device` uncapturederror events. Separately,
`steerOutBuf` lacked `COPY_DST`, so integrate's verify "passed" against
leftover buffer contents for a while.

Verifies also raced the rAF loop. Comparing a moved CPU snapshot against the
GPU's earlier one gave false plus-or-minus-one-cell mismatches. Every verify
now freezes its inputs before the first await.

## Numbers

Profiling on the 3090 at 20k agents, everything maxed: the wall was the
per-tick GPU sync, about 4ms/tick in `mapAsync`. Compute was microseconds.
Tier B was small too (conflict ~0.3, death ~0.1, hash ~0.2 ms/tick; the
earlier "71ms" reading was a population-explosion transient). Collapsing seven
readback sync points into one `mapAsync` and adding a one-frame-latency
pipeline hid most of it at about 1 tick per frame.

## Next

Trade, the first authored social layer, built on this substrate.
