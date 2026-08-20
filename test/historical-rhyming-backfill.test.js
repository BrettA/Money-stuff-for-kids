'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  acceptElementaryCandidate, assertOnlyElementaryChanged, elementaryChanged, generateWithRetries, locateSections,
  markdownSummary, resolveEditionSelection, safeReason
} = require('../scripts/historical-rhyming-backfill');

const published = [
  { date: '2026-07-28', editionId: '2026-07-28-first-edition' },
  { date: '2026-08-12', editionId: '2026-08-12-second-edition' }
];
const canonical = published.map(issue => issue.editionId);

test('selects one edition by date or full edition ID', () => {
  assert.deepEqual(resolveEditionSelection('2026-07-28', published, canonical), [published[0]]);
  assert.deepEqual(resolveEditionSelection('2026-08-12-second-edition', published, canonical), [published[1]]);
});

test('selects multiple comma-separated editions in requested order', () => {
  assert.deepEqual(resolveEditionSelection('2026-08-12, 2026-07-28', published, canonical), [published[1], published[0]]);
});

test('literal all selects every currently published canonical edition', () => {
  assert.deepEqual(resolveEditionSelection('all', published, canonical), published);
});

test('rejects invalid, nonexistent, or noncanonical editions', () => {
  assert.throws(() => resolveEditionSelection('2026-01-01', published, canonical), /invalid.*not published/);
  assert.throws(() => resolveEditionSelection('2026-07-28', published, [canonical[1]]), /does not exist in canonical/);
  assert.throws(() => resolveEditionSelection('all,2026-07-28', published, canonical), /exactly "all"/);
});

test('rejects an empty edition selection', () => {
  assert.throws(() => resolveEditionSelection('', published, canonical), /must not be empty/);
  assert.throws(() => resolveEditionSelection('  ', published, canonical), /must not be empty/);
});

test('matches source sections by normalized exact heading', () => {
  const stories = [{ sourceSection: 'World Liberty' }];
  assert.equal(locateSections(stories, [{ heading: ' world   LIBERTY ', sourceText: 'canonical' }])[0].section.sourceText, 'canonical');
  assert.throws(() => locateSections(stories, [
    { heading: 'World Liberty', sourceText: 'one' }, { heading: 'World Liberty', sourceText: 'two' }
  ]), /ambiguous/);
});

test('uses positional evidence only for an aligned one-to-one inventory', () => {
  const stories = [{ sourceSection: 'Parlays' }, { sourceSection: 'Agentic trading' }];
  const matches = locateSections(stories, [
    { heading: 'Prediction market parlays', sourceText: 'one' },
    { heading: 'Agents that trade', sourceText: 'two' },
    { heading: 'Things happen', sourceText: '' }
  ]);
  assert.deepEqual(matches.map(match => match.section.sourceText), ['one', 'two']);
});

test('one unmatched story does not prevent exact matches and ambiguity fails closed per story', () => {
  const matches = locateSections([
    { sourceSection: 'Known' }, { sourceSection: 'Tax-aware long-short' }
  ], [
    { heading: 'Known', sourceText: 'safe' },
    { heading: 'extra one', sourceText: 'x' },
    { heading: 'extra two', sourceText: 'y' }
  ]);
  assert.equal(matches[0].section.sourceText, 'safe');
  assert.match(matches[1].error.message, /could not be matched unambiguously/);
});

test('successful acceptance changes the serialized canonical edition', () => {
  const before = { stories: [{ adaptations: { elementary: { title: 'Old', paragraphs: ['old'] } } }] };
  const after = structuredClone(before);
  const replacement = { title: 'New', paragraphs: ['new'] };
  const accepted = [];
  acceptElementaryCandidate({
    accepted, generated: { adaptations: { elementary: replacement } }, index: 0,
    story: before.stories[0], updated: after
  });
  assert.equal(accepted.length, 1);
  assert.notEqual(JSON.stringify(after, null, 2), JSON.stringify(before, null, 2));
  assert.equal(elementaryChanged(after.stories[0], replacement), false);
  assert.throws(() => acceptElementaryCandidate({
    accepted: [], generated: { adaptations: { elementary: before.stories[0].adaptations.elementary } },
    index: 0, story: before.stories[0], updated: structuredClone(before)
  }), /identical to existing content/);
});

test('retries editorial failures with concise feedback and a complete replacement request', async () => {
  const calls = [];
  const generate = async request => {
    calls.push(request);
    if (calls.length < 3) throw new Error('Elementary rhyming story must end with a What happened? explanation');
    return { value: { adaptations: { elementary: { title: 'replacement' } } } };
  };
  const result = await generateWithRetries({
    client: {}, model: 'test', section: { heading: 'Canonical', sourceText: 'original canonical text' }, generate,
    validateCandidate() {}
  });
  assert.equal(result.adaptations.elementary.title, 'replacement');
  assert.equal(calls.length, 3);
  assert.equal(calls[1].style, 'rhyming-picture-book');
  assert.equal(calls[1].priorValidationError, 'Elementary rhyming story must end with a What happened? explanation');
  assert.deepEqual(calls[1].section, { heading: 'Canonical', sourceText: 'original canonical text' });
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
  assert.match(summary, /1 of 2/);
  assert.match(summary, /edition-one.*1\/2/);
  assert.match(summary, /Story B.*validation failed/);
});

test('workflow is manual-only, uses the four existing secrets, and never invokes publishing bridge or image generation', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/historical-rhyming-backfill.yml'), 'utf8');
  const triggers = workflow.slice(0, workflow.indexOf('\npermissions:'));
  const jobEnv = workflow.slice(workflow.indexOf('    env:'), workflow.indexOf('    steps:'));
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.match(workflow, /edition_ids:\n\s+description:[\s\S]*?required: true/);
  assert.doesNotMatch(triggers, /schedule:|pull_request:|\bpush:/);
  for (const secret of ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'OPENAI_API_KEY']) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
  assert.doesNotMatch(workflow, /PUBLISH_BRIDGE|generateImage|submit-package/);
  assert.doesNotMatch(jobEnv, /\$\{\{\s*runner\.temp\s*\}\}/);
  assert.match(workflow, /echo "BACKFILL_SUMMARY_FILE=\$RUNNER_TEMP\/historical-backfill-pr\.md" >> "\$GITHUB_ENV"/);
  assert.match(workflow, /npm run publish/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /git diff --check/);
});
