# Phase 6 — sync script hardening

Addresses review findings **#1, #4, #5, #14, #15, #16, #17, #29** from
`docs/CODE-REVIEW-2026-07-13.md`. Read that doc's entries for these findings before starting.

## 1. Settled decisions — do not relitigate

- **#1 (duplicate stems):** when two or more files in one source's `devlog/` map to the same
  target stem after phase-prefix stripping, **none of them sync** — each is logged as FAILED
  (naming the colliding files), `failed` increments, exit 1. A human resolves the collision
  upstream. We do NOT sync the first and skip the rest, and we do NOT try to detect cross-run
  collisions where the older source file was deleted upstream (undetectable without a manifest;
  out of scope).
- **#4 (I/O robustness):** `contentDir` must exist and be a directory at startup → `fail()`
  otherwise, before any clone. Each file's read/validate/write is wrapped in try/catch:
  a throw logs `FAILED: <file> — <err.message>`, increments `failed`, sets `dirty`, continues.
- **#5 (deep validation):** `validateFrontmatter` mirrors the Zod schema exactly — no more, no
  less (schema: `src/content.config.ts`). Additions: for non-field-notes posts `phase` must be
  a number with `Number.isInteger(phase) && phase >= 0`, and `repo_ref` a non-empty string.
  For all posts, `decisions` **if present** must be an array whose entries are objects with
  non-empty-string `what` and `why` (`alternatives`, if present, an array of strings);
  `benchmarks` **if present** an array of objects with non-empty-string `metric`/`value`/`target`.
  Absent `decisions`/`benchmarks` stay valid (Zod defaults them to `[]`).
- **#14 (draft rule):** `draft` is valid when `true` **or omitted** (`undefined`) — the schema
  defaults it to `true`. Anything else (explicit `false`, strings, etc.) fails with the existing
  message shape. Update the comment at the check site and SYNC-DESIGN's pseudo-code.
- **#15 (failed count):** clone or sparse-checkout failure increments `failed` in addition to
  setting `dirty`. Summary line format is unchanged.
- **#16 (repo injection):** validate each `source.repo` at config-validation time. Accept a repo
  iff: it does not start with `-`, does not contain `::`, and (matches
  `/^(https:\/\/|ssh:\/\/|git@)/` **or** `isAbsolute(repo)` is true). Absolute local paths must
  stay accepted — `test/phase-2-sync.mjs` fixtures use them, including a deliberately
  *nonexistent* absolute path in scenario 7 that must still reach the clone stage and fail there.
  Additionally add a literal `"--"` argument before the repo positional in the `git clone` argv.
- **#17 (doc drift):** in `docs/SYNC-DESIGN.md` §2, change the enum-extraction source from
  `src/content/config.ts` to `src/lib/projects.ts`.
- **#29 (git init unchecked):** in `test/phase-2-sync.mjs`, the `git init` call at line 80 must
  check its exit status and throw on failure, like the `git()` helper directly above it does.

## 2. Pinned dependencies

None added, none upgraded. `yaml` (already a devDependency) remains sync's only import beyond
node builtins. Nothing else.

## 3. Files to modify

### `scripts/sync.mjs`

1. **Imports:** add `statSync` to the `node:fs` import.
2. **Config validation block** (after the existing per-source shape check, before the PROJECTS
   cross-check): add the repo allowlist check from decision #16, failing with a message that
   names the offending repo value.
3. **After `contentDir` is resolved** (line ~90): add
   ```js
   if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
     fail(`contentDir does not exist or is not a directory: ${contentDir}`);
   }
   ```
4. **`sparseCloneDevlog`:** insert `"--"` between `"--single-branch"` and `repo` in the argv.
5. **Clone failure branch** (line ~224) and sparse-checkout failure: `failed++` alongside
   `dirty = true`.
6. **Duplicate-stem detection:** after the `files` list is built for a source, group files by
   their computed stem. In the per-file loop, when a file's stem group has length > 1:
   `failed++`, `dirty = true`, log
   `FAILED: <file> — duplicate target stem "<stem>" (also from: <other files in group>)`,
   `continue` (before the existence check, so nothing in the group ever syncs).
7. **Per-file try/catch** per decision #4 — wrap the body of the per-file loop from the
   existence check through `writeFileSync`.
8. **`validateFrontmatter`:** implement decisions #5 and #14. Keep the existing
   `{ field, reason }` return shape and first-failure-wins ordering. The `draft` comment
   currently reads "draft must be true (publishing is a human act; sync only pulls drafts)" —
   update it to reflect the omitted-is-valid rule.

### `docs/SYNC-DESIGN.md`

- §2: `src/content/config.ts` → `src/lib/projects.ts` (decision #17).
- §3/pseudo-code: draft rule now "true or omitted (schema default)" (decision #14).
- §5 failure-mode table: add the duplicate-stem row (behavior: all colliding files fail, exit 1);
  note that clone failures count in `failed`.

### `test/phase-2-sync.mjs`

- Fix the `git init` status check (decision #29).
- New scenarios, following the existing report/fixture style (each in its own block with a fresh
  content dir; reuse `validPost`/`makeRepo`/`writeConfig`/`runSync`):
  - **8. duplicate stem:** repo with `phase-3-retro.md` and `phase-7-retro.md` (both otherwise
    valid, same post-phase slug `retro`) → exit 1, output matches `/duplicate/`, and
    `particlr-retro.md` does NOT exist.
  - **9. missing contentDir:** config pointing at a nonexistent `contentDir` → exit 1, stderr/out
    names contentDir; runs fast (no clone).
  - **10. non-integer phase:** `validPost` with `phase: 4` line replaced by `phase: two` → exit 1,
    FAILED line names `phase`, target not created.
  - **11. omitted draft:** `validPost` with the `draft: true` line removed → exit 0, file synced.
  - **12. explicit draft false:** `draft: false` → exit 1, FAILED names `draft`, target not
    created.
  - **13. malicious repo values:** config with `repo: "--upload-pack=calc"` → exit 1 with the
    config-stage message (no git invocation); same for `repo: "ext::sh -c whatever"`.
  - **14. bad decisions entry:** valid post plus
    `decisions: [{ what: "x" }]`-shaped YAML (entry missing `why`) → exit 1, FAILED names
    `decisions`, target not created.

## 4. Stop conditions (all must pass; run them yourself and iterate until green)

1. `node test/phase-2-sync.mjs` → exit 0, zero FAIL lines (all existing + new scenarios).
2. `npm run test:phase0` → exit 0.
3. `npm run test:phase1` → exit 0.
4. `npm run test:phase3` → exit 0.
5. `node scripts/sync.mjs --config <nonexistent path>` → exit 1 with the config-not-found
   message (sanity check that CLI handling didn't regress).

Do NOT run `npm run sync` against the real `scribr.config.json` (network; the remotes may be
unreachable from this machine — not a gate).

## 5. Out of scope

- Everything in findings #2/#3/#6–#13, #18–#28, #30 (later phases).
- No changes to `src/` anything, `scripts/lighthouse.mjs`, `scripts/fonts-woff2.mjs`,
  `playwright.config.ts`, `.gitignore`, `package.json`, or any e2e/test file other than
  `test/phase-2-sync.mjs`.
- No new dependencies, no reformatting of untouched code, no threshold changes.
- **Do not commit — the reviewer commits after approval.**

## 6. Report format

Report back with: files changed (paths + one-line what/why each); every stop-condition command
with its exit code and the tail of its output; the new scenario names and their PASS lines;
and any deviations from this plan with justification (deviations are expected output, not
failures — flag them, don't hide them).
