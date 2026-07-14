// Phase 3 meta audit — builds, then walks dist/ asserting the OG/meta contract,
// zero-JS on static pages, the island only on /log/, the title-block metadata,
// and that OG images cover exactly {published post ids} ∪ {log} (a draft OG
// image would be a draft leak). Dependency-free plain Node.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

let failures = 0;
function report(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    if (detail) console.error(`      ${detail}`);
  }
}

// ---- read the project enum from the single source of truth ----
const projectsSrc = readFileSync(join(root, "src", "lib", "projects.ts"), "utf8");
const arrayBody = projectsSrc.match(/PROJECTS\s*=\s*\[([^\]]*)\]/s)[1];
const PROJECTS = [...arrayBody.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

// ---- published post ids (mirrors src/lib/published: draft !== false) ----
const contentDir = join(root, "src", "content", "log");
const publishedIds = [];
for (const name of readdirSync(contentDir)) {
  if (!/\.(md|mdx)$/.test(name)) continue;
  const src = readFileSync(join(contentDir, name), "utf8");
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const isPublished = fm && /^\s*draft:\s*false\s*$/m.test(fm[1]);
  if (isPublished) publishedIds.push(name.replace(/\.(md|mdx)$/, ""));
}

// ---- 1. build ----
const build = spawnSync("npm", ["run", "build"], {
  cwd: root,
  shell: true,
  stdio: "inherit",
});
report("npm run build exits 0", build.status === 0);
if (build.status !== 0) {
  console.error("\nBuild failed; aborting meta audit.");
  process.exit(1);
}

// ---- helpers ----
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
const count = (html, re) => (html.match(re) || []).length;
const rel = (f) => relative(dist, f).split(sep).join("/");

// Zero-JS discipline for post pages, amended for MDX demo islands: a post with
// no island must ship zero <script> tags at all; a post carrying an
// <astro-island> (the client:visible particlr demo) legitimately inlines the
// two small hydration bootstraps, but everything heavy must stay lazy — so
// assert no external <script src=> and no <link rel="modulepreload"> (the
// pixi+runtime graph loads only from the island's component-url on visibility).
function assertPostScripts(html, r) {
  if (/<astro-island/.test(html)) {
    report(
      `${r}: island post has no external <script src=`,
      count(html, /<script\b[^>]*\bsrc=/g) === 0
    );
    report(
      `${r}: island post has no modulepreload`,
      count(html, /rel="modulepreload"/g) === 0
    );
  } else {
    report(`${r}: zero <script tags`, count(html, /<script/g) === 0);
  }
}

const allFiles = walk(dist);
const htmlFiles = allFiles.filter((f) => f.endsWith(".html"));

// Classify pages by dist-relative path.
const projectSet = new Set(PROJECTS);
function classify(f) {
  const r = rel(f);
  if (r === "index.html") return "home";
  if (r === "log/index.html") return "logIndex";
  if (r === "404.html") return "notfound";
  const m = r.match(/^log\/([^/]+)\/index\.html$/);
  if (m) return projectSet.has(m[1]) ? "listing" : "post";
  return "other";
}

// ---- 2. universal meta contract on every HTML page ----
for (const f of htmlFiles) {
  const html = readFileSync(f, "utf8");
  const r = rel(f);
  report(`${r}: exactly one og:title`, count(html, /<meta property="og:title"/g) === 1);
  report(`${r}: exactly one og:description`, count(html, /<meta property="og:description"/g) === 1);
  report(`${r}: exactly one og:image`, count(html, /<meta property="og:image"/g) === 1);
  report(`${r}: exactly one twitter:card`, count(html, /<meta name="twitter:card"/g) === 1);
  report(`${r}: exactly one canonical`, count(html, /<link rel="canonical"/g) === 1);

  const og = html.match(/<meta property="og:image" content="([^"]+)"/);
  const okAbs =
    og && /^https:\/\/brac\.dev\/og\/[^"]+\.png$/.test(og[1]);
  report(`${r}: og:image is absolute brac.dev/og/*.png`, !!okAbs, og && og[1]);
  if (okAbs) {
    const pngName = og[1].replace("https://brac.dev/og/", "");
    report(
      `${r}: og:image file dist/og/${pngName} exists`,
      existsSync(join(dist, "og", pngName))
    );
  }
}

// ---- 3. post pages: article, zero scripts, title block ----
const postPages = htmlFiles.filter((f) => classify(f) === "post");
report("at least one post page exists", postPages.length >= 1);
for (const f of postPages) {
  const html = readFileSync(f, "utf8");
  const r = rel(f);
  const og = html.match(/<meta property="og:type" content="([^"]+)"/);
  report(`${r}: og:type == article`, og && og[1] === "article", og && og[1]);
  assertPostScripts(html, r);

  const hasBlock = /<div class="title-block"/.test(html);
  report(`${r}: title block present`, hasBlock);
  const labels = [...html.matchAll(/<span class="label">([^<]+)<\/span>/g)].map(
    (m) => m[1]
  );
  const isFieldNotes = rel(f).startsWith("log/field-notes-");
  const hasCore = labels.includes("PROJECT") && labels.includes("DATE");
  const shape = isFieldNotes
    ? labels.length === 2
    : labels.length === 4 &&
      labels.includes("PHASE") &&
      labels.includes("REF");
  report(
    `${r}: title block labels correct (${labels.join(",")})`,
    hasCore && shape
  );
}

// ---- 4. zero-JS discipline: island only on /log/ ----
for (const f of htmlFiles) {
  const kind = classify(f);
  const html = readFileSync(f, "utf8");
  const r = rel(f);
  if (kind === "logIndex") {
    // The FilterChips island. Astro 7 hydrates client:idle via an inline
    // <script> astro-island loader (which dynamically imports the component
    // module) rather than a literal <script type="module"> tag — so assert the
    // island ships JS here (and only here), which is the invariant that matters.
    report(
      `${r}: ships the island (>=1 <script)`,
      count(html, /<script/g) >= 1
    );
  } else if (kind === "post") {
    assertPostScripts(html, r);
  } else if (kind === "home" || kind === "listing" || kind === "notfound") {
    report(`${r}: zero <script tags`, count(html, /<script/g) === 0);
  }
}

// ---- 5. OG inventory == {published ids} ∪ {log}, no draft leak ----
const expectedOg = new Set([...publishedIds.map((id) => `${id}.png`), "log.png"]);
const actualOg = new Set(
  existsSync(join(dist, "og"))
    ? readdirSync(join(dist, "og")).filter((n) => n.endsWith(".png"))
    : []
);
const missing = [...expectedOg].filter((n) => !actualOg.has(n));
const extra = [...actualOg].filter((n) => !expectedOg.has(n));
report(
  `dist/og/ == {published}∪{log} (expected ${[...expectedOg].sort().join(", ")})`,
  missing.length === 0 && extra.length === 0,
  `missing=[${missing}] extra=[${extra}]`
);

if (failures > 0) {
  console.error(`\n${failures} meta-audit assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll phase-3 meta assertions passed.");
