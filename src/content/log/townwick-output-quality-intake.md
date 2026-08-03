---
title: "Townwick Q4: the intake round, and the questions the sections were waiting for"
date: 2026-08-02
project: townwick
phase: 3
tags: [intake, interview, prompts, extraction, gates]
draft: false
summary: "The output-quality programme closes: per-vertical interview kits, a scaffolder that won't overwrite answers, and a zero-key extraction prompt with a gate."
repo_ref: "output-quality-q4"
decisions:
  - what: "Zero-key intake: the extraction is a prompt the operator runs in their own Claude Code session, so this repo makes no LLM call and holds no API key"
    why: "The consuming machinery already exists, since the Console's C3 editor validates a pasted config.yaml against the real schema before committing it. A key would add a billing surface and break the C4 gate's no-network proof, to automate a step a human should be reading anyway."
    alternatives: ["Wire ANTHROPIC_API_KEY into the console and make the packages/ai stubs real (still queued as Personalization Pipeline P2)"]
  - what: "The prompt-kind enum split rather than widened; intake_extract is added outside QUEUE_ITEM_KINDS"
    why: "intake_extract is the one kind whose output is never a queue item, it's a proposed config.yaml consumed by the editor save path. Widening the enum would falsely promise the Inbox can file one."
    alternatives: ["Add intake_extract to QUEUE_ITEM_KINDS (semantically wrong)", "Drop the satisfies constraint (loses the invariant)"]
  - what: "The filled interview file is committed client data, and the scaffolder refuses to overwrite it"
    why: "clients/<slug>/interview.md is the provenance record, the answer to 'who said this' for every fact on the page. Once it holds a real conversation, 'regenerate' means 'throw their answers away', so pnpm interview exits 2 instead."
    alternatives: ["Keep notes in the gitignored intake/ directory (loses provenance)", "Overwrite with a --force flag (a flag that deletes a conversation)"]
  - what: "The grounded-extraction property is a gate row, not a hope"
    why: "Every proper noun, price, year and quoted sentence the worked example adds must appear verbatim in the interview notes, and the [off]-marked fact must appear nowhere. The prompt says 'never invent', and rules without a gate are comments."
    alternatives: ["Trust the prompt's rules (the exact gap the whole trust posture argues against)", "Re-implement extraction in the gate (drifts from the product)"]
  - what: "Kit coverage is frontmatter (covers:) resolved against the real Zod schema by walking it, with required sets per vertical held in the gate"
    why: "A kit that promises to feed team.members[].nicknmae has to fail, and it can only fail if the schema is the thing being asked. The required sets live in the gate, because a gate that derives its requirement from the thing it checks proves only self-agreement."
    alternatives: ["A hand-maintained list of legal paths (drifts)", "No coverage check (kits quietly rot as the schema moves)"]
  - what: "The specials image-feed mode stays deferred, with a dated note in docs/06"
    why: "Q4's path is deliberately zero-key and zero-upload, so it produces no place for a shop owner to drop a weekly image, which is the whole and only blocker."
    alternatives: ["Build it now (doubles the milestone with theme, lexicon and photo-pipeline work for a surface no client has asked for)"]
benchmarks:
  - metric: "gates"
    value: "intake 81/81, console-c4 114/114, tests 362+38+71, typecheck 0, validate 6/6, pnpm verify byte-identical to pre-Q4 verdicts"
    target: "c2/c3 verified green after commit (structurally red on a dirty tree)"
  - metric: "review negative proofs"
    value: "a name planted in the real example fixture failed the full gate naming the plant (77/81); removing intake-extract.md failed the edited c4 gate on all five touched rows; both restored byte-exact"
    target: "every gate edit negative-proven end to end, not just internally"
  - metric: "kits"
    value: "27 questions across core plus 3 vertical kits, each with a research citation and a config marker; 24 covers: paths, all resolving against the shipped schema"
    target: "no orphan questions, no unasked covers"
---

## What shipped

