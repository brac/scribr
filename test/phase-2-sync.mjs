// Phase 2 sync gate — exercises every SYNC-DESIGN §5 failure mode against a
// fixture git repo built at runtime (no .git dir is ever committed to scribr).
// Dependency-free orchestration: builds repos with `git init`, runs the real
// scripts/sync.mjs as a child process, and asserts exit codes AND file effects.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const syncScript = join(root, "scripts", "sync.mjs");

let failures = 0;
function report(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    if (detail) console.error(`      ${detail}`);
  }
}

const toPosix = (p) => p.replace(/\\/g, "/");
const cleanups = [];
function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(d);
  return d;
}

// ---- fixtures ----------------------------------------------------------

function validPost({ slug = "the-thing", project = "particlr", title, summary } = {}) {
  return [
    "---",
    `title: "${title ?? "Rebuilding the " + slug + " pass for real"}"`,
    "date: 2026-07-12",
    `project: ${project}`,
    "phase: 4",
    "tags: [pixijs, performance]",
    "draft: true",
    `summary: "${summary ?? "A concrete one-line summary that clears the twenty character floor easily."}"`,
    'repo_ref: "abc1234"',
    "decisions: []",
    "benchmarks: []",
    "---",
    "",
    "## What shipped",
    "",
    "Body text for the fixture post. Not validated beyond frontmatter.",
    "",
  ].join("\n");
}

// Build a git repo in a temp dir with the given devlog files.
// files: { "phase-3-collision-rework.md": "<contents>", ... }
function makeRepo(files) {
  const repo = tmp("scribr-fixrepo-");
  mkdirSync(join(repo, "devlog"), { recursive: true });
  // -text guarantees no CRLF conversion on clone → byte-identity holds on Windows.
  writeFileSync(join(repo, ".gitattributes"), "* -text\n");
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(repo, "devlog", name), contents);
  }
  const git = (...args) => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
    }
  };
  spawnSync("git", ["init", "-b", "main", repo], { encoding: "utf8" });
  git("config", "user.email", "fixture@scribr.test");
  git("config", "user.name", "scribr fixtures");
  git("config", "core.autocrlf", "false");
  git("add", ".");
  git("commit", "-m", "fixture devlog");
  return repo;
}

function writeConfig(contentDir, sources) {
  const dir = tmp("scribr-fixcfg-");
  const p = join(dir, "config.json");
  writeFileSync(
    p,
    JSON.stringify(
      {
        contentDir: toPosix(contentDir),
        sources: sources.map((s) => ({ ...s, repo: toPosix(s.repo) })),
      },
      null,
      2
    )
  );
  return p;
}

