# Phase 4 Implementation Plan — Demo Islands

**Author:** Fable (planner/reviewer)
**Implementer:** Opus agent
**Source docs:** `docs/BUILD-PLAN.md` (Phase 4), `docs/SPEC.md` §6
**Baseline:** `phase-3` — design system, OG images, Lighthouse gate all green.

## Research-verified facts (July 13, 2026 — all empirically confirmed)

1. **`@particlr/runtime@0.4.2`** (npm, ESM-only). Exports: `.` (core: `parseParticle`, `Effect`), `./pixi` (`PixiParticleRenderer`). **`pixi.js >=8.6.0 <9` is a peer dep** — install `pixi.js@^8.19.0` alongside.
2. **The runtime is host-driven.** No mount-on-canvas factory: the island owns the Pixi `Application`, ticker, and teardown:
   ```ts
   const doc = parseParticle(presetText).doc!;
   const fx = new Effect(doc, { seed: 1337 });
   const view = new PixiParticleRenderer(fx);
   await view.ready;                       // embedded textures decoded
   app.stage.addChild(view.container);
   app.ticker.add((t) => { fx.step(t.deltaMS / 1000); view.sync(); });
   ```
   Cleanup order: `view.destroy()` **then** `app.destroy(true, { children: true })` (safe — the built-in texture cache is page-lifetime with a self-healing guard). No built-in resize: use `app.init({ resizeTo })` and position `view.container` yourself. Reduced-motion single frame: step once (or a few steps to populate), `view.sync()`, `app.ticker.stop()`, `app.render()`.
3. **"ember-drift" does not exist.** Use **`ember-field`** (real preset, looping, "Drifting embers rising over warmth"). **Presets are not on npm** — vendor `C:\Users\Ben Bracamonte\Work\particlr\presets\ember-field.prt` (≈7 KB JSON) into scribr verbatim.
4. **Chunk isolation is free**: a page without the island ships zero `_astro/*.js` references and zero script tags; with `client:visible` there are two small inline scripts + `<astro-island component-url=...>` and **no modulepreload** — the ~283 KB gz pixi+runtime graph loads only on visibility. No manualChunks needed.
5. **MDX islands**: import the component **inside the `.mdx` file** (`import ParticlrDemo from "../../components/ParticlrDemo";` — relative to the MDX file) and use `<ParticlrDemo client:visible />`. Works through `render(entry)`. We don't use the mdx `optimize` option, so no `ignoreElementNames` concern.
6. **Playwright idioms** (use these):
   - pixi-bytes assertion: `page.on("request", ...)` collecting `/pixi|particlr/i` URLs.
   - rAF count: `addInitScript` wrapping `requestAnimationFrame` with a counter + `page.emulateMedia({ reducedMotion: "reduce" })` **before** goto; assert the **delta over a 2s window** is 0 (init may schedule a few frames before the ticker stops).
   - fps: rAF counter over 30s via `page.evaluate` promise; threshold ≥ 50 (headless SwiftShader renders below real-GPU fps; BUILD-PLAN says 60fps — report the measured number and treat ≥50 sustained in headless as the gate, with the number recorded in the devlog).
   - LCP: leave to the Lighthouse gate — add the demo post URL to `lighthouserc.cjs` `collect.url[]` with an added audit assertion `"largest-contentful-paint": ["error", { maxNumericValue: 1500 }]` scoped… lhci assertions are global per config; since our runner reads `rc.ci.assert.assertions`, extend `scripts/lighthouse.mjs` minimally: also read an optional `rc.ci.assert.audits` map `{ "largest-contentful-paint": 1500 }` and assert `lhr.audits[k].numericValue <= v` for every URL. All three URLs should pass LCP ≤ 1500 under Lighthouse's simulated mobile throttling.

## Deliverables

### 1. Dependencies

`npm i @particlr/runtime@^0.4.2 pixi.js@^8.19.0` (regular deps — client-only, tree-shaken into the lazy island graph; nothing server-side changes).

