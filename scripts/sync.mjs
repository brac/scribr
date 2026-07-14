// scribr sync — pulls devlog/*.md from every configured project repo into
// src/content/log/, renamed to the {project}-{slug} convention, without ever
// overwriting a local edit. One-way, non-destructive on the scribr side:
// once a draft is synced, the scribr copy is truth (SYNC-DESIGN §1).
//
// Usage: node scripts/sync.mjs [--config <path>]
// Only dependency: `yaml` (dev tooling; nothing ships at runtime).

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ---- CLI ---------------------------------------------------------------

function parseArgs(argv) {
  let config = "scribr.config.json";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config") {
      config = argv[i + 1];
      if (!config) fail("--config requires a path argument");
      i++;
    } else {
      fail(`unknown argument: ${argv[i]}`);
    }
  }
  return { config };
}

function fail(msg) {
  console.error(`sync: ${msg}`);
  process.exit(1);
}

// ---- Startup: config + enum cross-check --------------------------------

const { config: configArg } = parseArgs(process.argv.slice(2));
const configPath = isAbsolute(configArg) ? configArg : join(root, configArg);

if (!existsSync(configPath)) fail(`config not found: ${configPath}`);

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (err) {
  fail(`config is not valid JSON (${configPath}): ${err.message}`);
}

if (typeof config.contentDir !== "string" || !config.contentDir) {
  fail("config.contentDir must be a non-empty string");
}
if (!Array.isArray(config.sources) || config.sources.length === 0) {
  fail("config.sources must be a non-empty array");
}
for (const s of config.sources) {
  if (!s || typeof s.project !== "string" || typeof s.repo !== "string" || typeof s.branch !== "string") {
    fail(`each source needs string project/repo/branch — got ${JSON.stringify(s)}`);
  }
}

// Repo allowlist — a config value reaches `git clone` argv, so reject anything
// that could be parsed as an option (leading "-") or a command-executing
// transport (git's "ext::"/"fd::" URLs use "::"). Accept only recognised remote
// schemes or an absolute local path (the test fixtures clone from those).
const REPO_SCHEME_RE = /^(https:\/\/|ssh:\/\/|git@)/;
for (const s of config.sources) {
  if (s.repo.startsWith("-") || s.repo.includes("::") || !(REPO_SCHEME_RE.test(s.repo) || isAbsolute(s.repo))) {
    fail(
      `source repo is not an allowed remote or absolute path: ${JSON.stringify(s.repo)} ` +
        `(expected https://, ssh://, git@… or an absolute local path; no leading "-", no "::")`
    );
  }
}

// Regex-extract the project enum from the single source of truth, exactly the
// way test/validate-feeds.mjs does (this is a .mjs, projects.ts is TS; regex
// avoids a transpile step). Typo protection identical to the schema's.
const projectsSrc = readFileSync(join(root, "src", "lib", "projects.ts"), "utf8");
const arrayMatch = projectsSrc.match(/PROJECTS\s*=\s*\[([^\]]*)\]/s);
if (!arrayMatch) fail("could not locate PROJECTS enum in src/lib/projects.ts");
const PROJECTS = [...arrayMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

for (const s of config.sources) {
  if (!PROJECTS.includes(s.project)) {
    fail(
      `source project "${s.project}" is not in the schema enum ` +
        `(src/lib/projects.ts): [${PROJECTS.join(", ")}]`
    );
  }
}

const contentDir = isAbsolute(config.contentDir)
  ? config.contentDir
  : join(root, config.contentDir);

// A wrong contentDir would make every existence check false and then throw on
// the first write (or, if it exists but points elsewhere, resurrect already-
// edited drafts). Fail fast, before any clone.
if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
  fail(`contentDir does not exist or is not a directory: ${contentDir}`);
}

// ---- Frontmatter validation (mirrors the Zod schema) -------------------

const SLUG_RE = /^[a-z0-9-]+$/;

