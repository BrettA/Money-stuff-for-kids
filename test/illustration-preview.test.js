'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ILLUSTRATION_HOUSE_STYLE, artifactName, illustrationPreviewPrompt, loadEdition, runPreview, selectStories
} = require('../scripts/lib/illustration-preview');

const root = path.resolve(__dirname, '..');
const editionId = '2026-07-30-the-situation-deteriorated';

test('selects all canonical stories or one requested story', () => {
  const edition = loadEdition(root, editionId);
  assert.equal(selectStories(edition).length, 5);
  assert.deepEqual(selectStories(edition, 'revlon').map(story => story.id), ['revlon']);
  assert.throws(() => selectStories(edition, 'missing'), /does not exist/);
});

test('constructs an exact house-style prompt from canonical story data', () => {
  const edition = loadEdition(root, editionId);
  const story = selectStories(edition, 'ionic')[0];
  const prompt = illustrationPreviewPrompt(edition, story);
  assert.match(prompt, new RegExp(ILLUSTRATION_HOUSE_STYLE.slice(0, 40)));
  assert.match(prompt, /Scene to illustrate exactly: Workers inside a large Ward County/);
  assert.match(prompt, new RegExp(story.adaptations.elementary.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('fails clearly for invalid or missing editions', () => {
  assert.throws(() => loadEdition(root, ''), /Invalid edition ID/);
  assert.throws(() => loadEdition(root, '2099-01-01-not-here'), /does not exist/);
});

test('creates unique, label-safe artifact names', () => {
  assert.equal(artifactName({ editionId, label: 'More colorful!', runId: '123', runAttempt: '2' }),
    'illustration-preview-2026-07-30-the-situation-deteriorated-more-colorful-123-2');
});

test('preview workflow is manual-only and cannot publish or write repository contents', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/illustration-preview.yml'), 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.match(workflow, /edition_id:/);
  assert.match(workflow, /story_id:/);
  assert.match(workflow, /label:/);
  assert.match(workflow, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /\b(push|publish|commit)\b/i);
});

test('writes PNG previews and an exact prompt manifest without touching canonical data', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'illustration-preview-test-'));
  const canonicalPath = path.join(root, 'data', `${editionId}.json`);
  const before = fs.readFileSync(canonicalPath);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const prompts = [];
  const client = { images: { generate: async request => {
    prompts.push(request.prompt);
    return { data: [{ b64_json: png.toString('base64') }] };
  } } };
  const result = await runPreview({ root, editionId, storyId: 'revlon', label: 'v1',
    outputDirectory: temporary, model: 'test-image-model', runId: '99', runAttempt: '1', client,
    now: () => new Date('2026-08-20T12:34:56.000Z') });
  const manifest = JSON.parse(fs.readFileSync(path.join(result.destination, 'manifest.json'), 'utf8'));
  assert.equal(manifest.stories.length, 1);
  assert.equal(manifest.stories[0].finalImagePrompt, prompts[0]);
  assert.equal(manifest.model, 'test-image-model');
  assert.equal(manifest.generatedAt, '2026-08-20T12:34:56.000Z');
  assert(fs.readFileSync(path.join(result.destination, 'revlon.png')).equals(png));
  assert(fs.readFileSync(canonicalPath).equals(before));
});
