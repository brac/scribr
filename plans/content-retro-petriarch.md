# Content batch — petriarch retro drafts + trim pass

**Author:** Fable (planner/reviewer). Two Opus implementers run in parallel.
**User directives:** keep word counts down (overrides the contract's 400-word floor — target 300–450 body words for new drafts); trim the three published posts; publish the petriarch entries after the human voice pass.

## Agent A — petriarch retro drafts (works in C:\Users\Ben Bracamonte\Work\Petriarch)

- Research git log, docs/, README, tools/ findings. Pick the **two most significant completed arcs** (candidates visible in history: the social simulation layers — trade/territory/borders — and whatever foundational sim/render arc preceded them; verify against actual commits).
- Two files `devlog/phase-{N}-{slug}.md` per `scribr/docs/CLAUDE-DEVLOG-SECTION.md`, **300–450 body words each** (user override; density over completeness — decisions and failures survive, exposition dies).
- Real numbers only, sourced from repo (tools/ studies, README, commit messages). Real SHAs for repo_ref.
- Frontmatter valid per scribr constraints (title 8–90, summary 20–160, tags 1–5 lowercase, draft: true, project: petriarch).
- Git hygiene: fetch; require local main == origin/main for tracked files (a locally modified .gitignore exists — do NOT stage it); stage ONLY the two devlog files; one commit; push. That is the only commit/push authorized.

## Agent B — trim the three published posts (works in scribr)

Targets (body prose only — frontmatter, decisions/benchmarks arrays, title, summary stay untouched):

1. `src/content/log/swarmr-weapon-evolutions.md` — ~810 → **≤ 500** words. Preserve verbatim the two first-person opinion lines ("Honestly, I think VS's paired-passive recipes…" and "I'd still ship it in that order every time…") — they are the human's voice.
2. `src/content/log/particlr-spatial-hash.mdx` — → **≤ 350** words. Preserve: all five `##` sections, the MDX import + `<ParticlrDemo preset="ember-field" client:visible />` + its italic intro line, and the h1-relevant title (e2e asserts it).
3. `src/content/log/field-notes-hello-log.md` — tighten only if it doesn't gut it; it's already short.

Constraints: five sections stay present in order on phase posts (tests check `<h2>` count/ids); "What broke" keeps real content; no new claims, only cuts. After editing run: `npm run build`, `test:phase0`, `test:phase1`, `test:phase3`, `test:e2e` — all must exit 0. Report per-post before/after word counts. Do not commit.

## Reviewer (Fable)

Setup: add `petriarch` to `src/lib/projects.ts` + `scribr.config.json` (done before agents launch). Review both outputs (read drafts, spot-check sourced numbers against petriarch history, re-run scribr gates), sync, run the voice-pass dialog with Ben (candidate opinion lines shown as previews), flip drafts, gates, commit, push, verify live.
