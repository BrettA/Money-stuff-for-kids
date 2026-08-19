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
