---
name: publish-post
description: Run scribr's sync → edit → publish cycle for devlog posts. Use whenever Ben wants to pull new devlog drafts, edit a draft, publish a post, flip draft to false, add a demo embed to a post, or asks "what's in the editing backlog" — the whole editorial loop for brac.dev/log lives here.
---

# Publishing a scribr post

The product is the ≤20-minute editing pass (BUILD-PLAN Phase 6 gates on it). Time it; if a pass runs long, the fix is revising the worker contract in `docs/CLAUDE-DEVLOG-SECTION.md`, not accepting slower passes.

## 1. Sync

`npm run sync` — pulls new drafts from every repo in `scribr.config.json` into `src/content/log/` as `draft: true`. Skips anything already present (`.md` or `.mdx` — the scribr copy is truth; never re-sync over an edit). Exit 1 means a source repo's worker produced bad frontmatter — the summary names the repo and field.

## 2. The editing pass (human contract, CONTENT-SCHEMA §5)

Backlog = entries in `src/content/log/` with `draft: true`. For the chosen draft:

1. Read once; cut anything that reads like a changelog.
2. Add the opinion the worker isn't allowed to have (Ben's voice — Claude assists, Ben decides).
3. Optional demo embed: rename `.md → .mdx`, add at the relevant prose point:
   ```mdx
   import ParticlrDemo from "../../components/ParticlrDemo";
   <ParticlrDemo preset="ember-field" client:visible />
   ```
   MDX only ever enters at this step. Available presets = keys of `PRESETS` in `src/components/ParticlrDemo.tsx`; adding one means vendoring the `.prt` from `particlr/presets/` into `src/assets/presets/` and extending that map. Presets are luminous content — the stage is always dark by design.
4. Keep frontmatter valid while editing: title 8–90 chars, summary 20–160 (it's the OG/RSS text), 1–5 lowercase tags. The build enforces this — a violation fails deploy, which is the safety net working.

## 3. Publish

Flip `draft: false`. Then gate locally before pushing:

- `npm run build && npm run test:phase1 && npm run test:phase3` — draft-exclusion, feeds, meta/OG contracts. A newly published post automatically gets its OG card and feed entries; no manual step.
- If the post has a demo embed, also `npm run test:e2e`.

Commit (use `git commit -F <file>` on Windows — inline `-m` with quotes gets mangled) and push to `main`. Vercel deploys automatically; live at `https://brac.dev/log/{slug}/` in under a minute. Verify with a real browser visit (also feeds Vercel Analytics — headless visits don't count).

## 4. Distribute (v1 = manual)

Post the link where it fits (HN/Reddit/social). Feeds update themselves: global `/rss.xml`, per-project `/log/{project}/rss.xml`. Check referrers later in the Vercel dashboard → scribr → Analytics.
