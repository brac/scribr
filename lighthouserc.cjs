// Lighthouse gate config — the single source of truth for the URLs, run count,
// and category thresholds. scripts/lighthouse.mjs reads this and drives
// Lighthouse's Node API against Playwright's Chromium (see that file for why we
// don't use `lhci autorun` directly on Windows). staticDistDir documents that
// the gate runs against the built dist/, served locally with no network.
//
// Three URLs: the /log index, the demo post (particlr-spatial-hash, which now
// embeds the lazy particlr island), and a non-demo post (field-notes-hello-log)
// — so the gate proves the island page and a plain page both hold the bar.
// Median of 3 runs smooths flakiness; every category must score >= 0.95, and
// LCP must stay <= 1500ms on every URL (the `audits` map below, honoured by
// scripts/lighthouse.mjs — the demo island must not push the fold's paint).
module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist",
      url: [
        "http://localhost/log/",
        "http://localhost/log/particlr-spatial-hash/",
        "http://localhost/log/field-notes-hello-log/",
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
      // Per-audit numeric ceilings, asserted on every URL against the median run
      // (numericValue is in ms for timing audits). Read by scripts/lighthouse.mjs.
      // LCP <= 1500ms under simulated mobile throttling holds because browsers
      // are served the WOFF2 faces (~113 KB total; scripts/fonts-woff2.mjs)
      // rather than the 311 KB TTFs — the TTFs stay committed for og-canvas only.
      audits: {
        "largest-contentful-paint": 1500,
      },
    },
  },
};
