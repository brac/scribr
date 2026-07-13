# CLAUDE.md — Devlog Section

> Paste this section into each project repo's `CLAUDE.md`. It defines the devlog artifact required at every phase gate. Replace `{{PROJECT}}` with the project slug (`particlr`, `haulr`, etc.).

---

## Devlog artifact (required at phase completion)

Every completed phase MUST produce a devlog draft before the phase can be marked complete. The devlog is a phase artifact with the same standing as code, tests, and benchmarks: **the reviewer gates on it.**

### File

- Path: `devlog/phase-{N}-{short-slug}.md` (e.g. `devlog/phase-3-collision-rework.md`)
- Format: **plain CommonMark + YAML frontmatter. Never MDX. No HTML. No JSX. No components.** Embeds are added later by a human.
- One file per phase. Do not edit previous phases' devlog files.

### Frontmatter (all fields required unless marked optional)

```yaml
---
title: ""            # Post title. Specific and concrete, not generic.
                     # GOOD: "Rebuilding particlr's collision pass for 2,500 sprites"
                     # BAD:  "Phase 3 Update"
date: YYYY-MM-DD     # Date the phase completed
project: "{{PROJECT}}"
phase: N             # Integer phase number
tags: []             # 2-5 lowercase tags, e.g. [pixijs, performance, collision]
draft: true          # Always true. Never set false. Publishing is a human act.
summary: ""          # One sentence, <160 chars. Used for cards, OG, RSS.
repo_ref: ""         # Commit SHA or tag this post describes (the phase-completion commit)
decisions:           # Every locked decision made this phase. Empty array if none.
  - what: ""         # The decision, one line
    why: ""          # The reason it won, one line
    alternatives: [] # What was rejected, as strings
benchmarks:          # Every measured number this phase. Empty array if none.
  - metric: ""       # e.g. "frame time @ 2500 sprites"
    value: ""        # e.g. "3.1ms"
    target: ""       # e.g. "<4.16ms (240Hz budget)" — the stop condition it satisfied
---
```

### Body structure

Write these sections, in this order, using `##` headings:

1. **`## What shipped`** — What exists at the end of this phase that didn't exist before. Concrete: features, systems, files. 2-4 paragraphs max.
2. **`## Decisions`** — Prose context for the frontmatter `decisions` array. For each: the situation, the options actually considered, why the winner won. This is the most valuable section — do not compress it to a table restatement.
3. **`## What broke`** — Failures, dead ends, and reverted approaches from this phase. Be specific: what was tried, what the failure looked like (error, artifact, bad numbers), what the fix or retreat was. If genuinely nothing broke, write one line saying so — do not invent drama.
4. **`## Numbers`** — Prose context for the `benchmarks` array: how measurements were taken, what moved since last phase, anything surprising.
5. **`## Next`** — 2-3 sentences on what the next phase targets. No roadmap essays.

### Voice and content rules

- **Capture raw material, not marketing.** The human editor adds voice and opinion. Your job is to make sure nothing interesting is lost: the exact error message, the number before and after, the alternative that almost won.
- **Past tense, first person plural is fine ("we moved the broadphase to...").** No exclamation marks. No "excitingly", "delightfully", "robust", "seamless", "blazing".
- **Every claim of improvement needs a number** from `benchmarks` or a `repo_ref`-reachable diff. No unquantified "significantly faster".
- **Name the failures honestly.** "What broke" with real content is what makes these posts worth reading. A phase with zero failures and zero rejected alternatives will be treated as an incomplete draft by the reviewer.
- Length target: 400-900 words of body. Below 400 usually means decisions/failures were dropped; above 900 usually means changelog padding.
- Do not reference internal orchestration (agent roles, prompts, gate mechanics) unless the phase was *about* the agent workflow itself.
- Do not include code blocks longer than ~15 lines; link to the `repo_ref` instead. Short, load-bearing snippets are fine.

### Reviewer gate checklist (devlog)

The reviewer MUST verify before phase sign-off:

- [ ] File exists at `devlog/phase-{N}-{slug}.md` and frontmatter parses as YAML
- [ ] All required frontmatter fields present; `draft: true`; `repo_ref` points at a real commit/tag in this repo
- [ ] Every locked decision from this phase's spec/decision log appears in `decisions`
- [ ] Every benchmark that gated this phase appears in `benchmarks` with the actual measured value
- [ ] All five body sections present in order
- [ ] "What broke" is non-empty or explicitly states nothing broke
- [ ] No superlative filler; no improvement claims without numbers; no MDX/HTML/JSX
- [ ] 400-900 words of body

A devlog that fails any item blocks phase completion, same as a failing benchmark.
