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
    "edition_id": "2026-08-20-example-edition",
    "package_delete_url": "https://storage.example/private/object?short-lived-delete-signature=..."
  }
}
```

The URL must use HTTPS and should expire shortly after dispatch. `package_sha256` must be exactly 64 lowercase hexadecimal characters. Do not put the ZIP or base64 images in dispatch inputs. The workflow downloads at most 25 MiB, verifies the digest before inspecting the ZIP, installs only the canonical JSON and referenced images, then runs `npm test`, `npm run publish`, and `npm run check`. The built-in `GITHUB_TOKEN` is limited to `contents: write` and `pull-requests: write`, solely so the workflow can push its deterministic branch and open the reviewable PR.

## Vercel publishing bridge

The machine-to-machine design is independent of ChatGPT Scheduled Tasks. The manual production worker reads the source email, generates and validates the four adaptations and story-specific illustrations, and builds the completed ZIP. Gmail and model integration remain separate from this transport layer. See [`docs/GENERATION_WORKER.md`](GENERATION_WORKER.md) for credential setup and the dry-run procedure. `.github/workflows/submit-test-package.yml` remains available to submit the completed fixture in `examples/transport-test`.

```text
completed package -> manual GitHub worker -> authenticated Vercel Function
  -> private Vercel Blob -> ingest workflow -> reviewable PR -> human merge
```

No workflow schedules generation, sends subscriber email, or auto-merges. Gmail and OpenAI credentials exist only as GitHub secrets used by the generation worker and are never passed into this bridge.

### 1. Connect the private Blob store

In the Vercel project, open **Storage**, connect the existing **private** Blob store to this project, and make its read/write token available to Production and Preview deployments as `BLOB_READ_WRITE_TOKEN`. Do not prefix it with `NEXT_PUBLIC_` and do not copy it into GitHub.

The bridge uses `@vercel/blob` only on the server. It stores packages under `pending-editions/<edition-id>/<uuid>.zip`. Direct function uploads are supported for small callers, but the worker uses the two-step metadata protocol so packages do not encounter Vercel Functions' request-body limit.

### 2. Configure Vercel secrets

Generate independent random values; this command is suitable for each shared secret:

```sh
openssl rand -hex 32
```

Set these Vercel environment variables for Production and Preview as appropriate:

| Variable | Purpose |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Existing private Vercel Blob store read/write credential. |
| `PUBLISH_API_TOKEN` | Authenticates the GitHub caller to `/api/publish-edition`; use the same value in the GitHub secret below. |
| `GITHUB_INGEST_TOKEN` | Fine-grained GitHub PAT used only by the server to dispatch `ingest-edition.yml` in `BrettA/Money-stuff-for-kids`. Grant repository access only to this repository and Actions **write** permission. |
| `CRON_SECRET` | Authenticates Vercel's daily cleanup request. Vercel sends it as `Authorization: Bearer ...`. |

Redeploy after adding or rotating variables. Never put any values in `vercel.json`, workflow inputs, client-side code, Blob metadata, or committed `.env` files. `GITHUB_INGEST_TOKEN` exists only in Vercel.

### 3. Configure GitHub

In **Settings -> Secrets and variables -> Actions** add:

1. Repository **secret** `PUBLISH_API_TOKEN`, equal to the Vercel value.
2. Repository **variable** `PUBLISH_BRIDGE_URL`, equal to the deployment origin with no trailing slash, for example `https://money-stuff-for-kids.vercel.app`.

Do not add `GITHUB_INGEST_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, Gmail credentials, or OpenAI credentials to GitHub for this bridge.

### 4. Invoke the manual transport test

In **Actions -> Submit completed test package -> Run workflow**, keep the defaults:

```text
edition_id: 2099-01-01-transport-test
package_directory: examples/transport-test
```

The caller creates a ZIP on the runner, requests a ten-minute signed private PUT URL, uploads directly to Blob, then asks the bridge to publish the stored pathname. The bridge reads the private object server-side, enforces the 25 MiB limit, computes SHA-256, creates 24-hour signed GET and DELETE URLs, and dispatches the fixed repository/workflow/ref. It returns only the edition ID and digest, never storage or GitHub credentials.

The ingestion job independently downloads and verifies the digest before reading the ZIP. Its final success-only step uses the signed DELETE URL, so a failed job can be re-run against the exact same package and digest for up to 24 hours without repeating generation. As a fallback, Vercel Cron calls `/api/cleanup-editions` daily and deletes objects under `pending-editions/` after 24 hours.

The fixture's edition ID is intentionally far in the future to avoid collision. A successful end-to-end test opens an `automated-edition/2099-01-01-transport-test` pull request. Close that test PR and delete its branch after verification; do not merge the fixture into the published site.

### Request formats

Every bridge request requires `Authorization: Bearer $PUBLISH_API_TOKEN`. The scalable flow first sends:

```json
{"action":"prepare","edition_id":"2099-01-01-transport-test","content_length":12345}
```

After `PUT`-ing `application/zip` bytes to the returned `upload_url`, send:

```json
{"action":"publish","edition_id":"2099-01-01-transport-test","pathname":"pending-editions/2099-01-01-transport-test/<uuid>.zip"}
```

Small trusted callers may instead POST raw `application/zip` bytes with an `X-Edition-Id` header. Metadata upload is recommended because the presigned PUT is constrained to one private pathname, ZIP content type, declared maximum size, and ten-minute lifetime.

### Security and lifecycle notes

- `PUBLISH_API_TOKEN` is compared in constant time and all responses disable caching.
- Edition IDs and temporary pathnames are strictly validated; the GitHub owner, repository, workflow, and `main` ref are constants rather than caller inputs.
- SHA-256 is computed from a server-authenticated read of the exact private Blob object. The GitHub workflow verifies it again.
- If dispatch fails, the bridge deletes the object immediately. After dispatch, the ingestion workflow deletes it only after successful ingestion; failures retain the private object and its signed GET URL for the bounded 24-hour retry window. Daily cleanup removes failed/orphaned packages after 24 hours.
- Signed URLs grant one operation on one pathname and expire. The private Blob read/write token is never placed in a URL or dispatched to GitHub.
- After a successful dispatch, the bridge stores a small private receipt. Repeating the same edition ID and package SHA-256 is accepted without dispatching ingestion a second time; reusing that edition ID with different bytes is refused.
