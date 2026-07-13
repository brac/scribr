// Single source of truth for the project enum. The content schema imports this
// (z.enum(PROJECTS)) so a typo like "particlrr" fails the build instead of
// silently forking a feed. Phase 2's sync script regex-extracts these values,
// so keep this a plain `as const` array literal.
export const PROJECTS = [
  "particlr",
  "haulr",
  "swarmr",
  "herdr",
  "burnrat",
  "crawlers",
  "scribr",
  "field-notes",
] as const;

export type Project = (typeof PROJECTS)[number];
