const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const GET_URL_LIFETIME_MS = 60 * 60 * 1000;
const DELETE_URL_LIFETIME_MS = 24 * 60 * 60 * 1000;
const EDITION_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMP_PREFIX = 'pending-editions/';

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authorized(header, expected) {
  if (!expected || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

function assertEditionId(value) {
  if (typeof value !== 'string' || !EDITION_ID.test(value)) {
    throw new RequestError(400, 'edition_id must be a dated lowercase slug');
  }
}

function assertTemporaryPath(pathname, editionId) {
  const prefix = `${TEMP_PREFIX}${editionId}/`;
  if (typeof pathname !== 'string' || !pathname.startsWith(prefix) || !pathname.endsWith('.zip')) {
    throw new RequestError(400, 'pathname is not a temporary package for this edition');
  }
}

async function digestPrivateBlob(blob, pathname) {
  const result = await blob.get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) throw new RequestError(404, 'temporary package not found');
  if (result.blob.size > MAX_PACKAGE_BYTES) throw new RequestError(413, 'package exceeds 25 MiB');
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of result.stream) {
    size += chunk.byteLength;
    if (size > MAX_PACKAGE_BYTES) throw new RequestError(413, 'package exceeds 25 MiB');
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function signedUrl(blob, pathname, operation, validUntil) {
  const token = await blob.issueSignedToken({ pathname, operations: [operation], validUntil });
  const result = await blob.presignUrl(token, { access: 'private', operation, pathname, validUntil });
  return result.presignedUrl;
}

async function dispatchIngest(fetchImpl, githubToken, { editionId, packageUrl, sha256, deleteUrl }) {
  const response = await fetchImpl(
    'https://api.github.com/repos/BrettA/Money-stuff-for-kids/actions/workflows/ingest-edition.yml/dispatches',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${githubToken}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          package_url: packageUrl,
          package_sha256: sha256,
          edition_id: editionId,
          package_delete_url: deleteUrl
        }
      })
    }
  );
  if (response.status !== 204) {
    throw new Error(`GitHub workflow dispatch failed with status ${response.status}`);
  }
}

function createPublisher({ blob, fetchImpl = fetch, now = () => Date.now(), uuid = randomUUID, env = process.env }) {
  return async function publish({ authorization, contentType, body }) {
    if (!authorized(authorization, env.PUBLISH_API_TOKEN)) throw new RequestError(401, 'unauthorized');
    if (!env.GITHUB_INGEST_TOKEN) throw new Error('GITHUB_INGEST_TOKEN is not configured');

    if (contentType === 'application/zip') {
      const editionId = body.edition_id;
      const bytes = body.package;
      assertEditionId(editionId);
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new RequestError(400, 'ZIP body is empty');
      if (bytes.length > MAX_PACKAGE_BYTES) throw new RequestError(413, 'package exceeds 25 MiB');
      const pathname = `${TEMP_PREFIX}${editionId}/${uuid()}.zip`;
      await blob.put(pathname, bytes, { access: 'private', contentType: 'application/zip', addRandomSuffix: false });
      return finalize(pathname, editionId);
    }

    if (contentType !== 'application/json' || !body || typeof body !== 'object') {
      throw new RequestError(415, 'use application/json or application/zip');
    }
    const editionId = body.edition_id;
    assertEditionId(editionId);
    if (body.action === 'prepare') {
      if (!Number.isInteger(body.content_length) || body.content_length < 1 || body.content_length > MAX_PACKAGE_BYTES) {
        throw new RequestError(400, 'content_length must be between 1 and 26214400');
      }
      const pathname = `${TEMP_PREFIX}${editionId}/${uuid()}.zip`;
      const validUntil = now() + 10 * 60 * 1000;
      const token = await blob.issueSignedToken({
        pathname,
        operations: ['put'],
        validUntil,
        allowedContentTypes: ['application/zip'],
        maximumSizeInBytes: body.content_length
      });
      const { presignedUrl } = await blob.presignUrl(token, {
        access: 'private', operation: 'put', pathname, validUntil,
        allowedContentTypes: ['application/zip'], maximumSizeInBytes: body.content_length,
        addRandomSuffix: false, allowOverwrite: false
      });
      return { status: 200, data: { pathname, upload_url: presignedUrl, expires_at: new Date(validUntil).toISOString() } };
    }
    if (body.action === 'publish') {
      assertTemporaryPath(body.pathname, editionId);
      return finalize(body.pathname, editionId);
    }
    throw new RequestError(400, 'action must be prepare or publish');

    async function finalize(pathname, targetEditionId) {
      try {
        const sha256 = await digestPrivateBlob(blob, pathname);
        const packageUrl = await signedUrl(blob, pathname, 'get', now() + GET_URL_LIFETIME_MS);
        const deleteUrl = await signedUrl(blob, pathname, 'delete', now() + DELETE_URL_LIFETIME_MS);
        await dispatchIngest(fetchImpl, env.GITHUB_INGEST_TOKEN, {
          editionId: targetEditionId, packageUrl, sha256, deleteUrl
        });
        return { status: 202, data: { accepted: true, edition_id: targetEditionId, package_sha256: sha256 } };
      } catch (error) {
        await blob.del(pathname).catch(() => {});
        throw error;
      }
    }
  };
}

module.exports = { MAX_PACKAGE_BYTES, RequestError, TEMP_PREFIX, authorized, createPublisher };