The research corpus closed with a line that was really a brief: "A pipeline
that adds section types without adding these intake questions will produce
empty new sections." Q4 is that gap closed.

The questions ship as per-vertical interview kits, scaffolded with
`pnpm interview <slug>`. There are 27 of them across a core kit and three
vertical kits, and every single one carries a citation back to a named research
finding plus a marker showing which config path it feeds. Nothing is in there
because it seemed like a good question to ask.

The extraction path is a strict prompt template. It renders in the Prompt Lab
or by hand, the operator runs it in their own model session, and the output
gets pasted into the Console's validating editor. Then docs/07, the runbook
that ties all of it to the consent rules: blank beats guessed, quotes are
verbatim or absent, and `[off]` never reaches the page in any form.

The worked example is the fictional showcase barbershop interviewed inside its
own fiction. A filled questionnaire produced by the real scaffolder, and a
hand-authored example output that the gate holds to the extraction contract.
Same discipline as every other showcase fixture, except now the
grounded-extraction property is machine-checked rows instead of a habit.

## Decisions

Zero-key was the call that shaped everything else. The extraction runs in the
operator's own session, so this repo makes no LLM call and holds no API key.
The consuming machinery already existed, since the Console's C3 editor
validates a pasted `config.yaml` against the real schema before anything gets
committed, so the only genuinely missing pieces were the questions and the
prompt. Adding a key would have bought a billing surface and broken the C4
gate's no-network proof, all to automate a step a human should be reading
anyway. The `packages/ai` stubs are untouched and still wired for the day that
changes.

The scaffolder refusing to overwrite is a small thing that matters. Once
`clients/<slug>/interview.md` holds a conversation with a real person in their
own words, "regenerate" means "throw their answers away", so `pnpm interview`
exits 2 instead. There's no `--force`. A flag that deletes a conversation is
not a flag I want in the tool.

And the grounded-extraction property is a gate row rather than a hope. The
prompt says never invent, but rules without a gate are comments. The check
borrows `pnpm verify`'s own `properNounRuns` and `normalizeForMatch`, so
"proper noun" means the same thing at intake as it does at go-live. Five
negative rows each fire on a mutated temp copy, and each mutation is proven to
have actually mutated by byte comparison first.

## What broke

The full-battery run surfaced something worse than a bug in this milestone:
**main's CI has been red since the CJ flagship rebuild** (07bcadb and 4515df3).

Five older gates, phase-1, phase-3, sections, motion and trust, hardcoded the
seed client's original state: stock photos, classic variant, no sections block,
reveal off. The rebuild moved all of it. Triage says none of them is a product
regression, they're all gates pinned to a fixture that legitimately changed.

The sharpest case is a good demonstration of how brittle a string-matching gate
can be. The motion gate has a row asserting the `.member` press-state is still
present, and it trips on the string `.member.is-pressed` sitting inside a CSS
**comment** in the reveal stylesheet, which `reveal: true` newly pulled into the
seed build. So the gate is passing on a comment.

Reconciliation is its own follow-up round: gates re-pinned to temp-copy
fixtures, negative proofs re-run. Q4's own gates are green and touch none of
the five, which is the only reason this shipped rather than stopping.

## Numbers

Intake gate is 81/81. Console-c4 went to 114/114 once its arrays gained the
fourth template. Tests are 362 plus 38 plus 71, typecheck 0, validate 6/6, and
`pnpm verify` on cjs and fern-and-fade returns byte-identical verdicts to
pre-Q4.

The negative proofs are the part worth reading. A name planted in the real
example fixture failed the full gate at 77/81 with the plant named, and the
collision between that plant and negative row (a)'s own target got caught by
the mutation-must-mutate guard, which is the guard doing exactly what it's for.
Deleting `intake-extract.md` failed the edited c4 gate on all five touched
rows. Both restored byte-exact, sha-verified.

## Next

The output-quality programme is done. Next up is the CI reconciliation round to
un-red main, then phase 4, billing, which is the last numbered phase in
docs/06.
