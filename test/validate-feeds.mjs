// Phase 1 feed validation — parses every built feed with feedparser and asserts
// channel + item structure, absolute trailing-slash links, and draft exclusion.
// Reuses the dist/ produced by phase-1-draft-exclusion.mjs — does NOT rebuild.

import FeedParser from "feedparser";
import { createReadStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

// Fixture gate — the draft-fixture-absent check below is a negative that stays
// green once the fixture is gone, so refuse to run without it (finding #2).
const fixture = join(root, "src", "content", "log", "field-notes-draft-fixture.md");
if (!existsSync(fixture)) {
  console.error("FAIL  draft fixture src/content/log/field-notes-draft-fixture.md exists");
  console.error(
    "\nThe draft fixture is this gate's proof of draft exclusion. Restore it before\n" +
      "running feed validation — do not delete or rename it."
  );
  process.exit(1);
}
const fixtureFm = readFileSync(fixture, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fixtureFm || !/^draft:\s*true\s*$/m.test(fixtureFm[1])) {
  console.error("FAIL  draft fixture frontmatter contains draft: true");
  console.error(
    "\nThe draft fixture must stay draft: true — do not publish or alter it."
  );
  process.exit(1);
}

// Published counts derived from source frontmatter (mirrors phase-3-meta.mjs) so
// an empty or under-populated feed is a *checked* failure rather than a silent
// pass over a vacuous channel (finding #9). A post is published iff draft: false;
// group by its project: value (which may be quoted or bare).
const contentDir = join(root, "src", "content", "log");
const publishedByProject = {};
let totalPublished = 0;
for (const name of readdirSync(contentDir)) {
  if (!/\.(md|mdx)$/.test(name)) continue;
  const src = readFileSync(join(contentDir, name), "utf8");
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm || !/^\s*draft:\s*false\s*$/m.test(fm[1])) continue;
  const pm = fm[1].match(/^\s*project:\s*"?([^"\r\n]+?)"?\s*$/m);
  if (pm) publishedByProject[pm[1]] = (publishedByProject[pm[1]] || 0) + 1;
  totalPublished++;
}

// Read PROJECTS from the single source of truth by regex (this is a .mjs script
// and projects.ts is TS; regex avoids a transpile step). Kept honest by the
// build itself — a project without a feed file fails the existence check below.
const projectsSrc = readFileSync(join(root, "src", "lib", "projects.ts"), "utf8");
const arrayBody = projectsSrc.match(/PROJECTS\s*=\s*\[([^\]]*)\]/s)[1];
const PROJECTS = [...arrayBody.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const SEED_LINK = "https://brac.dev/log/particlr-spatial-hash/";

let failures = 0;
function report(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
}

function parseFeed(path) {
  return new Promise((resolve, reject) => {
    const fp = new FeedParser();
    let meta = null;
    const items = [];
    fp.on("error", reject);
    fp.on("meta", function () {
      meta = this.meta;
    });
    fp.on("readable", function () {
      let item;
      while ((item = this.read())) items.push(item);
    });
    fp.on("end", () => resolve({ meta, items }));
    createReadStream(path).on("error", reject).pipe(fp);
  });
}

async function checkFeed(label, path, { requireSeed = false, expectedCount } = {}) {
  if (!existsSync(path)) {
    report(`${label}: file exists`, false);
    return;
  }
  let parsed;
  try {
    parsed = await parseFeed(path);
  } catch (err) {
    report(`${label}: parses without error (${err.message})`, false);
    return;
  }
  report(`${label}: parses without error`, true);

  const { meta, items } = parsed;
  report(`${label}: channel title present`, !!(meta && meta.title));
  report(`${label}: channel description present`, !!(meta && meta.description));

  if (expectedCount !== undefined) {
    report(
      `${label}: item count matches frontmatter (${expectedCount})`,
      items.length === expectedCount
    );
  }

  let itemsOk = true;
  for (const item of items) {
    const linkOk =
      typeof item.link === "string" &&
      item.link.startsWith("https://brac.dev/log/") &&
      item.link.endsWith("/");
    if (!item.title || !item.link || !item.pubdate || !linkOk) {
      itemsOk = false;
      console.error(
        `  bad item in ${label}: title=${!!item.title} link=${item.link} pubdate=${item.pubdate}`
      );
    }
  }
  report(`${label}: every item has title/link/pubdate + absolute trailing-slash link`, itemsOk);

  // No feed may reference the draft fixture.
  const hasDraft = items.some(
    (i) => (i.link && i.link.includes("draft-fixture")) || (i.title && i.title.includes("draft fixture"))
  );
  report(`${label}: draft fixture absent`, !hasDraft);

  if (requireSeed) {
    report(`${label}: has >=1 item`, items.length >= 1);
    report(
      `${label}: contains seed post`,
      items.some((i) => i.link === SEED_LINK)
    );
  }
}

await checkFeed("global rss.xml", join(dist, "rss.xml"), {
  requireSeed: true,
  expectedCount: totalPublished,
});
for (const project of PROJECTS) {
  await checkFeed(`${project} rss.xml`, join(dist, "log", project, "rss.xml"), {
    // particlr carries the seed post, so require it here too (finding #9).
    requireSeed: project === "particlr",
    expectedCount: publishedByProject[project] || 0,
  });
}

if (failures > 0) {
  console.error(`\n${failures} feed assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll feed assertions passed.");
