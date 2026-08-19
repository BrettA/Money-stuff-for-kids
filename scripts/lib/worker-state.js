'use strict';

const fs = require('node:fs');

const EMPTY_STATE = { schemaVersion: 1, messages: {} };
const STATUSES = new Set(['generated', 'submitted']);

function loadState(file) {
  if (!file || !fs.existsSync(file)) return structuredClone(EMPTY_STATE);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.schemaVersion !== 1 || !state.messages || Array.isArray(state.messages)) {
    throw new Error('Worker state must be a schema-version-1 object');
  }
  for (const [id, record] of Object.entries(state.messages)) {
    if (record.gmailMessageId !== id || !STATUSES.has(record.status) ||
        typeof record.submitted !== 'boolean' || record.submitted !== (record.status === 'submitted')) {
      throw new Error(`Invalid worker state record for Gmail message ${id}`);
    }
  }
  return state;
}

function assertNotSubmitted(state, gmailMessageId) {
  const record = state.messages[gmailMessageId];
  if (record && record.submitted) {
    throw new Error(`Gmail message ${gmailMessageId} was already submitted as ${record.editionId}`);
  }
}

function recordGeneration(state, details, { adminRetry = false } = {}) {
  const previous = state.messages[details.gmailMessageId];
  if (previous && previous.submitted) {
    if (!adminRetry) throw new Error('Cannot replace a submitted worker state record');
    if (previous.editionId !== details.editionId) {
      throw new Error(`Cannot replace submitted worker state for edition ${previous.editionId} with ${details.editionId}`);
    }
  }
  state.messages[details.gmailMessageId] = {
    gmailMessageId: details.gmailMessageId,
    newsletterDate: details.newsletterDate,
    newsletterTitle: details.newsletterTitle,
    editionId: details.editionId,
    sourceSha256: details.sourceSha256,
    packageSha256: details.packageSha256,
    status: 'generated',
    submitted: false,
    updatedAt: details.updatedAt
  };
  return state.messages[details.gmailMessageId];
}

function recordSubmission(state, gmailMessageId, { packageSha256, updatedAt }) {
  const record = state.messages[gmailMessageId];
  if (!record) throw new Error('Cannot submit a message that has no generated state');
  if (record.packageSha256 !== packageSha256) throw new Error('Submitted digest does not match generated package');
  record.status = 'submitted';
  record.submitted = true;
  record.submittedAt = updatedAt;
  record.updatedAt = updatedAt;
  return record;
}

function writeState(file, state) {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

module.exports = { EMPTY_STATE, assertNotSubmitted, loadState, recordGeneration, recordSubmission, writeState };
