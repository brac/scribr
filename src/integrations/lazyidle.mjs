// Registers the client:lazyidle directive (see src/directives/lazyidle.mjs for
// why it exists — post-LCP hydration for above-the-fold enhancement islands).
export default function lazyIdle() {
  return {
    name: "lazyidle-directive",
    hooks: {
      "astro:config:setup": ({ addClientDirective }) => {
        addClientDirective({
          name: "lazyidle",
          // Project-root-relative string, not a file URL: esbuild (which
          // bundles directive entrypoints) can't resolve file:// URLs with
          // percent-encoded spaces in the path on Windows.
          entrypoint: "./src/directives/lazyidle.mjs",
        });
      },
    },
  };
}
