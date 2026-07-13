import type { CollectionEntry } from "astro:content";

export const published = (e: CollectionEntry<"log">) => !e.data.draft;
