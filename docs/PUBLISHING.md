# Publishing a Money Stuff edition

The publisher treats each source section as a story. It deliberately excludes a section whose heading is exactly **Things happen**; everything else in the manifest must be adapted before publishing.

## 1. Inventory the source

Copy `examples/edition-manifest.json` and enter the edition date, headline, and **every source section heading in source order**, including `Things happen`. Do not combine, silently omit, or invent substantive sections here.

## 2. Scaffold the edition

```sh
npm run new-edition -- path/to/manifest.json
```

This creates `data/YYYY-MM-DD-slug.json`, with a story for every substantive section and slots for all four reading ages. `Things happen` is recorded in the inventory but receives no story.

## 3. Adapt and illustrate

Replace every `TODO` in the new data file. Each story needs:

- complete Preschool, Elementary School, Middle School, and High School adaptations;
- its own non-placeholder `illustration.src` image path and useful `illustration.alt` description (do not reuse an image within the edition);
- an `elementaryChecklist` recording the real people, real companies, financial mechanism, and central joke from the source.

Elementary is a **retelling, not a paragraph-by-paragraph translation**. Compress, reorder, combine, and reshape freely so it reads as a Money Stuff-for-kids story. Preserve the named people and companies that make the story concrete, explain the actual mechanism rather than replacing it with a generic lesson, and land the source's central joke or absurdity. Use `"none in source"` only when the source truly names no person or company. The checklist is editorial evidence; it is not displayed to readers.

The other adaptations must remain faithful to the same source story and mechanism at their reading level. Elementary intentionally has no separate “Money idea” box; the explanation should work as a story.

## 4. Publish

```sh
npm run publish
npm run check
```

`publish` validates completeness, rejects `Things happen`, enforces four adaptations and one distinct accessible illustration per story, then derives `data/site.json` from `data/site-config.json` plus the canonical edition files, the homepage archive, and every edition page from the edition JSON files. Editions are sorted newest-first. Never hand-edit those generated files; rerun the publisher instead.

`check` performs the same editorial/data validation and fails if any generated file is stale, making it suitable for CI.
