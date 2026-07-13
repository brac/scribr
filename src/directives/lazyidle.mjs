// client:lazyidle — hydrate strictly AFTER the page's first paints are done:
// window load (all resources, including the preloaded fonts, are in) → two
// rAFs (the font-swap repaint has committed, so the observed LCP candidate is
// final) → an idle slot. Functionally identical to client:idle for the user —
// the island is server-rendered and inert-but-visible either way — but it
// guarantees the hydration fetches can never start before LCP. That matters
// because Lighthouse's Lantern model puts EVERY request that starts before
// observed LCP into the pessimistic LCP graph: with plain client:idle the
// chips' JS races the font-swap paint and randomly adds ~300ms of simulated
// LCP to /log/ (the run-to-run 1353↔1654ms variance).
export default (load) => {
  const idle = (cb) =>
    "requestIdleCallback" in window
      ? window.requestIdleCallback(cb)
      : setTimeout(cb, 200);
  const go = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        idle(async () => {
          const hydrate = await load();
          await hydrate();
        })
      )
    );
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
};
