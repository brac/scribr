---
title: "A permanent draft fixture for the exclusion gate"
date: 2026-07-11
project: field-notes
tags: [testing, fixtures]
draft: true
summary: "A draft post that must never appear in dist — the regression fixture proving drafts are excluded from pages, feeds, and the sitemap."
---

## What this is

This post has `draft: true` and exists only as a regression fixture. The
string `draft-fixture` in its slug must never appear anywhere under `dist/`:
not in a page, a feed, or the sitemap. Deleting it would remove the only proof
that draft exclusion actually works.

## Why it stays

Every future build runs the exclusion gate against this file. If a filter
regresses and drafts start leaking into the built output, this fixture is what
catches it before anything reaches production.
