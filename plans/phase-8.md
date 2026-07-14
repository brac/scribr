# Phase 8 — site source fixes (demo island teardown, OG guard, routes, a11y)

Addresses review findings **#7, #8, #21, #22, #23, #24, #25** from
`docs/CODE-REVIEW-2026-07-13.md`, plus one comment-drift nit. Read those entries first.

## 1. Settled decisions — do not relitigate

- **#7 + #8 (ParticlrDemo teardown):** one refactor fixes both. The effect keeps a single
  `cleanup` slot that is **progressively reassigned** as resources come alive, so every exit
  path (cancel mid-await, mid-init throw, unmount) tears down exactly what exists at that
  moment. Verified library facts (do not re-verify): Pixi v8 `Application.destroy()` nulls
  `this.renderer`, so **`app.canvas` must never be read after `app.destroy()`**; and
  `app.destroy(true, ...)` (`rendererDestroyOptions: true` ⇒ `removeView: true`) already
  detaches the canvas from the DOM, so the manual canvas-removal block is dead code — delete it.
- **#21 (global tickers):** the reduced-motion poster path keeps stopping `Ticker.system` and
  `Ticker.shared` (the zero-rAF e2e gate depends on it). The fix: `ctl.start` restarts
  `Ticker.system` and `Ticker.shared` alongside `app.ticker`, so pressing play restores normal
  page-global ticker state. `ctl.stop` keeps stopping only `app.ticker`.
- **#22 (OG key collision):** in `src/pages/og/[...route].ts`, guard the post loop:
  `if (post.id in pages) throw new Error(...)` — a build-time loud failure, mirroring the
  intent of `prerenderConflictBehavior: "error"`.
- **#23 (nested content ids):** `src/content.config.ts` loader pattern changes from
  `"**/*.{md,mdx}"` to `"*.{md,mdx}"`. Consequence (accepted): a nested file is silently not
  loaded rather than producing an off-contract URL; content is flat by construction (sync
  writes flat) and the loader comment should say so.
- **#24 (REF link):** the GitHub org stays `brac` (it matches every remote in
  `scribr.config.json`). Fix: field-notes posts render the REF cell **without** an href (plain
  value); project posts keep the existing pattern. `TitleBlock`'s `Cell` already supports
  href-less cells (DATE/PHASE) — do not modify TitleBlock.
- **#25 (a11y of demo failure):** keep the visual `.demo-error` overlay inside the
  `aria-hidden` stage. Additionally surface failure in the (accessible) figcaption: the
  `.demo-label` span gets `role="status"` and reads
  `demo ▸ {preset} — failed to load` when `failed` is true, the normal label otherwise.
- **Nit:** `astro.config.mjs` comment says "Cloudflare Pages"; deployment is Vercel — fix the
  word in the comment. No functional change.

## 2. Pinned dependencies

None added, none upgraded.

## 3. Files to modify

### `src/components/ParticlrDemo.tsx` — the only substantial change

Replace the effect body with this structure (adapt mechanically, keep existing comments where
they still apply; `runCleanup` replaces the old `destroyed` flag — nulling the slot makes it
idempotent):

