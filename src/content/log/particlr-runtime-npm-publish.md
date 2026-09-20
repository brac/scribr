---
title: "Publishing @particlr/runtime to npm without shipping the editor"
date: 2026-07-12
project: particlr
phase: 8
tags: [npm, packaging, supply-chain, release]
draft: false
summary: "Splitting the MIT runtime out of a private monorepo to npm and a public mirror across four releases, including a 0.4.2 supply-chain fix."
repo_ref: "cd0ffd7"
decisions:
  - what: "Publish only packages/runtime to npm and a public mirror; the monorepo stays private"
    why: "The runtime is the MIT artifact users install and inspect, while the editor is the commercial surface and must stay closed"
    alternatives: ["Open the whole monorepo", "Hand-copy the runtime into a public repo"]
  - what: "Extract the mirror with a history-preserving git subtree split; ship dist/ only via files: [\"dist\"]"
    why: "The split roots the mirror's history at the package; the full API reference lives in the shipped .d.ts and schema JSON, so the README trims to a quick-start"
    alternatives: ["Copy files without history", "Ship src in the npm tarball", "Keep the 507-line prose README"]
  - what: "Make packages/runtime standalone-buildable with its own in-sync copy of tsconfig.base.json"
    why: "npm install && npm run build must work in the mirror where the monorepo root (../../) does not exist"
    alternatives: ["Depend on the monorepo layout (breaks standalone build)"]
  - what: "For 0.4.2, replace the adapter's fetch(dataUrl) texture decode with decodeBase64 -> Blob -> createImageBitmap and add validator error E44"
    why: "Socket flagged a network-access capability that was accidentally real; the validator accepted any string, so a crafted .prt could have fetched a remote URL"
    alternatives: ["Suppress the scanner alert and keep fetch()"]
benchmarks:
  - metric: "runtime bundle at 0.4.2 (gzipped)"
    value: "23.33 KB"
    target: "<= 25 KB gz"
  - metric: "runtime bundle at 0.4.0 / 0.4.1 (gzipped)"
    value: "23.26 KB"
    target: "<= 25 KB gz"
  - metric: "vitest suite at the 0.4.2 publish gate"
    value: "1532 passing"
    target: "green"
  - metric: "package README length at 0.4.1"
    value: "~55 lines (from 507)"
    target: "quick-start only; reference lives in .d.ts + schema"
  - metric: "Socket network-access capability score (pre-0.4.2)"
    value: "75"
    target: "0 after removing fetch() from dist"
---

## What shipped

`@particlr/runtime` is on npm under MIT. Four releases: 0.3.0 on 2026-07-10
(`7a3daa0`), then 0.4.0, 0.4.1 and 0.4.2 on 2026-07-12.

The monorepo stays private because the editor is the thing I sell. Only
`packages/runtime` is public, split out with `git subtree` so the mirror repo
(github.com/brac/particlr-runtime) keeps its history. The tarball ships `dist/`
only. The package builds on its own: it carries a copy of `tsconfig.base.json`
so `npm install && npm run build` works in the mirror, where `../../` doesn't
exist. A test pins `RUNTIME_VERSION` to the `package.json` version so the two
can't drift.

0.4.0 carried schema 9 through 12 (TIERB, WIND_PARAMS, CURVES, the correctness
remediation) onto npm. 0.4.1 was README only. 0.4.2 was a supply-chain fix.

## Decisions

Publish the runtime, nothing else. It's what people install and read, and a
subtree split beats hand-copying files into a second repo.

Ship compiled `dist` only. The API reference already lives in the `.d.ts` and
`particle.schema.json`, which is what let 0.4.1 cut the README from 507 lines
to about 55.

For 0.4.2, fix the problem rather than suppress the scanner. The Pixi adapter's
`fetch(dataUrl)` texture decode became `decodeBase64` to Blob to
`createImageBitmap`, plus a new validator error.

## What broke

Socket flagged the package for network access, score 75. I would have argued
it was a false positive. It wasn't. The validator accepted any string for a
`textures` value, so a crafted `.prt` pointing at a remote URL would have been
fetched at decode time. "That fetch only ever sees data: URLs" is the sentence
everyone says right before the audit. The fix removes every `fetch` identifier
from `dist` and adds `E44`: `textures` values must be
`data:image/<subtype>;base64,...`.

Publishing itself is a recurring wall. The machine's npm token returns `E401`
(expired), the account is behind 2FA, and the agent's shell can't complete
npm's browser OTP flow. So every publish is me running login plus OTP by hand.

The mirror's first push on 2026-07-10 carried a branch-only `.gitignore` commit
and needed a one-time force-with-lease. Moving `.gitignore` into
`packages/runtime` (`488a545`) made every later sync a fast-forward.

## Numbers

Bundle stayed under the 25 KB gz budget: 23.26 KB at 0.4.0 and 0.4.1, 23.33 KB
at 0.4.2. Each release gated on the full vitest suite (1527 tests through
0.4.1, 1532 at 0.4.2) and on `npm pack --dry-run` showing LICENSE, README and
`dist` with no `src`. Mirror syncs are recorded as fast-forward ranges,
`9f71ec4..91e349f` for 0.4.2.

## Next

Re-run the Socket scan against 0.4.2 and confirm the alert clears. Longer
term, the whole reason the CPU sim sits behind a versioned format is the v2
WebGPU compute path (`V2_DESIGN`), which should swap in under the same package
without breaking a `.prt`.
