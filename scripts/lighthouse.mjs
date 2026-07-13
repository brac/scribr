// Lighthouse gate. Serves the built dist/, runs Lighthouse against Playwright's
// bundled Chromium, and asserts every category >= the threshold in
// lighthouserc.cjs (median of N runs) for each configured URL.
//
// Why not `lhci autorun`: on Windows, chrome-launcher's teardown fails to rm
// its auto-created temp profile dir — Chromium keeps a lock (a lingering
// crashpad child) — and the resulting EPERM crashes the lighthouse process
// AFTER results are computed, failing the run. That's unfixable from config, so
// we drive Lighthouse's Node API against a Chromium we launch ourselves (with a
// profile dir we own and clean up), which never touches that code path.
// lighthouserc.cjs stays the single source of truth for URLs and thresholds.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createGzip } from "node:zlib";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

// ---- config from lighthouserc.cjs ----
const rc = require(join(root, "lighthouserc.cjs"));
const urls = rc.ci.collect.url;
const runs = rc.ci.collect.numberOfRuns ?? 3;
const assertions = rc.ci.assert.assertions;
const thresholds = Object.fromEntries(
  Object.entries(assertions).map(([k, v]) => [
    k.replace("categories:", ""),
    v[1].minScore,
  ])
);
// Optional per-audit numeric ceilings ({ auditId: maxNumericValue }), asserted
// on every URL. lhci's own assertions are category-only in our runner, so this
// map is the single source of truth for numeric audit gates (e.g. LCP).
const audits = rc.ci.assert.audits ?? {};
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

// ---- 1. build ----
const build = spawnSync("npm", ["run", "build"], { stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

// ---- static server for dist/ (directory-index + trailing-slash resolution) ----
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};
function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const full = join(dist, p);
  if (existsSync(full) && statSync(full).isFile()) return full;
  // fall back to directory index for extension-less paths
  const idx = join(dist, p, "index.html");
  if (existsSync(idx) && statSync(idx).isFile()) return idx;
  return null;
}
// Compressible text types get gzip when the client accepts it. Production
// (Cloudflare Pages) always serves compressed; without this the gate's Lantern
// simulation charges pages their RAW byte size (an inlined-CSS post page is
// ~21 KB raw vs ~7 KB gzipped), which spills the document across extra
// simulated TCP windows and inflates LCP beyond anything a real deploy sees.
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".xml", ".svg", ".txt", ".json"]);
const server = createServer((req, res) => {
  const file = resolveFile(req.url || "/");
  if (!file) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  res.setHeader("Content-Type", MIME[extname(file)] || "application/octet-stream");
  const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (acceptsGzip && COMPRESSIBLE.has(extname(file))) {
    res.setHeader("Content-Encoding", "gzip");
    createReadStream(file).pipe(createGzip()).pipe(res);
  } else {
    createReadStream(file).pipe(res);
  }
});

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function waitForCDP(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const r = net.connect(port, "127.0.0.1");
      r.on("connect", () => {
        r.destroy();
        resolve(true);
      });
      r.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Chromium CDP endpoint did not become ready");
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const serverPort = await freePort();
await new Promise((r) => server.listen(serverPort, r));

const debugPort = await freePort();
const userDataDir = mkdtempSync(join(tmpdir(), "scribr-lh-"));
const chrome = spawn(
  chromium.executablePath(),
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

let failures = 0;
try {
  await waitForCDP(debugPort);

  for (const url of urls) {
    // Point the configured localhost URL at our static server port.
    const u = new URL(url);
    u.port = String(serverPort);
    const target = u.toString();

    const scores = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
    const auditVals = Object.fromEntries(Object.keys(audits).map((a) => [a, []]));
    for (let i = 0; i < runs; i++) {
      const result = await lighthouse(target, {
        port: debugPort,
        output: "json",
        logLevel: "error",
      });
      for (const c of CATEGORIES) {
        scores[c].push(result.lhr.categories[c].score);
      }
      for (const a of Object.keys(audits)) {
        auditVals[a].push(result.lhr.audits[a]?.numericValue ?? NaN);
      }
    }

    console.log(`\n${target}`);
    for (const c of CATEGORIES) {
      const m = median(scores[c]);
      const pct = Math.round(m * 100);
      const min = thresholds[c];
      const pass = m >= min;
      if (!pass) failures++;
      console.log(
        `  ${pass ? "PASS" : "FAIL"}  ${c.padEnd(16)} ${pct}  (>= ${Math.round(min * 100)})  [runs: ${scores[c].map((s) => Math.round(s * 100)).join(",")}]`
      );
    }
    for (const [a, max] of Object.entries(audits)) {
      const m = median(auditVals[a]);
      const pass = Number.isFinite(m) && m <= max;
      if (!pass) failures++;
      console.log(
        `  ${pass ? "PASS" : "FAIL"}  ${a.padEnd(16)} ${Math.round(m)}ms  (<= ${max}ms)  [runs: ${auditVals[a].map((v) => Math.round(v)).join(",")}]`
      );
    }
  }
} finally {
  try {
    if (process.platform === "win32" && chrome.pid) {
      spawnSync("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      chrome.kill("SIGKILL");
    }
  } catch {}
  await new Promise((r) => server.close(r));
  // Give the OS a moment to release the profile lock, then remove it.
  await new Promise((r) => setTimeout(r, 500));
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10 });
  } catch {
    /* best-effort */
  }
}

if (failures > 0) {
  console.error(`\n${failures} Lighthouse category assertion(s) below threshold.`);
  process.exit(1);
}
console.log("\nAll Lighthouse categories meet threshold.");
