'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { submitPackage } = require('../scripts/lib/submit-package');

test('uses the existing prepare, private PUT, publish protocol and supplies the digest', async () => {
  const archive = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-submit-')), 'edition.zip');
  fs.writeFileSync(archive, 'zip bytes');
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([url, options]);
    if (url === 'https://upload.example') return { ok: true, status: 200 };
    const body = JSON.parse(options.body);
    if (body.action === 'prepare') return {
      ok: true, status: 200, json: async () => ({ pathname: 'pending-editions/id/file.zip', upload_url: 'https://upload.example' })
    };
    return { ok: true, status: 202, json: async () => ({ accepted: true, package_sha256: 'abc' }) };
  };
  await submitPackage({
    bridgeUrl: 'https://bridge.example/', token: 'secret', editionId: 'id', archive, sha256: 'abc', fetchImpl
  });
  assert.equal(JSON.parse(requests[2][1].body).package_sha256, 'abc');
  assert.equal(JSON.parse(requests[2][1].body).admin_retry, false);
  assert.equal(requests[2][1].headers['x-admin-retry-authorization'], undefined);
  assert.equal(requests[1][1].method, 'PUT');
});

test('passes an explicit admin retry only on the publish request', async () => {
  const archive = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'msfk-retry-')), 'edition.zip');
  fs.writeFileSync(archive, 'zip bytes');
  const bodies = [];
  const jsonRequests = [];
  const fetchImpl = async (url, options) => {
    if (url === 'https://upload.example') return { ok: true, status: 200 };
    jsonRequests.push(options);
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) return { ok: true, status: 200, json: async () => ({ pathname: 'pending-editions/id/file.zip', upload_url: 'https://upload.example' }) };
    return { ok: true, status: 202, json: async () => ({ accepted: true, package_sha256: 'abc' }) };
  };
  await submitPackage({
    bridgeUrl: 'https://bridge.example', token: 'secret', editionId: 'id', archive, sha256: 'abc',
    adminRetry: true, adminRetryToken: 'admin-secret', fetchImpl
  });
  assert.equal(bodies[0].admin_retry, undefined);
  assert.equal(bodies[1].admin_retry, true);
  assert.equal(jsonRequests[0].headers['x-admin-retry-authorization'], undefined);
  assert.equal(jsonRequests[1].headers['x-admin-retry-authorization'], 'Bearer admin-secret');
});
