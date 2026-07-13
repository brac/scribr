import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const decision = z.object({
  what: z.string().min(1),
  why: z.string().min(1),
  alternatives: z.array(z.string()).default([]),
});

const benchmark = z.object({
  metric: z.string().min(1),
  value: z.string().min(1),
  target: z.string().min(1),
});

const log = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/log" }),
  schema: z
    .object({
      title: z.string().min(8).max(90),
      date: z.coerce.date(),
      project: z.enum([
        // extend as projects are added; enum (not free string) so a typo
        // ("particlrr") fails the build instead of silently forking a feed
        "particlr",
        "haulr",
        "swarmr",
        "herdr",
        "burnrat",
        "crawlers",
        "scribr",
        "field-notes", // ad-hoc manual posts not tied to a project phase
      ]),
      phase: z.number().int().positive().optional(), // absent for field-notes
      tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1).max(5),
      draft: z.boolean().default(true),
      summary: z.string().min(20).max(160),
      repo_ref: z.string().optional(), // required for phase posts, see refine
      decisions: z.array(decision).default([]),
      benchmarks: z.array(benchmark).default([]),
    })
    .refine(
      (p) => p.project === "field-notes" || (p.phase !== undefined && !!p.repo_ref),
      { error: "phase and repo_ref are required for project posts" }
    ),
});

export const collections = { log };
