---
title: "What this log is, and how it gets written"
date: 2026-07-12
project: field-notes
tags: [meta, process]
draft: false
summary: "A short note on what this devlog is: a build record drafted by the agents at each phase gate, edited by a human, one entry per completed phase."
---

## What this is

This is a build log. Each project here is assembled in phases, and each phase
ends at a gate — a fixed set of checks that either pass or do not. When a gate
passes, the agent that did the work drafts an entry: what shipped, the
decisions that had real alternatives, what broke, and the numbers that were
measured. Nothing gets written up before the gate is green.

## How it gets written

The first draft is machine-written, on purpose. The agent that closed the
phase has the full context — the dead ends, the benchmark runs, the reason a
simpler approach was rejected — while it is still fresh, so it writes the
record then rather than reconstructing it later. A human edits after: trims,
corrects, keeps what matters. The voice is flat and factual, not promotional. If
a number is here, it was measured; if a decision is here, it had a losing
alternative worth naming.

## What to expect

One entry per completed phase, roughly. Some phases are plumbing and read like
it. The point is the record, not the reach — a place to see how these things
were built, gate by gate, rather than how they might be pitched.