### 2. `src/assets/presets/ember-field.prt` (vendored)

Byte-identical copy from the particlr repo. Add `src/types.d.ts` (or extend existing env types) with `declare module "*.prt?raw" { const s: string; export default s; }`.

### 3. `src/components/ParticlrDemo.tsx` — the island

Preact component, props: `preset: string` (currently only `"ember-field"` — a small internal map `{ "ember-field": emberFieldRaw }` from `import emberFieldRaw from "../assets/presets/ember-field.prt?raw"`; unknown preset renders an inline error box rather than throwing).

Structure & behavior:
- Renders a `<figure class="demo">`: a container `<div>` (fixed `aspect-ratio: 16/9`, `--panel` background, 1px `--rule` border — matches the table treatment) + a `<figcaption>` mono caption: `demo ▸ ember-field` on the left, a control `<button>` on the right.
- On mount (`useEffect`), decide mode by `matchMedia("(prefers-reduced-motion: reduce)")`:
  - **Motion mode**: create `Application`, `await app.init({ resizeTo: containerEl, backgroundAlpha: 0, antialias: true })`, append `app.canvas`, build Effect + PixiParticleRenderer per fact 2, `await view.ready`, center via `view.container.position.set(w/2, h*0.65)` (embers rise — keep the emitter low-center; adjust visually), ticker loop. Handle container resize by updating position on `app.renderer.on("resize")` or a ResizeObserver.
  - **Poster mode** (reduced motion): same init, then advance the sim deterministically without the ticker: `for (let i = 0; i < 90; i++) fx.step(1/60);` then `view.sync(); app.render(); app.ticker.stop();` — a populated static frame, **zero ongoing rAF**. The caption button reads `▶ play` and opting in switches to motion mode (explicit user intent overrides the media query).
  - **Pause control** (motion mode): the caption button toggles `pause ⏸ / play ▶` by `app.ticker.stop()/start()` — WCAG 2.2.2 for auto-moving content. `aria-pressed` + accessible label.
- On unmount: cancel loop, `view.destroy()`, `app.destroy(true, { children: true })`, remove canvas. Guard double-cleanup (client:visible + navigation).
- Zero SSR output problems: the component must render its shell (figure/caption/button disabled) on the server without touching pixi — **all pixi/runtime imports must be dynamic (`await import(...)`) inside `useEffect`**, so SSR never evaluates them and the shell HTML carries no cost. (The chunk graph stays lazy either way, but dynamic import also keeps SSR from executing WebGL-adjacent module init.)
- Seed: fixed `seed: 1337` — deterministic playback, reproducible tests.
- Keep the island dependency-free beyond preact hooks + the two runtime packages. Styling via a small scoped block in `global.css` (`.demo` rules) — mono caption 0.8rem, same button treatment as chips.

### 4. Convert the seed post to MDX — first real MDX post

