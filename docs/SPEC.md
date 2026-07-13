# scribr — System Specification

**Version:** 1.0
**Status:** Locked
**Domain:** `brac.dev/log`
**Repo:** `scribr` (contains the full brac.dev Astro site; the log is a section of it)

---

## 1. What scribr is

scribr is the devlog system for brac.dev. Claude Code worker agents draft a devlog post as a **phase artifact** inside each project repo. scribr **pulls** those drafts via a sync script, Ben edits and publishes, and the post ships as static HTML on the apex domain with per-project feeds, OG images, and embedded live demos where relevant.

Goal: every completed phase across every project produces one publishable post, compounding link authority on `brac.dev` and generating traction for the work.

### Non-goals (v1)

- No CMS, no admin UI. Publishing is a git commit.
- No comments. Distribution happens on HN/Reddit/social; discussion lives there.
- No server runtime. Fully static output.
- No automated publishing. A human editing pass is a hard gate.

---

## 2. Locked decisions

| # | Decision | Choice | Why | Alternatives rejected |
|---|----------|--------|-----|----------------------|
| 1 | Name | **scribr** | Agent-as-scribe metaphor; workers scribe what happened during the build | ledgr, devlogr, chroniclr |
| 2 | Framework | **Astro** (content collections + MDX) | Typed frontmatter via Zod at build time; zero-JS static output; islands for demos | Next.js (runtime overhead), Hugo/Eleventy (no islands), plain Vite (hand-rolled content pipeline) |
| 3 | Interactive islands | **Preact** via `@astrojs/preact` | Existing particlr components import nearly as-is | React (heavier, no benefit) |
| 4 | URL structure | **`brac.dev/log/{slug}`** on the apex | Link authority consolidates on one domain; subdomains fragment SEO | `scribr.brac.dev` (fragments authority), project-nested paths (no unified feed) |
| 5 | Slug convention | **`{project}-{phase-slug}`**, date in frontmatter only | Posts don't look stale; stable URLs | Date-prefixed URLs |
| 6 | Repo topology | **Devlog drafts live in each project repo** (`devlog/`); scribr pulls via sync script | Workers stay repo-local; no cross-repo credentials; project repos self-document | Workers pushing to scribr repo (credential + conflict surface, context pollution) |
| 7 | Worker output format | **Plain `.md`** (CommonMark + frontmatter), never MDX | Dead-simple worker contract; renders on GitHub; Ben adds MDX embeds during editing | Workers writing MDX (fragile, invites component hallucination) |
| 8 | Sync trigger | **Manual** (`scribr sync` / repo dispatch) | Drafts arrive when Ben is ready to edit; automation trivial to add later | Cron (pulls drafts into an unattended queue) |
| 9 | Draft lifecycle | Synced posts land `draft: true`; flipping to `false` is the publish act | Natural editing backlog; drafts excluded from build | Separate drafts branch (merge overhead) |
| 10 | Post cadence | **One post per completed phase**, plus ad-hoc manual "field notes" | Matches existing phase-gated workflow | Per-commit (noise), per-release (too sparse) |
| 11 | Hosting | **Cloudflare Pages**, build-on-push | Effectively unlimited free bandwidth (HN-spike safe); already in CF ecosystem for DNS | Vercel (hobby-tier commercial-use clause, 100GB cap), droplet (most maintenance, least benefit) |
| 12 | Apex routing | brac.dev apex moves to Pages; project apps stay on subdomains → droplet. Fallback: Caddy reverse-proxies `/log/*` to Pages | Cleanest routing; apex is static anyway | — |
| 13 | OG images | **Auto-generated per post at build** (title + project + brac.dev branding) | Link CTR on social/HN | Manual images (won't happen), none (dead links in feeds) |
| 14 | Analytics | **Umami, self-hosted on existing droplet**, in v1 | Privacy-light; measures whether traction is actually happening | Plausible cloud (monthly cost), GA (overkill, consent burden) |
| 15 | RSS | **Global feed + per-project feeds** | Devlog audience is RSS-heavy; feeds are plumbing for cross-post automation | None |
| 16 | Index | `/log` interleaves all projects with filter chips; `/log/{project}` per-project listing pages + feed | One destination, filterable | Per-project silos |

---

## 3. Architecture

```
┌────────────────┐   phase gate    ┌──────────────────┐
│ project repo    │  writes        │ devlog/*.md       │
│ (particlr, etc.)│ ─────────────▶ │ (plain md, typed  │
│ worker agent    │  reviewer-     │  frontmatter)     │
└────────────────┘  gated         └────────┬──────────┘
                                            │  scribr sync (manual pull)
                                            ▼
┌───────────────────────────────────────────────────────┐
│ scribr repo (brac.dev site, Astro)                     │
│                                                        │
│  src/content/log/        ← synced drafts (draft:true)  │
│  src/components/demos/   ← Preact islands (particlr…)  │
│  scripts/sync.mjs        ← pull script                 │
│                                                        │
│  Ben edits → adds MDX embeds → flips draft:false       │
│  → commit → push                                       │
└───────────────────────┬───────────────────────────────┘
                        │ push to main
                        ▼
              Cloudflare Pages build
        (Astro build: validate schema, render
         static HTML, OG images, RSS feeds)
                        ▼
                  brac.dev/log/*
```

### Directory layout (scribr repo)

```
scribr/
├── astro.config.mjs
├── scribr.config.json          # list of source repos for sync
├── scripts/
│   ├── sync.mjs                 # pulls devlog/*.md from project repos
│   └── og.ts                    # OG image generation (satori/resvg or astro-og)
├── src/
│   ├── content/
│   │   ├── config.ts            # Zod schema (see CONTENT-SCHEMA.md)
│   │   └── log/                 # all posts; drafts + published
│   ├── components/
│   │   ├── DecisionTable.astro  # renders frontmatter decisions[]
│   │   ├── BenchmarkTable.astro # renders frontmatter benchmarks[]
│   │   ├── FilterChips.tsx      # Preact island, /log index filtering
│   │   └── demos/
│   │       └── ParticlrDemo.tsx # Preact + PixiJS island
│   ├── layouts/
│   │   └── Post.astro
│   └── pages/
│       ├── log/
│       │   ├── index.astro      # unified index + chips
│       │   ├── [slug].astro     # post pages
│       │   └── [project]/index.astro  # per-project listing
│       ├── rss.xml.ts           # global feed
│       └── log/[project]/rss.xml.ts   # per-project feeds
└── package.json
```

### Directory layout (each project repo)

```
{project}/
└── devlog/
    ├── phase-1-{slug}.md
    ├── phase-2-{slug}.md
    └── ...
```

---

## 4. Content pipeline

1. **Draft** — Worker completes a phase. The phase gate requires `devlog/phase-N-{slug}.md` conforming to the schema (see `CLAUDE-DEVLOG-SECTION.md`). Reviewer agent validates it like any other artifact. Committed with the phase.
2. **Sync** — Ben runs `node scripts/sync.mjs`. Script pulls `devlog/*.md` from every repo in `scribr.config.json` into `src/content/log/`, prefixing filenames with the project slug and skipping files already present (see `SYNC-DESIGN.md`).
3. **Edit** — Ben's pass (~10 min/post): inject voice, cut fluff, add opinion, optionally rename `.md → .mdx` and drop in demo islands (`<ParticlrDemo preset="..." client:visible />`).
4. **Publish** — Flip `draft: false`, commit, push. Pages builds. Schema violations fail the build (machine-verifiable gate).
5. **Distribute** — RSS feeds update automatically; Ben posts links to HN/Reddit/social manually in v1. Feed-driven cross-posting (dev.to via canonical URL) is a v2 candidate.

---

## 5. Pages & routes

| Route | Content |
|-------|---------|
| `/log` | All published posts, newest first, project filter chips (Preact island; filters client-side, no page reload) |
| `/log/{slug}` | Post page: title, date, project badge, rendered body, DecisionTable + BenchmarkTable if present, repo_ref link to the commit/tag |
| `/log/{project}` | Per-project listing, chronological — the linkable project narrative |
| `/rss.xml` | Global feed |
| `/log/{project}/rss.xml` | Per-project feed |
| OG images | Generated at build per post: title, project, brac.dev branding |

Draft posts (`draft: true`) are excluded from all routes, feeds, and the sitemap.

---

## 6. Performance & SEO requirements

- Zero client JS on post pages except explicitly-added demo islands (`client:visible`).
- Lighthouse ≥ 95 across all categories on `/log` and a demo-bearing post page.
- Canonical URLs on every post (enables later cross-posting without SEO damage).
- Sitemap + RSS autodiscovery `<link>` tags.
- Demo islands lazy-load below the fold; a post with a PixiJS demo must not regress LCP on the text content.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Agent-written posts read like changelogs with adjectives | Human editing pass is a hard gate; worker contract emphasizes raw material (decisions, failures, numbers) over prose polish |
| Worker frontmatter drift | Zod validation fails the Pages build; reviewer agent checks schema at the phase gate too |
| Demo island bloats a post | `client:visible` + island-level code splitting; benchmark in BUILD-PLAN.md |
| Apex migration breaks existing routing | Fallback locked (decision #12): Caddy proxies `/log/*` to Pages until apex move is convenient |
| Draft backlog rots | Sync is manual — drafts only arrive when Ben sits down to edit |
