'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(
  path.resolve(__dirname, '..', '.github', 'workflows', 'ingest-edition.yml'),
  'utf8'
);

test('failed ingestion retains its package so a job retry downloads the same verified bytes', () => {
  assert.match(workflow, /name: Delete temporary package\n(?:\s+#.*\n)*\s+if: \$\{\{ success\(\) && inputs\.package_delete_url != '' \}\}/);
  assert.doesNotMatch(workflow, /always\(\).*package_delete_url/);
  assert.match(workflow, /--output "\$RUNNER_TEMP\/edition\.zip" "\$PACKAGE_URL"/);
  assert.match(workflow, /echo "\$PACKAGE_SHA256  \$RUNNER_TEMP\/edition\.zip" \| sha256sum --check --strict/);
});

test('retryability does not weaken deterministic branch and lease protections', () => {
  assert.match(workflow, /scripts\/prepare-ingestion-branch\.sh "\$EDITION_ID"/);
  assert.match(workflow, /--force-with-lease="refs\/heads\/\$INGESTION_BRANCH:\$BRANCH_PUSH_LEASE"/);
});
