const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
// Keep the download capability alive for the same bounded window as orphaned
// packages so a failed Actions job can be re-run without regenerating content.
const GET_URL_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DELETE_URL_LIFETIME_MS = 24 * 60 * 60 * 1000;
const EDITION_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMP_PREFIX = 'pending-editions/';
const RECEIPT_PREFIX = 'published-editions/';

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

async function readReceipt(blob, pathname) {
  try {
    const result = await blob.get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error && (error.status === 404 || error.statusCode === 404 || error.code === 'blob_not_found')) return null;
    throw error;
  }
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
      if (body.admin_retry !== undefined && typeof body.admin_retry !== 'boolean') {
        throw new RequestError(400, 'admin_retry must be a boolean');
      }
      if (body.package_sha256 !== undefined && !/^[0-9a-f]{64}$/.test(body.package_sha256)) {
        throw new RequestError(400, 'package_sha256 must be 64 lowercase hexadecimal characters');
      }
      return finalize(body.pathname, editionId, body.package_sha256, body.admin_retry === true);
    }
    throw new RequestError(400, 'action must be prepare or publish');

    async function finalize(pathname, targetEditionId, expectedSha256, adminRetry = false) {
      try {
        const sha256 = await digestPrivateBlob(blob, pathname);
        if (expectedSha256 && sha256 !== expectedSha256) throw new RequestError(409, 'uploaded package digest does not match package_sha256');
        const receipt = `${RECEIPT_PREFIX}${targetEditionId}/receipt.json`;
        const previous = await readReceipt(blob, receipt);
        if (previous) {
          if (adminRetry && (previous.edition_id !== targetEditionId || !/^[0-9a-f]{64}$/.test(previous.package_sha256))) {
            throw new RequestError(409, 'existing receipt is not valid for the retry edition');
          }
          if (!adminRetry && previous.package_sha256 !== sha256) {
            throw new RequestError(409, 'edition was already published with a different package digest');
          }
          if (!adminRetry) {
            if (pathname.startsWith(TEMP_PREFIX)) await blob.del(pathname).catch(() => {});
            return { status: 202, data: { accepted: true, duplicate: true, edition_id: targetEditionId, package_sha256: sha256 } };
          }
        }
        const packageUrl = await signedUrl(blob, pathname, 'get', now() + GET_URL_LIFETIME_MS);
        const deleteUrl = await signedUrl(blob, pathname, 'delete', now() + DELETE_URL_LIFETIME_MS);
        await dispatchIngest(fetchImpl, env.GITHUB_INGEST_TOKEN, {
          editionId: targetEditionId, packageUrl, sha256, deleteUrl
        });
        await blob.put(receipt, JSON.stringify({ edition_id: targetEditionId, package_sha256: sha256 }), {
          access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: adminRetry
        });
        return { status: 202, data: { accepted: true, duplicate: false, edition_id: targetEditionId, package_sha256: sha256 } };
      } catch (error) {
        await blob.del(pathname).catch(() => {});
        throw error;
      }
    }
  };
}

module.exports = { MAX_PACKAGE_BYTES, RECEIPT_PREFIX, RequestError, TEMP_PREFIX, authorized, createPublisher, readReceipt };
