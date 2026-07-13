// One-shot: generate WOFF2 variants of the committed (already-subsetted) TTFs.
// The site serves WOFF2 (listed first in each variant's src in astro.config.mjs)
// while og-canvas keeps consuming the TTFs directly (satori/CanvasKit need TTF).
// Outputs are committed beside the TTFs; re-run only if the TTFs change.
//
// Uses wawoff2 (WASM port of Google's woff2) — no native toolchain needed.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { compress } from "wawoff2";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dirname, "..", "src", "assets", "fonts");

const faces = [
  "IBMPlexMono-Regular.ttf",
  "IBMPlexMono-SemiBold.ttf",
  "SourceSerif4-Regular.ttf",
  "SourceSerif4-It.ttf",
  "SourceSerif4-Semibold.ttf",
];

for (const name of faces) {
  const src = join(fontsDir, name);
  const out = join(fontsDir, name.replace(/\.ttf$/, ".woff2"));
  const ttf = readFileSync(src);
  const woff2 = Buffer.from(await compress(ttf));
  writeFileSync(out, woff2);
  console.log(
    `${basename(src)} ${ttf.length}B -> ${basename(out)} ${woff2.length}B (${Math.round((woff2.length / ttf.length) * 100)}%)`
  );
}
