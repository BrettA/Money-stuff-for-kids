'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertOnlyElementaryChanged, locateSections, markdownSummary, safeReason } = require('../scripts/historical-rhyming-backfill');

test('matches source sections exactly and fails closed on ambiguous headings', () => {
  const stories = [{ sourceSection: 'World Liberty' }];
  assert.equal(locateSections(stories, [{ heading: 'World Liberty', sourceText: 'canonical' }])[0].sourceText, 'canonical');
  assert.throws(() => locateSections(stories, [
    { heading: 'World Liberty', sourceText: 'one' }, { heading: 'World Liberty', sourceText: 'two' }
  ]), /ambiguous/);
  assert.throws(() => locateSections(stories, [{ heading: 'Something else', sourceText: 'x' }]), /not found/);
});

test('preservation guard permits only Elementary adaptation replacement', () => {
  const before = { id: 'edition', stories: [{
    id: 'story', illustration: { src: '/same.png', alt: 'same' }, elementaryChecklist: { realPeople: [] },
    adaptations: { preschool: { title: 'P' }, elementary: { title: 'old' }, middle: { title: 'M' }, high: { title: 'H' } }
  }] };
  const after = structuredClone(before);
  after.stories[0].adaptations.elementary = { title: 'new' };
  assert.doesNotThrow(() => assertOnlyElementaryChanged(before, after));
  after.stories[0].illustration.alt = 'changed';
  assert.throws(() => assertOnlyElementaryChanged(before, after), /outside Elementary/);
});

test('summary reports partial results without including multiline source-like errors', () => {
  const reason = safeReason(new Error(`validation failed\n${'x'.repeat(400)}`));
  assert.equal(reason.includes('\n'), false);
  assert.ok(reason.length <= 240);
  const summary = markdownSummary([{ editionId: 'edition-one', total: 2, succeeded: 1, failures: [
    { story: 'Story B', reason: 'validation failed' }
  ] }]);
  assert.match(summary, /1 of 39/);
  assert.match(summary, /edition-one.*1\/2/);
  assert.match(summary, /Story B.*validation failed/);
});

test('workflow is manual-only, uses the four existing secrets, and never invokes publishing bridge or image generation', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/historical-rhyming-backfill.yml'), 'utf8');
  const triggers = workflow.slice(0, workflow.indexOf('\npermissions:'));
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(triggers, /schedule:|pull_request:|\bpush:/);
  for (const secret of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'OPENAI_API_KEY']) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
  assert.doesNotMatch(workflow, /PUBLISH_BRIDGE|generateImage|submit-package/);
  assert.match(workflow, /npm run publish/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /git diff --check/);
});
