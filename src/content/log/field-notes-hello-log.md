---
title: "What this log is, and how it gets written"
date: 2026-07-12
project: field-notes
tags: [meta, process]
draft: false
summary: "A short note on what this devlog is: a build record drafted by the agents at each phase gate, edited by a human, one entry per completed phase."
---

## What this is

A build log. Each project here is built in phases, and each phase ends at a
gate: a fixed set of checks that pass or don't. When a gate passes, the agent
that did the work drafts an entry. What shipped, the decisions that had real
alternatives, what broke, and the numbers that were measured. Nothing gets
written up before the gate is green.

## How it gets written

The first draft is machine-written, on purpose. The agent that closed the
phase still has the dead ends, the benchmark runs and the reason a simpler
approach lost, so it writes the record while that's fresh instead of
reconstructing it later. Then I edit: trim, correct, keep what matters. The
voice is flat and factual. If a number is here, it was measured. If a decision
is here, it had a losing alternative worth naming.

## What to expect

One entry per completed phase, roughly. Some phases are plumbing and read like
it. The point is the record, not the reach. A place to see how these things
were built, gate by gate, rather than how they might be pitched.
