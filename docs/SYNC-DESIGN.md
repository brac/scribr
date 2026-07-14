# scribr — Sync Script Design

**Version:** 1.0
**Script:** `scripts/sync.mjs` (Node ≥ 20, zero runtime deps beyond `yaml`)
**Trigger:** Manual — `npm run sync` when starting an editing session. No cron in v1.

---

## 1. Job

Pull `devlog/*.md` from every configured project repo into `src/content/log/`, renamed to slug convention, without ever overwriting local edits.

The invariant that matters: **scribr's copy is the editable one.** Once a draft has been synced, the project repo's copy is history and the scribr copy is truth. Sync must therefore be one-way and non-destructive on the scribr side.

## 2. Config (`scribr.config.json`)

```json
{
  "contentDir": "src/content/log",
  "sources": [
    { "project": "particlr", "repo": "git@github.com:brac/particlr.git", "branch": "main" },
    { "project": "haulr",    "repo": "git@github.com:brac/haulr.git",    "branch": "main" }
  ]
}
```

- `project` must match a value in the content schema's `project` enum. The script validates this against `src/lib/projects.ts`'s enum list at startup (cheap regex extraction) and hard-fails on mismatch — same typo-protection philosophy as the schema itself.
- Adding a project to scribr = one enum entry + one `sources` entry.

## 3. Algorithm

```
for each source in config.sources:
  shallow-clone source.repo@branch into a temp dir (depth 1, sparse: devlog/ only)
  for each devlog/phase-N-{slug}.md:
    target = {contentDir}/{project}-{slug}.md        # phase prefix stripped
    if target exists (any extension: .md or .mdx):
      skip, log "exists (edited or pending): {target}"
    else:
      parse frontmatter (yaml)
      validate: required fields present, project field == source.project,
                draft == true or omitted (schema default), date parses
      on validation failure: skip file, log error, mark run "dirty"
      write file verbatim to target
      log "synced: {target}"
cleanup temp dirs
print summary table: synced / skipped-existing / failed
exit 1 if any file failed validation (visible in terminal + usable by CI later)
```

### Design points

- **Existence check covers `.mdx` too.** After the editing pass a draft may have been renamed `.md → .mdx`; sync must treat that as "already here" or it would resurrect the unedited original next run.
- **Skip-if-exists, never merge, never overwrite.** If a worker legitimately revises a devlog post-sync (rare — the contract says don't), the resolution is manual deletion of the scribr copy followed by re-sync. This is deliberate: silent overwrites of a half-edited draft are the worst failure mode this script can have.
- **Sparse shallow clone** (`git clone --depth 1 --filter=blob:none --sparse` + `git sparse-checkout set devlog`) keeps sync fast even against repos with large assets (haulr's UE content never gets pulled).
- **Frontmatter is validated at sync time** even though the Astro build validates again. Two reasons: the sync summary tells you *which repo's worker* is producing bad frontmatter (build errors point at scribr files, obscuring origin), and a bad draft never enters the editing backlog.
- **Verbatim copy.** The script does not rewrite frontmatter, dates, or slugs beyond the filename. What the worker wrote (and the reviewer gated) is what lands in drafts.

## 4. Output

```
scribr sync — 2026-07-13
  particlr   synced: particlr-shader-tints.md
  particlr   exists: particlr-collision-rework.md
  haulr      synced: haulr-lwc-frames.md
  haulr      FAILED: phase-4-docking.md — missing summary
──────────────────────────────────────────────
  2 synced, 1 skipped, 1 failed → exit 1
```

## 5. Failure modes

| Failure | Behavior |
|---------|----------|
| Repo unreachable | Log, continue with remaining sources, count in `failed`, exit 1 |
| Frontmatter invalid | Skip file, log field-level error + source repo, exit 1 |
| `project` field ≠ source project | Skip file (worker copy-pasted another repo's template), exit 1 |
| Duplicate slug across projects | Impossible by construction — filenames are project-prefixed |
| Duplicate stem within a source | Two devlog files collapse to one `{project}-{slug}` after phase-prefix stripping (e.g. `phase-3-retro.md` + `phase-7-retro.md`). All colliding files fail (each names its partners); none sync. Human resolves upstream. exit 1 |
| Target exists | Skip silently-ish (listed in summary as `exists`) — this is the normal steady state, not an error |

## 6. v2 candidates (explicitly out of scope now)

- `--watch` / cron trigger once the manual rhythm is proven
- GitHub Action `repository_dispatch` from project repos on phase-commit
- `sync --project particlr` filter flag
- Auto-open newly synced drafts in `$EDITOR`