```tsx
useEffect(() => {
  if (!presetText) { setFailed(true); return; }
  const stage = stageRef.current;
  if (!stage) return;

  let cancelled = false;
  let cleanup: (() => void) | null = null;
  // Progressively reassigned as resources come alive; runCleanup is safe to
  // call from any exit path and at most once.
  const runCleanup = () => {
    const c = cleanup;
    cleanup = null;
    ctl.current = null;
    try { c?.(); } catch { /* teardown must never throw into Preact */ }
  };

  (async () => {
    const [{ Application, Ticker }, { parseParticle, Effect }, { PixiParticleRenderer }] =
      await Promise.all([ /* unchanged */ ]);
    if (cancelled) return;

    const parsed = parseParticle(presetText);
    if (!parsed.doc) { setFailed(true); return; }

    const app = new Application();
    await app.init({ resizeTo: stage, backgroundAlpha: 0, antialias: true });
    // Application is live from here — every later exit must destroy it.
    cleanup = () => { app.destroy(true, { children: true }); };
    if (cancelled) { runCleanup(); return; }

    stage.appendChild(app.canvas);
    /* canvas style lines unchanged */

    const fx = new Effect(parsed.doc, { seed: 1337 });
    const view = new PixiParticleRenderer(fx);
    cleanup = () => { view.destroy(); app.destroy(true, { children: true }); };
    await view.ready;
    if (cancelled) { runCleanup(); return; }
    app.stage.addChild(view.container);

    /* position(), tick, app.ticker.add(tick), ResizeObserver — unchanged */

    cleanup = () => {
      ro.disconnect();
      app.ticker.remove(tick);
      view.destroy();
      // destroy(true, …) detaches the canvas itself; NEVER read app.canvas
      // after this line — pixi v8 nulls the renderer on destroy.
      app.destroy(true, { children: true });
    };

    ctl.current = {
      start: () => {
        // Poster mode stops the page-global tickers (zero-rAF gate); pressing
        // play restores them so pointer polling and any shared-ticker
        // consumers resume alongside our render loop.
        Ticker.system.start();
        Ticker.shared.start();
        app.ticker.start();
        setPlaying(true);
      },
      stop: () => { app.ticker.stop(); setPlaying(false); },
    };

    /* reduced-motion poster block and setReady(true) — unchanged */
  })().catch((err) => {
    runCleanup();
    if (!cancelled) {
      console.error("[ParticlrDemo] init failed", err);
      setFailed(true);
    }
  });

  return () => { cancelled = true; runCleanup(); };
}, [presetText]);
```

Also (#25): in the JSX, change the label span to
`<span class="demo-label" role="status">{failed ? \`demo ▸ ${preset} — failed to load\` : \`demo ▸ ${preset}\`}</span>`.
The in-stage `.demo-error` div stays.

### `src/pages/og/[...route].ts` — collision guard (#22)

```ts
for (const post of posts) {
  if (post.id in pages) {
    throw new Error(
      `OG card key collision: post id "${post.id}" would overwrite an existing card`
    );
  }
  pages[post.id] = { ... };  // unchanged
}
```

### `src/content.config.ts` — `pattern: "*.{md,mdx}"` (#23), plus a comment noting content is
flat by contract (sync writes flat; nested files are intentionally not loaded).

### `src/layouts/Post.astro` — REF cell (#24): only attach `href` when `!isFieldNotes`; comment
that repo names mirror project names per `scribr.config.json` and field-notes has no repo.

### `astro.config.mjs` — comment word swap Cloudflare Pages → Vercel.

## 4. Stop conditions

1. `npm run build` → exit 0.
2. `npm run test:phase3` → exit 0 (OG inventory, zero-JS pages, island placement all unchanged).
3. `npm run test:phase1` → exit 0.
4. `npm run test:e2e` → exit 0 — pay attention to: "reduced motion shows a static poster with
   zero ongoing rAF" (must still pass with the #21 change — start() is user-initiated, so the
   poster path is untouched) and the 30s fps/console-error test (the teardown refactor must not
   introduce console errors).
5. `grep` proof: no occurrence of `app.canvas` textually after the `app.destroy` call in the
   final cleanup (i.e., the dead block is gone). State this in the report.

## 5. Out of scope

- Findings #1–#6, #9–#20, #26–#30 (other phases). No changes to `scripts/*`, `test/*`, `e2e/*`,
  `playwright.config.ts`, `.gitignore`, `src/styles/global.css` (the existing `.demo-error` and
  `.demo-label` styles are sufficient), or `TitleBlock.astro`.
- Do not change the preset, seed, emitter position, or any rendering parameters.
- **Do not commit — the reviewer commits after approval.**

## 6. Report format

Files changed with rationale; each stop-condition command with exit code + output tail; explicit
confirmation of stop-condition 5; deviations with justification.
