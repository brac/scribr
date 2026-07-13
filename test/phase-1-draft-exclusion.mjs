// Phase 1 draft-exclusion gate — proves a draft: true post is absent from every
// built page, feed, and sitemap entry. Runs the build itself first (like the
// phase-0 gate), then walks dist/. Dependency-free plain Node.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

let failures = 0;
function report(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
}

// 1. Build.
const build = spawnSync("npm", ["run", "build"], {
  cwd: root,
  shell: true,
  stdio: "inherit",
});
report("npm run build exits 0", build.status === 0);
if (build.status !== 0) {
  console.error("\nBuild failed; aborting exclusion checks.");
  process.exit(1);
}

// 2. Draft URL directory must not exist.
report(
  "dist/log/field-notes-draft-fixture/ does not exist",
  !existsSync(join(dist, "log", "field-notes-draft-fixture"))
);

// 3. No file under dist/ may contain the string "draft-fixture".
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(dist);
const offenders = files.filter((f) => readFileSync(f, "utf8").includes("draft-fixture"));
report(
  `zero dist files contain "draft-fixture" (scanned ${files.length})`,
  offenders.length === 0
);
if (offenders.length > 0) {
  for (const f of offenders) console.error(`  leaked in: ${f}`);
}

// 4. Seed post must be present — guards against a filter that excludes all.
report(
  "seed post dist/log/particlr-spatial-hash/index.html present",
  existsSync(join(dist, "log", "particlr-spatial-hash", "index.html"))
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll draft-exclusion assertions passed.");
