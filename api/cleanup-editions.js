const { del, list } = require('@vercel/blob');
const { timingSafeEqual } = require('node:crypto');
const { TEMP_PREFIX } = require('./_publish-core');

const RETENTION_MS = 24 * 60 * 60 * 1000;

function matches(header, secret) {
  if (!secret || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function removeExpired({ blobList = list, blobDel = del, now = Date.now() } = {}) {
  let cursor;
  let removed = 0;
  do {
    const page = await blobList({ prefix: TEMP_PREFIX, cursor, limit: 1000 });
    const expired = page.blobs.filter(item => now - new Date(item.uploadedAt).getTime() >= RETENTION_MS);
    if (expired.length) {
      await blobDel(expired.map(item => item.url));
      removed += expired.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return removed;
}

async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') return response.status(405).json({ error: 'method not allowed' });
  if (!matches(request.headers.authorization, process.env.CRON_SECRET)) {
    return response.status(401).json({ error: 'unauthorized' });
  }
  try {
    return response.status(200).json({ removed: await removeExpired() });
  } catch (error) {
    console.error('cleanup-editions failed', error);
    return response.status(502).json({ error: 'cleanup service unavailable' });
  }
}

module.exports = handler;
module.exports.removeExpired = removeExpired;
