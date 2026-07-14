# Phase 9 — lighthouse gate hardening

Addresses review findings **#6, #18, #19, #20** from `docs/CODE-REVIEW-2026-07-13.md`.
All changes confined to `scripts/lighthouse.mjs`.

## 1. Settled decisions — do not relitigate

- **#6 (traversal + bind):** the static server binds `127.0.0.1` explicitly, and `resolveFile`
  rejects any resolved path that escapes `dist/`:
  after `const full = join(dist, p)`, return `null` unless
  `full === dist || full.startsWith(dist + sep)` (import `sep` from `node:path`). `join`
  normalizes `..` segments, so the prefix check is sufficient. The directory-index fallback
  (`join(dist, p, "index.html")`) must be computed from the already-validated path (or guarded
  identically).
- **#18 (URIError):** wrap the body of `resolveFile` in try/catch → `return null` (the handler
  already turns `null` into a 404). Malformed percent-encoding becomes a 404, never a crash.
- **#19 (missing Chromium):** before `spawn`, check
  `existsSync(chromium.executablePath())`; if missing, print
  `Playwright Chromium not found — run: npx playwright install chromium` and `process.exit(1)`
  (before the temp profile dir is created, so nothing leaks). Also attach
  `chrome.on("error", ...)` printing the same hint and exiting 1, as a belt-and-suspenders for
  spawn-time failures.
- **#20 (median):** proper median — for even-length input return the mean of the two middle
  elements; odd-length behavior unchanged:
  ```js
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  ```

## 2. Pinned dependencies

None added, none upgraded.

## 3. Files to modify

`scripts/lighthouse.mjs` only:
1. `node:path` import gains `sep`.
2. `resolveFile` — try/catch + containment check (#18, #6).
3. `server.listen(serverPort, "127.0.0.1", r)` (#6).
4. Pre-spawn executable check + `error` listener on `chrome` (#19). Order matters: do the
   `existsSync` check BEFORE `mkdtempSync(join(tmpdir(), "scribr-lh-"))`.
5. `median` fix (#20).

## 4. Stop conditions

1. `npm run test:lighthouse` → exit 0, all categories PASS on all three URLs (this is the
   several-minute full gate: build + 3 runs × 3 URLs).
2. **Traversal probe:** while a gate run's server is up — or more simply, add a temporary
   ~10-line probe at the bottom of a scratch copy (do NOT leave probe code in the repo):
   start the server on a port, then verify with `fetch`:
   - `GET /..%2f..%2fpackage.json` → 404
   - `GET /%` → 404 (no crash)
   - `GET /log/` → 200
   Report the three observed statuses. Any approach that demonstrates these three behaviors
   against the real `resolveFile`/server code is acceptable; leaving test scaffolding in
   `scripts/lighthouse.mjs` is not.
3. Regression: `npm run test:phase1` → exit 0 (shares the build; nothing else overlaps).
4. `node -e` spot-check of the new median: `[1,2,3,4]` → `2.5`, `[1,2,3]` → `2`. Include output.

## 5. Out of scope

- All other findings/files. No changes to `lighthouserc.cjs` thresholds, URL list, or run count.
- **Do not commit — the reviewer commits after approval.**

## 6. Report format

Files changed; each stop condition with command, exit code, and output tail (including the three
probe statuses and the median spot-check); deviations with justification.
