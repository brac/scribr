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

// 1. Fixture gate — this whole suite is a set of negatives ("draft-fixture
// absent from dist"), so it proves nothing if the fixture disappears. Assert the
// draft fixture source exists AND is still draft: true BEFORE spending a build.
const fixture = join(root, "src", "content", "log", "field-notes-draft-fixture.md");
if (!existsSync(fixture)) {
  console.error(
    "FAIL  draft fixture src/content/log/field-notes-draft-fixture.md exists"
  );
  console.error(
    "\nThe draft fixture is this gate's only proof — every assertion below is a\n" +
      "negative that stays green once it is deleted or renamed. Restore it before\n" +
      "running the phase-1 gate."
  );
  process.exit(1);
}
const fixtureFm = readFileSync(fixture, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fixtureFm || !/^draft:\s*true\s*$/m.test(fixtureFm[1])) {
  console.error(
    "FAIL  draft fixture frontmatter contains draft: true"
  );
  console.error(
    "\nThe draft fixture must stay draft: true — it is the post this gate proves\n" +
      "gets excluded from every output surface. Do not publish or alter it."
  );
  process.exit(1);
}
report("draft fixture present and draft: true", true);

// 2. Build.
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

// 3. Draft URL directory must not exist.
report(
  "dist/log/field-notes-draft-fixture/ does not exist",
  !existsSync(join(dist, "log", "field-notes-draft-fixture"))
);

// 4. No file under dist/ may contain the string "draft-fixture".
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

// 5. Seed post must be present — guards against a filter that excludes all.
report(
  "seed post dist/log/particlr-spatial-hash/index.html present",
  existsSync(join(dist, "log", "particlr-spatial-hash", "index.html"))
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll draft-exclusion assertions passed.");
