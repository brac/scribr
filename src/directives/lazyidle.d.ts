// Type registration for the client:lazyidle directive (see lazyidle.mjs).
// The top-level import makes this file a module so `declare module "astro"`
// AUGMENTS Astro's types instead of shadowing them.
import "astro";

declare module "astro" {
  interface AstroClientDirectives {
    "client:lazyidle"?: boolean;
  }
}
