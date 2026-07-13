// Phase 0 schema gate — proves the content schema fails the build when the
// seed post's required frontmatter is corrupted. No test framework; plain Node.
// Mutations are done by raw string manipulation on the frontmatter block so the
// test stays dependency-free (no YAML library).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const seed = join(root, "src", "content", "log", "particlr-spatial-hash.md");
const backup = join(__dirname, "particlr-spatial-hash.md.bak");

function build() {
  const r = spawnSync("npm", ["run", "build"], {
    cwd: root,
    shell: true,
    stdio: "ignore",
  });
  return r.status;
}

const pristine = readFileSync(seed, "utf8");
copyFileSync(seed, backup);

let failures = 0;

function report(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
}

try {
  // 1. Baseline: clean build must succeed.
  report("baseline clean build exits 0", build() === 0);

  // 2. Corruption cases: each must make the build fail (nonzero exit).
  const cases = [
    {
      name: "missing summary line fails build",
      mutate: (src) =>
        src
          .split("\n")
          .filter((line) => !line.startsWith("summary:"))
          .join("\n"),
    },
    {
      name: "bad project enum (particlrr) fails build",
      mutate: (src) => src.replace("project: particlr", "project: particlrr"),
    },
    {
      name: "empty tags array fails build",
      mutate: (src) =>
        src.replace(
          "tags: [pixijs, performance, spatial-hash]",
          "tags: []"
        ),
    },
  ];

  for (const c of cases) {
    const mutated = c.mutate(pristine);
    if (mutated === pristine) {
      report(c.name + " (mutation applied)", false);
      continue;
    }
    writeFileSync(seed, mutated);
    const status = build();
    report(c.name, status !== 0);
    // restore pristine copy before the next case
    copyFileSync(backup, seed);
  }

  // 3. Final: clean build again (proves restore worked).
  report("final clean build exits 0 (restore worked)", build() === 0);
} finally {
  // Always restore the pristine seed and remove the backup.
  writeFileSync(seed, pristine);
  try {
    rmSync(backup);
  } catch {}
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll schema-gate assertions passed.");
