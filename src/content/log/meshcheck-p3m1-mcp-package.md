---
title: "meshcheck-mcp: four thin-client tools, a tarball e2e, and a recorded agent transcript"
date: 2026-07-14
project: "meshcheck"
phase: 3
milestone: 1
tags: [mcp, typescript, npm, e2e]
draft: true
summary: "The meshcheck-mcp package ships four MCP tools as a strict thin client, gated by a tarball install and a hermetic claude -p agent transcript."
repo_ref: "p3m1"
---

# P3M1 — meshcheck-mcp package (raw material for phase-3 devlog)

Milestone draft, not the gated artifact. Working notes per CLAUDE.md.

## What shipped

`mcp/` workspace package: `meshcheck-mcp@0.1.0`, ESM, `@modelcontextprotocol/sdk@1.29.0` (`McpServer` + `registerTool` + `StdioServerTransport`), zod ^3.25 raw-shape schemas. Four tools per SPEC_05 — validate_model, render_model (JSON text block + ≤3 inline base64 PNG stills), inspect_model (non-determinism surfaced in the description; passes the Phase-4-pending API error through verbatim), get_report. Thin-client rules held: verbatim passthrough (raw body string re-used, never re-serialized), no interpretation on errors, zero telemetry. Path handling expands `~`, resolves vs CWD, miss-error lists every path tried. Size routing: <4.4MB multipart, ≥4.4MB presigned Blob flow, >plan max refused client-side (plan cap fetched once from /account, cached). Async transparency: 202 → 2s polls → report re-fetch; the agent never sees the envelope.

Also this milestone (P3M0, reviewer): gate-verified Phase 2 deployment promoted to production (meshcheck.vercel.app), live-smoke green.

## Decisions

- npm publish deferred (Ben must log into npm; he holds the name). Gate distribution = `npm pack` → `npm i -g ./tgz` → plain `meshcheck-mcp` shim. Measured: `npx ./tgz` re-extracts EVERY run (~960 ms tax, flat across runs) — rejected for the gate; `node <abs path>` rejected as unfaithful to the bin wiring users hit.
- No `outputSchema` on any tool: declaring one forces `structuredContent` and fights the mixed text+image result render_model needs. Report JSON rides as a text block verbatim.
- `mode: "full"` sent explicitly by validate_model unless `checks_only` — mirrors SPEC_03 default rather than relying on it.

## What broke

- Screenshot URLs in API responses are origin-relative (`/s/<id>/front.png?...` — the signed route lives outside `/v1`), so a bare `fetch(url)` failed; images must resolve against the API origin. Found by the implementer via integration test 6; verified by reviewer against server code.
- Node 24 on Windows refuses `spawn("npm.cmd")` without `shell:true` (EINVAL) — tarball e2e script uses shell with fixed-literal args (DEP0190 warning accepted).
- Reviewer tooling: scratchpad-located tsx scripts can't resolve workspace deps (pnpm strict layout) — probes must run from inside a workspace dir.
- tsconfig split (build vs typecheck) needed so `dist/cli.js` lands exactly at the `bin` path while tests/scripts stay typechecked.

## Numbers

- 21 tests (2 offline unit files + integration vs production), suite ~8.5s; full-repo regression green: server 143, renderer 20, mcp 21.
- Credits: ~23 burned per implementer cycle (balance 9138 → 9115); reviewer re-runs + turntable probe (4 credits) + e2e transcript on top.
- Tarball: 11 files, 11.3 kB packed / 35.7 kB unpacked.
- e2e gate (BENCHMARKS row 1): `claude -p` hermetic run, 4 turns; agent called validate_model on Duck__flip_faces.glb and named GEO-003 inconsistent winding, 422/4,212 faces (10.02%) vs 5% threshold. Artifacts: plans/artifacts/e2e-transcript.json, e2e-session.jsonl (key-leak scanned, clean).
- Reviewer live probe of the path no test covered: async turntable render through the installed shim — 202 → poll → done → report fetch, turntable descriptor + URL present.

## Observations for later

- The gate agent flagged that SPEC-001 reports `skipped` ("gltf-validator not available") on the deployed API — the known hosted-core caveat, but now visible to every MCP user in every full report. Consider wiring the in-function validator (SPEC_04 allows it) or documenting the skip in llms.txt. Not a P3M1 defect.
- Duck-derived broken fixtures carry the stock Duck's UV warnings (UV-002/004/005) as baseline noise alongside their injected defect.
