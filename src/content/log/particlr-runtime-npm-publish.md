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

`@particlr/runtime` is on npm, MIT-licensed, across four releases: 0.3.0 on
2026-07-10 (`7a3daa0`), then 0.4.0, 0.4.1, and 0.4.2 on 2026-07-12. The monorepo
stays private — the editor is the commercial surface — so only
`packages/runtime` is public, extracted by a history-preserving git subtree
split into a separate mirror repo (github.com/brac/particlr-runtime). The
package ships `dist/` only via `files: ["dist"]`, and builds standalone:
`packages/runtime` carries a copy of `tsconfig.base.json`, so
`npm install && npm run build` works in the mirror where `../../` does not
exist. A test pins `RUNTIME_VERSION` to `package.json`'s version so the two
can't drift. 0.4.0 carried schema 9 to 12 (TIERB, WIND_PARAMS, CURVES, and the
correctness remediation) onto npm; 0.4.1 was README-only; 0.4.2 was a
supply-chain fix.

## Decisions

Publishing only the runtime was the anchor: it is what users install and
inspect, and a subtree split keeps the mirror's history rooted at the package
instead of hand-copying files. The tarball ships compiled `dist`
only — the full API reference lives in the shipped `.d.ts` and
`particle.schema.json`, which let 0.4.1 cut the README from 507 lines to about
55. Standalone buildability forced the in-package `tsconfig.base.json` copy,
since the mirror cannot otherwise compile. And
0.4.2 replaced the Pixi adapter's `fetch(dataUrl)` texture decode with
`decodeBase64` to Blob to `createImageBitmap` plus a new validator gate, rather
than suppressing the scanner's alert.

## What broke

0.4.2 existed because Socket flagged the package with a network-access
capability, score 75, and the flag was accidentally real: the validator accepted
any string for a `textures` value, so a crafted `.prt` pointing at a remote URL
would genuinely have been fetched at decode time. The fix removes every `fetch`
identifier from `dist` and adds error `E44` — `textures` values must be
`data:image/<subtype>;base64,...`. The uncomfortable part: the scanner was
right and I would have argued with it. "That fetch can only ever see data:
URLs" is exactly the sentence every supply-chain victim said before the audit.
Publishing itself is the other recurring
wall: the machine's npm token returns `E401` (expired) and the account is
2FA-protected, and the shell here can't complete npm's browser OTP flow, so each
publish is human-in-the-loop (Ben ran login plus OTP for 0.4.0). The mirror's
first push (2026-07-10) carried a branch-only `.gitignore` commit and needed a
one-time force-with-lease; moving `.gitignore` into `packages/runtime`
(`488a545`) made every later sync fast-forward.

## Numbers

The runtime held its size budget throughout: 23.26 of 25 KB gz at 0.4.0 and
0.4.1, 23.33 at 0.4.2. Each release gated on the full vitest suite — 1527 tests
through 0.4.1, 1532 at 0.4.2 — plus `npm pack --dry-run` confirming LICENSE,
README, and `dist` present with no `src`. Mirror syncs are recorded as
fast-forward ranges, e.g. `9f71ec4..91e349f` for 0.4.2.

## Next

The immediate follow-up is re-running the Socket scan against 0.4.2 to confirm
the network-access alert clears. Longer term, the reason the CPU sim sits behind
a versioned format at all is the v2 WebGPU compute path (`V2_DESIGN`), which
should swap in under the same published package without breaking a `.prt`.
