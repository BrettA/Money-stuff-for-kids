# Money Stuff generation worker

The production worker reads one complete Money Stuff email through the Gmail API, inventories its source sections, generates four faithful age adaptations and one image per substantive section, validates a canonical schema-version-2 package, and—only when explicitly requested—submits it through the existing Vercel publishing bridge. The Elementary slot is generated as a 250–400 word rhyming, read-aloud picture-book story and ends with a plain-English `What happened?` explanation; the other age slots and canonical schema are unchanged.

`MONEY_STUFF_GENERATION_STYLE=legacy` restores the previous Elementary prompting without changing stored data or public rendering. This is an editorial-generation escape hatch, not a public product mode. Structured output reliably enforces the existing fields, while generation-time checks enforce length, the ending, and guard against clearly invented checklist entities using alias-tolerant source matching. Rhyme quality, meter, entity importance, and semantic source fidelity still require editorial review; the prompt deliberately permits shortened names, slant rhyme, and irregular meter rather than imposing brittle mechanical validators.

It does not run on a schedule, scrape Bloomberg, email subscribers, process signups, merge pull requests, or replace the private Blob ingestion pipeline.

## Security and authentication design

For one personal Gmail inbox, use a normal OAuth 2.0 refresh token with the read-only Gmail scope. A Google service account cannot directly impersonate a personal Gmail account; domain-wide delegation is a Google Workspace administrator feature and is unnecessary here.

The worker exchanges the refresh token for a short-lived access token at runtime. Gmail and OpenAI credentials remain GitHub Actions secrets. The newsletter body, generated package, OAuth tokens, and API key are never committed or uploaded as workflow artifacts.

## One-time Gmail OAuth setup

Perform these steps as the owner of the Gmail inbox, outside GitHub Actions.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project dedicated to this worker.
2. Open **APIs & Services → Library**, find **Gmail API**, and enable it.
3. Open **Google Auth Platform → Branding** and configure the app name, support email, and developer contact.
4. Under **Audience**, select **External** for a personal Gmail account and add the mailbox as a test user while configuring it. Move the consent configuration to **Production** before minting the final token so it does not inherit Google’s short testing-mode lifetime. Google can still revoke refresh tokens after account security changes, prolonged non-use, or manual revocation.
5. Under **Data Access**, add only:

   ```text
   https://www.googleapis.com/auth/gmail.readonly
   ```

6. Open **Clients → Create client → Web application** and add this exact authorized redirect URI:

   ```text
   https://developers.google.com/oauthplayground
   ```

7. Store the client ID and client secret in a password manager. Never commit them or use them as workflow inputs.
8. Open [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/), open its gear menu, enable **Use your own OAuth credentials**, and enter that client ID and secret.
9. In **Step 1**, enter the read-only Gmail scope above, choose **Authorize APIs**, and sign in to the one mailbox receiving the full Money Stuff newsletter.
10. In **Step 2**, choose **Exchange authorization code for tokens** and copy the refresh token into the password manager.
11. Optionally verify the grant locally without printing token values:

    ```sh
    curl --fail --silent --show-error https://oauth2.googleapis.com/token \
      --data-urlencode client_id="$GMAIL_CLIENT_ID" \
      --data-urlencode client_secret="$GMAIL_CLIENT_SECRET" \
      --data-urlencode refresh_token="$GMAIL_REFRESH_TOKEN" \
      --data-urlencode grant_type=refresh_token | jq -e '.access_token and .expires_in'
    ```

To rotate the grant, revoke the app in the Google account’s third-party access settings, repeat the authorization steps, and replace only the GitHub secret. Never add Gmail credentials to Vercel; Vercel receives only a completed package.

## GitHub Actions configuration

Open **Repository Settings → Secrets and variables → Actions**.

### Required repository secrets

