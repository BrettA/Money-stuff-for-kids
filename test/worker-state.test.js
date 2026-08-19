'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  assertNotSubmitted, loadState, recordGeneration, recordSubmission, writeState
} = require('../scripts/lib/worker-state');

test('records only generation metadata and prevents a submitted Gmail message from retrying', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-state-')), 'state.json');
  const state = loadState(file);
  recordGeneration(state, {
    gmailMessageId: 'gmail-1', newsletterDate: '2026-08-19', newsletterTitle: 'Title',
    editionId: '2026-08-19-title', sourceSha256: 'a'.repeat(64), packageSha256: 'b'.repeat(64),
    updatedAt: '2026-08-19T12:00:00Z'
  });
  assert.doesNotThrow(() => assertNotSubmitted(state, 'gmail-1'));
  recordSubmission(state, 'gmail-1', { packageSha256: 'b'.repeat(64), updatedAt: '2026-08-19T12:01:00Z' });
  assert.throws(() => assertNotSubmitted(state, 'gmail-1'), /already submitted/);
  writeState(file, state);
  assert.equal(loadState(file).messages['gmail-1'].submitted, true);
  assert.equal(Object.hasOwn(loadState(file).messages['gmail-1'], 'sourceBody'), false);
});

test('refuses to mark a different package digest submitted', () => {
  const state = { schemaVersion: 1, messages: {} };
  recordGeneration(state, {
    gmailMessageId: 'gmail-2', newsletterDate: '2026-08-19', newsletterTitle: 'Title',
    editionId: '2026-08-19-title', sourceSha256: 'a', packageSha256: 'right', updatedAt: 'now'
  });
  assert.throws(() => recordSubmission(state, 'gmail-2', { packageSha256: 'wrong', updatedAt: 'later' }), /digest/);
});

function submittedState(editionId = '2026-08-19-title') {
  return {
    schemaVersion: 1,
    messages: {
      'gmail-retry': {
        gmailMessageId: 'gmail-retry', newsletterDate: '2026-08-19', newsletterTitle: 'Title', editionId,
        sourceSha256: 'a'.repeat(64), packageSha256: 'b'.repeat(64), status: 'submitted', submitted: true,
        submittedAt: '2026-08-19T12:01:00Z', updatedAt: '2026-08-19T12:01:00Z'
      }
    }
  };
}

const retryGeneration = {
  gmailMessageId: 'gmail-retry', newsletterDate: '2026-08-19', newsletterTitle: 'Title',
  editionId: '2026-08-19-title', sourceSha256: 'c'.repeat(64), packageSha256: 'd'.repeat(64),
  updatedAt: '2026-08-19T13:00:00Z'
};

test('ordinary generation cannot replace submitted worker state', () => {
  const state = submittedState();
  assert.throws(() => recordGeneration(state, retryGeneration), /Cannot replace a submitted worker state record/);
  assert.equal(state.messages['gmail-retry'].packageSha256, 'b'.repeat(64));
  assert.equal(state.messages['gmail-retry'].submitted, true);
});

test('authorized admin retry replaces and resubmits the same Gmail message and edition', () => {
  const state = submittedState();
  recordGeneration(state, retryGeneration, { adminRetry: true });
  assert.deepEqual(state.messages['gmail-retry'], {
    ...retryGeneration, status: 'generated', submitted: false
  });

  recordSubmission(state, 'gmail-retry', {
    packageSha256: retryGeneration.packageSha256, updatedAt: '2026-08-19T13:01:00Z'
  });
  assert.equal(state.messages['gmail-retry'].packageSha256, 'd'.repeat(64));
  assert.equal(state.messages['gmail-retry'].status, 'submitted');
  assert.equal(state.messages['gmail-retry'].submitted, true);
  assert.equal(state.messages['gmail-retry'].submittedAt, '2026-08-19T13:01:00Z');
  assert.equal(state.messages['gmail-retry'].updatedAt, '2026-08-19T13:01:00Z');
});

test('admin retry cannot replace submitted worker state for a different edition', () => {
  const state = submittedState('2026-08-18-other-title');
  assert.throws(
    () => recordGeneration(state, retryGeneration, { adminRetry: true }),
    /Cannot replace submitted worker state for edition 2026-08-18-other-title with 2026-08-19-title/
  );
  assert.equal(state.messages['gmail-retry'].editionId, '2026-08-18-other-title');
  assert.equal(state.messages['gmail-retry'].packageSha256, 'b'.repeat(64));
  assert.equal(state.messages['gmail-retry'].submitted, true);
});

test('explicit migration replaces only the exact expected submitted edition', () => {
  const oldEditionId = '2026-08-19-fwd-money-stuff-the-situation-deteriorated';
  const state = submittedState(oldEditionId);
  const migrated = {
    ...retryGeneration,
    newsletterDate: '2026-07-30',
    newsletterTitle: 'The Situation Deteriorated',
    editionId: '2026-07-30-the-situation-deteriorated'
  };
  recordGeneration(state, migrated, { adminRetry: true, previousEditionId: oldEditionId });
  assert.deepEqual(state.messages['gmail-retry'], { ...migrated, status: 'generated', submitted: false });
});

test('explicit migration rejects a wrong expected old edition without changing state', () => {
  const state = submittedState('2026-08-19-actual-old-edition');
  assert.throws(
    () => recordGeneration(state, { ...retryGeneration, editionId: '2026-07-30-new-edition' }, {
      adminRetry: true, previousEditionId: '2026-08-19-wrong-old-edition'
    }),
    /expected 2026-08-19-wrong-old-edition but worker state records 2026-08-19-actual-old-edition/
  );
  assert.equal(state.messages['gmail-retry'].editionId, '2026-08-19-actual-old-edition');
  assert.equal(state.messages['gmail-retry'].submitted, true);
});
