# Content batch — two more particlr retro drafts

**Author:** Fable (planner/reviewer). One Opus implementer.
**Word target:** 300–450 body words each (standing user override of the contract's 400 floor — density over completeness).

## Constraints specific to particlr

1. **Occupied phase numbers:** particlr already has devlog phase **5** (published: spatial hash) and phase **7** (draft: correctness-seams, in `devlog/phase-7-correctness-seams.md`). The two new drafts must use numbers that keep one coherent ordinal story with those (e.g. earlier foundational arcs below 5, or 6, or above 7 for later arcs). State the rationale.
2. **Arc selection:** particlr's history is rich (SLICE_ONE phases, TIER1/TIER2 particle features, CURVES, ALIGN, the editor, 58 presets, @particlr/runtime npm publish, AUTO_REDEEM/Polar licensing, the correctness arc already covered). Pick the **two most significant completed arcs not already covered** by phases 5/7. Candidates worth weighing: the runtime's npm packaging/publish (it's what made scribr's demo island possible), the preset library/juice arc, the editor arc. Verify completion against commits — no in-progress work.
3. **Git safety — particlr may have unrelated local work.** Another worker previously left local commits/changes in that repo. Therefore: `git fetch origin` first. If local main == origin/main, proceed normally. If local main is AHEAD or dirty: do NOT touch local main — create a temp branch at `origin/main`, add the two devlog files there, commit, `git push origin <tempbranch>:main`, then delete the temp branch, leaving local main and the working tree exactly as found. Either way: the pushed commit must contain exactly the two new devlog files and nothing else.
4. All standing rules: contract at `scribr/docs/CLAUDE-DEVLOG-SECTION.md` (project slug `particlr`), real numbers with named sources, real SHAs for repo_ref, frontmatter within schema limits, draft: true, one commit, push authorized for that commit only.

## Reviewer follow-up (Fable)

Spot-check sourced numbers, sync, voice-pass dialog with preview lines, flip, gates, publish.
