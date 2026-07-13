# Phase 2 Implementation Plan — Sync Script

**Author:** Fable (planner/reviewer)
**Implementer:** Opus agent
**Source docs:** `docs/SYNC-DESIGN.md` (the contract — read it in full), `docs/BUILD-PLAN.md` (Phase 2), `docs/CLAUDE-DEVLOG-SECTION.md`
**Baseline:** `phase-1` tag — full route surface, feeds, all gates green.

## Settled decisions (do not relitigate)

1. **HTTPS remotes, not SSH.** SYNC-DESIGN's config example uses `git@github.com:` URLs; this machine's git/gh auth is HTTPS. Use `https://github.com/brac/{repo}.git` in `scribr.config.json`.
2. **Enum source of truth is `src/lib/projects.ts`** (SYNC-DESIGN predates Phase 1's extraction; it says to regex the enum out of the content config). Regex-extract `PROJECTS` from `src/lib/projects.ts` exactly the way `test/validate-feeds.mjs` already does.
3. **Two configured sources: `particlr` and `scribr` itself.** scribr's own devlog drafts (phase-0, phase-1, already pushed) are future launch content; syncing them dogfoods the script and gives the BUILD-PLAN timing gate its "two configured repos". The synced copies land `draft: true` and are build-excluded, so this is safe.
4. **`yaml` goes in devDependencies** — it's tooling, nothing ships at runtime.
5. **Synced drafts are still Zod-validated at build** (Astro validates every collection entry, drafts included). This is intended — the real particlr draft must be schema-valid or `astro build` fails. That's the machine gate working; write the draft accordingly.

## Deliverables

### 1. `scribr.config.json` (repo root)

```json
{
  "contentDir": "src/content/log",
  "sources": [
    { "project": "particlr", "repo": "https://github.com/brac/particlr.git", "branch": "main" },
    { "project": "scribr",   "repo": "https://github.com/brac/scribr.git",   "branch": "main" }
  ]
}
```

### 2. `scripts/sync.mjs`

Node ≥20, ESM, only dep: `yaml`. Implement SYNC-DESIGN §3 faithfully:

- **CLI:** `node scripts/sync.mjs [--config <path>]`. `--config` (default `scribr.config.json`) exists solely so the test suite can point at fixture configs. No other flags (SYNC-DESIGN §6 lists them as v2 non-goals).
- **Startup:** load config; regex-extract the enum from `src/lib/projects.ts`; hard-fail (exit 1, clear message, sync nothing) if any `source.project` is not in the enum, or config is malformed.
- **Per source:**
  - Sparse shallow clone into a fresh temp dir (`fs.mkdtemp` under `os.tmpdir()`):
    `git clone --depth 1 --filter=blob:none --sparse --branch {branch} --single-branch {repo} {tmp}` then `git -C {tmp} sparse-checkout set devlog`. Use `spawnSync` with arg arrays; on failure (unreachable repo, bad branch) log the git stderr, mark the run dirty, continue with remaining sources.
  - A source with no `devlog/` dir or no `.md` files: 0 files, not an error.
  - For each `devlog/*.md` (only `.md`):
    - Target name: strip a leading `phase-\d+-` prefix if present, else keep the name; target = `{contentDir}/{project}-{name}.md`.
    - **Existence check first**: if target exists as `.md` OR `.mdx` → count `exists`, continue. This check precedes validation (an already-synced file that would now fail validation is not our problem — scribr's copy is truth).
    - Parse frontmatter (`yaml` package on the `---` block). Validate, with field-level messages: required fields present (`title`, `date`, `project`, `tags`, `summary`, plus `phase` + `repo_ref` unless `project === "field-notes"`); `date` parses as a date; `project === source.project`; `draft === true`; `title` length 8–90; `summary` length 20–160; `tags` 1–5 entries matching `/^[a-z0-9-]+$/`. On failure: skip file, log `FAILED: {file} — {field}: {reason}`, mark dirty.
    - Write the file **verbatim** (raw bytes, no rewriting) to target; count `synced`.
  - Always clean up temp dirs (try/finally).
- **Output:** summary table per SYNC-DESIGN §4 (per-file lines grouped by project, then `N synced, N skipped, N failed → exit {code}`).
- **Exit code:** 1 if any clone failed or any file failed validation; 0 otherwise (skips are normal).

### 3. `test/phase-2-sync.mjs` — fixture tests

Dependency-free orchestration (may import `yaml` if convenient). The script:

1. **Builds a fixture repo at runtime** in a temp dir (`git init -b main`, commit devlog files) — no `.git` dir is ever committed to scribr. Fixture devlog contents live inline in the test script or under `test/fixtures/` as plain files copied in.
2. Creates a temp `contentDir` and a temp config pointing the fixture repo (via `file://`-less local path — git clones local paths fine; use the directory path as `repo`) at project `particlr`.
3. Exercises every SYNC-DESIGN §5 failure mode, asserting exit codes AND file effects:
   - fresh valid file → synced, exit 0, target exists, byte-identical to source
   - target `.md` already present → skipped, target NOT overwritten (assert content unchanged)
   - target `.mdx` already present → skipped, no `.md` resurrection
   - invalid frontmatter (missing `summary`) → file skipped, field named in output, exit 1
   - `project: haulr` in a particlr source → skipped, exit 1
   - second run over already-synced state → 0 synced, exit 0
   - unreachable repo (nonexistent path) as one of two sources → other source still syncs, exit 1
   - `phase-3-collision-rework.md` → lands as `particlr-collision-rework.md` (prefix stripping)
4. PASS/FAIL line per assertion; exit 1 on any failure.

### 4. The real particlr draft (research + write + push)

This is the research half of the phase. In `C:\Users\Ben Bracamonte\Work\particlr` (a separate git repo, origin `https://github.com/brac/particlr.git`):

1. **Research the repo**: `git log` on main, `docs/`, `BACKLOG.md`, `CLAUDE.md`, test/benchmark outputs — identify the most recently **completed** phase of real work and its actual decisions, failures, and measured numbers. The draft must be genuine: real commit SHA for `repo_ref` (a main-branch commit that exists on origin), real numbers only — nothing invented. If a claimed number can't be sourced from the repo (docs, code comments, benchmark files, commit messages), leave it out.
2. Write `devlog/phase-{N}-{slug}.md` per `docs/CLAUDE-DEVLOG-SECTION.md` (project `particlr`, `draft: true`, all five sections, 400–900 body words, honest "What broke").
3. Validate it against the same constraints the sync script enforces (title/summary lengths, tags) — it must survive both sync validation and scribr's Zod build gate.
4. **Git hygiene in particlr — strict:** `git -C ../particlr fetch origin` first; verify local `main` == `origin/main` (if diverged/behind: STOP and report, do not resolve). Add ONLY the new devlog file. Commit with a plain message ("devlog: phase N draft for scribr"). Push to `origin main`. Touch nothing else in that repo; do not stage any pre-existing modified/untracked files.
5. Then in scribr: `npm run sync` → the draft lands as `src/content/log/particlr-{slug}.md`, and scribr's own two devlog drafts land as `scribr-scaffold-and-schema.md` + `scribr-routes-index-feeds.md`. Run `npm run build` — the synced drafts must pass Zod. These synced files get committed with the phase (they are the editing backlog).

### 5. `package.json`

- `"sync": "node scripts/sync.mjs"`
- `"test:phase2": "node test/phase-2-sync.mjs"`
- devDeps += `yaml`

### 6. `devlog/phase-2-sync-script.md`

Phase 2 devlog per contract: `project: scribr`, `phase: 2`, `draft: true`, `repo_ref: "phase-2"`. Real decisions (https-vs-ssh, two-source config, existence-check-before-validation ordering), real failures encountered, real numbers (sync wall time, fixture case count).

## Stop conditions (all must pass before you report done)

- [ ] `npm run test:phase2` exits 0 — every fixture case above asserted
- [ ] `npm run sync` against the real config pulls the particlr draft + scribr's two drafts into `src/content/log/` (first run), and a second consecutive run reports 0 synced, exit 0
- [ ] `Measure-Command { npm run sync }` (or equivalent timing) < 15 s with the two real repos, measured on the steady-state (second) run and reported; also report the first-run time
- [ ] `npm run build`, `npm run check`, `npm run test:phase0`, `npm run test:phase1`, `npm run test:e2e` all still exit 0 with the synced drafts present
- [ ] The synced particlr draft is byte-identical to the file in the particlr repo
- [ ] The pushed particlr commit touches exactly one file (`devlog/phase-{N}-{slug}.md`)

## Out of scope

- `--watch`, cron, repository_dispatch, `--project` filter, `$EDITOR` integration (SYNC-DESIGN §6)
- Editing/publishing any synced draft (they stay `draft: true`)
- Styling, OG, demo islands
- Do not commit in **scribr** — reviewer commits. (The **particlr** devlog commit+push is the one exception, per §4.)

## Report format

Files created/modified; the particlr draft's path, `repo_ref` SHA and pushed commit SHA; commands run with exit codes; timing numbers; stop-condition checklist; deviations with justification.