// Returns { field, reason } on the first failure, or null if valid.
function validateFrontmatter(fm, expectedProject) {
  if (fm === null || typeof fm !== "object") {
    return { field: "frontmatter", reason: "not a YAML mapping" };
  }
  const isFieldNotes = fm.project === "field-notes";
  const required = ["title", "date", "project", "tags", "summary"];
  if (!isFieldNotes) required.push("phase", "repo_ref");
  for (const key of required) {
    if (fm[key] === undefined || fm[key] === null) {
      return { field: key, reason: "missing" };
    }
  }

  // date must parse
  const d = fm.date instanceof Date ? fm.date : new Date(fm.date);
  if (Number.isNaN(d.getTime())) {
    return { field: "date", reason: `does not parse as a date (${fm.date})` };
  }

  // project must match the source it came from
  if (fm.project !== expectedProject) {
    return {
      field: "project",
      reason: `expected "${expectedProject}", got "${fm.project}"`,
    };
  }

  // draft: valid when true OR omitted — the schema defaults it to true. Any
  // other value (explicit false, strings) fails; publishing is a human act.
  if (fm.draft !== undefined && fm.draft !== true) {
    return { field: "draft", reason: `must be true or omitted, got ${JSON.stringify(fm.draft)}` };
  }

  // title 8–90
  if (typeof fm.title !== "string" || fm.title.length < 8 || fm.title.length > 90) {
    return {
      field: "title",
      reason: `length must be 8–90 (got ${typeof fm.title === "string" ? fm.title.length : typeof fm.title})`,
    };
  }

  // summary 20–160
  if (typeof fm.summary !== "string" || fm.summary.length < 20 || fm.summary.length > 160) {
    return {
      field: "summary",
      reason: `length must be 20–160 (got ${typeof fm.summary === "string" ? fm.summary.length : typeof fm.summary})`,
    };
  }

  // tags: 1–5 entries, each a lowercase slug
  if (!Array.isArray(fm.tags) || fm.tags.length < 1 || fm.tags.length > 5) {
    return {
      field: "tags",
      reason: `must be 1–5 entries (got ${Array.isArray(fm.tags) ? fm.tags.length : typeof fm.tags})`,
    };
  }
  for (const t of fm.tags) {
    if (typeof t !== "string" || !SLUG_RE.test(t)) {
      return { field: "tags", reason: `"${t}" must match /^[a-z0-9-]+$/` };
    }
  }

  // phase: an integer ≥ 0 whenever present, on ANY post (0 is scribr's
  // Phase 0). Required-for-project-posts was already enforced above; the
  // schema's z.number().int().nonnegative() applies to field-notes too.
  if (fm.phase !== undefined && !(Number.isInteger(fm.phase) && fm.phase >= 0)) {
    return { field: "phase", reason: `must be an integer ≥ 0 (got ${JSON.stringify(fm.phase)})` };
  }

  // repo_ref: a string whenever present (z.string().optional()); additionally
  // non-empty for project posts (schema refine). An empty string on a
  // field-notes post is Zod-valid, so it stays valid here.
  if (fm.repo_ref !== undefined && typeof fm.repo_ref !== "string") {
    return { field: "repo_ref", reason: `must be a string (got ${JSON.stringify(fm.repo_ref)})` };
  }
  if (!isFieldNotes && fm.repo_ref.length === 0) {
    return { field: "repo_ref", reason: "must be a non-empty string for project posts" };
  }

  // decisions (if present): array of { what, why, alternatives? }. Absent is
  // fine — the schema defaults it to []. Mirrors the `decision` object shape.
  if (fm.decisions !== undefined) {
    if (!Array.isArray(fm.decisions)) {
      return { field: "decisions", reason: `must be an array (got ${typeof fm.decisions})` };
    }
    for (const dec of fm.decisions) {
      if (dec === null || typeof dec !== "object" || Array.isArray(dec)) {
        return { field: "decisions", reason: "each entry must be an object" };
      }
      if (typeof dec.what !== "string" || dec.what.length === 0) {
        return { field: "decisions", reason: "each entry needs a non-empty 'what'" };
      }
      if (typeof dec.why !== "string" || dec.why.length === 0) {
        return { field: "decisions", reason: "each entry needs a non-empty 'why'" };
      }
      if (dec.alternatives !== undefined &&
          (!Array.isArray(dec.alternatives) || dec.alternatives.some((a) => typeof a !== "string"))) {
        return { field: "decisions", reason: "'alternatives' must be an array of strings" };
      }
    }
  }

  // benchmarks (if present): array of { metric, value, target }, all non-empty
  // strings. Absent is fine — the schema defaults it to [].
  if (fm.benchmarks !== undefined) {
    if (!Array.isArray(fm.benchmarks)) {
      return { field: "benchmarks", reason: `must be an array (got ${typeof fm.benchmarks})` };
    }
    for (const b of fm.benchmarks) {
      if (b === null || typeof b !== "object" || Array.isArray(b)) {
        return { field: "benchmarks", reason: "each entry must be an object" };
      }
      for (const k of ["metric", "value", "target"]) {
        if (typeof b[k] !== "string" || b[k].length === 0) {
          return { field: "benchmarks", reason: `each entry needs a non-empty '${k}'` };
        }
      }
    }
  }

  return null;
}

