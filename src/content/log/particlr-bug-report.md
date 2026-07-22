---
title: "A bug-report button that ships dark: wiring particlr to an inbox"
date: 2026-07-14
project: "particlr"
phase: 9
tags: [vercel, email, serverless, ux]
draft: true
summary: "One footer button, one serverless function, and a bug-report pipeline that lands in a real inbox — built to ship before its email key exists."
repo_ref: "513627c"
decisions:
  - what: "Bug reports travel as POST /api/report-bug → transactional email, not a mailto: link"
    why: "mailto: breaks on machines with no mail client and loses all diagnostics; we already run serverless functions with this exact shape"
    alternatives: ["mailto: link", "GitHub issue creation via API", "third-party form service (web3forms/Formspree)"]
  - what: "Resend as the email provider, called via plain fetch with zero new dependencies"
    why: "Native Vercel Marketplace integration, 100/day free tier, REST API simple enough that the api/ workspace stays dependency-free"
    alternatives: ["SendGrid/Postmark plain accounts", "Gmail SMTP with app password", "zero-account form relays"]
  - what: "The button lives in the footer, not the TopBar"
    why: "The TopBar is full and collapses behind drawers on mobile; the footer wraps and stays visible at every breakpoint"
    alternatives: ["TopBar button", "Help-menu entry"]
  - what: "The endpoint ships dark: deployed and probeable before the email key exists"
    why: "DNS and account provisioning are human-gated; sequencing code behind them would have stalled the whole feature"
    alternatives: ["holding the deploy until provisioning", "sandbox sender (cannot reach an arbitrary inbox)"]
benchmarks:
  - metric: "editor bundle (gzipped)"
    value: "172.75 KB (+1.78 KB for the feature)"
    target: "≤200 KB (house budget)"
  - metric: "runtime core (gzipped)"
    value: "23.33 KB (untouched)"
    target: "≤25 KB"
  - metric: "editor smoke lane"
    value: "71 passed (8 new bug-report tests incl. a 390×844 mobile check)"
    target: "exit 0, full regression"
  - metric: "unit suite"
    value: "1627 passed (50 new endpoint tests, 6 new client tests)"
    target: "exit 0"
---

## What shipped

A "Report a bug" entry in the editor footer, a modal on the same accessibility
contract as the license dialog (focus trap, Escape chain, return-to-opener), and
a new serverless function, `POST /api/report-bug`, that forwards reports to a
real inbox via Resend's REST API. The form takes a 10–2000-character
description, an optional reply-to email, and an opt-in copy of the current
effect JSON; a read-only "what gets sent" block shows every auto-attached
diagnostic (path, viewport, format version, licensed yes/no, user agent) before
anything leaves the machine.

The endpoint follows the house function shape: a pure, dependency-injected core
in `api/_lib/reportBug.ts` with the thin named-export entrypoint, 50 unit tests
pinning the provider request byte-for-byte, and the same error-code vocabulary
the activation endpoint uses. Abuse guards are layered: a 32 KB body cap, a
hidden honeypot field that returns an indistinguishable silent 200 without
sending, and validation bounds on every field.

## Decisions

The transport question had one serious contender and several tempting shortcuts.
A mailto: link costs nothing but silently fails on machines with no mail client
and can't carry diagnostics. Third-party form relays avoid DNS work but hand
report contents to someone else's spam pipeline. We already operate Vercel
functions for license activation, so a function-plus-provider was the same
amount of novelty as a form relay with none of the trust cost.

Provider research produced the deciding constraint set: Resend is a native
Vercel Marketplace integration, its free tier (100/day) is far above a bug
form's needs, and its REST API is a single fetch — the `api/` workspace keeps
zero runtime dependencies. The research round also killed an assumption early:
both project domains *look* DNS-managed by Vercel (`vercel dns ls` returns
records) but are actually delegated to Porkbun, so the domain-verification
records are a human step, and the sandbox sender can't reach an arbitrary
inbox. That reshaped sequencing into "ship dark": the guard order resolves the
honeypot *before* the environment, so the deployed-but-unprovisioned endpoint
is fully probeable and a filled honeypot never 500s.

## What broke

The client posted the attached effect JSON as an object where the server
contract requires a string. Every route-mocked UI test passed — the mock
asserted only that `body.doc` was truthy — so the attach path would have failed
with `400 bad_request` against the real endpoint, 100% of the time, with error
copy blaming the user's description. Review caught it by reading both sides of
the seam; the fix serializes once in the client module with a byte-measured
24 KB pre-check, and the test now requires a string that parses back to
schemaVersion 12.

Smaller friction: the editor-smoke port (5199) was held by a stale dev server
started outside the test harness, so gate re-runs used a temporarily
parametrized port, reverted before commit. And an early plan draft would have
run the golden-frame lane locally on Windows — goldens are container-pinned, so
that gate was rewritten as a file-scope assertion instead.

## Numbers

Bundle cost was measured by the existing size gate before and after: the
dialog, client module, and copy add 1.78 KB gzipped against the 200 KB budget
(0.17 KB of that is the round-two validation pre-checks). The runtime core is
untouched at 23.33 KB. Test counts moved from 1621 to 1627 unit tests and 63 to
71 smoke tests. No performance-path changes; no golden-frame deltas.

## Next

Provisioning is the open half: a Resend account (Marketplace install) and three
DNS records at Porkbun, after which the already-deployed endpoint goes live and
the end-to-end probe — a real report from production arriving at the inbox —
closes the phase. A `preset` provenance diagnostic is deferred until the store
tracks which bundled preset a document came from.
