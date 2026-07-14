import { useEffect, useRef, useState } from "preact/hooks";
import emberFieldRaw from "../assets/presets/ember-field.prt?raw";

// Vendored presets, keyed by name. Only the raw JSON string ships here (~7 KB);
// the runtime + PixiJS graph is loaded lazily via dynamic import inside the
// effect, so this module — and the SSR shell it renders — carry no WebGL cost.
const PRESETS: Record<string, string> = {
  "ember-field": emberFieldRaw,
};

interface Props {
  // Currently only "ember-field". Unknown values render an inline error box
  // rather than throwing (a bad prop must not blank the post).
  preset: string;
}

// A live particlr demo. The island owns the Pixi Application, ticker, and
// teardown (the runtime is host-driven). SSR renders only the figure shell;
// every pixi/runtime import is dynamic and runs on mount, so the heavy graph
// (~283 KB gz) loads only when the figure scrolls into view (client:visible).
export default function ParticlrDemo({ preset }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false); // pixi attached, sim populated
  const [playing, setPlaying] = useState(false); // ticker running
  const [failed, setFailed] = useState(false);

  // Imperative start/stop handle, filled once the async init resolves.
  const ctl = useRef<{ start: () => void; stop: () => void } | null>(null);

  const presetText = PRESETS[preset];

  useEffect(() => {
    if (!presetText) {
      setFailed(true);
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;

    let cancelled = false;
    let cleanup: (() => void) | null = null;
    // Progressively reassigned as resources come alive; runCleanup is safe to
    // call from any exit path and at most once (nulling the slot makes it
    // idempotent — it replaces the old `destroyed` flag).
    const runCleanup = () => {
      const c = cleanup;
      cleanup = null;
      ctl.current = null;
      try {
        c?.();
      } catch {
        /* teardown must never throw into Preact */
      }
    };

    (async () => {
      // Dynamic imports keep pixi/runtime out of SSR and out of every page's
      // graph — they resolve to the lazy island chunk on first hydration.
      const [{ Application, Ticker }, { parseParticle, Effect }, { PixiParticleRenderer }] =
        await Promise.all([
          import("pixi.js"),
          import("@particlr/runtime"),
          import("@particlr/runtime/pixi"),
        ]);
      if (cancelled) return;

      const parsed = parseParticle(presetText);
      if (!parsed.doc) {
        setFailed(true);
        return;
      }

      const app = new Application();
      // No built-in resize semantics we rely on beyond canvas sizing: resizeTo
      // the stage keeps the canvas matched to the aspect-ratio box; transparent
      // background lets the --panel fill show through.
      await app.init({
        resizeTo: stage,
        backgroundAlpha: 0,
        antialias: true,
      });
      // Application is live from here — every later exit must destroy it.
      cleanup = () => {
        app.destroy(true, { children: true });
      };
      if (cancelled) {
        runCleanup();
        return;
      }

      stage.appendChild(app.canvas);
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";
      app.canvas.style.display = "block";

      const fx = new Effect(parsed.doc, { seed: 1337 });
      const view = new PixiParticleRenderer(fx);
      cleanup = () => {
        view.destroy();
        app.destroy(true, { children: true });
      };
      await view.ready; // embedded textures decoded
      if (cancelled) {
        runCleanup();
        return;
      }
      app.stage.addChild(view.container);

      // Emitter low-centre: the rect emitter is 300px wide and embers rise
      // (gravity y = -60), so seating it near the bottom keeps the warmth band
      // and the drift both in frame.
      const position = () => {
        view.container.position.set(app.screen.width / 2, app.screen.height * 0.8);
      };
      position();

      const tick = (t: { deltaMS: number }) => {
        fx.step(t.deltaMS / 1000);
        view.sync();
      };
      app.ticker.add(tick);

      // No ResizeObserver-driven app.resize needed (resizeTo handles the canvas
      // on window resize); we only need to re-seat the emitter when the box
      // changes size.
      const ro = new ResizeObserver(() => position());
      ro.observe(stage);

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
        stop: () => {
          app.ticker.stop();
          setPlaying(false);
        },
      };

      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      if (reduced) {
        // Poster mode: advance the sim deterministically, paint one frame, and
        // stop the ticker — a populated static image with zero ongoing rAF.
        for (let i = 0; i < 90; i++) fx.step(1 / 60);
        view.sync();
        position();
        app.render();
        app.ticker.stop();
        // Beyond app.ticker, Pixi keeps a global system ticker alive (pointer
        // polling) and can hold the shared ticker — both schedule rAF forever.
        // Reduced motion must yield a truly static frame, so stop every ticker;
        // the page then settles to zero rAF. (A later pointer-over would restart
        // the system ticker for event polling only — still no rendering, since
        // app.ticker stays stopped until the user presses play.)
        Ticker.system.stop();
        Ticker.shared.stop();
        setPlaying(false);
      } else {
        // Application ticker auto-starts; our tick is now live.
        setPlaying(true);
      }
      setReady(true);
    })().catch((err) => {
      runCleanup();
      if (!cancelled) {
        console.error("[ParticlrDemo] init failed", err);
        setFailed(true);
      }
    });

    return () => {
      cancelled = true;
      runCleanup();
    };
  }, [presetText]);

  const toggle = () => {
    const c = ctl.current;
    if (!c) return;
    if (playing) c.stop();
    else c.start();
  };

  return (
    <figure class="demo">
      <div class="demo-stage" ref={stageRef} aria-hidden="true">
        {failed && (
          <div class="demo-error">
            preset “{preset}” could not be loaded
          </div>
        )}
      </div>
      <figcaption class="demo-caption">
        <span class="demo-label" role="status">
          {failed ? `demo ▸ ${preset} — failed to load` : `demo ▸ ${preset}`}
        </span>
        <button
          type="button"
          class="demo-toggle"
          aria-pressed={playing}
          aria-label={playing ? "Pause animation" : "Play animation"}
          disabled={!ready || failed}
          onClick={toggle}
        >
          {playing ? "⏸ pause" : "▶ play"}
        </button>
      </figcaption>
    </figure>
  );
}
