// Lighthouse gate config — the single source of truth for the URLs, run count,
// and category thresholds. scripts/lighthouse.mjs reads this and drives
// Lighthouse's Node API against Playwright's Chromium (see that file for why we
// don't use `lhci autorun` directly on Windows). staticDistDir documents that
// the gate runs against the built dist/, served locally with no network.
//
// The two URLs are exactly the BUILD-PLAN gate: the /log index and one post
// page. Median of 3 runs smooths flakiness; every category must score >= 0.95.
module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist",
      url: [
        "http://localhost/log/",
        "http://localhost/log/particlr-spatial-hash/",
      ],
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.95 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["error", { minScore: 0.95 }],
        "categories:seo": ["error", { minScore: 0.95 }],
      },
    },
  },
};
