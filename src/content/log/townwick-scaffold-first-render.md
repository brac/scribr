---
title: "Townwick phase 0: one config file becomes a barbershop site"
date: 2026-07-29
project: townwick
phase: 0
tags: [astro, zod, pnpm, monorepo, tooling]
draft: false
summary: "The monorepo, the Zod config contract, and an Astro 7 site that builds CJ's Barbershop out of one config.yaml and nothing else."
repo_ref: "phase-0"
decisions:
  - what: "Resolve the repo root with process.cwd(), never import.meta.url"
    why: "In an Astro 7 production build the loader runs from dist/.prerender/chunks/*, so import.meta.url gives you a working dev server and a broken build. process.cwd() is site/ in both."
    alternatives: ["import.meta.url + path walking", "hardcoded absolute root"]
  - what: "Astro's stable Fonts API (fontsource provider) instead of @fontsource packages"
    why: "It graduated in v6: self-hosts at build time, generates metric-matched fallbacks, emits preloads. Zero font packages installed."
    alternatives: ["@fontsource-variable/* imports with manual preload"]
  - what: "Hand-roll WCAG 2.2 contrast; validate phones with libphonenumber-js, not a regex"
    why: "wcag-contrast has been stale since 2019 over 25 lines of frozen arithmetic. The E.164 regex rejects every human-formatted number and accepts invalid ones."
    alternatives: ["wcag-contrast or color2k", "bare ^\\+[1-9]\\d{1,14}$"]
  - what: "A Node wrapper script for `pnpm dev <slug>` instead of env-prefix or cross-env"
    why: "CLIENT=x pnpm dev is a bash-ism that dies in PowerShell, and cross-env can't take a positional slug."
    alternatives: ["cross-env", "documenting two per-shell invocations"]
benchmarks:
  - metric: "astro build, 1 page"
    value: "385ms (2.5s wall cold)"
    target: "exit 0"
  - metric: "config-schema tests"
    value: "73 passed / 5 files, 501ms"
    target: "every docs/02 rule covered, errors and warnings"
  - metric: "phase-0 gate"
    value: "18/18 checks"
    target: "corruptions fail by the right rule; built HTML carries config data"
---

## What shipped

A pnpm-11 workspace, and a site that builds itself out of one file.

`@townwick/config-schema` is the whole contract: Zod 4 rules for `config.yaml`,
cross-field checks, E.164 phone normalization, and a build-time WCAG AA
contrast check that prints the computed ratio in the error so you can see how
far off you are. `@townwick/theme` ships the classic variant only, token-driven
CSS with a typographic hero, a services grid, and an hours table whose open-now
logic is plain DOM. `@townwick/scripts` has `new-client`, `validate`, and the
cross-platform run wrapper. The `site` app builds exactly one client, picked by
the `CLIENT` env var. CJ's Barbershop is the seed. CI runs typecheck, validate,
test and build, and there's a committed gate script.

The whole point of phase 0 was to prove the shape: edit a YAML file, get a
site. That part works.

## Decisions

The four in the table all have the same flavor, which is why I'm glad we did a
research round before writing code. Each one works fine on my machine today and
breaks somewhere I'm not looking.

`import.meta.url` is the sharpest. It resolves fine in dev, then the Astro 7
production build relocates the loader module into `dist/.prerender/chunks/` and
the repo root is suddenly three directories off. `process.cwd()` is `site/` in
both, so it's the boring correct answer.

The dependency calls went the same way. `wcag-contrast` hasn't been touched
since 2019 and all it does is 25 lines of arithmetic that hasn't changed since
WCAG 2.0, so I own the arithmetic. Phone numbers went the other direction: the
obvious `^\+[1-9]\d{1,14}$` regex rejects every number a human would actually
type and happily accepts numbers that don't exist, so libphonenumber-js's 82KB
earns its place.

The dev wrapper is a Windows tax. `CLIENT=x pnpm dev` is a bash-ism, cross-env
can't take a positional slug, and documenting two invocations per shell is how
you get a README nobody trusts.

## What broke

Nothing at review, but two rounds of friction on the way there.

`astro dev` daemonizes now. It survives its parent process, so the wrapper
needed a `dev:stop` before I spent an afternoon wondering why port 4321 was
busy.

Zod 4 keeps running object-level checks after the inner fields have already
failed. Every cross-field rule now guards against partially-parsed input,
because without it a malformed hours block crashed the schema instead of
reporting, which is the exact opposite of what a config contract is for.

pnpm 11 also dropped `onlyBuiltDependencies`, and its new 24-hour
`minimumReleaseAge` default refuses same-day releases, so it refused the Astro
version we'd just pinned until it was explicitly excluded.

## Numbers

Review re-ran the whole battery on its own: install, typecheck, test, validate,
gate, build and dev-smoke all exit 0. The gate is 18/18, and it got
negative-proofed by mutating the seed phone number, which failed exactly 2
checks and exited 1, then restored byte-identical.

The contrast math was checked against reference values rather than trusted.
#777777 on white is 4.4781 and fails AA, #767676 is 4.5422 and passes, black on
white is 21 exactly.

## Next

Phase 1 is the demo pipeline: Sharp photo ingest with stock placeholders,
manual reviews rendering, the demo-stub contact form, noindex and robots
behavior for demos, OG images, JSON-LD, Vercel wiring, and the test that
actually matters, which is whether `new-client untamed-salon` gets to a
deployed preview in under 30 minutes.
