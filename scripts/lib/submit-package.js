'use strict';

const fs = require('node:fs');

async function jsonRequest(url, token, body, fetchImpl, adminRetryToken = '') {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  if (adminRetryToken) headers['x-admin-retry-authorization'] = `Bearer ${adminRetryToken}`;
  const response = await fetchImpl(`${url}/api/publish-edition`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Publishing bridge request failed (${response.status}): ${result.error || 'unknown error'}`);
  return result;
}

async function submitPackage({
  bridgeUrl, token, editionId, archive, sha256, adminRetry = false, adminRetryToken = '', fetchImpl = fetch
}) {
  const bytes = fs.readFileSync(archive);
  const base = String(bridgeUrl).replace(/\/$/, '');
  const prepared = await jsonRequest(base, token, {
    action: 'prepare', edition_id: editionId, content_length: bytes.length
  }, fetchImpl);
  if (!prepared.pathname || !prepared.upload_url) throw new Error('Publishing bridge returned incomplete upload metadata');
  const upload = await fetchImpl(prepared.upload_url, {
    method: 'PUT', headers: { 'content-type': 'application/zip' }, body: bytes
  });
  if (!upload.ok) throw new Error(`Private package upload failed (${upload.status})`);
  const published = await jsonRequest(base, token, {
    action: 'publish', edition_id: editionId, pathname: prepared.pathname, package_sha256: sha256,
    admin_retry: adminRetry
  }, fetchImpl, adminRetry ? adminRetryToken : '');
  if (!published.accepted || published.package_sha256 !== sha256) {
    throw new Error('Publishing bridge did not accept the exact package digest');
  }
  return published;
}

module.exports = { submitPackage };
