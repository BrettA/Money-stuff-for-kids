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

## Automated ingestion API

The `Ingest completed edition` GitHub Actions workflow accepts completed content; it does not read email or generate copy or images. It is `workflow_dispatch` only, creates `automated-edition/<edition-id>`, runs the repository's tests and publisher, and opens a pull request into `main`. It never merges that pull request. No Gmail, OpenAI, or object-storage credentials belong in this repository. Prefer a GitHub App installation token in the external automation's secret store; a repository-scoped fine-grained token able to dispatch Actions is also supported.

Upload a ZIP to private object storage, generate a short-lived HTTPS download URL, and compute the SHA-256 of the exact ZIP bytes. The archive must contain exactly:

```text
edition.json
images/
  <edition-id>/
    <image filename referenced by a story>
    <one file for every other story image>
```

`edition.json` must be the finished canonical schema-version-2 object. Its `id` must equal `<edition-id>`, a dated lowercase slug such as `2026-08-20-example-edition`. Every `stories[].illustration.src` must be a unique absolute path of the form `/images/<edition-id>/<filename>` and use `.gif`, `.jpeg`, `.jpg`, `.png`, `.svg`, or `.webp`. Each referenced image must appear at that path without the leading slash. Extra files, unreferenced images, missing images, duplicate ZIP members, links, special files, absolute/traversal/backslash paths, invalid publisher content, and existing destinations are rejected. Limits are 25 MiB compressed, 50 MiB expanded, 10 MiB per file, and 100 ZIP members.

Dispatch the workflow with GitHub's REST API (replace the owner and repository):

```http
POST /repos/OWNER/REPOSITORY/actions/workflows/ingest-edition.yml/dispatches
Authorization: Bearer <GitHub App installation token>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json

{
  "ref": "main",
  "inputs": {
    "package_url": "https://storage.example/private/object?short-lived-signature=...",
    "package_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "edition_id": "2026-08-20-example-edition"
  }
}
```

The URL must use HTTPS and should expire shortly after dispatch. `package_sha256` must be exactly 64 lowercase hexadecimal characters. Do not put the ZIP or base64 images in dispatch inputs. The workflow downloads at most 25 MiB, verifies the digest before inspecting the ZIP, installs only the canonical JSON and referenced images, then runs `npm test`, `npm run publish`, and `npm run check`. The built-in `GITHUB_TOKEN` is limited to `contents: write` and `pull-requests: write`, solely so the workflow can push its deterministic branch and open the reviewable PR.
