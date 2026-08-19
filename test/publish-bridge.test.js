const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');
const { createPublisher, MAX_PACKAGE_BYTES } = require('../api/_publish-core');
const { removeExpired } = require('../api/cleanup-editions');

const editionId = '2099-01-01-transport-test';
const pathname = `pending-editions/${editionId}/fixed.zip`;

function stream(bytes) {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

function fixture({ githubStatus = 204 } = {}) {
  const calls = { tokens: [], presigns: [], dispatches: [], deleted: [], puts: [] };
  const bytes = Buffer.from('completed package');
  const blob = {
    issueSignedToken: async options => { calls.tokens.push(options); return { delegationToken: 'd', clientSigningToken: 's' }; },
    presignUrl: async (_token, options) => { calls.presigns.push(options); return { presignedUrl: `https://private.example/${options.operation}` }; },
    get: async () => ({ statusCode: 200, blob: { size: bytes.length }, stream: stream(bytes) }),
    put: async (...args) => { calls.puts.push(args); },
    del: async target => { calls.deleted.push(target); }
  };
  const fetchImpl = async (...args) => { calls.dispatches.push(args); return { status: githubStatus }; };
  const publish = createPublisher({
    blob, fetchImpl, now: () => Date.parse('2098-12-31T00:00:00Z'), uuid: () => 'fixed',
    env: { PUBLISH_API_TOKEN: 'publish-secret', GITHUB_INGEST_TOKEN: 'github-secret' }
  });
  return { publish, calls, bytes };
}

test('requires the server-side publishing bearer token', async () => {
  const { publish, calls } = fixture();
  await assert.rejects(publish({ authorization: 'Bearer wrong', contentType: 'application/json', body: { action: 'prepare', edition_id: editionId, content_length: 12 } }), error => error.status === 401);
  assert.equal(calls.tokens.length, 0);
});

test('prepares a narrowly scoped private upload without exposing either secret', async () => {
  const { publish, calls } = fixture();
  const result = await publish({ authorization: 'Bearer publish-secret', contentType: 'application/json', body: { action: 'prepare', edition_id: editionId, content_length: 1234 } });
  assert.equal(result.status, 200);
  assert.equal(result.data.pathname, pathname);
  assert.equal(calls.tokens[0].pathname, pathname);
  assert.deepEqual(calls.tokens[0].operations, ['put']);
  assert.equal(calls.tokens[0].maximumSizeInBytes, 1234);
  assert.doesNotMatch(JSON.stringify(result), /publish-secret|github-secret/);
});

test('hashes private Blob bytes and dispatches fixed repository workflow inputs', async () => {
  const { publish, calls } = fixture();
  const result = await publish({ authorization: 'Bearer publish-secret', contentType: 'application/json', body: { action: 'publish', edition_id: editionId, pathname } });
  assert.equal(result.status, 202);
  assert.equal(result.data.package_sha256, '6d7de7f4838fedddaf5c867d11b19693d70c45208afb3b316f9921a46263e4ce');
  const [url, request] = calls.dispatches[0];
  assert.equal(url, 'https://api.github.com/repos/BrettA/Money-stuff-for-kids/actions/workflows/ingest-edition.yml/dispatches');
  assert.equal(request.headers.authorization, 'Bearer github-secret');
  const payload = JSON.parse(request.body);
  assert.equal(payload.ref, 'main');
  assert.equal(payload.inputs.edition_id, editionId);
  assert.equal(payload.inputs.package_sha256, result.data.package_sha256);
  assert.equal(payload.inputs.package_url, 'https://private.example/get');
  assert.equal(payload.inputs.package_delete_url, 'https://private.example/delete');
});

test('deletes a temporary direct upload when GitHub dispatch fails', async () => {
  const { publish, calls, bytes } = fixture({ githubStatus: 403 });
  await assert.rejects(publish({ authorization: 'Bearer publish-secret', contentType: 'application/zip', body: { edition_id: editionId, package: bytes } }), /dispatch failed/);
  assert.equal(calls.puts[0][0], pathname);
  assert.deepEqual(calls.deleted, [pathname]);
});

test('validates IDs, paths, and upload sizes before Blob access', async () => {
  const { publish, calls } = fixture();
  const request = body => publish({ authorization: 'Bearer publish-secret', contentType: 'application/json', body });
  await assert.rejects(request({ action: 'prepare', edition_id: '../bad', content_length: 1 }), error => error.status === 400);
  await assert.rejects(request({ action: 'prepare', edition_id: editionId, content_length: MAX_PACKAGE_BYTES + 1 }), error => error.status === 400);
  await assert.rejects(request({ action: 'publish', edition_id: editionId, pathname: 'pending-editions/other/file.zip' }), error => error.status === 400);
  assert.equal(calls.tokens.length, 0);
});

test('cleanup removes only temporary packages at least 24 hours old across pages', async () => {
  const deleted = [];
  let page = 0;
  const blobList = async options => {
    assert.equal(options.prefix, 'pending-editions/');
    page += 1;
    return page === 1
      ? { blobs: [{ url: 'https://blob/old', uploadedAt: '2098-12-29T00:00:00Z' }, { url: 'https://blob/new', uploadedAt: '2098-12-30T12:00:01Z' }], hasMore: true, cursor: 'next' }
      : { blobs: [{ url: 'https://blob/old-two', uploadedAt: '2098-12-30T00:00:00Z' }], hasMore: false };
  };
  const removed = await removeExpired({ blobList, blobDel: async urls => deleted.push(...urls), now: Date.parse('2098-12-31T12:00:00Z') });
  assert.equal(removed, 2);
  assert.deepEqual(deleted, ['https://blob/old', 'https://blob/old-two']);
});
