// Raw-import a vendored .prt preset as a string (Vite `?raw` suffix). The
// particlr runtime's parseParticle() takes the JSON text directly, so the
// preset ships as an inlined string in the lazy island chunk — no fetch, no
// separate asset request.
declare module "*.prt?raw" {
  const s: string;
  export default s;
}
