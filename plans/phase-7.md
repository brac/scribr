# Phase 7 — test-gate integrity

Addresses review findings **#2, #3, #9, #10, #11, #12, #13, #26, #27, #28, #30** from
`docs/CODE-REVIEW-2026-07-13.md`. Read those entries first.

## 1. Settled decisions — do not relitigate

- **#2 (vacuous draft gate):** both `test/phase-1-draft-exclusion.mjs` and
  `test/validate-feeds.mjs` assert, before any dist checks, that
  `src/content/log/field-notes-draft-fixture.md` exists AND its frontmatter contains
  `draft: true` (regex `/^draft:\s*true\s*$/m` against the frontmatter block). Failure aborts
  with exit 1 and a message saying the fixture is the gate's proof and must not be
  deleted/renamed.
- **#3 + #12 (stale dist / dev-server reuse):** `playwright.config.ts` webServer becomes
  `command: "npm run build && npm run preview"`, `reuseExistingServer: false`, and
  `timeout: 240_000` (build takes tens of seconds; the old 120s was preview-only). A dev server
  already occupying 4321 now fails loudly instead of silently serving dev output — that is the
  intended behavior, not a bug.
- **#11:** add `forbidOnly: !!process.env.CI` at the top level of the Playwright config.
- **#9 (empty feeds pass):** `test/validate-feeds.mjs` derives expected item counts from source
  frontmatter: scan `src/content/log/*.{md,mdx}`, a post is published iff its frontmatter matches
  `/^\s*draft:\s*false\s*$/m` (this mirrors `phase-3-meta.mjs` lines 30–38 — copy that idiom),
  group counts by `project:` value. Assert: global feed item count === total published count;
  each project feed's item count === that project's published count (0 stays a valid channel
  with 0 items — the assertion makes emptiness *checked*, not forbidden). Keep the existing
  `requireSeed` on the global feed and add it to the particlr feed (`SEED_LINK` is a particlr
  post).
- **#10 (landmine):** delete the `"no draft OG image leaked"` report block in
  `test/phase-3-meta.mjs` (lines ~187–190) entirely. The set-equality assertion directly above
  it is strictly stronger. Do not replace it with anything.
- **#13 (phase-0 corruption stranding):** in `test/phase-0-schema-gate.mjs`, add a
  signal-restore: a `restore()` helper that writes `pristine` back to the seed and best-effort
  removes the backup; register `process.on("SIGINT", ...)` and `process.on("SIGTERM", ...)`
  handlers that call it then `process.exit(130)`. Keep the existing `finally` as-is. Also add
  `*.bak` to `.gitignore`.
- **#26 (pre-scroll race):** in `e2e/demo.spec.ts` "loads pixi only after the figure scrolls
  into view", insert `await page.waitForTimeout(500);` between the `goto(..., { waitUntil:
  "load" })` and the two pre-scroll negative assertions — same settle the sibling test at lines
  24–27 already uses. Do not change the assertions themselves.
- **#27 (URL race):** in `e2e/log-index.spec.ts`, move both `expect(page.url()).toBe(urlBefore)`
  checks (after the particlr click and after the "all" click) to AFTER their respective
  `toHaveCount` assertions — Playwright's auto-waiting on the count settles the page first, so a
  would-be navigation would have committed by then.
- **#28 (fps flake):** accepted risk, **no functional change**. Add a one-line comment above the
  `expect(fps ...)` assertion noting it can flake on contended shared runners and fails in the
  safe direction. Do not change the threshold, the 30s window, or the test structure.
- **#30 (.gitignore env patterns):** replace the three overlapping patterns (`.env`, `.env.*`,
  `.env*`) with exactly two lines: `.env` and `.env.*`. Keep every other existing entry, add
  `*.bak` (from #13). `.env.local` remains covered by `.env.*`.

## 2. Pinned dependencies

None added, none upgraded. Nothing else.

## 3. Files to modify

- `playwright.config.ts` — decisions #3/#12/#11. Also update the stale comment ("`npm run
  build` must run before the e2e suite") to say the webServer now builds itself.
- `test/phase-1-draft-exclusion.mjs` — fixture-presence assertion (decision #2) inserted as a
  new numbered section between the header and the build step (it must run BEFORE the build so a
  missing fixture can't waste a build).
- `test/validate-feeds.mjs` — fixture-presence assertion (#2) + frontmatter-derived count
  assertions (#9). The count scan runs once at startup; pass expected counts into `checkFeed`
  via a new option (e.g. `expectedCount`), asserted as
  `report(\`${label}: item count matches frontmatter (N)\`, items.length === expectedCount)`.
- `test/phase-3-meta.mjs` — delete the redundant assertion block (#10). No other changes.
- `test/phase-0-schema-gate.mjs` — signal restore (#13). No other changes.
- `e2e/demo.spec.ts` — settle before pre-scroll asserts (#26); flake comment (#28).
- `e2e/log-index.spec.ts` — reorder URL assertions (#27).
- `.gitignore` — env-pattern consolidation + `*.bak` (#30, #13).

## 4. Stop conditions

1. `npm run test:phase1` → exit 0 (both scripts, including the new fixture + count assertions).
2. `npm run test:phase3` → exit 0.
3. `npm run test:e2e` → exit 0, all tests green (the suite now builds first — expect the longer
   startup).
4. **Negative proof of #2** (run manually, then restore): rename
   `src/content/log/field-notes-draft-fixture.md` to `.bak-check`, run
   `node test/phase-1-draft-exclusion.mjs` → must exit 1 naming the fixture, WITHOUT running a
   build; rename back. Include the observed output in your report.
5. **Negative proof of #9:** confirm by reading (not running) that a zero-item particlr feed
   would now fail both the `expectedCount` assertion and `requireSeed` — state the two assertion
   names in your report.
6. `npm run test:phase0` → exit 0 (regression; also exercises the modified file).

## 5. Out of scope

- Findings #1, #4–#8, #14–#25, #29 (other phases). `scripts/*` untouched. `src/*` untouched.
- Do not add a test framework, do not restructure the plain-Node test style, no reformatting.
- Do not change any assertion thresholds beyond what's specified.
- **Do not commit — the reviewer commits after approval.**

## 6. Report format

Files changed with one-line rationale each; every stop-condition command with exit code and
output tail (including the negative-proof run of #4); deviations with justification.