function runSync(configPath) {
  const r = spawnSync(process.execPath, [syncScript, "--config", configPath], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function freshContentDir() {
  return tmp("scribr-content-");
}

// ---- scenarios ---------------------------------------------------------

try {
  const validSlugFile = "phase-3-collision-rework.md";
  const validContents = validPost({ slug: "collision-rework" });
  const goodRepo = makeRepo({ [validSlugFile]: validContents });

  // 1. Fresh valid file → synced, exit 0, prefix stripped, byte-identical.
  {
    const cd = freshContentDir();
    const cfg = writeConfig(cd, [
      { project: "particlr", repo: goodRepo, branch: "main" },
    ]);
    const { status, out } = runSync(cfg);
    const target = join(cd, "particlr-collision-rework.md");
    report("fresh valid file: exit 0", status === 0, `exit ${status}\n${out}`);
    report("fresh valid file: reported synced", /synced:/.test(out) && /1 synced/.test(out));
    report(
      "prefix stripped → particlr-collision-rework.md exists",
      existsSync(target)
    );
    const byteEqual =
      existsSync(target) &&
      Buffer.compare(readFileSync(target), readFileSync(join(goodRepo, "devlog", validSlugFile))) === 0;
    report("synced file is byte-identical to source", byteEqual);

    // 2. Second run over already-synced state → 0 synced, exit 0.
    const second = runSync(cfg);
    report("second run: exit 0", second.status === 0, `exit ${second.status}`);
    report("second run: 0 synced, reported exists", /0 synced/.test(second.out) && /exists:/.test(second.out));
    const stillEqual =
      existsSync(target) &&
      Buffer.compare(readFileSync(target), readFileSync(join(goodRepo, "devlog", validSlugFile))) === 0;
    report("second run: target still byte-identical (not rewritten)", stillEqual);
  }

  // 3. Target .md already present → skipped, NOT overwritten.
  {
    const cd = freshContentDir();
    const sentinel = "SENTINEL EDITED — must not be overwritten\n";
    writeFileSync(join(cd, "particlr-collision-rework.md"), sentinel);
    const cfg = writeConfig(cd, [{ project: "particlr", repo: goodRepo, branch: "main" }]);
    const { status, out } = runSync(cfg);
    report("existing .md: exit 0", status === 0, `exit ${status}`);
    report("existing .md: reported exists, 0 synced", /exists:/.test(out) && /0 synced/.test(out));
    report(
      "existing .md: content unchanged (not overwritten)",
      readFileSync(join(cd, "particlr-collision-rework.md"), "utf8") === sentinel
    );
  }

  // 4. Target .mdx already present → skipped, no .md resurrection.
  {
    const cd = freshContentDir();
    const sentinel = "MDX SENTINEL\n";
    writeFileSync(join(cd, "particlr-collision-rework.mdx"), sentinel);
    const cfg = writeConfig(cd, [{ project: "particlr", repo: goodRepo, branch: "main" }]);
    const { status, out } = runSync(cfg);
    report("existing .mdx: exit 0", status === 0, `exit ${status}`);
    report("existing .mdx: reported exists", /exists:/.test(out) && /0 synced/.test(out));
    report(
      "existing .mdx: no .md resurrected",
      !existsSync(join(cd, "particlr-collision-rework.md"))
    );
    report(
      "existing .mdx: content unchanged",
      readFileSync(join(cd, "particlr-collision-rework.mdx"), "utf8") === sentinel
    );
  }

  // 5. Invalid frontmatter (missing summary) → skipped, field named, exit 1.
  {
    const cd = freshContentDir();
    const noSummary = validPost({ slug: "docking" })
      .split("\n")
      .filter((l) => !l.startsWith("summary:"))
      .join("\n");
    const repo = makeRepo({ "phase-4-docking.md": noSummary });
    const cfg = writeConfig(cd, [{ project: "particlr", repo, branch: "main" }]);
    const { status, out } = runSync(cfg);
    report("missing summary: exit 1", status === 1, `exit ${status}\n${out}`);
    report("missing summary: FAILED line names 'summary'", /FAILED:/.test(out) && /summary/.test(out));
    report("missing summary: target not created", !existsSync(join(cd, "particlr-docking.md")));
  }

  // 6. Wrong project field (haulr) in a particlr source → skipped, exit 1.
  {
    const cd = freshContentDir();
    const wrong = validPost({ slug: "wrong", project: "haulr" });
    const repo = makeRepo({ "phase-2-wrong.md": wrong });
    const cfg = writeConfig(cd, [{ project: "particlr", repo, branch: "main" }]);
    const { status, out } = runSync(cfg);
    report("wrong project: exit 1", status === 1, `exit ${status}\n${out}`);
    report("wrong project: FAILED line names 'project'", /FAILED:/.test(out) && /project/.test(out));
    report("wrong project: target not created", !existsSync(join(cd, "particlr-wrong.md")));
  }

  // 7. Unreachable repo as one of two sources → other still syncs, exit 1.
  {
    const cd = freshContentDir();
    const goodRepo2 = makeRepo({ "phase-1-good.md": validPost({ slug: "good" }) });
    const missing = join(tmpdir(), "scribr-does-not-exist-" + Date.now());
    const cfg = writeConfig(cd, [
      { project: "particlr", repo: missing, branch: "main" },
      { project: "particlr", repo: goodRepo2, branch: "main" },
    ]);
    const { status, out } = runSync(cfg);
    report("unreachable repo: exit 1", status === 1, `exit ${status}\n${out}`);
    report("unreachable repo: clone failure reported", /clone failed/.test(out));
    report(
      "unreachable repo: the reachable source still synced",
      existsSync(join(cd, "particlr-good.md")) && /1 synced/.test(out)
    );
  }
} finally {
  for (const d of cleanups) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* best-effort */
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll phase-2 sync assertions passed.");