// Extract and parse the leading `---\n...\n---` YAML block. Returns
// { fm } on success or { error } describing the parse failure.
function readFrontmatter(raw) {
  const text = raw.replace(/^﻿/, "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?(?:\n|$)/);
  if (!m) return { error: "no YAML frontmatter block" };
  try {
    return { fm: parseYaml(m[1]) };
  } catch (err) {
    return { error: `YAML parse error: ${err.message}` };
  }
}

// ---- Clone one source into a fresh temp dir ----------------------------

function sparseCloneDevlog(repo, branch) {
  const tmp = mkdtempSync(join(tmpdir(), "scribr-sync-"));
  const clone = spawnSync(
    "git",
    [
      "clone",
      "--depth", "1",
      "--filter=blob:none",
      "--sparse",
      "--branch", branch,
      "--single-branch",
      "--", // end of options — repo can never be read as a flag
      repo,
      tmp,
    ],
    { encoding: "utf8" }
  );
  if (clone.status !== 0) {
    return { tmp, error: (clone.stderr || clone.error?.message || "git clone failed").trim() };
  }
  const sparse = spawnSync("git", ["-C", tmp, "sparse-checkout", "set", "devlog"], {
    encoding: "utf8",
  });
  if (sparse.status !== 0) {
    return { tmp, error: (sparse.stderr || "git sparse-checkout failed").trim() };
  }
  return { tmp };
}

// ---- Main --------------------------------------------------------------

const today = new Date().toISOString().slice(0, 10);
console.log(`scribr sync — ${today}`);

let synced = 0;
let skipped = 0;
let failed = 0;
let dirty = false; // any clone failure or validation failure → exit 1

const pad = (s) => s.padEnd(10);

for (const source of config.sources) {
  const { project, repo, branch } = source;
  let tmp;
  try {
    const res = sparseCloneDevlog(repo, branch);
    tmp = res.tmp;
    if (res.error) {
      failed++; // a clone/sparse-checkout failure is a failure, not just dirty
      dirty = true;
      const firstLine = res.error.split("\n")[0];
      console.log(`  ${pad(project)} ERROR: clone failed — ${firstLine}`);
      continue;
    }

    const devlogDir = join(tmp, "devlog");
    if (!existsSync(devlogDir)) continue; // no devlog/ → 0 files, not an error

    const files = readdirSync(devlogDir)
      .filter((n) => n.endsWith(".md"))
      .sort();

    // Pre-group by computed stem so a within-source collision (phase-3-retro.md
    // + phase-7-retro.md → particlr-retro.md) is caught before anything writes.
    const stemGroups = new Map();
    for (const file of files) {
      const slug = file.slice(0, -3).replace(/^phase-\d+-/, "");
      const stem = `${project}-${slug}`;
      if (!stemGroups.has(stem)) stemGroups.set(stem, []);
      stemGroups.get(stem).push(file);
    }

    for (const file of files) {
      const base = file.slice(0, -3); // strip ".md"
      const slug = base.replace(/^phase-\d+-/, "");
      const stem = `${project}-${slug}`;

      // Duplicate-stem guard: when two devlog files collapse to the same target
      // stem, none of them sync — each is failed, naming its collision partners,
      // and a human resolves it upstream (#1). Runs before the existence check
      // so a collision can never quietly write one file and drop the rest.
      const group = stemGroups.get(stem);
      if (group.length > 1) {
        failed++;
        dirty = true;
        const others = group.filter((f) => f !== file).join(", ");
        console.log(
          `  ${pad(project)} FAILED: ${file} — duplicate target stem "${stem}" (also from: ${others})`
        );
        continue;
      }

      const targetMd = join(contentDir, `${stem}.md`);
      const targetMdx = join(contentDir, `${stem}.mdx`);

      try {
        // Existence check FIRST — an already-synced file is truth on the scribr
        // side, even if it would now fail validation. Covers .md and .mdx.
        if (existsSync(targetMd) || existsSync(targetMdx)) {
          skipped++;
          console.log(`  ${pad(project)} exists: ${stem}.md`);
          continue;
        }

        const raw = readFileSync(join(devlogDir, file)); // Buffer — verbatim bytes
        const { fm, error } = readFrontmatter(raw.toString("utf8"));
        if (error) {
          failed++;
          dirty = true;
          console.log(`  ${pad(project)} FAILED: ${file} — frontmatter: ${error}`);
          continue;
        }
        const bad = validateFrontmatter(fm, project);
        if (bad) {
          failed++;
          dirty = true;
          console.log(`  ${pad(project)} FAILED: ${file} — ${bad.field}: ${bad.reason}`);
          continue;
        }

        writeFileSync(targetMd, raw); // verbatim bytes, no rewriting
        synced++;
        console.log(`  ${pad(project)} synced: ${stem}.md`);
      } catch (err) {
        // Any read/validate/write throw is one file's failure, not the run's —
        // log it, count it, keep going (SYNC-DESIGN §5 log-and-continue).
        failed++;
        dirty = true;
        console.log(`  ${pad(project)} FAILED: ${file} — ${err.message}`);
      }
    }
  } finally {
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}

console.log("─".repeat(46));
const code = dirty ? 1 : 0;
console.log(`  ${synced} synced, ${skipped} skipped, ${failed} failed → exit ${code}`);
process.exit(code);
