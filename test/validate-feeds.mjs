// Phase 1 feed validation — parses every built feed with feedparser and asserts
// channel + item structure, absolute trailing-slash links, and draft exclusion.
// Reuses the dist/ produced by phase-1-draft-exclusion.mjs — does NOT rebuild.

import FeedParser from "feedparser";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

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

async function checkFeed(label, path, { requireSeed = false } = {}) {
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

await checkFeed("global rss.xml", join(dist, "rss.xml"), { requireSeed: true });
for (const project of PROJECTS) {
  await checkFeed(
    `${project} rss.xml`,
    join(dist, "log", project, "rss.xml")
  );
}

if (failures > 0) {
  console.error(`\n${failures} feed assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll feed assertions passed.");