| Secret | Value |
| --- | --- |
| `GMAIL_CLIENT_ID` | OAuth client ID from Google Cloud. |
| `GMAIL_CLIENT_SECRET` | OAuth client secret from Google Cloud. |
| `GMAIL_REFRESH_TOKEN` | Offline token for the one mailbox and read-only Gmail scope. |
| `OPENAI_API_KEY` | Server-side OpenAI project API key. |
| `PUBLISH_API_TOKEN` | Existing shared secret used by the Vercel bridge. It is read only when `submit=true`. |
| `ADMIN_RETRY_TOKEN` | Separate high-privilege bridge secret. Configure the same value in GitHub Actions and Vercel; Actions exposes it to the worker only when `admin_retry=true`. |

Never place these values in `NEXT_PUBLIC_` variables, workflow inputs, repository files, artifacts, or PR bodies.

### Required repository variable for submission

| Variable | Value |
| --- | --- |
| `PUBLISH_BRIDGE_URL` | Existing Vercel origin without a trailing slash, such as `https://money-stuff-for-kids.vercel.app`. |

### Optional repository variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_TEXT_MODEL` | `gpt-5-mini` | Override the structured-output model without changing code. |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1.5` | Override the image model without changing code. |
| `MONEY_STUFF_GMAIL_QUERY` | `from:(noreply@news.bloomberg.com) subject:(Money Stuff)` | Narrow discovery if the verified sender differs. |

Model variables are optional. If OpenAI retires a model, update the repository variable after checking current official OpenAI documentation; credentials and source code need not change.

## Manual operation

Open **Actions → Generate Money Stuff edition → Run workflow**.

- **gmail_message_id**: leave blank for the newest matching, unsubmitted message; enter an exact Gmail API message ID for deterministic testing.
- **submit**: leave `false` for a safe dry run; set `true` only for an intentional end-to-end transport test.
- **admin_retry**: leave `false` for every ordinary run. For emergency recovery only, set it to `true` together with `submit=true` and an explicit `gmail_message_id`. This permits that selected submitted message to be regenerated and tells the bridge to redispatch ingestion, then replace its matching edition receipt.

### Dry run (`submit=false`)

The job fetches the full email, generates all copy and images, runs `npm test`, runs the publisher and check against an isolated staging tree, builds the canonical ZIP, and updates minimal duplicate-prevention state. It does not call Vercel and does not retain the newsletter or package as an artifact.

### Real submission (`submit=true`)

The job performs the same validation and then uses the existing bridge prepare → private signed PUT → publish protocol. The bridge recognizes a repeated `(editionId, packageSha256)` receipt and does not dispatch ingestion twice. A new package proceeds through private Vercel Blob and the existing ingestion workflow, which opens a reviewable PR and never merges it.

## Minimal durable retry state

Runs are serialized. The workflow maintains one small file on the `automation-state` branch:

```text
money-stuff-worker-state.json
```

It contains a schema version and records keyed by Gmail message ID with only newsletter date/title, edition ID, source/package digests, `generated` or `submitted` status, and timestamps. It never contains source copy, adaptations, images, subscriber data, tokens, or general application state.

The workflow creates the branch on the first successful run and uses a lease-protected push. A submitted Gmail ID is rejected during normal operation. The manual `admin_retry` escape hatch is accepted only on `workflow_dispatch`, requires both an exact Gmail ID and submission, and affects only that selected message; normal receipt and worker-state duplicate prevention remains unchanged. If the bridge accepted a package but the state push failed, its private receipt makes an ordinary retry of that edition and digest an accepted no-op rather than a second ingestion dispatch.

## Failure behavior

The worker fails closed when a credential is missing; Gmail retrieval or complete HTML MIME decoding fails; source headings are empty or duplicated; structured metadata changes or omits a heading; any adaptation or checklist field is absent; image generation fails or returns a non-PNG result; canonical validation, `npm test`, isolated `npm run publish`, or isolated `npm run check` fails; the bridge does not accept the exact local digest; or the Gmail message is already submitted.

Email content is untrusted source data in prompts. Only the exact `Things happen` section is omitted from stories, and its heading remains in `sourceSections` for publisher verification.

## Expected usage

An issue with 8–12 substantive sections normally uses one metadata request, 8–12 structured story requests, and 8–12 image requests. Cost varies with issue length, configured models, current model pricing, image settings, and output length; check official OpenAI pricing before the first production submission. The workflow does not log newsletter text merely to report usage.