- Rename `src/content/log/particlr-spatial-hash.md` → `.mdx` (git mv). Frontmatter unchanged. Add at the **end of the "Numbers" section** (below the fold):
  ```mdx
  import ParticlrDemo from "../../components/ParticlrDemo";

  <ParticlrDemo preset="ember-field" client:visible />
  ```
  (import at top of body per MDX convention; component where it belongs in the prose.) Add one italic serif line before it: *Live demo — the `ember-field` preset running on the current runtime build.* — the post text references `ember-drift`, which doesn't exist; do NOT edit the post's prose claims (it's fixture content), the caption names the real preset.
- **Update `test/phase-0-schema-gate.mjs`**: seed path is now `.mdx`. Corruption logic unchanged.

### 5. Second published fixture: `src/content/log/field-notes-hello-log.md`

The "post without demos" stop condition needs a published non-demo post, and the only published post is becoming the demo post. Add a short field-note (`project: field-notes`, `draft: false`, no phase/repo_ref needed): 2–3 paragraphs in the worker-contract voice introducing what this log is (drafted by agents at phase gates, edited by a human, one post per completed phase — factual, no marketing). Title like "What this log is, and how it gets written". Tags `[meta, process]`. This doubles as sensible launch content; flag to the reviewer that Ben may rewrite or unpublish it.

### 6. Gates

**`e2e/demo.spec.ts`** (new; the existing e2e config/webServer serves the built site):
1. **No pixi bytes on non-demo pages**: for `/log/field-notes-hello-log/` and `/log/`: collect requests matching `/pixi|particlr/i` over goto + networkidle + a scroll to bottom → assert empty. Also assert zero `<script>` elements on the field-note post.
2. **Lazy load on visibility**: goto demo post (`/log/particlr-spatial-hash/`), assert zero pixi/particlr requests while at top; `scrollIntoViewIfNeeded()` on the demo figure; wait for canvas element; assert pixi/particlr requests now > 0 and a `<canvas>` is attached.
3. **Runs without console errors + fps**: listen for `console.type() === "error"` and `pageerror`; after canvas appears, measure rAF-fps over 30s; assert 0 errors and fps ≥ 50 (record actual number in output). Mark this test `test.slow()`.
4. **Reduced motion**: new context with `reducedMotion: "reduce"` emulation + rAF counter init script; goto, scroll to demo, wait for canvas, wait 1s settle; assert rAF delta over the next 2s == 0; assert the play button is present (`▶`).
5. Keep total e2e wall time sane: only the fps test is 30s.

**`lighthouserc.cjs` + `scripts/lighthouse.mjs`**: add the demo post URL to `collect.url[]`; add the `audits` LCP extension per fact 6 (assert on all URLs). All categories ≥95 must now hold for three URLs.

**`test/phase-3-meta.mjs` update**: the demo post now legitimately carries inline hydration scripts. Amend the zero-script assertion: post pages must have zero scripts **unless** the page contains `<astro-island` — in that case assert there are **no external `<script src=`** tags and no `modulepreload` links (everything stays lazy). The field-note fixture keeps the strict zero-script check alive for the non-demo case. OG inventory: two published posts now — expect `{particlr-spatial-hash, field-notes-hello-log, log}.png`.

### 7. `devlog/phase-4-demo-islands.md`

Per contract: `project: scribr`, `phase: 4`, `draft: true`, `repo_ref: "phase-4"`. Real decisions (host-driven runtime integration, vendored preset, poster-mode opt-in button, fps threshold under headless SwiftShader), real failures, real numbers (island graph size measured from dist, fps measured, LCP from Lighthouse, demo-post Lighthouse scores).

## Stop conditions (all must pass)

- [ ] Full regression: `build`, `check`, `test:phase0` (updated path), `test:phase1`, `test:phase2`, `test:phase3` (updated), `test:e2e` — all exit 0
- [ ] e2e proves: zero pixi/particlr bytes on `/log/` and the field-note post; demo post loads pixi only after scroll-into-view; 30s run with 0 console errors and fps ≥ 50 (actual number reported); reduced-motion shows populated poster frame with 0 rAF delta and a play button
- [ ] `npm run test:lighthouse` exits 0 with three URLs — all categories ≥ 95 AND LCP ≤ 1500ms on each (report all numbers)
- [ ] `dist/` audit: the pixi/runtime chunks exist under `_astro/` and are referenced ONLY from the demo post's `astro-island component-url` graph (no other page references them — covered by test:phase3 amendment + e2e, but eyeball the demo post HTML)
- [ ] The vendored `.prt` is byte-identical to `particlr/presets/ember-field.prt`

## Out of scope

- More than one demo preset/embed; interactive params (setParam sliders) — v2 candy
- Editing other posts; publishing drafts; deploy (Phase 5)
- Do not touch the particlr repo at all this phase
- Do not commit — reviewer commits

## Report format

Files created/modified; commands + exit codes; measured numbers (fps, LCP, island graph bytes, Lighthouse ×3 URLs); stop-condition checklist; deviations with justification.
